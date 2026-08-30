/**
 * Audio Capture Engine for YouTube Subtitle Translator
 * Captures live audio directly from HTML5 <video> with singleton node caching,
 * auto-resuming AudioContext on playback, and 16kHz PCM streaming.
 */

class AudioCaptureEngine {
  /**
   * @param {Object} options
   * @param {VADProcessor} [options.vadProcessor]
   * @param {Function} [options.onPCMFrame] - Callback({ base64PCM, videoTimeSec, rms })
   * @param {Function} [options.onSpeechChunk] - Callback({ base64Audio, startMs, endMs, durationMs })
   */
  constructor(options = {}) {
    this.vadProcessor = options.vadProcessor || null;
    this.onPCMFrame = options.onPCMFrame || null;
    this.onSpeechChunk = options.onSpeechChunk || null;

    this.videoElement = null;
    this.audioContext = null;
    this.mediaSourceNode = null;
    this.processorNode = null;
    this.silentGainNode = null;
    this.isCapturing = false;
    this.lastAudioLevel = 0;

    this._boundOnPlay = this._handlePlay.bind(this);
    this._boundOnPause = this._handlePause.bind(this);
    this._boundOnTimeUpdate = this._handleTimeUpdate.bind(this);
    this._boundOnSeeking = this._handleSeeking.bind(this);
    this._boundOnSeeked = this._handleSeeked.bind(this);
    this._boundOnEnded = this._handleEnded.bind(this);

    if (this.vadProcessor) {
      this.vadProcessor.onChunkReady = this._handleVADChunk.bind(this);
    }
  }

  /**
   * Attaches audio capture to a target HTML5 Video element
   * @param {HTMLVideoElement} video
   */
  attach(video) {
    if (!video) return;
    if (this.videoElement === video && this.isCapturing) {
      this._resumeContext();
      return;
    }

    this.detach();
    this.videoElement = video;

    this.videoElement.addEventListener('play', this._boundOnPlay);
    this.videoElement.addEventListener('playing', this._boundOnPlay);
    this.videoElement.addEventListener('pause', this._boundOnPause);
    this.videoElement.addEventListener('timeupdate', this._boundOnTimeUpdate);
    this.videoElement.addEventListener('seeking', this._boundOnSeeking);
    this.videoElement.addEventListener('seeked', this._boundOnSeeked);
    this.videoElement.addEventListener('ended', this._boundOnEnded);

    this._initAudioPipeline();
  }

  _resumeContext() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
  }

  /**
   * Detaches from current video and releases Web Audio resources
   */
  detach() {
    if (this.videoElement) {
      this.videoElement.removeEventListener('play', this._boundOnPlay);
      this.videoElement.removeEventListener('playing', this._boundOnPlay);
      this.videoElement.removeEventListener('pause', this._boundOnPause);
      this.videoElement.removeEventListener('timeupdate', this._boundOnTimeUpdate);
      this.videoElement.removeEventListener('seeking', this._boundOnSeeking);
      this.videoElement.removeEventListener('seeked', this._boundOnSeeked);
      this.videoElement.removeEventListener('ended', this._boundOnEnded);
      this.videoElement = null;
    }

    if (this.processorNode) {
      this.processorNode.onaudioprocess = null;
      try { this.processorNode.disconnect(); } catch (e) {}
      this.processorNode = null;
    }

    if (this.silentGainNode) {
      try { this.silentGainNode.disconnect(); } catch (e) {}
      this.silentGainNode = null;
    }

    if (this.vadProcessor) {
      this.vadProcessor.reset();
    }

    this.isCapturing = false;
  }

  _initAudioPipeline() {
    if (!this.videoElement) return;

    try {
      // Re-use existing AudioContext & MediaSourceNode on the HTMLVideoElement to prevent InvalidStateError
      if (!this.videoElement.__geminiAudioContext) {
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        this.videoElement.__geminiAudioContext = new AudioCtxClass();
        try {
          this.videoElement.__geminiMediaSource = this.videoElement.__geminiAudioContext.createMediaElementSource(this.videoElement);
          this.videoElement.__geminiMediaSource.connect(this.videoElement.__geminiAudioContext.destination);
        } catch (err) {
          console.warn('[GeminiSubtitles] MediaElementSource attachment notice:', err);
        }
      }

      this.audioContext = this.videoElement.__geminiAudioContext;
      this.mediaSourceNode = this.videoElement.__geminiMediaSource;

      this._resumeContext();

      if (!this.mediaSourceNode) {
        console.warn('[GeminiSubtitles] MediaSourceNode not available. Will retry on play.');
        return;
      }

      // Process audio in 4096-sample buffer frames (~85ms at 48kHz)
      const bufferSize = 4096;
      this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

      this.processorNode.onaudioprocess = (event) => {
        if (!this.isCapturing || !this.videoElement || this.videoElement.paused) return;

        const inputData = event.inputBuffer.getChannelData(0);
        const inputSampleRate = event.inputBuffer.sampleRate;
        const videoTime = this.videoElement.currentTime;

        // Calculate RMS audio energy
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        this.lastAudioLevel = rms;

        // Resample input audio buffer to 16kHz mono
        const resampled16k = AudioUtils.resampleTo16k(inputData, inputSampleRate, 16000);

        // 1. Stream raw PCM to Live Client (WebSocket)
        if (this.onPCMFrame) {
          const base64PCM = AudioUtils.floatTo16BitPCMBase64(resampled16k);
          this.onPCMFrame({
            base64PCM,
            videoTimeSec: videoTime,
            rms: rms
          });
        }

        // 2. Feed into VAD processor
        if (this.vadProcessor) {
          this.vadProcessor.processFrame(resampled16k, videoTime);
        }
      };

      // Connect through a zero-gain node to keep processing active
      this.silentGainNode = this.audioContext.createGain();
      this.silentGainNode.gain.value = 0;

      this.mediaSourceNode.connect(this.processorNode);
      this.processorNode.connect(this.silentGainNode);
      this.silentGainNode.connect(this.audioContext.destination);

      this.isCapturing = true;
      console.log('[GeminiSubtitles] Audio capture pipeline attached successfully. Context State:', this.audioContext.state);
    } catch (err) {
      console.error('[GeminiSubtitles] Failed to initialize Audio pipeline:', err);
    }
  }

  _handleVADChunk(vadChunk) {
    const { audioBuffer, sampleRate, startMs, endMs, durationMs } = vadChunk;
    const wavArrayBuffer = AudioUtils.encodeWAV(audioBuffer, sampleRate || 16000);
    const base64Audio = AudioUtils.arrayBufferToBase64(wavArrayBuffer);

    if (this.onSpeechChunk) {
      this.onSpeechChunk({
        base64Audio,
        startMs,
        endMs,
        durationMs
      });
    }
  }

  _handlePlay() {
    this._resumeContext();
    if (!this.isCapturing) {
      this._initAudioPipeline();
    }
  }

  _handleTimeUpdate() {
    if (this.audioContext && this.audioContext.state === 'suspended' && this.videoElement && !this.videoElement.paused) {
      this._resumeContext();
    }
  }

  _handlePause() {
    if (this.vadProcessor) {
      this.vadProcessor.reset();
    }
  }

  _handleSeeking() {
    if (this.vadProcessor) {
      this.vadProcessor.reset();
    }
  }

  _handleSeeked() {
    this._resumeContext();
    if (this.vadProcessor) {
      this.vadProcessor.reset();
    }
  }

  _handleEnded() {
    if (this.vadProcessor) {
      this.vadProcessor.reset();
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AudioCaptureEngine;
}
