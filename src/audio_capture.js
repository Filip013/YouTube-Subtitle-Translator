/**
 * Audio Capture Engine for YouTube Subtitle Translator
 * Captures audio directly from HTML5 <video> element using Web Audio API,
 * pipes frames through VAD, and encodes speech slices into 16kHz PCM WAV.
 */

class AudioCaptureEngine {
  /**
   * @param {Object} options
   * @param {VADProcessor} options.vadProcessor
   * @param {Function} options.onSpeechChunk - Callback({ base64Audio, startMs, endMs, durationMs })
   */
  constructor(options = {}) {
    this.vadProcessor = options.vadProcessor;
    this.onSpeechChunk = options.onSpeechChunk;

    this.videoElement = null;
    this.audioContext = null;
    this.mediaStreamSource = null;
    this.processorNode = null;
    this.silentGainNode = null;
    this.isCapturing = false;

    this._boundOnPlay = this._handlePlay.bind(this);
    this._boundOnPause = this._handlePause.bind(this);
    this._boundOnSeeking = this._handleSeeking.bind(this);
    this._boundOnSeeked = this._handleSeeked.bind(this);
    this._boundOnEnded = this._handleEnded.bind(this);

    // Link VAD callback to WAV encoder
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
    if (this.videoElement === video && this.isCapturing) return;

    this.detach();
    this.videoElement = video;

    // Listen for video playback state changes
    this.videoElement.addEventListener('play', this._boundOnPlay);
    this.videoElement.addEventListener('pause', this._boundOnPause);
    this.videoElement.addEventListener('seeking', this._boundOnSeeking);
    this.videoElement.addEventListener('seeked', this._boundOnSeeked);
    this.videoElement.addEventListener('ended', this._boundOnEnded);

    this._initAudioPipeline();
  }

  /**
   * Detaches from current video and releases Web Audio resources
   */
  detach() {
    if (this.videoElement) {
      this.videoElement.removeEventListener('play', this._boundOnPlay);
      this.videoElement.removeEventListener('pause', this._boundOnPause);
      this.videoElement.removeEventListener('seeking', this._boundOnSeeking);
      this.videoElement.removeEventListener('seeked', this._boundOnSeeked);
      this.videoElement.removeEventListener('ended', this._boundOnEnded);
      this.videoElement = null;
    }

    if (this.processorNode) {
      this.processorNode.onaudioprocess = null;
      this.processorNode.disconnect();
      this.processorNode = null;
    }

    if (this.silentGainNode) {
      this.silentGainNode.disconnect();
      this.silentGainNode = null;
    }

    if (this.mediaStreamSource) {
      this.mediaStreamSource.disconnect();
      this.mediaStreamSource = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    if (this.vadProcessor) {
      this.vadProcessor.reset();
    }

    this.isCapturing = false;
  }

  _initAudioPipeline() {
    if (!this.videoElement) return;

    try {
      // Create Web Audio context
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtxClass();

      // Capture audio stream from video element
      let stream = null;
      if (typeof this.videoElement.captureStream === 'function') {
        stream = this.videoElement.captureStream();
      } else if (typeof this.videoElement.mozCaptureStream === 'function') {
        stream = this.videoElement.mozCaptureStream();
      }

      if (!stream || stream.getAudioTracks().length === 0) {
        console.warn('[GeminiSubtitles] No audio track found in video stream yet. Will retry on play.');
        return;
      }

      this.mediaStreamSource = this.audioContext.createMediaStreamSource(stream);

      // Process audio in 4096-sample buffer frames (~85ms at 48kHz)
      const bufferSize = 4096;
      this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

      this.processorNode.onaudioprocess = (event) => {
        if (!this.isCapturing || !this.videoElement || this.videoElement.paused) return;

        const inputData = event.inputBuffer.getChannelData(0);
        const inputSampleRate = event.inputBuffer.sampleRate;

        // Resample input audio buffer to 16kHz mono
        const resampled16k = AudioUtils.resampleTo16k(inputData, inputSampleRate, 16000);

        // Feed into VAD processor with current video timestamp
        if (this.vadProcessor) {
          this.vadProcessor.processFrame(resampled16k, this.videoElement.currentTime);
        }
      };

      // Connect through a zero-gain node to keep ScriptProcessor running without doubling speaker output
      this.silentGainNode = this.audioContext.createGain();
      this.silentGainNode.gain.value = 0;

      this.mediaStreamSource.connect(this.processorNode);
      this.processorNode.connect(this.silentGainNode);
      this.silentGainNode.connect(this.audioContext.destination);

      this.isCapturing = true;
      console.log('[GeminiSubtitles] Audio capture pipeline initialized successfully.');
    } catch (err) {
      console.error('[GeminiSubtitles] Failed to initialize Audio pipeline:', err);
    }
  }

  _handleVADChunk(vadChunk) {
    const { audioBuffer, sampleRate, startMs, endMs, durationMs } = vadChunk;

    // Encode raw 16kHz PCM Float32Array to 16-bit PCM WAV ArrayBuffer
    const wavArrayBuffer = AudioUtils.encodeWAV(audioBuffer, sampleRate || 16000);
    // Convert to Base64
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
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    if (!this.isCapturing) {
      this._initAudioPipeline();
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
