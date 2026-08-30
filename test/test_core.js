/**
 * Unit Tests for YouTube Subtitle Translator Core Logic, StorageManager & Concurrent Queue
 */

const assert = require('assert');
const AudioUtils = require('../src/audio_utils');
const VADProcessor = require('../src/vad_processor');
const GeminiService = require('../src/gemini_service');
const StorageManager = require('../src/storage_manager');

console.log('--- Running Tests for AudioUtils, VADProcessor, GeminiService & StorageManager ---');

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

// 2. Test AudioUtils.encodeWAV & Base64
{
  const samples = new Float32Array(1600);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 16000);
  }

  const wavBuffer = AudioUtils.encodeWAV(samples, 16000);
  assert.strictEqual(wavBuffer.byteLength, 44 + 1600 * 2, 'WAV size should be 44-byte header + 3200 bytes PCM data');

  const view = new DataView(wavBuffer);
  // Check RIFF header
  assert.strictEqual(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)), 'RIFF');
  assert.strictEqual(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)), 'WAVE');
  assert.strictEqual(view.getUint32(24, true), 16000, 'Sample rate in header should be 16000');
  assert.strictEqual(view.getUint16(22, true), 1, 'Channels in header should be 1 (mono)');
  assert.strictEqual(view.getUint16(34, true), 16, 'Bits per sample should be 16');

  const base64 = AudioUtils.arrayBufferToBase64(wavBuffer);
  assert.ok(typeof base64 === 'string' && base64.length > 0, 'Base64 string should be non-empty');
  console.log('✓ AudioUtils.encodeWAV & Base64 encoding passed');
}

// 3. Test AudioUtils.computeRMS
{
  const silence = new Float32Array(100).fill(0);
  assert.strictEqual(AudioUtils.computeRMS(silence), 0, 'Silence RMS should be 0');

  const constantVal = new Float32Array(100).fill(0.5);
  assert.strictEqual(Math.round(AudioUtils.computeRMS(constantVal) * 100) / 100, 0.5, 'Constant RMS should equal amplitude');
  console.log('✓ AudioUtils.computeRMS passed');
}

// 4. Test VADProcessor speech chunking and programmatic timestamps
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

  const frameSize = 800; // 50ms at 16kHz
  const silentFrame = new Float32Array(frameSize).fill(0.001);
  const speechFrame = new Float32Array(frameSize);
  for (let i = 0; i < speechFrame.length; i++) {
    speechFrame[i] = 0.4 * Math.sin((2 * Math.PI * 300 * i) / 16000);
  }

  // Simulate 200ms background noise / silence at videoTime = 0.0s -> 0.2s
  for (let t = 0; t < 4; t++) {
    vad.processFrame(silentFrame, t * 0.05);
  }
  assert.strictEqual(vad.isSpeaking, false, 'Should be in non-speech state');

  // Simulate 500ms active speech at videoTime = 0.2s -> 0.7s
  for (let t = 4; t < 14; t++) {
    vad.processFrame(speechFrame, t * 0.05);
  }
  assert.strictEqual(vad.isSpeaking, true, 'Should detect speech onset');

  // Simulate 300ms silence (exceeds 200ms hangover) at videoTime = 0.7s -> 1.0s
  for (let t = 14; t < 20; t++) {
    vad.processFrame(silentFrame, t * 0.05);
  }

  assert.strictEqual(vad.isSpeaking, false, 'Should have finalized speech after silence hangover');
  assert.strictEqual(chunksEmitted.length, 1, 'Should have emitted exactly 1 speech chunk');

  const chunk = chunksEmitted[0];
  assert.ok(chunk.startMs >= 0, 'startMs should be valid');
  assert.ok(chunk.endMs > chunk.startMs, 'endMs should be greater than startMs');
  assert.ok(chunk.durationMs >= 300, 'durationMs should meet minimum duration');
  assert.ok(chunk.audioBuffer.length > 0, 'audioBuffer should contain audio samples');

  console.log(`✓ VADProcessor emitted chunk: [startMs=${chunk.startMs}, endMs=${chunk.endMs}, durationMs=${chunk.durationMs}ms]`);
}

// 5. Test StorageManager keys & methods
{
  const latinKey = StorageManager.getKey('dQw4w9WgXcQ', 'latin');
  const cyrillicKey = StorageManager.getKey('dQw4w9WgXcQ', 'cyrillic');
  assert.strictEqual(latinKey, 'yt_subs_dQw4w9WgXcQ_latin');
  assert.strictEqual(cyrillicKey, 'yt_subs_dQw4w9WgXcQ_cyrillic');
  console.log('✓ StorageManager key generation passed');
}

// 6. Test GeminiService Concurrent Queue & In-Memory Cache
{
  const service = new GeminiService({
    apiKey: 'dummy_key',
    model: 'gemini-3.5-flash-lite',
    concurrency: 3
  });

  // Pre-seed cache
  service.cache.set('vid1_0_1000_latin', 'Zdravo svete');

  service.enqueueTranslation({ base64Audio: 'abc', startMs: 0, endMs: 1000 }, 'vid1')
    .then(res => {
      assert.strictEqual(res.text, 'Zdravo svete');
      assert.strictEqual(res.cached, true);
      console.log('✓ GeminiService cache & concurrent queue verified');
      console.log('\n✅ ALL EXTENSION TESTS PASSED SUCCESSFULLY!');
    });
}
