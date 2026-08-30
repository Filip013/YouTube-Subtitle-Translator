/**
 * Audio Capture Engine for YouTube Subtitle Translator
 * Captures audio directly from HTML5 <video> element using Web Audio API (createMediaElementSource + captureStream fallback),
 * calculates real-time RMS audio signal level, and feeds 16kHz PCM frames to GeminiLiveClient.
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
    if (this.videoElement === video && this.isCapturing) return;

    this.detach();
    this.videoElement = video;

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

    if (this.mediaSourceNode) {
      try {
        this.mediaSourceNode.disconnect();
      } catch (e) {}
      this.mediaSourceNode = null;
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
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtxClass();

      // Primary method: createMediaElementSource connects directly to the HTML5 video
      try {
        this.mediaSourceNode = this.audioContext.createMediaElementSource(this.videoElement);
        // Connect to destination to ensure video audio remains audible to user
        this.mediaSourceNode.connect(this.audioContext.destination);
      } catch (err) {
        // Fallback: captureStream if already attached or element cannot be tapped
        if (typeof this.videoElement.captureStream === 'function') {
          const stream = this.videoElement.captureStream();
          if (stream && stream.getAudioTracks().length > 0) {
            this.mediaSourceNode = this.audioContext.createMediaStreamSource(stream);
          }
        }
      }

      if (!this.mediaSourceNode) {
        console.warn('[GeminiSubtitles] Could not create audio source node. Will retry on play.');
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

      // Connect through a zero-gain node to keep ScriptProcessor active
      this.silentGainNode = this.audioContext.createGain();
      this.silentGainNode.gain.value = 0;

      this.mediaSourceNode.connect(this.processorNode);
      this.processorNode.connect(this.silentGainNode);
      this.silentGainNode.connect(this.audioContext.destination);

      this.isCapturing = true;
      console.log('[GeminiSubtitles] Audio capture pipeline successfully attached to video.');
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
