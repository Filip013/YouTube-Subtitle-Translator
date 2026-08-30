/**
 * Content Script Orchestrator for YouTube Subtitle Translator
 * Bridges Audio Capture, Gemini Live Client (WebSocket), Storage Manager, and Subtitle Renderer.
 */

(function () {
  'use strict';

  let currentVideoId = null;
  let vadProcessor = null;
  let audioCapture = null;
  let geminiLiveClient = null;
  let storageManager = null;
  let subtitleRenderer = null;
  let isInitialized = false;

  // Default configuration
  const config = {
    enabled: true,
    apiKey: '',
    model: 'gemini-3.1-flash-live',
    scriptType: 'latin', // 'latin' or 'cyrillic'
    sensitivity: 'medium',
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
   * Get clean YouTube video title from DOM
   */
  function getVideoTitle() {
    const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
                    document.querySelector('#title h1 yt-formatted-string') ||
                    document.querySelector('h1.title');
    if (titleEl && titleEl.textContent.trim()) {
      return titleEl.textContent.trim();
    }
    return document.title.replace(' - YouTube', '').trim();
  }

  /**
   * Initialize core components
   */
  async function init() {
    await loadSettings();

    // 1. Initialize Storage Manager
    storageManager = new StorageManager();

    // 2. Initialize Subtitle Renderer
    subtitleRenderer = new SubtitleRenderer({
      fontSize: config.fontSize,
      fontColor: config.fontColor,
      backgroundColor: config.backgroundColor,
      bottomOffset: config.bottomOffset
    });
    subtitleRenderer.setEnabled(config.enabled);

    // 3. Initialize Gemini Live Client (WebSocket streaming)
    geminiLiveClient = new GeminiLiveClient({
      apiKey: config.apiKey,
      model: config.model,
      scriptType: config.scriptType,
      onSubtitleChunk: handleLiveSubtitleChunk,
      onStatusChange: (status, msg) => {
        if (status === 'connecting') {
          subtitleRenderer.setStatus('translating');
        } else if (status === 'error') {
          subtitleRenderer.setStatus('error');
          setTimeout(() => subtitleRenderer.setStatus('idle'), 3000);
        } else if (status === 'connected') {
          subtitleRenderer.setStatus('idle');
        }
      }
    });

    // 4. Initialize VAD Processor
    vadProcessor = new VADProcessor({
      sampleRate: 16000,
      sensitivity: config.sensitivity
    });

    // 5. Initialize Audio Capture Engine
    audioCapture = new AudioCaptureEngine({
      vadProcessor: vadProcessor,
      onPCMFrame: (pcmFrame) => {
        if (!config.enabled || !config.apiKey || !geminiLiveClient) return;

        const currentTimeMs = Math.round(pcmFrame.videoTimeSec * 1000);

        // Check if this time range is ALREADY subtitled and saved in memory:
        if (subtitleRenderer && subtitleRenderer.hasCueAtTime(currentTimeMs)) {
          // Skip sending audio to avoid duplicate API calls & re-translation
          return;
        }

        // Stream audio for un-subtitled territory
        geminiLiveClient.sendAudioFrame(pcmFrame.base64PCM, pcmFrame.videoTimeSec);
      }
    });

    isInitialized = true;
    console.log('[GeminiSubtitles] Extension initialized with Live model:', config.model);

    // Listen for storage updates
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' || area === 'local') {
        let scriptChanged = false;
        for (const [key, { newValue }] of Object.entries(changes)) {
          config[key] = newValue;
          if (key === 'scriptType') scriptChanged = true;
        }

        if (geminiLiveClient) {
          geminiLiveClient.updateConfig({
            apiKey: config.apiKey,
            model: config.model,
            scriptType: config.scriptType
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

        if (scriptChanged && currentVideoId && storageManager) {
          loadStoredSubtitles(currentVideoId);
        }
      }
    });

    // Listen for message actions (e.g. clear video subtitles)
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'clearActiveVideoSubtitles' && currentVideoId) {
        if (storageManager) {
          storageManager.deleteVideoSubtitles(currentVideoId).then(() => {
            if (subtitleRenderer) subtitleRenderer.clear();
            if (geminiLiveClient) geminiLiveClient.resetStream();
            sendResponse({ success: true });
          });
          return true;
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
   * Handles streaming subtitle chunks received from Gemini Live API
   */
  async function handleLiveSubtitleChunk(subtitleData) {
    if (!config.enabled || !currentVideoId) return;

    if (!subtitleData.isFinal) {
      // Live preview on screen
      subtitleRenderer.setLiveCue(subtitleData.text, subtitleData.startMs, subtitleData.endMs);
    } else {
      // Finalized sentence cue: commit and save immediately
      const cue = {
        text: subtitleData.text,
        startMs: subtitleData.startMs,
        endMs: subtitleData.endMs
      };

      subtitleRenderer.addCue(cue);

      if (storageManager) {
        const title = getVideoTitle();
        await storageManager.saveCue(currentVideoId, config.scriptType, cue, title);
        console.log(`[GeminiSubtitles] Successfully persisted fragment [${cue.startMs}ms - ${cue.endMs}ms]: ${cue.text}`);
      }
    }
  }

  /**
   * Check for YouTube player element and attach capture
   */
  async function checkAndAttachPlayer() {
    const videoId = StorageManager.extractVideoId(window.location.href);
    if (!videoId) {
      if (audioCapture) audioCapture.detach();
      if (geminiLiveClient) geminiLiveClient.disconnect();
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
        if (geminiLiveClient) {
          geminiLiveClient.resetStream();
          geminiLiveClient.connect();
        }

        await loadStoredSubtitles(videoId);
      }

      subtitleRenderer.init(playerContainer, videoElement);
      audioCapture.attach(videoElement);
    } else {
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

  const observer = new MutationObserver(() => {
    const video = document.querySelector('video.html5-main-video');
    if (video && (!audioCapture || audioCapture.videoElement !== video)) {
      checkAndAttachPlayer();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
