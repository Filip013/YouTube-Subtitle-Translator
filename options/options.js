/**
 * Options Script for YouTube Subtitle Translator
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const apiKeyInput = document.getElementById('api-key');
  const btnToggleKeyVisibility = document.getElementById('btn-toggle-key-visibility');
  const btnTestApi = document.getElementById('btn-test-api');
  const apiTestFeedback = document.getElementById('api-test-feedback');
  const modelIdInput = document.getElementById('model-id');
  const presetPills = document.querySelectorAll('.preset-pill');

  const scriptTypeRadios = document.querySelectorAll('input[name="scriptType"]');
  const vadSensitivitySelect = document.getElementById('vad-sensitivity');

  const sliderConcurrency = document.getElementById('slider-concurrency');
  const valConcurrency = document.getElementById('val-concurrency');
  const checkContextChaining = document.getElementById('check-context-chaining');

  const sliderSilence = document.getElementById('slider-silence');
  const valSilence = document.getElementById('val-silence');
  const sliderMaxDuration = document.getElementById('slider-max-duration');
  const valMaxDuration = document.getElementById('val-max-duration');

  const sliderFontSize = document.getElementById('slider-font-size');
  const valFontSize = document.getElementById('val-font-size');
  const sliderBottomOffset = document.getElementById('slider-bottom-offset');
  const valBottomOffset = document.getElementById('val-bottom-offset');
  const colorFont = document.getElementById('color-font');
  const colorBg = document.getElementById('color-bg');

  const previewSubtitle = document.getElementById('preview-subtitle');
  const btnSaveAll = document.getElementById('btn-save-all');
  const saveStatusMsg = document.getElementById('save-status-msg');
  const btnClearCache = document.getElementById('btn-clear-cache');
  const btnResetDefaults = document.getElementById('btn-reset-defaults');
  const savedVideosSummary = document.getElementById('saved-videos-summary');

  const storageManager = new StorageManager();

  const defaultSettings = {
    enabled: true,
    apiKey: '',
    model: 'gemini-3.5-flash-lite',
    scriptType: 'latin',
    sensitivity: 'medium',
    concurrency: 3,
    enableContextChaining: true,
    silenceHangoverMs: 350,
    maxSpeechDurationMs: 5000,
    fontSize: 22,
    bottomOffset: 12,
    fontColor: '#ffffff',
    backgroundColor: '#000000'
  };

  // Load existing settings
  chrome.storage.sync.get(defaultSettings, (items) => {
    apiKeyInput.value = items.apiKey || '';
    modelIdInput.value = items.model || 'gemini-3.5-flash-lite';

    scriptTypeRadios.forEach(radio => {
      radio.checked = radio.value === items.scriptType;
    });

    vadSensitivitySelect.value = items.sensitivity || 'medium';

    sliderConcurrency.value = items.concurrency || 3;
    valConcurrency.textContent = sliderConcurrency.value;

    checkContextChaining.checked = items.enableContextChaining !== false;

    sliderSilence.value = items.silenceHangoverMs || 350;
    valSilence.textContent = sliderSilence.value;

    sliderMaxDuration.value = items.maxSpeechDurationMs || 5000;
    valMaxDuration.textContent = sliderMaxDuration.value;

    sliderFontSize.value = items.fontSize || 22;
    valFontSize.textContent = sliderFontSize.value;

    sliderBottomOffset.value = items.bottomOffset || 12;
    valBottomOffset.textContent = sliderBottomOffset.value;

    colorFont.value = items.fontColor || '#ffffff';
    colorBg.value = items.backgroundColor || '#000000';

    updateLivePreview();
    loadSavedVideosList();
  });

  async function loadSavedVideosList() {
    try {
      const videos = await storageManager.getAllSavedVideos();
      if (!videos || videos.length === 0) {
        savedVideosSummary.innerHTML = '<em>No videos currently stored in memory. Watch any YouTube video with subtitles enabled to start caching!</em>';
        return;
      }

      let totalCues = videos.reduce((acc, v) => acc + (v.cueCount || 0), 0);
      savedVideosSummary.innerHTML = `
        <div style="font-weight: 600; color: #f8fafc; margin-bottom: 6px;">
          📚 Subtitle Memory Library: ${videos.length} video(s) cached (${totalCues} total subtitle cues)
        </div>
        <div style="font-size: 11px; opacity: 0.8;">
          When watching any of these videos, subtitles will render instantly without using Gemini API tokens.
        </div>
      `;
    } catch (err) {
      savedVideosSummary.textContent = 'Could not load video memory stats.';
    }
  }

  // Toggle API Key visibility
  btnToggleKeyVisibility.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      btnToggleKeyVisibility.textContent = '🔒';
    } else {
      apiKeyInput.type = 'password';
      btnToggleKeyVisibility.textContent = '👁️';
    }
  });

  // Preset model buttons
  presetPills.forEach(pill => {
    pill.addEventListener('click', () => {
      modelIdInput.value = pill.dataset.model;
    });
  });

  // Slider input updates & preview
  sliderConcurrency.addEventListener('input', () => {
    valConcurrency.textContent = sliderConcurrency.value;
  });

  sliderSilence.addEventListener('input', () => {
    valSilence.textContent = sliderSilence.value;
  });

  sliderMaxDuration.addEventListener('input', () => {
    valMaxDuration.textContent = sliderMaxDuration.value;
  });

  sliderFontSize.addEventListener('input', () => {
    valFontSize.textContent = sliderFontSize.value;
    updateLivePreview();
  });

  sliderBottomOffset.addEventListener('input', () => {
    valBottomOffset.textContent = sliderBottomOffset.value;
    updateLivePreview();
  });

  colorFont.addEventListener('input', updateLivePreview);
  colorBg.addEventListener('input', updateLivePreview);

  scriptTypeRadios.forEach(radio => {
    radio.addEventListener('change', updateLivePreview);
  });

  function updateLivePreview() {
    const fontSize = sliderFontSize.value;
    const bottomOffset = sliderBottomOffset.value;
    const fontColor = colorFont.value;
    const bgColor = colorBg.value;

    const selectedScript = document.querySelector('input[name="scriptType"]:checked')?.value || 'latin';
    if (selectedScript === 'cyrillic') {
      previewSubtitle.textContent = 'Ово је пример генерисаног превода на српски језик.';
    } else {
      previewSubtitle.textContent = 'Ovo je primer generisanog prevoda na srpski jezik.';
    }

    previewSubtitle.style.fontSize = `${fontSize}px`;
    previewSubtitle.style.bottom = `${bottomOffset}%`;
    previewSubtitle.style.color = fontColor;
    previewSubtitle.style.backgroundColor = `${bgColor}c7`; // ~78% opacity
  }

  // Test Connection
  btnTestApi.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    const model = modelIdInput.value.trim() || 'gemini-3.5-flash-lite';

    if (!key) {
      showApiFeedback('Please enter an API key first.', 'error');
      return;
    }

    btnTestApi.disabled = true;
    btnTestApi.textContent = 'Testing...';

    const result = await GeminiService.testConnection(key, model);
    btnTestApi.disabled = false;
    btnTestApi.textContent = 'Test Connection';

    if (result.success) {
      showApiFeedback(result.message, 'success');
    } else {
      showApiFeedback(`Connection Failed: ${result.message}`, 'error');
    }
  });

  function showApiFeedback(msg, type) {
    apiTestFeedback.textContent = msg;
    apiTestFeedback.className = `feedback-banner ${type}`;
    apiTestFeedback.classList.remove('hidden');
  }

  // Save all settings
  btnSaveAll.addEventListener('click', () => {
    const selectedScript = document.querySelector('input[name="scriptType"]:checked')?.value || 'latin';
    const settings = {
      apiKey: apiKeyInput.value.trim(),
      model: modelIdInput.value.trim() || 'gemini-3.5-flash-lite',
      scriptType: selectedScript,
      sensitivity: vadSensitivitySelect.value,
      concurrency: parseInt(sliderConcurrency.value, 10),
      enableContextChaining: checkContextChaining.checked,
      silenceHangoverMs: parseInt(sliderSilence.value, 10),
      maxSpeechDurationMs: parseInt(sliderMaxDuration.value, 10),
      fontSize: parseInt(sliderFontSize.value, 10),
      bottomOffset: parseInt(sliderBottomOffset.value, 10),
      fontColor: colorFont.value,
      backgroundColor: colorBg.value
    };

    chrome.storage.sync.set(settings, () => {
      saveStatusMsg.classList.add('visible');
      setTimeout(() => {
        saveStatusMsg.classList.remove('visible');
      }, 2500);
    });
  });

  // Clear cache & storage
  btnClearCache.addEventListener('click', async () => {
    if (confirm('Clear all remembered video subtitles and cache?')) {
      await storageManager.clearAll();
      loadSavedVideosList();
      alert('All remembered subtitles and cache cleared.');
    }
  });

  // Reset defaults
  btnResetDefaults.addEventListener('click', () => {
    if (confirm('Are you sure you want to reset all settings to defaults?')) {
      chrome.storage.sync.set(defaultSettings, () => {
        location.reload();
      });
    }
  });
});
