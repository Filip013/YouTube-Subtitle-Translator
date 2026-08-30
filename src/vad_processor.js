/**
 * Voice Activity Detection (VAD) & Intelligent Speech Chunker
 * Calculates audio energy in real-time, detects speech boundaries,
 * and outputs speech chunks with exact programmatic timestamps.
 */

class VADProcessor {
  /**
   * @param {Object} options
   * @param {number} [options.sampleRate=16000] - Processing sample rate
   * @param {number} [options.minSpeechDurationMs=600] - Minimum speech duration to trigger translation (ms)
   * @param {number} [options.maxSpeechDurationMs=5000] - Maximum chunk duration before slicing (ms)
   * @param {number} [options.silenceHangoverMs=350] - Silence duration that indicates end of sentence/phrase (ms)
   * @param {number} [options.preSpeechPaddingMs=220] - Buffer to capture first syllable before trigger (ms)
   * @param {number} [options.postSpeechPaddingMs=180] - Buffer to capture trailing syllable after speech (ms)
   * @param {string} [options.sensitivity='medium'] - 'low' | 'medium' | 'high'
   * @param {Function} [options.onChunkReady] - Callback when a complete speech chunk is extracted
   */
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || 16000;
    this.minSpeechDurationMs = options.minSpeechDurationMs || 600;
    this.maxSpeechDurationMs = options.maxSpeechDurationMs || 5000;
    this.silenceHangoverMs = options.silenceHangoverMs || 350;
    this.preSpeechPaddingMs = options.preSpeechPaddingMs || 220;
    this.postSpeechPaddingMs = options.postSpeechPaddingMs || 180;
    this.sensitivity = options.sensitivity || 'medium';
    this.onChunkReady = options.onChunkReady || null;

    // Threshold configuration based on sensitivity
    this.updateSensitivity(this.sensitivity);

    // State machine
    this.isSpeaking = false;
    this.speechStartVideoTime = 0;
    this.accumulatedSpeechDurationMs = 0;
    this.accumulatedSilenceMs = 0;
    this.noiseFloor = 0.01;
    this.alpha = 0.05; // Smoothing factor for noise floor

    // Audio buffers
    this.currentSpeechBuffers = [];
    this.preSpeechRingBuffer = [];
    this.maxPreSpeechFrames = Math.ceil(this.preSpeechPaddingMs / 50); // ~50ms frames

