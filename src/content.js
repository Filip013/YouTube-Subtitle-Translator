/**
 * Content Script Orchestrator for YouTube Subtitle Translator
 * Injected on YouTube pages, bridges Audio Capture, VAD, Gemini Service, Storage Manager, and Subtitle Renderer.
 */

(function () {
  'use strict';

  let currentVideoId = null;
  let vadProcessor = null;
  let audioCapture = null;
  let geminiService = null;
  let storageManager = null;
  let subtitleRenderer = null;
  let isInitialized = false;

  // Default configuration
  const config = {
    enabled: true,
    apiKey: '',
    model: 'gemini-3.5-flash-lite',
    scriptType: 'latin', // 'latin' or 'cyrillic'
    sensitivity: 'medium',
    concurrency: 3,
    enableContextChaining: true,
    fontSize: 22,
    fontColor: '#ffffff',
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    bottomOffset: 12
  };

  /**
   * Initialize settings from storage
   */
  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(config, (items) => {
        Object.assign(config, items);
        resolve(config);
      });
    });
  }

  /**
   * Initialize core components
   */
  async function init() {
    await loadSettings();

    // 1. Initialize Storage Manager
    storageManager = new StorageManager();

    // 2. Initialize Gemini Service
    geminiService = new GeminiService({
      apiKey: config.apiKey,
      model: config.model,
      scriptType: config.scriptType,
      concurrency: config.concurrency,
      enableContextChaining: config.enableContextChaining
    });

    // 3. Initialize VAD Processor
    vadProcessor = new VADProcessor({
      sampleRate: 16000,
      sensitivity: config.sensitivity
    });

    // 4. Initialize Subtitle Renderer
    subtitleRenderer = new SubtitleRenderer({
      fontSize: config.fontSize,
      fontColor: config.fontColor,
      backgroundColor: config.backgroundColor,
      bottomOffset: config.bottomOffset
    });
    subtitleRenderer.setEnabled(config.enabled);

    // 5. Initialize Audio Capture Engine
    audioCapture = new AudioCaptureEngine({
      vadProcessor: vadProcessor,
      onSpeechChunk: handleSpeechChunk
    });

    isInitialized = true;
    console.log('[GeminiSubtitles] Extension initialized with model:', config.model);

    // Listen for storage updates
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' || area === 'local') {
        let scriptChanged = false;
        for (const [key, { newValue }] of Object.entries(changes)) {
          config[key] = newValue;
          if (key === 'scriptType') scriptChanged = true;
        }

        if (geminiService) {
          geminiService.updateConfig({
            apiKey: config.apiKey,
            model: config.model,
            scriptType: config.scriptType,
            concurrency: config.concurrency,
            enableContextChaining: config.enableContextChaining
          });
        }

        if (vadProcessor && changes.sensitivity) {
          vadProcessor.updateSensitivity(config.sensitivity);
        }

        if (subtitleRenderer) {
          if (changes.enabled !== undefined) {
            subtitleRenderer.setEnabled(config.enabled);
          }
          subtitleRenderer.applyStyles({
            fontSize: config.fontSize,
            fontColor: config.fontColor,
            backgroundColor: config.backgroundColor,
            bottomOffset: config.bottomOffset
          });
        }

        // If script was changed, reload stored subtitles for this video in the new script
        if (scriptChanged && currentVideoId && storageManager) {
          loadStoredSubtitles(currentVideoId);
        }
      }
    });

    // Attach to current page video
    checkAndAttachPlayer();
  }

  /**
   * Loads previously remembered subtitles for this video
   */
  async function loadStoredSubtitles(videoId) {
    if (!storageManager || !subtitleRenderer || !videoId) return;

    try {
      const storedCues = await storageManager.loadSubtitles(videoId, config.scriptType);
      if (storedCues && storedCues.length > 0) {
        console.log(`[GeminiSubtitles] Loaded ${storedCues.length} remembered subtitles for video: ${videoId}`);
        storedCues.forEach(cue => subtitleRenderer.addCue(cue));
      }
    } catch (err) {
      console.warn('[GeminiSubtitles] Failed to load stored subtitles:', err);
    }
  }

  /**
   * Handles extracted speech chunks from VAD & Audio Engine via lookahead queue
   */
  async function handleSpeechChunk(chunk) {
    if (!config.enabled || !config.apiKey || !currentVideoId) return;

    subtitleRenderer.setStatus('translating');

    try {
      const result = await geminiService.enqueueTranslation(chunk, currentVideoId);
      subtitleRenderer.setStatus('idle');

      if (result.text) {
        const cue = {
          text: result.text,
          startMs: result.startMs,
          endMs: result.endMs
        };

        // Add to UI overlay
        subtitleRenderer.addCue(cue);

        // Save persistently so it's remembered for future views
        if (storageManager && !result.cached) {
          storageManager.saveCue(currentVideoId, config.scriptType, cue);
        }
      } else if (result.error && result.error !== 'NO_API_KEY') {
        subtitleRenderer.setStatus('error');
        setTimeout(() => subtitleRenderer.setStatus('idle'), 3000);
      }
    } catch (err) {
      console.error('[GeminiSubtitles] Translation error:', err);
      subtitleRenderer.setStatus('error');
      setTimeout(() => subtitleRenderer.setStatus('idle'), 3000);
    }
  }

  /**
   * Helper to extract Video ID from URL
   */
  function getVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('v');
  }

  /**
   * Check for YouTube player element and attach capture
   */
  async function checkAndAttachPlayer() {
    const videoId = getVideoId();
    if (!videoId) {
      if (audioCapture) audioCapture.detach();
      if (subtitleRenderer) subtitleRenderer.clear();
      currentVideoId = null;
      return;
    }

    const playerContainer = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
    const videoElement = document.querySelector('video.html5-main-video') || document.querySelector('video');

    if (playerContainer && videoElement) {
      if (currentVideoId !== videoId) {
        currentVideoId = videoId;
        if (subtitleRenderer) subtitleRenderer.clear();
        if (vadProcessor) vadProcessor.reset();
        if (geminiService) geminiService.resetQueue();

        // Load previously remembered subtitles for this video
        await loadStoredSubtitles(videoId);
      }

      subtitleRenderer.init(playerContainer, videoElement);
      audioCapture.attach(videoElement);
    } else {
      // Retry in 500ms if player is still loading
      setTimeout(checkAndAttachPlayer, 500);
    }
  }

  // Hook YouTube SPA navigation events
  window.addEventListener('yt-navigate-finish', () => {
    setTimeout(checkAndAttachPlayer, 300);
  });

  window.addEventListener('spfdone', () => {
    setTimeout(checkAndAttachPlayer, 300);
  });

  // Observe DOM changes to catch player dynamic mounts
  const observer = new MutationObserver(() => {
    const video = document.querySelector('video.html5-main-video');
    if (video && (!audioCapture || audioCapture.videoElement !== video)) {
      checkAndAttachPlayer();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Start initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
