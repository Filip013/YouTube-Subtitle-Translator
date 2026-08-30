/**
 * Subtitle Renderer for YouTube Subtitle Translator
 * Professional, Smooth, Stutter-Free Subtitle Rendering Engine.
 * Features:
 * - Anti-flicker Hold Buffer (ensures subtitles stay visible comfortably for >= 2.5s)
 * - Seamless in-place text updates without DOM recreation
 * - Dual Subtitle Support (English original + Serbian translation)
 * - Video playback synchronization with requestAnimationFrame
 */

class SubtitleRenderer {
  constructor(options = {}) {
    this.container = null;
    this.textElement = null;
    this.secondaryTextElement = null;
    this.statusElement = null;
    this.videoElement = null;
    this.playerContainer = null;

    this.cues = []; // Sorted list of finalized { id, text, originalText, startMs, endMs }
    this.liveCue = null; // Active live streaming cue
    this.currentDisplayedText = '';
    this.currentDisplayedSecondary = '';
    this.currentCueId = null;
    this.lastActiveTimeMs = 0;
    this.rafId = null;
    this.isEnabled = true;
    this.showDualSubtitles = options.showDualSubtitles || false;

    this.styleSettings = {
      fontSize: options.fontSize || 22,
      fontColor: options.fontColor || '#ffffff',
      backgroundColor: options.backgroundColor || 'rgba(8, 8, 8, 0.82)',
      bottomOffset: options.bottomOffset || 12,
      textShadow: options.textShadow || '0px 2px 4px rgba(0, 0, 0, 0.9)'
    };
  }

  /**
   * Initializes overlay inside the YouTube player element safely
   */
  init(playerContainer, videoElement) {
    if (!playerContainer || !videoElement) return;

    if (this.playerContainer === playerContainer && this.videoElement === videoElement && this.container && this.container.isConnected) {
      return;
    }

    this.playerContainer = playerContainer;
    this.videoElement = videoElement;

    this._cleanupDOMOnly();
    this._createDOM();
    this._startSyncLoop();
  }

  _cleanupDOMOnly() {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.textElement = null;
    this.secondaryTextElement = null;
    this.statusElement = null;
  }

  _createDOM() {
    this.container = document.createElement('div');
    this.container.className = 'gemini-yt-subtitle-container';
    this.container.id = 'gemini-yt-subtitles';

    this.statusElement = document.createElement('div');
    this.statusElement.className = 'gemini-yt-subtitle-status';
    this.statusElement.title = 'Gemini Subtitles (Serbian)';

    this.secondaryTextElement = document.createElement('div');
    this.secondaryTextElement.className = 'gemini-yt-subtitle-original';

    this.textElement = document.createElement('div');
    this.textElement.className = 'gemini-yt-subtitle-text';

    this.container.appendChild(this.statusElement);
    this.container.appendChild(this.secondaryTextElement);
    this.container.appendChild(this.textElement);

    this.playerContainer.appendChild(this.container);
    this.applyStyles(this.styleSettings);
  }

  applyStyles(settings = {}) {
    this.styleSettings = { ...this.styleSettings, ...settings };
    if (settings.showDualSubtitles !== undefined) {
      this.showDualSubtitles = settings.showDualSubtitles;
    }

    if (!this.container || !this.textElement) return;

    this.container.style.bottom = `${this.styleSettings.bottomOffset}%`;
    this.textElement.style.fontSize = `${this.styleSettings.fontSize}px`;
    this.textElement.style.color = this.styleSettings.fontColor;
    this.textElement.style.backgroundColor = this.styleSettings.backgroundColor;
    this.textElement.style.textShadow = this.styleSettings.textShadow;

    if (this.secondaryTextElement) {
      this.secondaryTextElement.style.fontSize = `${Math.max(13, Math.round(this.styleSettings.fontSize * 0.72))}px`;
    }
  }

  /**
   * Sets temporary live streaming cue
   */
  setLiveCue(text, startMs, endMs) {
    if (!text || !text.trim()) {
      this.liveCue = null;
      return;
    }
    this.liveCue = {
      text: text.trim(),
      startMs: startMs,
      endMs: Math.max(endMs, startMs + 2400)
    };
  }