    this.totalSamplesCollected = 0;
  }

  updateSensitivity(sensitivity) {
    this.sensitivity = sensitivity;
    switch (sensitivity) {
      case 'high': // More sensitive (detects quieter voices, lower threshold)
        this.baseThreshold = 0.008;
        this.snrMultiplier = 1.8;
        break;
      case 'low': // Less sensitive (filters noisy environments, higher threshold)
        this.baseThreshold = 0.025;
        this.snrMultiplier = 3.5;
        break;
      case 'medium':
      default:
        this.baseThreshold = 0.015;
        this.snrMultiplier = 2.4;
        break;
    }
  }

  /**
   * Process a new frame of 16kHz mono audio.
   * @param {Float32Array} frameBuffer - Raw 16kHz audio samples
   * @param {number} videoCurrentTime - Current video.currentTime in seconds
   */
  processFrame(frameBuffer, videoCurrentTime) {
    if (!frameBuffer || frameBuffer.length === 0) return;

    const rms = this._calculateRMS(frameBuffer);
    const frameDurationMs = (frameBuffer.length / this.sampleRate) * 1000;
    const dynamicThreshold = Math.max(this.baseThreshold, this.noiseFloor * this.snrMultiplier);

    const isSpeechFrame = rms > dynamicThreshold;

    if (!this.isSpeaking) {
      // NON-SPEECH STATE: update adaptive background noise floor
      this.noiseFloor = (1 - this.alpha) * this.noiseFloor + this.alpha * rms;

      // Keep pre-speech ring buffer filled
      this.preSpeechRingBuffer.push(new Float32Array(frameBuffer));
      if (this.preSpeechRingBuffer.length > this.maxPreSpeechFrames) {
        this.preSpeechRingBuffer.shift();
      }

      // Detect speech onset
      if (isSpeechFrame) {
        this.isSpeaking = true;
        this.accumulatedSpeechDurationMs = 0;
        this.accumulatedSilenceMs = 0;

        // Accurate timestamp: video time adjusted backwards by pre-speech padding duration
        const preSpeechDurationSec = (this.preSpeechRingBuffer.length * frameBuffer.length) / this.sampleRate;
        this.speechStartVideoTime = Math.max(0, videoCurrentTime - preSpeechDurationSec);

        // Initialize speech buffer with pre-speech padding
        this.currentSpeechBuffers = [...this.preSpeechRingBuffer];
        this.preSpeechRingBuffer = [];
        this.totalSamplesCollected = this.currentSpeechBuffers.reduce((acc, b) => acc + b.length, 0);

        // Add the current frame
        this.currentSpeechBuffers.push(new Float32Array(frameBuffer));
        this.totalSamplesCollected += frameBuffer.length;
        this.accumulatedSpeechDurationMs += frameDurationMs;
      }
    } else {
      // SPEECH STATE: accumulate frames
      this.currentSpeechBuffers.push(new Float32Array(frameBuffer));
      this.totalSamplesCollected += frameBuffer.length;
      this.accumulatedSpeechDurationMs += frameDurationMs;

      if (isSpeechFrame) {
        this.accumulatedSilenceMs = 0;
      } else {
        this.accumulatedSilenceMs += frameDurationMs;
      }

      // End of speech conditions
      const isSentenceEnd = this.accumulatedSilenceMs >= this.silenceHangoverMs;
      const isMaxDurationReached = this.accumulatedSpeechDurationMs >= this.maxSpeechDurationMs;

      if (isSentenceEnd || isMaxDurationReached) {
        this._finalizeSpeechChunk(videoCurrentTime);
      }
    }
  }

  /**
   * Finalizes the current speech segment and triggers callback with exact timestamps.
   */
  _finalizeSpeechChunk(currentVideoTime) {
    if (this.currentSpeechBuffers.length === 0) {
      this.reset();
      return;
    }

    const totalSamples = this.totalSamplesCollected;
    const totalDurationMs = (totalSamples / this.sampleRate) * 1000;

    // Check if segment meets minimum speech duration
    if (totalDurationMs >= this.minSpeechDurationMs) {
      const mergedBuffer = new Float32Array(totalSamples);
      let offset = 0;
      for (const buf of this.currentSpeechBuffers) {
        mergedBuffer.set(buf, offset);
        offset += buf.length;
      }

      const startMs = Math.round(this.speechStartVideoTime * 1000);
      const endMs = Math.round(currentVideoTime * 1000);

      // Ensure valid positive duration
      const finalEndMs = Math.max(startMs + Math.round(totalDurationMs), endMs);

      if (this.onChunkReady) {
        this.onChunkReady({
          audioBuffer: mergedBuffer,
          sampleRate: this.sampleRate,
          startMs: startMs,
          endMs: finalEndMs,
          durationMs: finalEndMs - startMs
        });
      }
    }

    this.reset();
  }

  /**
   * Resets VAD state (e.g. on video seek, pause, or video change)
   */
  reset() {
    this.isSpeaking = false;
    this.speechStartVideoTime = 0;
    this.accumulatedSpeechDurationMs = 0;
    this.accumulatedSilenceMs = 0;
    this.currentSpeechBuffers = [];
    this.preSpeechRingBuffer = [];
    this.totalSamplesCollected = 0;
  }

  _calculateRMS(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }
    return Math.sqrt(sum / buffer.length);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VADProcessor;
}
