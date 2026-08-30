/**
 * Popup Script for YouTube Subtitle Translator
 * Live Telemetry Controller, One-Click Copy Log & Copy Saved Captions
 */

document.addEventListener('DOMContentLoaded', async () => {
  const toggleEnabled = document.getElementById('toggle-enabled');
  const segmentBtns = document.querySelectorAll('.segment-btn');
  const genderBtns = document.querySelectorAll('.gender-btn');
  const apiKeyInput = document.getElementById('api-key-input');
  const btnSaveKey = document.getElementById('btn-save-key');
  const apiStatusBadge = document.getElementById('api-status-badge');
  const btnTestConnection = document.getElementById('btn-test-connection');
  const btnOpenOptions = document.getElementById('btn-open-options');
  const testResultBox = document.getElementById('test-result-box');
  const memoryDesc = document.getElementById('memory-subtitle-count');
  const btnClearCurrentVideo = document.getElementById('btn-clear-current-video');
  const btnCopySavedCues = document.getElementById('btn-copy-saved-cues');
  const liveDebugLog = document.getElementById('live-debug-log');
  const btnCopyLog = document.getElementById('btn-copy-log');

  const storageManager = new StorageManager();
  let currentScriptType = 'latin';
  let currentSpeakerGender = 'auto';
  let activeVideoId = null;
  let cachedCues = [];

  const defaultSettings = {
    enabled: true,
    apiKey: '',
    liveModel: 'gemini-3.5-live-translate-preview',
    scriptType: 'latin',
    speakerGender: 'auto',
    sensitivity: 'medium'
  };

  // Load stored settings
  chrome.storage.sync.get(defaultSettings, (items) => {
    toggleEnabled.checked = items.enabled;
    currentScriptType = items.scriptType || 'latin';
    currentSpeakerGender = items.speakerGender || 'auto';

    segmentBtns.forEach(btn => {
      if (btn.dataset.script === items.scriptType) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    genderBtns.forEach(btn => {
      if (btn.dataset.gender === items.speakerGender) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    if (items.apiKey) {
      apiKeyInput.value = items.apiKey;
      updateApiBadge(true);
    } else {
      updateApiBadge(false);
    }

    refreshLiveTelemetry();
  });

  // One-Click Copy Log Button
  if (btnCopyLog) {
    btnCopyLog.addEventListener('click', async () => {
      const textToCopy = liveDebugLog.textContent.trim();
      if (!textToCopy) return;

      try {
        await navigator.clipboard.writeText(textToCopy);
        const originalText = btnCopyLog.textContent;
        btnCopyLog.textContent = '✅ Copied!';
        btnCopyLog.style.borderColor = '#34a853';
        btnCopyLog.style.color = '#34a853';
        setTimeout(() => {
          btnCopyLog.textContent = originalText;
          btnCopyLog.style.borderColor = '';
          btnCopyLog.style.color = '';
        }, 1500);
      } catch (err) {
        console.error('Failed to copy text:', err);
      }
    });
  }

  // One-Click Copy Saved Captions Timeline Button
  if (btnCopySavedCues) {
    btnCopySavedCues.addEventListener('click', async () => {
      if (!cachedCues || cachedCues.length === 0) return;

      let formattedOutput = `=== SAVED CAPTIONS TIMELINE (Video ID: ${activeVideoId}) ===\n\n`;
      cachedCues.forEach((c, idx) => {
        const start = formatTime(c.startMs);
        const end = formatTime(c.endMs);
        formattedOutput += `[${start} -> ${end}] ${c.text}\n`;
      });

      try {
        await navigator.clipboard.writeText(formattedOutput);
        const originalText = btnCopySavedCues.textContent;
        btnCopySavedCues.textContent = '✅ Copied!';
        btnCopySavedCues.style.borderColor = '#34a853';
        btnCopySavedCues.style.color = '#34a853';
        setTimeout(() => {
          btnCopySavedCues.textContent = originalText;
          btnCopySavedCues.style.borderColor = '';
          btnCopySavedCues.style.color = '';
        }, 1500);
      } catch (err) {
        console.error('Failed to copy saved captions:', err);
      }
    });
  }

  // Continuously refresh live telemetry while popup is open
  async function refreshLiveTelemetry() {
    if (!chrome.tabs || !chrome.tabs.query) return;

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs && tabs[0] && tabs[0].url) {
        activeVideoId = StorageManager.extractVideoId(tabs[0].url);
        if (activeVideoId) {
          cachedCues = await storageManager.loadSubtitles(activeVideoId, currentScriptType);
          if (cachedCues && cachedCues.length > 0) {
            memoryDesc.textContent = `✨ ${cachedCues.length} Serbian subtitles remembered`;
            btnClearCurrentVideo.classList.remove('hidden');
            btnCopySavedCues.classList.remove('hidden');
          } else {
            memoryDesc.textContent = 'No previous subtitles for this video yet';
            btnClearCurrentVideo.classList.add('hidden');
            btnCopySavedCues.classList.add('hidden');
          }

          // Fetch real-time telemetry from content script
          chrome.storage.local.get(['yt_live_diagnostics'], (res) => {
            const diag = res.yt_live_diagnostics;
            if (diag) {
              let logText = `[Video ID] ${diag.videoId || activeVideoId}\n`;
              logText += `[Mode] ${diag.mode || 'Live Translate'}\n`;
              logText += `[Status] ${diag.status || 'Active'}\n`;
              logText += `[PCM Frames] ${diag.framesSent || 0} sent\n`;
              logText += `[Saved in Storage] ${cachedCues.length} subtitles\n`;

              if (diag.wsInfo) {
                logText += `[WebSocket] ${diag.wsInfo.wsState} (Model: ${diag.wsInfo.model})\n`;
                logText += `[Server Message] ${diag.wsInfo.lastServerMessage}\n`;
                if (diag.wsInfo.lastCloseCode) {
                  logText += `[Last Close] Code: ${diag.wsInfo.lastCloseCode} (${diag.wsInfo.lastCloseReason || 'None'})\n`;
                }
              }

              if (diag.lastTranslated) {
                logText += `[Serbian] "${diag.lastTranslated.substring(0, 45)}..."\n`;
              }
              if (diag.lastError) {
                logText += `[⚠️ Error] ${diag.lastError}\n`;
              }
              liveDebugLog.textContent = logText;
            } else {
              liveDebugLog.textContent = `[Video ID] ${activeVideoId}\nStored Subtitles: ${cachedCues.length}\nPlay the video to stream audio.`;
            }
          });
          return;
        }
      }

      activeVideoId = null;
      memoryDesc.textContent = 'Ready on YouTube video pages';
      btnClearCurrentVideo.classList.add('hidden');
      btnCopySavedCues.classList.add('hidden');
      liveDebugLog.textContent = 'Open any YouTube video to start monitoring.';
    });
  }

  const pollInterval = setInterval(refreshLiveTelemetry, 800);
  window.addEventListener('unload', () => clearInterval(pollInterval));

  // Clear current video subtitles
  btnClearCurrentVideo.addEventListener('click', async () => {
    if (!activeVideoId) return;

    if (confirm('Delete all remembered subtitles for this video?')) {
      await storageManager.deleteVideoSubtitles(activeVideoId);

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'clearActiveVideoSubtitles' }, () => {});
        }
      });

      refreshLiveTelemetry();
    }
  });

  // Toggle enable/disable
  toggleEnabled.addEventListener('change', () => {
    chrome.storage.sync.set({ enabled: toggleEnabled.checked });
  });

  // Script selection
  segmentBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      segmentBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentScriptType = btn.dataset.script;
      chrome.storage.sync.set({ scriptType: currentScriptType }, () => {
        refreshLiveTelemetry();
      });
    });
  });

  // Gender selection
  genderBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      genderBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSpeakerGender = btn.dataset.gender;
      chrome.storage.sync.set({ speakerGender: currentSpeakerGender });
    });
  });

  // Save API Key
  btnSaveKey.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    chrome.storage.sync.set({ apiKey: key }, () => {
      updateApiBadge(Boolean(key));
      showFeedback('API Key saved!', 'success');
    });
  });

  // Test Connection
  btnTestConnection.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showFeedback('Please enter an API key first.', 'error');
      return;
    }

    btnTestConnection.disabled = true;
    btnTestConnection.textContent = '⏳ Testing...';
    hideFeedback();

    const result = await GeminiService.testConnection(key, 'gemini-3.5-live-translate-preview');
    btnTestConnection.disabled = false;
    btnTestConnection.textContent = '⚡ Test API';

    if (result.success) {
      updateApiBadge(true);
      showFeedback(result.message, 'success');
    } else {
      showFeedback(`Failed: ${result.message}`, 'error');
    }
  });

  // Open Options
  btnOpenOptions.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options/options.html'));
    }
  });

  function updateApiBadge(hasKey) {
    if (hasKey) {
      apiStatusBadge.textContent = 'Key Active';
      apiStatusBadge.className = 'status-indicator active';
    } else {
      apiStatusBadge.textContent = 'Missing Key';
      apiStatusBadge.className = 'status-indicator warning';
    }
  }

  function showFeedback(message, type) {
    testResultBox.textContent = message;
    testResultBox.className = `test-result-box ${type}`;
    testResultBox.classList.remove('hidden');
  }

  function hideFeedback() {
    testResultBox.classList.add('hidden');
  }

  function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    const millis = Math.floor((ms % 1000) / 100);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${millis}`;
  }
});
