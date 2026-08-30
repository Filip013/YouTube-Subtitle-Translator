/**
 * Subtitle Renderer for YouTube Subtitle Translator
 * Classical Closed Caption Engine (Netflix / Movie Style)
 * 
 * Features:
 * 1. Forward Reading Window: Ensures live-translated sentences stay comfortably visible
 *    for >= 3.0 seconds after the sentence finishes speaking in real time.
 * 2. Pre-Buffered Replay Support: Perfectly synchronized to speech timestamps on seek/replay.
 * 3. Classical Captions: Zero typewriter jitter; full, ready-to-read sentences only.
 * 4. Dual Subtitle Support: Optional original English + Serbian translation.
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
    this.currentCueId = null;
    this.currentDisplayedText = '';
    this.currentDisplayedSecondary = '';
    this.rafId = null;
    this.isEnabled = true;
    this.showDualSubtitles = options.showDualSubtitles || false;

    this.styleSettings = {
      fontSize: options.fontSize || 22,
      fontColor: options.fontColor || '#ffffff',
      backgroundColor: options.backgroundColor || 'rgba(6, 6, 8, 0.88)',
      bottomOffset: options.bottomOffset || 12,
      textShadow: options.textShadow || '0px 2px 4px rgba(0, 0, 0, 0.95)'
    };
  }

  /**
   * Initializes overlay inside the YouTube player element
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
    this.statusElement.title = 'Gemini Subtitles (Classical Mode)';

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
   * Adds a completed, classical sentence cue with forward reading window
   * @param {Object} cue - { text: string, originalText?: string, startMs: number, endMs: number }
   * @param {number} [currentPlaybackMs] - Current video playback position in ms
   */
  addCue(cue, currentPlaybackMs = 0) {
    if (!cue || !cue.text) return;

    const cleanText = cue.text.trim();
    if (!cleanText) return;

    // Minimum reading time (>= 2.8s or ~380ms per word)
    const wordCount = cleanText.split(/\s+/).length;
    const readingDurationMs = Math.max(2800, wordCount * 380);

    const baseEnd = Math.max(cue.endMs, cue.startMs + readingDurationMs);
    // If watching live, extend endMs forward from current playback time so user has time to read
    const liveEnd = currentPlaybackMs > 0 ? Math.max(baseEnd, currentPlaybackMs + readingDurationMs) : baseEnd;

    const newCue = {
      id: `${cue.startMs}_${liveEnd}`,
      text: cleanText,
      originalText: (cue.originalText || '').trim(),
      startMs: cue.startMs,
      endMs: liveEnd
    };

    // Remove overlapping/duplicate cues
    this.cues = this.cues.filter(c => Math.abs(c.startMs - newCue.startMs) > 800);
    this.cues.push(newCue);
    this.cues.sort((a, b) => a.startMs - b.startMs);
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
      this.statusElement.textContent = '✨ Translating...';
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

  /**
   * Classical Movie Caption Renderer:
   * Only renders complete sentences when the video playback reaches their exact timestamp window.
   */
  _renderAtTime(currentTimeMs) {
    if (!this.textElement) return;

    const activeCue = this.cues.find(
      c => currentTimeMs >= c.startMs - 200 && currentTimeMs <= c.endMs + 300
    );

    if (activeCue) {
      const secondary = (this.showDualSubtitles && activeCue.originalText) ? activeCue.originalText : '';
      this._showText(activeCue.text, secondary, activeCue.id);
    } else {
      this._hideSubtitles();
    }
  }

  _showText(primaryText, secondaryText, cueId) {
    if (this.currentCueId === cueId) {
      return;
    }

    this.currentCueId = cueId;
    this.currentDisplayedText = primaryText;
    this.textElement.textContent = primaryText;

    if (!this.textElement.classList.contains('visible')) {
      this.textElement.classList.add('visible');
    }

    if (secondaryText && this.secondaryTextElement) {
      this.currentDisplayedSecondary = secondaryText;
      this.secondaryTextElement.textContent = secondaryText;
      if (!this.secondaryTextElement.classList.contains('visible')) {
        this.secondaryTextElement.classList.add('visible');
      }
    } else if (this.secondaryTextElement) {
      this.secondaryTextElement.classList.remove('visible');
      this.currentDisplayedSecondary = '';
    }
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
    this.currentCueId = null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SubtitleRenderer;
}
