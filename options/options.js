/**
 * Options Page Script for YouTube Subtitle Translator
 * Full configuration for Two-Stage AI Pipeline, VAD tuning, and Subtitle Library Manager
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Navigation
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.card-section');
  const btnSaveAll = document.getElementById('btn-save-all');
  const saveStatusMsg = document.getElementById('save-status-msg');

  // Form Controls
  const apiKeyInput = document.getElementById('api-key');
  const btnToggleKey = document.getElementById('btn-toggle-key-visibility');
  const btnTestApi = document.getElementById('btn-test-api');
  const apiTestFeedback = document.getElementById('api-test-feedback');

  const transcribeModelIdInput = document.getElementById('transcribe-model-id');
  const translateModelIdInput = document.getElementById('translate-model-id');

  const scriptTypeRadios = document.querySelectorAll('input[name="scriptType"]');
  const speakerGenderSelect = document.getElementById('speaker-gender');

  const vadSensitivitySelect = document.getElementById('vad-sensitivity');
  const sliderSilence = document.getElementById('slider-silence');
  const valSilence = document.getElementById('val-silence');
  const sliderMaxDuration = document.getElementById('slider-max-duration');
  const valMaxDuration = document.getElementById('val-max-duration');

  const checkDualSubtitles = document.getElementById('check-dual-subtitles');
  const sliderFontSize = document.getElementById('slider-font-size');
  const valFontSize = document.getElementById('val-font-size');
  const sliderBottomOffset = document.getElementById('slider-bottom-offset');
  const valBottomOffset = document.getElementById('val-bottom-offset');
  const colorFont = document.getElementById('color-font');
  const colorBg = document.getElementById('color-bg');

  // Preview elements
  const previewOriginal = document.getElementById('preview-original');
  const previewTranslated = document.getElementById('preview-translated');
  const previewSubtitleBox = document.getElementById('preview-subtitle-box');

  // Video Library
  const searchInput = document.getElementById('search-saved-videos');
  const btnClearAllLibrary = document.getElementById('btn-clear-all-library');
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

    colorFont.value = (typeof items.fontColor === 'string' && items.fontColor.startsWith('#')) ? items.fontColor : '#ffffff';
    colorBg.value = (typeof items.backgroundColor === 'string' && items.backgroundColor.startsWith('#')) ? items.backgroundColor : '#000000';

    updateLivePreview();
    renderVideoLibrary();
  });

  // Render list of saved videos
  async function renderVideoLibrary() {
    try {
      const videos = await storageManager.getAllSavedVideos();
      if (!videos || videos.length === 0) {
        videoLibraryContainer.innerHTML = `
          <div class="empty-state">
            <span class="empty-icon">📭</span>
            <h4>No Saved Subtitles Yet</h4>
            <p>Subtitles generated on YouTube will appear here and persist across sessions.</p>
          </div>`;
        return;
      }

      videoLibraryContainer.innerHTML = '';
      videos.forEach(v => {
        const item = document.createElement('div');
        item.className = 'library-item';
        item.innerHTML = `
          <div class="library-info">
            <div class="library-title" title="${v.videoTitle}">${v.videoTitle}</div>
            <div class="library-meta">
              <span>🆔 ${v.videoId}</span>
              <span>🧩 ${v.cueCount || 0} fragments</span>
              <span>🕒 ${new Date(v.updatedAt || Date.now()).toLocaleDateString()}</span>
            </div>
          </div>
          <div class="library-actions">
            <button type="button" class="btn-outline btn-view-cues" data-video-id="${v.videoId}" data-video-title="${v.videoTitle}">
              🔍 View & Edit
            </button>
            <button type="button" class="btn-danger-outline btn-del-video" data-video-id="${v.videoId}">
              🗑️
            </button>
          </div>
        `;
        videoLibraryContainer.appendChild(item);
      });

      // Hook view & delete buttons
      document.querySelectorAll('.btn-view-cues').forEach(btn => {
        btn.addEventListener('click', () => openFragmentModal(btn.dataset.videoId, btn.dataset.videoTitle));
      });

      document.querySelectorAll('.btn-del-video').forEach(btn => {
        btn.addEventListener('click', async () => {
          const vId = btn.dataset.videoId;
          if (confirm(`Delete all saved subtitles for video (${vId})?`)) {
            await storageManager.deleteVideoSubtitles(vId);
            renderVideoLibrary();
          }
        });
      });
    } catch (e) {
      console.error('Error rendering library:', e);
    }
  }

  // Open modal with fragment editor
  async function openFragmentModal(videoId, videoTitle) {
    activeModalVideoId = videoId;
    modalVideoTitle.textContent = videoTitle || `YouTube Video (${videoId})`;
    fragmentModal.classList.remove('hidden');

    activeModalCues = await storageManager.loadSubtitles(videoId, currentScriptType);
    renderModalFragments();
  }

  function renderModalFragments() {
    if (!activeModalCues || activeModalCues.length === 0) {
      modalFragmentList.innerHTML = '<p class="text-muted" style="padding: 20px; text-align: center;">No fragments found for this video.</p>';
      return;
    }

    modalFragmentList.innerHTML = '';
    activeModalCues.forEach((cue, index) => {
      const row = document.createElement('div');
      row.className = 'fragment-row';
      const cueId = `${cue.startMs}_${cue.endMs}`;
      const timeStr = `${formatTime(cue.startMs)} ➔ ${formatTime(cue.endMs)}`;

      row.innerHTML = `
        <span class="frag-time">${timeStr}</span>
        <div class="frag-text">
          <div class="frag-serbian">${cue.text}</div>
          ${cue.originalText ? `<div class="frag-original">${cue.originalText}</div>` : ''}
        </div>
        <button type="button" class="btn-danger-icon btn-del-cue" data-cue-id="${cueId}">✕</button>
      `;
      modalFragmentList.appendChild(row);
    });

    // Individual delete buttons
    document.querySelectorAll('.btn-del-cue').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cueId = btn.dataset.cueId;
        activeModalCues = await storageManager.deleteCue(activeModalVideoId, currentScriptType, cueId);
        renderModalFragments();
        renderVideoLibrary();
      });
    });
  }

  // Close modal
  modalBtnClose.addEventListener('click', () => {
    fragmentModal.classList.add('hidden');
    activeModalVideoId = null;
  });

  // Export SRT
  modalBtnExport.addEventListener('click', () => {
    if (!activeModalCues || activeModalCues.length === 0) return;
    const srtContent = StorageManager.exportSRT(activeModalCues);
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `subtitles_${activeModalVideoId}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Delete all in modal
  modalBtnDeleteAll.addEventListener('click', async () => {
    if (confirm('Delete all saved subtitles for this video?')) {
      await storageManager.deleteVideoSubtitles(activeModalVideoId);
      fragmentModal.classList.add('hidden');
      renderVideoLibrary();
    }
  });

  // Clear all library
  btnClearAllLibrary.addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete ALL saved subtitles across ALL videos?')) {
      await storageManager.clearAll();
      renderVideoLibrary();
    }
  });

  // Save All Settings
  btnSaveAll.addEventListener('click', () => {
    let scriptVal = 'latin';
    scriptTypeRadios.forEach(r => {
      if (r.checked) scriptVal = r.value;
    });

    const newSettings = {
      apiKey: apiKeyInput.value.trim(),
      transcribeModel: transcribeModelIdInput.value.trim() || 'gemini-3.5-transcribe-live',
      translateModel: translateModelIdInput.value.trim() || 'gemini-3.1-flash-lite',
      scriptType: scriptVal,
      speakerGender: speakerGenderSelect.value,
      sensitivity: vadSensitivitySelect.value,
      silenceHangoverMs: parseInt(sliderSilence.value, 10),
      maxSpeechDurationMs: parseInt(sliderMaxDuration.value, 10),
      showDualSubtitles: checkDualSubtitles.checked,
      fontSize: parseInt(sliderFontSize.value, 10),
      bottomOffset: parseInt(sliderBottomOffset.value, 10),
      fontColor: colorFont.value,
      backgroundColor: colorBg.value
    };

    chrome.storage.sync.set(newSettings, () => {
      saveStatusMsg.textContent = 'Settings saved successfully!';
      saveStatusMsg.classList.add('visible');
      setTimeout(() => {
        saveStatusMsg.classList.remove('visible');
      }, 2500);
    });
  });

  // Live preview updates
  function updateLivePreview() {
    previewSubtitleBox.style.fontSize = `${sliderFontSize.value}px`;
    previewSubtitleBox.style.color = colorFont.value;
    previewSubtitleBox.style.backgroundColor = colorBg.value;

    if (checkDualSubtitles.checked) {
      previewOriginal.style.display = 'block';
    } else {
      previewOriginal.style.display = 'none';
    }
  }

  sliderFontSize.addEventListener('input', () => {
    valFontSize.textContent = sliderFontSize.value;
    updateLivePreview();
  });

  sliderBottomOffset.addEventListener('input', () => {
    valBottomOffset.textContent = sliderBottomOffset.value;
  });

  sliderSilence.addEventListener('input', () => {
    valSilence.textContent = sliderSilence.value;
  });

  sliderMaxDuration.addEventListener('input', () => {
    valMaxDuration.textContent = sliderMaxDuration.value;
  });

  colorFont.addEventListener('input', updateLivePreview);
  colorBg.addEventListener('input', updateLivePreview);
  checkDualSubtitles.addEventListener('change', updateLivePreview);

  // Toggle API key visibility
  btnToggleKey.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  // Test API Key
  btnTestApi.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showApiFeedback('Please enter an API key first.', 'error');
      return;
    }

    btnTestApi.disabled = true;
    btnTestApi.textContent = 'Testing...';
    hideApiFeedback();

    const result = await GeminiService.testConnection(key, 'gemini-2.5-flash');
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

  function hideApiFeedback() {
    apiTestFeedback.classList.add('hidden');
  }

  function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }
});
