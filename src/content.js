/**
 * Content Script Orchestrator for YouTube Subtitle Translator
 * PURE TRANSCRIPTION MODE (Stage 1: gemini-3.5-transcribe-live)
 * Direct real-time speech-to-text with immediate disk persistence in chrome.storage.local
 */

(function () {
  'use strict';

  let currentVideoId = null;
  let vadProcessor = null;
  let audioCapture = null;
  let transcribeClient = null;
  let storageManager = null;
  let subtitleRenderer = null;
  let isInitialized = false;

  // Real-time telemetry state
  const diagnostics = {
    videoId: null,
    mode: 'Pure Transcription (gemini-3.5-transcribe-live)',
    status: 'Initializing...',
    audioLevel: 0,
    framesSent: 0,
    cuesSaved: 0,
    lastTranscribed: '',
    wsInfo: null,
    lastError: null,
    lastUpdated: Date.now()
  };

  // Default configuration
  const config = {
    enabled: true,
    apiKey: '',
    transcribeModel: 'gemini-3.5-transcribe-live',
    sensitivity: 'medium',
    fontSize: 22,
    fontColor: '#ffffff',
    backgroundColor: '#000000',
    bottomOffset: 12
  };

  function publishDiagnostics(extra = {}) {
    const wsInfo = transcribeClient ? transcribeClient.getDebugInfo() : null;

    Object.assign(diagnostics, extra, {
      videoId: currentVideoId,
      wsInfo: wsInfo,
      cuesSaved: subtitleRenderer ? subtitleRenderer.getCues().length : 0,
      lastUpdated: Date.now()
    });

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ yt_live_diagnostics: diagnostics });
    }
  }

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
      showDualSubtitles: false
    });
    subtitleRenderer.setEnabled(config.enabled);

    // 3. Initialize Live Transcribe Client (WebSocket Speech-to-Text)
    transcribeClient = new GeminiTranscribeClient({
      apiKey: config.apiKey,
      model: config.transcribeModel,
      onTranscriptChunk: handleTranscriptChunk,
      onStatusChange: (status, msg) => {
        publishDiagnostics({ status: msg, lastError: status === 'error' ? msg : null });
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
        if (!config.enabled || !config.apiKey || !transcribeClient) return;

        // Stream audio continuously to Live Transcribe WebSocket
        transcribeClient.sendAudioFrame(pcmFrame.base64PCM, pcmFrame.videoTimeSec);
        diagnostics.framesSent++;
        diagnostics.audioLevel = Math.round((pcmFrame.rms || 0) * 100);

        if (diagnostics.framesSent % 25 === 0) {
          publishDiagnostics({ status: `Streaming audio (Signal: ${diagnostics.audioLevel}%)` });
        }
      }
    });

    isInitialized = true;
    console.log('[GeminiSubtitles] Pure Transcription Mode initialized with model:', config.transcribeModel);

    // Listen for storage updates
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' || area === 'local') {
        for (const [key, { newValue }] of Object.entries(changes)) {
          config[key] = newValue;
        }

        if (transcribeClient) {
          transcribeClient.updateConfig({
            apiKey: config.apiKey,
            model: config.transcribeModel
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
            showDualSubtitles: false
          });
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
            publishDiagnostics({ cuesSaved: 0, lastTranscribed: '' });
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
   * Loads previously remembered transcription fragments for this video
   */
  async function loadStoredSubtitles(videoId) {
    if (!storageManager || !subtitleRenderer || !videoId) return;

    try {
      const storedCues = await storageManager.loadSubtitles(videoId);
      if (storedCues && storedCues.length > 0) {
        console.log(`[GeminiSubtitles] Loaded ${storedCues.length} remembered transcription fragments for video: ${videoId}`);
        storedCues.forEach(cue => subtitleRenderer.addCue(cue));
        publishDiagnostics({
          status: `Loaded ${storedCues.length} saved fragments from disk`,
          cuesSaved: storedCues.length
        });
      } else {
        console.log(`[GeminiSubtitles] No existing saved subtitles for video: ${videoId}`);
        publishDiagnostics({
          status: 'Ready. No saved fragments yet.',
          cuesSaved: 0
        });
      }
    } catch (err) {
      console.warn('[GeminiSubtitles] Failed to load stored subtitles:', err);
    }
  }

  /**
   * Handles incoming transcription chunks from Live WebSocket ASR
   */
  async function handleTranscriptChunk(chunkData) {
    if (!config.enabled || !currentVideoId) return;

    const transcriptText = (chunkData.text || '').trim();
    if (!transcriptText) return;

    const title = getVideoTitle();

    if (!chunkData.isFinal) {
      // 1. Live transcription preview on player overlay
      subtitleRenderer.setLiveCue(transcriptText, chunkData.startMs, chunkData.endMs);
      publishDiagnostics({ lastTranscribed: transcriptText });
    } else {
      // 2. Finalized sentence: Save directly to disk (chrome.storage.local) and add as permanent cue
      const cue = {
        text: transcriptText,
        originalText: transcriptText,
        startMs: chunkData.startMs,
        endMs: chunkData.endMs
      };

      subtitleRenderer.addCue(cue);

      if (storageManager) {
        await storageManager.saveCue(currentVideoId, 'latin', cue, title);
        publishDiagnostics({
          status: 'Saved transcription fragment to disk!',
          lastTranscribed: transcriptText,
          cuesSaved: subtitleRenderer.getCues().length
        });
        console.log(`[GeminiSubtitles] 💾 Persisted fragment [${cue.startMs}ms - ${cue.endMs}ms]: "${transcriptText}"`);
      }
    }
  }

  /**
   * Check for YouTube player element and attach capture idempotently
   */
  async function checkAndAttachPlayer() {
    if (!isInitialized || !subtitleRenderer || !storageManager || !transcribeClient || !audioCapture) {
      return;
    }

    const videoId = StorageManager.extractVideoId(window.location.href);
    if (!videoId) {
      if (audioCapture) audioCapture.detach();
      if (transcribeClient) transcribeClient.disconnect();
      if (subtitleRenderer) subtitleRenderer.clear();
      currentVideoId = null;
      publishDiagnostics({ status: 'Not on a YouTube video page' });
      return;
    }

    const playerContainer = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
    const videoElement = document.querySelector('video.html5-main-video') || document.querySelector('video');

    if (playerContainer && videoElement) {
      const isNewVideo = currentVideoId !== videoId;

      if (isNewVideo) {
        currentVideoId = videoId;
        diagnostics.framesSent = 0;
        if (subtitleRenderer) subtitleRenderer.clear();
        if (vadProcessor) vadProcessor.reset();
        if (transcribeClient) {
          transcribeClient.resetStream();
          transcribeClient.connect();
        }
      }

      subtitleRenderer.init(playerContainer, videoElement);
      audioCapture.attach(videoElement);

      if (isNewVideo) {
        await loadStoredSubtitles(videoId);
      }
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
