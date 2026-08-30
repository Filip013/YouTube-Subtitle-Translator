/**
 * Audio Utilities for YouTube Subtitle Translator
 * Handles resampling, 16-bit PCM conversion, WAV header creation, and Base64 encoding.
 */

class AudioUtils {
  /**
   * Resamples a Float32Array audio buffer to a target sample rate (default 16000Hz mono).
   * @param {Float32Array} audioBuffer - Input audio samples
   * @param {number} inputSampleRate - Current sample rate of the AudioContext (e.g. 44100 or 48000)
   * @param {number} targetSampleRate - Desired sample rate (default 16000)
   * @returns {Float32Array} Resampled audio buffer
   */
  static resampleTo16k(audioBuffer, inputSampleRate, targetSampleRate = 16000) {
    if (inputSampleRate === targetSampleRate) {
      return audioBuffer;
    }

    const ratio = inputSampleRate / targetSampleRate;
    const newLength = Math.round(audioBuffer.length / ratio);
    const result = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
      const originIndex = i * ratio;
      const indexFloor = Math.floor(originIndex);
      const indexCeil = Math.min(indexFloor + 1, audioBuffer.length - 1);
      const weight = originIndex - indexFloor;
      
      // Linear interpolation between samples
      result[i] = audioBuffer[indexFloor] * (1 - weight) + audioBuffer[indexCeil] * weight;
    }

    return result;
  }

  /**
   * Converts Float32Array [-1.0, 1.0] samples to a 16-bit PCM Mono WAV ArrayBuffer.
   * @param {Float32Array} samples - Normalized audio samples
   * @param {number} sampleRate - Sample rate (e.g. 16000)
   * @returns {ArrayBuffer} Standard WAV file binary data
   */
  static encodeWAV(samples, sampleRate = 16000) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = samples.length * (bitsPerSample / 8);
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // RIFF identifier
    this.writeString(view, 0, 'RIFF');
    // RIFF chunk length
    view.setUint32(4, 36 + dataSize, true);
    // RIFF type
    this.writeString(view, 8, 'WAVE');
    // format chunk identifier
    this.writeString(view, 12, 'fmt ');
    // format chunk length
    view.setUint32(16, 16, true);
    // sample format (1 = PCM)
    view.setUint16(20, 1, true);
    // channel count
    view.setUint16(22, numChannels, true);
    // sample rate
    view.setUint32(24, sampleRate, true);
    // byte rate
    view.setUint32(28, byteRate, true);
    // block align
    view.setUint16(32, blockAlign, true);
    // bits per sample
    view.setUint16(34, bitsPerSample, true);
    // data chunk identifier
    this.writeString(view, 36, 'data');
    // data chunk length
    view.setUint32(40, dataSize, true);

    // Write 16-bit PCM samples
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      // Clamp between -1.0 and 1.0
      const s = Math.max(-1, Math.min(1, samples[i]));
      // Convert to 16-bit signed integer (-32768 to 32767)
      const val = s < 0 ? s * 0x8000 : s * 0x7fff;
      view.setInt16(offset, val, true);
    }

    return buffer;
  }

  /**
   * Helper to write ASCII strings to DataView
   */
  static writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  /**
   * Converts an ArrayBuffer to a Base64 string.
   * @param {ArrayBuffer} buffer
   * @returns {string} Base64 encoded string
   */
  static arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    const chunkSize = 0x8000; // Process in chunks to prevent call stack overflow

    for (let i = 0; i < len; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
      binary += String.fromCharCode.apply(null, chunk);
    }

    return btoa(binary);
  }

  /**
   * Computes Root-Mean-Square (RMS) energy of an audio buffer.
   * @param {Float32Array} buffer
   * @returns {number} RMS energy value (0.0 to 1.0)
   */
  static computeRMS(buffer) {
    if (!buffer || buffer.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }
    return Math.sqrt(sum / buffer.length);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AudioUtils;
}
