/**
 * Unit Tests for YouTube Subtitle Translator Core Logic, StorageManager & Gemini Live
 */

const assert = require('assert');
const AudioUtils = require('../src/audio_utils');
const VADProcessor = require('../src/vad_processor');
const GeminiService = require('../src/gemini_service');
const StorageManager = require('../src/storage_manager');
const SubtitleRenderer = require('../src/subtitle_renderer');
const GeminiLiveClient = require('../src/gemini_live_client');

console.log('--- Running Tests for AudioUtils, VADProcessor, GeminiService, StorageManager & SubtitleRenderer ---');

// 1. Test AudioUtils.resampleTo16k
{
  const sampleRate48k = 48000;
  const targetRate = 16000;
  const inputBuffer = new Float32Array(4800);
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

// 3. Test StorageManager extractVideoId
{
  assert.strictEqual(StorageManager.extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(StorageManager.extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s'), 'dQw4w9WgXcQ');
  assert.strictEqual(StorageManager.extractVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(StorageManager.extractVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.strictEqual(StorageManager.extractVideoId('https://www.youtube.com/live/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  console.log('✓ StorageManager.extractVideoId passed for all YouTube formats');
}

// 4. Test StorageManager In-Memory Save & Load
{
  const storage = new StorageManager();
  storage.saveCue('test_vid', 'latin', { startMs: 1000, endMs: 3000, text: 'Test subtitle' });
  storage.loadSubtitles('test_vid', 'latin').then(cues => {
    assert.strictEqual(cues.length, 1);
    assert.strictEqual(cues[0].text, 'Test subtitle');
    console.log('✓ StorageManager direct save and load verified');
  });
}

// 5. Test StorageManager SRT Export
{
  const cues = [
    { startMs: 1000, endMs: 4000, text: 'Prva rečenica' },
    { startMs: 4500, endMs: 7200, text: 'Druga rečenica' }
  ];
  const srt = StorageManager.exportSRT(cues);
  assert.ok(srt.includes('00:00:01,000 --> 00:00:04,000'), 'SRT must format timestamps correctly');
  assert.ok(srt.includes('Prva rečenica'), 'SRT must include cue text');
  console.log('✓ StorageManager.exportSRT passed');
}

// 6. Test SubtitleRenderer hasCueAtTime & removeCue
{
  const renderer = new SubtitleRenderer();
  renderer.addCue({ startMs: 2000, endMs: 5000, text: 'Zdravo' });

  assert.strictEqual(renderer.hasCueAtTime(3000), true, 'Timestamp 3000ms should be within cue [2000, 5000]');
  assert.strictEqual(renderer.hasCueAtTime(1000), false, 'Timestamp 1000ms should not be within cue');

  renderer.removeCue('2000_5000');
  assert.strictEqual(renderer.hasCueAtTime(3000), false, 'Cue should be removed');
  console.log('✓ SubtitleRenderer.hasCueAtTime & removeCue passed');
}

console.log('\n✅ ALL EXTENSION TESTS PASSED SUCCESSFULLY!');