  /**
   * Adds a finalized subtitle cue with anti-flicker display window
   */
  addCue(cue) {
    if (!cue || !cue.text) return;

    const cleanText = cue.text.trim();
    if (!cleanText) return;

    // Minimum 2.4s display time so reader can absorb the sentence comfortably
    const duration = Math.max(cue.endMs - cue.startMs, Math.max(2400, cleanText.split(/\s+/).length * 360));

    const newCue = {
      id: `${cue.startMs}_${cue.startMs + duration}`,
      text: cleanText,
      originalText: (cue.originalText || '').trim(),
      startMs: cue.startMs,
      endMs: cue.startMs + duration
    };

    // Remove overlapping/duplicate cues
    this.cues = this.cues.filter(c => Math.abs(c.startMs - newCue.startMs) > 600);
    this.cues.push(newCue);
    this.cues.sort((a, b) => a.startMs - b.startMs);
    this.liveCue = null;
  }

  removeCue(cueId) {
    this.cues = this.cues.filter(c => c.id !== cueId);
    if (this.currentCueId === cueId) {
      this._hideSubtitles();
    }
  }

  hasCueAtTime(currentTimeMs) {
    return this.cues.some(c => currentTimeMs >= c.startMs && currentTimeMs <= c.endMs);
  }

  getCues() {
    return [...this.cues];
  }

  setStatus(status) {
    if (!this.statusElement) return;
    if (status === 'translating') {
      this.statusElement.classList.add('translating');
      this.statusElement.textContent = '✨ Live Translating...';
    } else if (status === 'error') {
      this.statusElement.classList.remove('translating');
      this.statusElement.classList.add('error');
      this.statusElement.textContent = '⚠️ Reconnecting...';
    } else {
      this.statusElement.classList.remove('translating', 'error');
      this.statusElement.textContent = '';
    }
  }

  _startSyncLoop() {
    if (this.rafId) return;

    const update = () => {
      if (this.isEnabled && this.videoElement) {
        const currentTimeMs = this.videoElement.currentTime * 1000;
        this._renderAtTime(currentTimeMs);
      }
      this.rafId = requestAnimationFrame(update);
    };
    this.rafId = requestAnimationFrame(update);
  }

  _renderAtTime(currentTimeMs) {
    if (!this.textElement) return;

    // 1. Prioritize live streaming preview if actively receiving speech
    if (this.liveCue && currentTimeMs >= this.liveCue.startMs - 300 && currentTimeMs <= this.liveCue.endMs + 1200) {
      this._showText(this.liveCue.text, '', 'live');
      return;
    }

    // 2. Search for active finalized cue with hold buffer
    const activeCue = this.cues.find(
      c => currentTimeMs >= c.startMs - 200 && currentTimeMs <= c.endMs + 600
    );

    if (activeCue) {
      const secondary = (this.showDualSubtitles && activeCue.originalText) ? activeCue.originalText : '';
      this._showText(activeCue.text, secondary, activeCue.id);
    } else {
      this._hideSubtitles();
    }
  }

  _showText(primaryText, secondaryText, cueId) {
    if (this.currentDisplayedText !== primaryText) {
      this.currentDisplayedText = primaryText;
      this.textElement.textContent = primaryText;
    }

    if (!this.textElement.classList.contains('visible')) {
      this.textElement.classList.add('visible');
    }

    if (secondaryText && this.secondaryTextElement) {
      if (this.currentDisplayedSecondary !== secondaryText) {
        this.currentDisplayedSecondary = secondaryText;
        this.secondaryTextElement.textContent = secondaryText;
      }
      if (!this.secondaryTextElement.classList.contains('visible')) {
        this.secondaryTextElement.classList.add('visible');
      }
    } else if (this.secondaryTextElement) {
      this.secondaryTextElement.classList.remove('visible');
      this.currentDisplayedSecondary = '';
    }

    this.currentCueId = cueId;
  }

  _hideSubtitles() {
    if (this.currentCueId !== null) {
      this.currentCueId = null;
      this.currentDisplayedText = '';
      this.currentDisplayedSecondary = '';
      if (this.textElement) {
        this.textElement.classList.remove('visible');
      }
      if (this.secondaryTextElement) {
        this.secondaryTextElement.classList.remove('visible');
      }
    }
  }

  setEnabled(enabled) {
    this.isEnabled = enabled;
    if (this.container) {
      this.container.style.display = enabled ? 'flex' : 'none';
    }
    if (!enabled) {
      this.clear();
    }
  }

  clear() {
    this.cues = [];
    this.liveCue = null;
    this._hideSubtitles();
    this.setStatus('idle');
  }

  destroy() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this._cleanupDOMOnly();
    this.cues = [];
    this.liveCue = null;
    this.currentCueId = null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SubtitleRenderer;
}
