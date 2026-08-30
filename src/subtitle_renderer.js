/**
 * Subtitle Renderer for YouTube Subtitle Translator
 * Creates, updates, and synchronizes the custom subtitle overlay on YouTube's player.
 * Supports Dual Subtitles (Original English + Translated Serbian) and custom styling.
 */

class SubtitleRenderer {
  constructor(options = {}) {
    this.container = null;
    this.textElement = null;
    this.secondaryTextElement = null; // For Dual Subtitles (Original text)
    this.statusElement = null;
    this.videoElement = null;
    this.playerContainer = null;

    this.cues = []; // Sorted list of finalized { id, text, originalText, startMs, endMs }
    this.liveCue = null; // Temporary active streaming cue
    this.currentCue = null;
    this.rafId = null;
    this.isEnabled = true;
    this.showDualSubtitles = options.showDualSubtitles || false;

    this.styleSettings = {
      fontSize: options.fontSize || 22,
      fontColor: options.fontColor || '#ffffff',
      backgroundColor: options.backgroundColor || 'rgba(0, 0, 0, 0.78)',
      bottomOffset: options.bottomOffset || 12,
      textShadow: options.textShadow || '0px 2px 4px rgba(0, 0, 0, 0.8)'
    };
  }

  /**
   * Initializes overlay inside the YouTube player element
   * @param {HTMLElement} playerContainer
   * @param {HTMLVideoElement} videoElement
   */
  init(playerContainer, videoElement) {
    if (!playerContainer || !videoElement) return;

    this.playerContainer = playerContainer;
    this.videoElement = videoElement;

    this.destroy();
    this._createDOM();
    this._startSyncLoop();
  }

  _createDOM() {
    this.container = document.createElement('div');
    this.container.className = 'gemini-yt-subtitle-container';
    this.container.id = 'gemini-yt-subtitles';

    this.statusElement = document.createElement('div');
    this.statusElement.className = 'gemini-yt-subtitle-status';
    this.statusElement.title = 'Gemini Subtitles (Serbian)';

    // Secondary original transcript element (Dual Subtitles)
    this.secondaryTextElement = document.createElement('div');
    this.secondaryTextElement.className = 'gemini-yt-subtitle-original';

    // Primary Serbian translation element
    this.textElement = document.createElement('div');
    this.textElement.className = 'gemini-yt-subtitle-text';

    this.container.appendChild(this.statusElement);
    this.container.appendChild(this.secondaryTextElement);
    this.container.appendChild(this.textElement);

    this.playerContainer.appendChild(this.container);
    this.applyStyles(this.styleSettings);
  }

  /**
   * Updates style settings dynamically
   */
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
   * Sets temporary live streaming cue (displayed during speech transcription)
   */
  setLiveCue(text, startMs, endMs) {
    if (!text) {
      this.liveCue = null;
      return;
    }
    this.liveCue = {
      text: text,
      startMs: startMs,
      endMs: endMs
    };
  }

  /**
   * Adds or updates a finalized translated subtitle cue
   * @param {Object} cue - { text: string, originalText?: string, startMs: number, endMs: number }
   */
  addCue(cue) {
    if (!cue || !cue.text) return;

    const newCue = {
      id: `${cue.startMs}_${cue.endMs}`,
      text: cue.text,
      originalText: cue.originalText || '',
      startMs: cue.startMs,
      endMs: cue.endMs
    };

    this.cues = this.cues.filter(c => c.id !== newCue.id);
    this.cues.push(newCue);
    this.cues.sort((a, b) => a.startMs - b.startMs);
    this.liveCue = null;
  }

  /**
   * Removes a specific cue by ID
   */
  removeCue(cueId) {
    this.cues = this.cues.filter(c => c.id !== cueId);
    if (this.currentCue && this.currentCue.id === cueId) {
      this.currentCue = null;
      if (this.textElement) {
        this.textElement.textContent = '';
        this.textElement.classList.remove('visible');
      }
      if (this.secondaryTextElement) {
        this.secondaryTextElement.textContent = '';
        this.secondaryTextElement.classList.remove('visible');
      }
    }
  }

  /**
   * Checks if a finalized subtitle cue already covers the given timestamp
   * @param {number} currentTimeMs 
   * @returns {boolean}
   */
  hasCueAtTime(currentTimeMs) {
    return this.cues.some(c => currentTimeMs >= c.startMs && currentTimeMs <= c.endMs);
  }

  /**
   * Returns current list of cues
   */
  getCues() {
    return [...this.cues];
  }

  /**
   * Sets the translating status indicator
   */
  setStatus(status) {
    if (!this.statusElement) return;
    if (status === 'translating') {
      this.statusElement.classList.add('translating');
      this.statusElement.textContent = '✨ Translating...';
    } else if (status === 'error') {
      this.statusElement.classList.remove('translating');
      this.statusElement.classList.add('error');
      this.statusElement.textContent = '⚠️ Translation Error';
    } else {
      this.statusElement.classList.remove('translating', 'error');
      this.statusElement.textContent = '';
    }
  }

  _startSyncLoop() {
    const update = () => {
      if (this.isEnabled && this.videoElement && !this.videoElement.paused) {
        const currentTimeMs = this.videoElement.currentTime * 1000;
        this._renderAtTime(currentTimeMs);
      }
      this.rafId = requestAnimationFrame(update);
    };
    this.rafId = requestAnimationFrame(update);
  }

  _renderAtTime(currentTimeMs) {
    if (!this.textElement) return;

    // 1. Check if we have an active live streaming transcription preview
    if (this.liveCue && currentTimeMs >= this.liveCue.startMs - 500 && currentTimeMs <= this.liveCue.endMs + 1000) {
      this.textElement.textContent = this.liveCue.text;
      this.textElement.classList.add('visible');
      if (this.secondaryTextElement) {
        this.secondaryTextElement.classList.remove('visible');
      }
      return;
    }

    // 2. Otherwise render finalized cues
    const activeCue = this.cues.find(
      c => currentTimeMs >= c.startMs && currentTimeMs <= c.endMs + 300
    );

    if (activeCue) {
      if (this.currentCue !== activeCue) {
        this.currentCue = activeCue;
        this.textElement.textContent = activeCue.text;
        this.textElement.classList.add('visible');

        // Render Dual Subtitles if originalText exists and enabled
        if (this.showDualSubtitles && activeCue.originalText && this.secondaryTextElement) {
          this.secondaryTextElement.textContent = activeCue.originalText;
          this.secondaryTextElement.classList.add('visible');
        } else if (this.secondaryTextElement) {
          this.secondaryTextElement.classList.remove('visible');
        }
      }
    } else {
      if (this.currentCue !== null) {
        this.currentCue = null;
        this.textElement.textContent = '';
        this.textElement.classList.remove('visible');
        if (this.secondaryTextElement) {
          this.secondaryTextElement.textContent = '';
          this.secondaryTextElement.classList.remove('visible');
        }
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
    this.currentCue = null;
    if (this.textElement) {
      this.textElement.textContent = '';
      this.textElement.classList.remove('visible');
    }
    if (this.secondaryTextElement) {
      this.secondaryTextElement.textContent = '';
      this.secondaryTextElement.classList.remove('visible');
    }
    this.setStatus('idle');
  }

  destroy() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.textElement = null;
    this.secondaryTextElement = null;
    this.statusElement = null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SubtitleRenderer;
}
