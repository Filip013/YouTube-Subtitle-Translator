/**
 * Subtitle Renderer for YouTube Subtitle Translator
 * Creates, updates, and synchronizes the custom subtitle overlay on YouTube's player.
 */

class SubtitleRenderer {
  constructor(options = {}) {
    this.container = null;
    this.textElement = null;
    this.statusElement = null;
    this.videoElement = null;
    this.playerContainer = null;

    this.cues = []; // Sorted list of { id, text, startMs, endMs }
    this.currentCue = null;
    this.rafId = null;
    this.isEnabled = true;

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
   * @param {HTMLElement} playerContainer - YouTube player DOM element (e.g. #movie_player)
   * @param {HTMLVideoElement} videoElement
   */
  init(playerContainer, videoElement) {
    if (!playerContainer || !videoElement) return;

    this.playerContainer = playerContainer;
    this.videoElement = videoElement;

    this.destroy(); // Clean up any existing overlay
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

    this.textElement = document.createElement('div');
    this.textElement.className = 'gemini-yt-subtitle-text';

    this.container.appendChild(this.statusElement);
    this.container.appendChild(this.textElement);

    this.playerContainer.appendChild(this.container);
    this.applyStyles(this.styleSettings);
  }

  /**
   * Updates style settings dynamically
   */
  applyStyles(settings = {}) {
    this.styleSettings = { ...this.styleSettings, ...settings };
    if (!this.container || !this.textElement) return;

    this.container.style.bottom = `${this.styleSettings.bottomOffset}%`;
    this.textElement.style.fontSize = `${this.styleSettings.fontSize}px`;
    this.textElement.style.color = this.styleSettings.fontColor;
    this.textElement.style.backgroundColor = this.styleSettings.backgroundColor;
    this.textElement.style.textShadow = this.styleSettings.textShadow;
  }

  /**
   * Adds or updates a translated subtitle cue
   * @param {Object} cue - { text: string, startMs: number, endMs: number }
   */
  addCue(cue) {
    if (!cue || !cue.text) return;

    const newCue = {
      id: `${cue.startMs}_${cue.endMs}`,
      text: cue.text,
      startMs: cue.startMs,
      endMs: cue.endMs
    };

    // Remove any existing cue with the same ID or overlapping range
    this.cues = this.cues.filter(c => c.id !== newCue.id);
    this.cues.push(newCue);

    // Keep cues sorted by start time
    this.cues.sort((a, b) => a.startMs - b.startMs);
  }

  /**
   * Sets the translating status indicator (e.g. subtle pulsing dot)
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

    // Find the cue that spans the current time
    // Adding a 250ms grace margin so rapid pauses don't cause flicker
    const activeCue = this.cues.find(
      c => currentTimeMs >= c.startMs && currentTimeMs <= c.endMs + 250
    );

    if (activeCue) {
      if (this.currentCue !== activeCue) {
        this.currentCue = activeCue;
        this.textElement.textContent = activeCue.text;
        this.textElement.classList.add('visible');
      }
    } else {
      if (this.currentCue !== null) {
        this.currentCue = null;
        this.textElement.textContent = '';
        this.textElement.classList.remove('visible');
      }
    }
  }

  /**
   * Toggle enabled state
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    if (this.container) {
      this.container.style.display = enabled ? 'flex' : 'none';
    }
    if (!enabled) {
      this.clear();
    }
  }

  /**
   * Clears all cues (e.g. on new video load)
   */
  clear() {
    this.cues = [];
    this.currentCue = null;
    if (this.textElement) {
      this.textElement.textContent = '';
      this.textElement.classList.remove('visible');
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
    this.statusElement = null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SubtitleRenderer;
}
