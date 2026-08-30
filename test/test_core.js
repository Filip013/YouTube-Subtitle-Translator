/**
 * Unit Tests for YouTube Subtitle Translator Core Logic, StorageManager & Gemini Live
 */

const assert = require('assert');
const AudioUtils = require('../src/audio_utils');
const VADProcessor = require('../src/vad_processor');
const GeminiService = require('../src/gemini_service');
const StorageManager = require('../src/storage_manager');
const GeminiLiveClient = require('../src/gemini_live_client');

console.log('--- Running Tests for AudioUtils, VADProcessor, GeminiService, StorageManager & GeminiLiveClient ---');

// 1. Test AudioUtils.resampleTo16k
{
  const sampleRate48k = 48000;
  const targetRate = 16000;
  const inputBuffer = new Float32Array(4800); // 100ms at 48kHz
  for (let i = 0; i < inputBuffer.length; i++) {
    inputBuffer[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate48k);
  }

  const resampled = AudioUtils.resampleTo16k(inputBuffer, sampleRate48k, targetRate);
  assert.strictEqual(resampled.length, 1600, 'Resampled buffer should have exactly 1600 samples (100ms at 16kHz)');
  console.log('✓ AudioUtils.resampleTo16k passed');
}

// 2. Test AudioUtils.floatTo16BitPCMBase64
{
  const samples = new Float32Array([0.0, 0.5, -0.5, 1.0, -1.0]);
  const base64PCM = AudioUtils.floatTo16BitPCMBase64(samples);
  assert.ok(typeof base64PCM === 'string' && base64PCM.length > 0, 'Base64 PCM string should be valid');
  console.log('✓ AudioUtils.floatTo16BitPCMBase64 passed');
}

// 3. Test AudioUtils.encodeWAV & Base64
{
  const samples = new Float32Array(1600);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 16000);
  }

  const wavBuffer = AudioUtils.encodeWAV(samples, 16000);
  assert.strictEqual(wavBuffer.byteLength, 44 + 1600 * 2, 'WAV size should be 44-byte header + 3200 bytes PCM data');

  const view = new DataView(wavBuffer);
  assert.strictEqual(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)), 'RIFF');
  assert.strictEqual(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)), 'WAVE');
  assert.strictEqual(view.getUint32(24, true), 16000, 'Sample rate in header should be 16000');
  assert.strictEqual(view.getUint16(22, true), 1, 'Channels in header should be 1 (mono)');
  assert.strictEqual(view.getUint16(34, true), 16, 'Bits per sample should be 16');

  const base64 = AudioUtils.arrayBufferToBase64(wavBuffer);
  assert.ok(typeof base64 === 'string' && base64.length > 0, 'Base64 string should be non-empty');
  console.log('✓ AudioUtils.encodeWAV & Base64 encoding passed');
}

// 4. Test AudioUtils.computeRMS
{
  const silence = new Float32Array(100).fill(0);
  assert.strictEqual(AudioUtils.computeRMS(silence), 0, 'Silence RMS should be 0');

  const constantVal = new Float32Array(100).fill(0.5);
  assert.strictEqual(Math.round(AudioUtils.computeRMS(constantVal) * 100) / 100, 0.5, 'Constant RMS should equal amplitude');
  console.log('✓ AudioUtils.computeRMS passed');
}

// 5. Test VADProcessor speech chunking and programmatic timestamps
{
  let chunksEmitted = [];
  const vad = new VADProcessor({
    sampleRate: 16000,
    minSpeechDurationMs: 300,
    silenceHangoverMs: 200,
    sensitivity: 'medium',
    onChunkReady: (chunk) => {
      chunksEmitted.push(chunk);
    }
  });

  const frameSize = 800;
  const silentFrame = new Float32Array(frameSize).fill(0.001);
  const speechFrame = new Float32Array(frameSize);
  for (let i = 0; i < speechFrame.length; i++) {
    speechFrame[i] = 0.4 * Math.sin((2 * Math.PI * 300 * i) / 16000);
  }

  for (let t = 0; t < 4; t++) {
    vad.processFrame(silentFrame, t * 0.05);
  }
  assert.strictEqual(vad.isSpeaking, false, 'Should be in non-speech state');

  for (let t = 4; t < 14; t++) {
    vad.processFrame(speechFrame, t * 0.05);
  }
  assert.strictEqual(vad.isSpeaking, true, 'Should detect speech onset');

  for (let t = 14; t < 20; t++) {
    vad.processFrame(silentFrame, t * 0.05);
  }

  assert.strictEqual(vad.isSpeaking, false, 'Should have finalized speech after silence hangover');
  assert.strictEqual(chunksEmitted.length, 1, 'Should have emitted exactly 1 speech chunk');
  console.log('✓ VADProcessor speech detection verified');
}

// 6. Test StorageManager keys & methods
{
  const latinKey = StorageManager.getKey('dQw4w9WgXcQ', 'latin');
  const cyrillicKey = StorageManager.getKey('dQw4w9WgXcQ', 'cyrillic');
  assert.strictEqual(latinKey, 'yt_subs_dQw4w9WgXcQ_latin');
  assert.strictEqual(cyrillicKey, 'yt_subs_dQw4w9WgXcQ_cyrillic');
  console.log('✓ StorageManager key generation passed');
}

// 7. Test GeminiLiveClient instantiation
{
  const liveClient = new GeminiLiveClient({
    apiKey: 'test_key',
    model: 'gemini-3.1-flash-live',
    scriptType: 'cyrillic'
  });
  assert.strictEqual(liveClient.model, 'gemini-3.1-flash-live');
  assert.strictEqual(liveClient.scriptType, 'cyrillic');
  console.log('✓ GeminiLiveClient configuration passed');
}

console.log('\n✅ ALL EXTENSION TESTS PASSED SUCCESSFULLY!');
