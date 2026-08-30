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

  // Real-time telemetry state
  const diagnostics = {
    videoId: null,
    status: 'Initializing...',
    audioLevel: 0,
    framesSent: 0,
    cuesSaved: 0,
    lastTranscribed: '',
    lastTranslated: '',
    lastError: null,
    lastUpdated: Date.now()
  };

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

  function publishDiagnostics(extra = {}) {
    Object.assign(diagnostics, extra, {
      videoId: currentVideoId,
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
        diagnostics.framesSent++;
        diagnostics.audioLevel = Math.round((pcmFrame.rms || 0) * 100);

        if (diagnostics.framesSent % 20 === 0) {
          publishDiagnostics({ status: `Streaming audio (Level: ${diagnostics.audioLevel}%)` });
        }
      }
    });

    isInitialized = true;
    console.log('[GeminiSubtitles] Extension initialized with Live Transcribe:', config.transcribeModel);

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
            publishDiagnostics({ cuesSaved: 0, lastTranscribed: '', lastTranslated: '' });
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
        publishDiagnostics({
          status: `Loaded ${storedCues.length} fragments from memory`,
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
   * Handles incoming transcription chunks (Stage 1 -> Stage 2)
   */
  async function handleTranscriptChunk(chunkData) {
    if (!config.enabled || !currentVideoId) return;

    if (!chunkData.isFinal) {
      // Live transcription preview on screen
      subtitleRenderer.setLiveCue(chunkData.text, chunkData.startMs, chunkData.endMs);
      publishDiagnostics({ lastTranscribed: chunkData.text });
    } else {
      const englishText = chunkData.text;
      const title = getVideoTitle();

      // 1. Immediately save the transcript cue so progress is NEVER lost!
      const initialCue = {
        text: englishText,
        originalText: englishText,
        startMs: chunkData.startMs,
        endMs: chunkData.endMs
      };
      subtitleRenderer.addCue(initialCue);
      if (storageManager) {
        await storageManager.saveCue(currentVideoId, config.scriptType, initialCue, title);
      }

      publishDiagnostics({
        status: `Translating: "${englishText.substring(0, 30)}..."`,
        lastTranscribed: englishText,
        cuesSaved: subtitleRenderer.getCues().length
      });

      // 2. Stage 2: Translate English sentence to natural Serbian via Flash Lite
      const serbianText = await textTranslator.translateText(englishText);

      if (serbianText && serbianText !== englishText) {
        const translatedCue = {
          text: serbianText,
          originalText: englishText,
          startMs: chunkData.startMs,
          endMs: chunkData.endMs
        };

        subtitleRenderer.addCue(translatedCue);

        if (storageManager) {
          await storageManager.saveCue(currentVideoId, config.scriptType, translatedCue, title);
          publishDiagnostics({
            status: 'Fragment translated & saved!',
            lastTranslated: serbianText,
            cuesSaved: subtitleRenderer.getCues().length
          });
          console.log(`[GeminiSubtitles] Saved translated fragment: "${englishText}" -> "${serbianText}" [${translatedCue.startMs}ms - ${translatedCue.endMs}ms]`);
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
