/**
 * Content Script Orchestrator for YouTube Subtitle Translator (Two-Stage Pipeline)
 * Stage 1: gemini-3.5-transcribe-live (Live ASR over WebSockets)
 * Stage 2: gemini-3.1-flash-lite (Fast Text-to-Text Serbian Translation)
 */

(function () {
  'use strict';

  let currentVideoId = null;
  let vadProcessor = null;
  let audioCapture = null;
  let transcribeClient = null;
  let textTranslator = null;
  let storageManager = null;
  let subtitleRenderer = null;
  let isInitialized = false;

  // Default configuration
  const config = {
    enabled: true,
    apiKey: '',
    transcribeModel: 'gemini-3.5-transcribe-live',
    translateModel: 'gemini-3.1-flash-lite',
    scriptType: 'latin', // 'latin' or 'cyrillic'
    speakerGender: 'auto', // 'auto', 'male', 'female'
    showDualSubtitles: false,
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
      bottomOffset: config.bottomOffset,
      showDualSubtitles: config.showDualSubtitles
    });
    subtitleRenderer.setEnabled(config.enabled);

    // 3. Initialize Stage 2 Text Translator
    textTranslator = new GeminiTextTranslator({
      apiKey: config.apiKey,
      model: config.translateModel,
      scriptType: config.scriptType,
      speakerGender: config.speakerGender
    });

    // 4. Initialize Stage 1 Live Transcribe Client (WebSocket ASR)
    transcribeClient = new GeminiTranscribeClient({
      apiKey: config.apiKey,
      model: config.transcribeModel,
      onTranscriptChunk: handleTranscriptChunk,
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

    // 5. Initialize VAD Processor
    vadProcessor = new VADProcessor({
      sampleRate: 16000,
      sensitivity: config.sensitivity
    });

    // 6. Initialize Audio Capture Engine
    audioCapture = new AudioCaptureEngine({
      vadProcessor: vadProcessor,
      onPCMFrame: (pcmFrame) => {
        if (!config.enabled || !config.apiKey || !transcribeClient) return;

        const currentTimeMs = Math.round(pcmFrame.videoTimeSec * 1000);

        // Skip sending audio for already subtitled sections
        if (subtitleRenderer && subtitleRenderer.hasCueAtTime(currentTimeMs)) {
          return;
        }

        transcribeClient.sendAudioFrame(pcmFrame.base64PCM, pcmFrame.videoTimeSec);
      }
    });

    isInitialized = true;
    console.log('[GeminiSubtitles] Two-Stage Pipeline Initialized: Transcribe (' + config.transcribeModel + ') + Translate (' + config.translateModel + ')');

    // Listen for storage updates
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' || area === 'local') {
        let scriptChanged = false;
        for (const [key, { newValue }] of Object.entries(changes)) {
          config[key] = newValue;
          if (key === 'scriptType') scriptChanged = true;
        }

        if (transcribeClient) {
          transcribeClient.updateConfig({
            apiKey: config.apiKey,
            model: config.transcribeModel
          });
        }

        if (textTranslator) {
          textTranslator.updateConfig({
            apiKey: config.apiKey,
            model: config.translateModel,
            scriptType: config.scriptType,
            speakerGender: config.speakerGender
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
            bottomOffset: config.bottomOffset,
            showDualSubtitles: config.showDualSubtitles
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
            if (transcribeClient) transcribeClient.resetStream();
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
   * Handles incoming transcription chunks (Stage 1 -> Stage 2)
   */
  async function handleTranscriptChunk(chunkData) {
    if (!config.enabled || !currentVideoId) return;

    if (!chunkData.isFinal) {
      // Live transcription preview on screen
      subtitleRenderer.setLiveCue(chunkData.text, chunkData.startMs, chunkData.endMs);
    } else {
      // Stage 2: Translate clean English sentence to Serbian via Flash Lite
      const englishText = chunkData.text;
      const serbianText = await textTranslator.translateText(englishText);

      if (serbianText) {
        const cue = {
          text: serbianText,
          originalText: englishText,
          startMs: chunkData.startMs,
          endMs: chunkData.endMs
        };

        subtitleRenderer.addCue(cue);

        if (storageManager) {
          const title = getVideoTitle();
          await storageManager.saveCue(currentVideoId, config.scriptType, cue, title);
          console.log(`[GeminiSubtitles] Saved fragment: "${englishText}" -> "${serbianText}" [${cue.startMs}ms - ${cue.endMs}ms]`);
        }
      }
    }
  }

  /**
   * Check for YouTube player element and attach capture idempotently
   */
  async function checkAndAttachPlayer() {
    const videoId = StorageManager.extractVideoId(window.location.href);
    if (!videoId) {
      if (audioCapture) audioCapture.detach();
      if (transcribeClient) transcribeClient.disconnect();
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
        if (transcribeClient) {
          transcribeClient.resetStream();
          transcribeClient.connect();
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
    setTimeout(checkAndAttachPlayer, 200);
  });

  window.addEventListener('spfdone', () => {
    setTimeout(checkAndAttachPlayer, 200);
  });

  // Track URL changes safely
  let lastObservedUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastObservedUrl) {
      lastObservedUrl = window.location.href;
      checkAndAttachPlayer();
    }
  }, 1000);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
