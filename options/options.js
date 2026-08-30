/**
 * Options Script for YouTube Subtitle Translator
 * Handles Two-Stage Pipeline settings, live preview, and Subtitle & Fragment Manager.
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const apiKeyInput = document.getElementById('api-key');
  const btnToggleKeyVisibility = document.getElementById('btn-toggle-key-visibility');
  const btnTestApi = document.getElementById('btn-test-api');
  const apiTestFeedback = document.getElementById('api-test-feedback');

  const transcribeModelIdInput = document.getElementById('transcribe-model-id');
  const translateModelIdInput = document.getElementById('translate-model-id');

  const scriptTypeRadios = document.querySelectorAll('input[name="scriptType"]');
  const speakerGenderSelect = document.getElementById('speaker-gender-select');
  const checkDualSubtitles = document.getElementById('check-dual-subtitles');

  const vadSensitivitySelect = document.getElementById('vad-sensitivity');
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

  const previewWrapper = document.getElementById('preview-wrapper');
  const previewOriginal = document.getElementById('preview-original');
  const previewSubtitle = document.getElementById('preview-subtitle');

  const btnSaveAll = document.getElementById('btn-save-all');
  const saveStatusMsg = document.getElementById('save-status-msg');
  const btnClearCache = document.getElementById('btn-clear-cache');
  const videoLibraryContainer = document.getElementById('video-library-container');

  // Modal Elements
  const fragmentModal = document.getElementById('fragment-modal');
  const modalVideoTitle = document.getElementById('modal-video-title');
  const modalFragmentList = document.getElementById('modal-fragment-list');
  const modalBtnClose = document.getElementById('modal-btn-close');
  const modalBtnExport = document.getElementById('modal-btn-export');
  const modalBtnDeleteAll = document.getElementById('modal-btn-delete-all');

  const storageManager = new StorageManager();
  let currentScriptType = 'latin';
  let activeModalVideoId = null;
  let activeModalCues = [];

  const defaultSettings = {
    enabled: true,
    apiKey: '',
    transcribeModel: 'gemini-3.5-transcribe-live',
    translateModel: 'gemini-3.1-flash-lite',
    scriptType: 'latin',
    speakerGender: 'auto',
    showDualSubtitles: false,
    sensitivity: 'medium',
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
    transcribeModelIdInput.value = items.transcribeModel || 'gemini-3.5-transcribe-live';
    translateModelIdInput.value = items.translateModel || 'gemini-3.1-flash-lite';
    currentScriptType = items.scriptType || 'latin';

    scriptTypeRadios.forEach(radio => {
      radio.checked = radio.value === items.scriptType;
    });

    speakerGenderSelect.value = items.speakerGender || 'auto';
    checkDualSubtitles.checked = Boolean(items.showDualSubtitles);
    vadSensitivitySelect.value = items.sensitivity || 'medium';

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
    renderVideoLibrary();
  });

  // Render list of saved videos
  async function renderVideoLibrary() {
    try {
      const videos = await storageManager.getAllSavedVideos();
      if (!videos || videos.length === 0) {
        videoLibraryContainer.innerHTML = `
          <div style="padding: 20px; text-align: center; color: var(--text-muted);">
            No videos currently saved in memory. Watch any YouTube video with subtitles enabled to start caching!
          </div>
        `;
        return;
      }

      videoLibraryContainer.innerHTML = '';

      videos.forEach(v => {
        const card = document.createElement('div');
        card.className = 'video-entry-card';

        const updatedDate = v.updatedAt ? new Date(v.updatedAt).toLocaleDateString() : 'Recently';

        card.innerHTML = `
          <div class="video-entry-info">
            <div class="video-entry-title">${escapeHTML(v.videoTitle || 'YouTube Video')}</div>
            <div class="video-entry-meta">
              ID: <code>${v.videoId}</code> • <strong>${v.cueCount || 0} fragments</strong> • Saved: ${updatedDate}
            </div>
          </div>
          <div class="video-entry-actions">
            <button type="button" class="btn-outline btn-view-fragments" data-id="${v.videoId}" data-title="${escapeHTML(v.videoTitle || '')}">
              👁️ View Fragments
            </button>
            <button type="button" class="btn-danger-outline btn-delete-video" data-id="${v.videoId}">
              🗑️
            </button>
          </div>
        `;

        videoLibraryContainer.appendChild(card);
      });

      // Bind action buttons
      document.querySelectorAll('.btn-view-fragments').forEach(btn => {
        btn.addEventListener('click', () => {
          openFragmentModal(btn.dataset.id, btn.dataset.title);
        });
      });

      document.querySelectorAll('.btn-delete-video').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Delete all remembered subtitles for this video?')) {
            await storageManager.deleteVideoSubtitles(btn.dataset.id);
            renderVideoLibrary();
          }
        });
      });
    } catch (err) {
      videoLibraryContainer.textContent = 'Could not load video memory library.';
    }
  }

  // Open Fragment Modal
  async function openFragmentModal(videoId, title) {
    activeModalVideoId = videoId;
    modalVideoTitle.textContent = title || `Subtitles for (${videoId})`;
    modalFragmentList.innerHTML = '<div style="padding: 10px; color: var(--text-muted);">Loading fragments...</div>';
    fragmentModal.classList.remove('hidden');

    activeModalCues = await storageManager.loadSubtitles(videoId, currentScriptType);
    renderModalFragments();
  }

  function renderModalFragments() {
    if (!activeModalCues || activeModalCues.length === 0) {
      modalFragmentList.innerHTML = '<div style="padding: 15px; color: var(--text-muted); text-align: center;">No subtitle fragments for this video.</div>';
      return;
    }

    modalFragmentList.innerHTML = '';

    activeModalCues.forEach((cue) => {
      const item = document.createElement('div');
      item.className = 'fragment-item';

      const formatTime = (ms) => {
        const totalSec = Math.floor(ms / 1000);
        const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
        const secs = String(totalSec % 60).padStart(2, '0');
        return `${mins}:${secs}`;
      };

      const originalHtml = cue.originalText ? `<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 2px;">EN: ${escapeHTML(cue.originalText)}</div>` : '';

      item.innerHTML = `
        <div class="fragment-time">${formatTime(cue.startMs)} - ${formatTime(cue.endMs)}</div>
        <div class="fragment-text">
          ${originalHtml}
          <strong>${escapeHTML(cue.text)}</strong>
        </div>
        <button type="button" class="fragment-delete-btn" data-id="${cue.startMs}_${cue.endMs}" title="Delete this fragment">❌</button>
      `;

      modalFragmentList.appendChild(item);
    });

    // Bind individual delete buttons
    document.querySelectorAll('.fragment-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cueId = btn.dataset.id;
        activeModalCues = await storageManager.deleteCue(activeModalVideoId, currentScriptType, cueId);
        renderModalFragments();
        renderVideoLibrary();
      });
    });
  }

  // Close Modal
  modalBtnClose.addEventListener('click', () => {
    fragmentModal.classList.add('hidden');
    activeModalVideoId = null;
  });

  // Export as SRT
  modalBtnExport.addEventListener('click', () => {
    if (!activeModalCues || activeModalCues.length === 0) {
      alert('No subtitles to export.');
      return;
    }

    const srtContent = StorageManager.exportSRT(activeModalCues);
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeModalVideoId}_subtitles_serbian.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // Delete All for this Video from Modal
  modalBtnDeleteAll.addEventListener('click', async () => {
    if (activeModalVideoId && confirm('Delete all subtitles for this video?')) {
      await storageManager.deleteVideoSubtitles(activeModalVideoId);
      fragmentModal.classList.add('hidden');
      renderVideoLibrary();
    }
  });

  function escapeHTML(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

  // Slider input updates & preview
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
  checkDualSubtitles.addEventListener('change', updateLivePreview);

  scriptTypeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      currentScriptType = document.querySelector('input[name="scriptType"]:checked')?.value || 'latin';
      updateLivePreview();
      renderVideoLibrary();
    });
  });

  function updateLivePreview() {
    const fontSize = sliderFontSize.value;
    const bottomOffset = sliderBottomOffset.value;
    const fontColor = colorFont.value;
    const bgColor = colorBg.value;
    const isDual = checkDualSubtitles.checked;

    const selectedScript = document.querySelector('input[name="scriptType"]:checked')?.value || 'latin';
    if (selectedScript === 'cyrillic') {
      previewSubtitle.textContent = 'Ово је пример преведеног титла на српски језик.';
    } else {
      previewSubtitle.textContent = 'Ovo je primer prevedenog titla na srpski jezik.';
    }

    if (isDual) {
      previewOriginal.classList.remove('hidden');
    } else {
      previewOriginal.classList.add('hidden');
    }

    previewWrapper.style.bottom = `${bottomOffset}%`;
    previewSubtitle.style.fontSize = `${fontSize}px`;
    previewSubtitle.style.color = fontColor;
    previewSubtitle.style.backgroundColor = `${bgColor}c7`;
  }

  // Test Connection
  btnTestApi.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    const model = translateModelIdInput.value.trim() || 'gemini-3.1-flash-lite';

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
      transcribeModel: transcribeModelIdInput.value.trim() || 'gemini-3.5-transcribe-live',
      translateModel: translateModelIdInput.value.trim() || 'gemini-3.1-flash-lite',
      scriptType: selectedScript,
      speakerGender: speakerGenderSelect.value,
      showDualSubtitles: checkDualSubtitles.checked,
      sensitivity: vadSensitivitySelect.value,
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

  // Clear all videos
  btnClearCache.addEventListener('click', async () => {
    if (confirm('Clear all saved video subtitles and cache?')) {
      await storageManager.clearAll();
      renderVideoLibrary();
      alert('All remembered subtitles and cache cleared.');
    }
  });
});
