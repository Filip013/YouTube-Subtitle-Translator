/**
 * Popup Script for YouTube Subtitle Translator
 */

document.addEventListener('DOMContentLoaded', async () => {
  const toggleEnabled = document.getElementById('toggle-enabled');
  const segmentBtns = document.querySelectorAll('.segment-btn');
  const sensitivitySelect = document.getElementById('sensitivity-select');
  const apiKeyInput = document.getElementById('api-key-input');
  const btnSaveKey = document.getElementById('btn-save-key');
  const apiStatusBadge = document.getElementById('api-status-badge');
  const btnTestConnection = document.getElementById('btn-test-connection');
  const btnOpenOptions = document.getElementById('btn-open-options');
  const testResultBox = document.getElementById('test-result-box');
  const memoryDesc = document.getElementById('memory-subtitle-count');
  const btnClearCurrentVideo = document.getElementById('btn-clear-current-video');

  const storageManager = new StorageManager();
  let currentScriptType = 'latin';
  let activeVideoId = null;

  const defaultSettings = {
    enabled: true,
    apiKey: '',
    model: 'gemini-3.1-flash-live',
    scriptType: 'latin',
    sensitivity: 'medium'
  };

  // Load stored settings
  chrome.storage.sync.get(defaultSettings, (items) => {
    toggleEnabled.checked = items.enabled;
    currentScriptType = items.scriptType || 'latin';

    segmentBtns.forEach(btn => {
      if (btn.dataset.script === items.scriptType) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    sensitivitySelect.value = items.sensitivity || 'medium';

    if (items.apiKey) {
      apiKeyInput.value = items.apiKey;
      updateApiBadge(true);
    } else {
      updateApiBadge(false);
    }

    checkActiveTabMemory();
  });

  // Check active tab memory count
  async function checkActiveTabMemory() {
    if (!chrome.tabs || !chrome.tabs.query) {
      memoryDesc.textContent = 'Storage active and ready';
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs && tabs[0] && tabs[0].url) {
        activeVideoId = StorageManager.extractVideoId(tabs[0].url);
        if (activeVideoId) {
          const cues = await storageManager.loadSubtitles(activeVideoId, currentScriptType);
          if (cues && cues.length > 0) {
            memoryDesc.textContent = `✨ ${cues.length} subtitle cues remembered`;
            btnClearCurrentVideo.classList.remove('hidden');
          } else {
            memoryDesc.textContent = 'No previous subtitles for this video yet';
            btnClearCurrentVideo.classList.add('hidden');
          }
          return;
        }
      }
      activeVideoId = null;
      memoryDesc.textContent = 'Ready on YouTube video pages';
      btnClearCurrentVideo.classList.add('hidden');
    });
  }

  // Clear current video subtitles
  btnClearCurrentVideo.addEventListener('click', async () => {
    if (!activeVideoId) return;

    if (confirm('Delete all remembered subtitles for this video?')) {
      await storageManager.deleteVideoSubtitles(activeVideoId);

      // Send message to active tab to clear subtitle overlay immediately
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'clearActiveVideoSubtitles' }, () => {});
        }
      });

      checkActiveTabMemory();
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
        checkActiveTabMemory();
      });
    });
  });

  // Sensitivity selection
  sensitivitySelect.addEventListener('change', () => {
    chrome.storage.sync.set({ sensitivity: sensitivitySelect.value });
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

    chrome.storage.sync.get({ model: 'gemini-3.1-flash-live' }, async (items) => {
      const result = await GeminiService.testConnection(key, items.model);
      btnTestConnection.disabled = false;
      btnTestConnection.textContent = '⚡ Test Connection';

      if (result.success) {
        updateApiBadge(true);
        showFeedback(result.message, 'success');
      } else {
        showFeedback(`Failed: ${result.message}`, 'error');
      }
    });
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
});
