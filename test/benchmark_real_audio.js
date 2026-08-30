/**
 * Benchmark Real YouTube Audio (Video 9OnmNLYvv5Y) across Live Architectures
 * Feeds test_sample_16k.wav in real-time (100ms chunks) to compare accuracy & latency.
 */

const fs = require('fs');
const path = require('path');

function getApiKey() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/GEMINI_API_KEY\s*=\s*["']?([^"'\r\n]+)/);
    if (match && match[1]) return match[1].trim();
  }
  return '';
}

const API_KEY = getApiKey();
const WAV_PATH = path.join(__dirname, '..', 'test_sample_16k.wav');

// Reads raw PCM data skipping 44-byte WAV header
function getRawPCM16k() {
  const fileBuffer = fs.readFileSync(WAV_PATH);
  return fileBuffer.subarray(44);
}

// -------------------------------------------------------------
// BENCHMARK 1: gemini-3.5-live-translate-preview
// -------------------------------------------------------------
async function runLiveTranslate35() {
  console.log(`\n========================================================================`);
  console.log(`🎙️ BENCHMARK 1: gemini-3.5-live-translate-preview (Single-Stage)`);
  console.log(`========================================================================`);

  return new Promise((resolve) => {
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${API_KEY}`;
    const ws = new WebSocket(wsUrl);

    let streamInterval = null;
    let receivedTranslations = [];

    const timer = setTimeout(() => {
      console.log(`⏱️ Benchmark 1 finished.`);
      clearInterval(streamInterval);
      ws.close();
      resolve(receivedTranslations);
    }, 14000);

    ws.onopen = () => {
      const setupPayload = {
        setup: {
          model: "models/gemini-3.5-live-translate-preview",
          generationConfig: {
            responseModalities: ["AUDIO"],
            temperature: 0.1,
            translationConfig: {
              targetLanguageCode: "sr"
            }
          },
          outputAudioTranscription: {}
        }
      };
      ws.send(JSON.stringify(setupPayload));
    };

    ws.onmessage = async (event) => {
      let raw = '';
      if (typeof event.data === 'string') raw = event.data;
      else if (event.data instanceof Blob) raw = await event.data.text();
      else if (Buffer.isBuffer(event.data) || event.data instanceof ArrayBuffer) raw = Buffer.from(event.data).toString('utf8');

      if (!raw) return;

      try {
        const data = JSON.parse(raw);

        if (data.setupComplete) {
          console.log(`🎉 Connected! Streaming 10s of real YouTube audio in 100ms chunks...`);
          const pcm = getRawPCM16k();
          const chunkSize = 1600 * 2; // 100ms
          let offset = 0;

          streamInterval = setInterval(() => {
            if (offset + chunkSize > pcm.length) {
              clearInterval(streamInterval);
              console.log(`📡 Finished streaming all audio frames.`);
              return;
            }
            const chunk = pcm.subarray(offset, offset + chunkSize);
            offset += chunkSize;

            ws.send(JSON.stringify({
              realtimeInput: {
                audio: {
                  mimeType: "audio/pcm;rate=16000",
                  data: chunk.toString('base64')
                }
              }
            }));
          }, 100);
        }

        if (data.serverContent) {
          if (data.serverContent.outputTranscription?.text) {
            const txt = data.serverContent.outputTranscription.text;
            console.log(`🇷🇸 [Live Output Transcript]: "${txt}"`);
            receivedTranslations.push(txt);
          }
          if (data.serverContent.interimInputTranscription?.text) {
            console.log(`🇬🇧 [Interim Input (EN)]: "${data.serverContent.interimInputTranscription.text}"`);
          }
          if (data.serverContent.inputTranscription?.text) {
            console.log(`🇬🇧 [Final Input (EN)]: "${data.serverContent.inputTranscription.text}"`);
          }
          if (data.serverContent.modelTurn?.parts) {
            for (const part of data.serverContent.modelTurn.parts) {
              if (part.text) {
                console.log(`🇷🇸 [ModelTurn Text]: "${part.text.trim()}"`);
                receivedTranslations.push(part.text.trim());
              }
            }
          }
        }
      } catch (e) {}
    };

    ws.onerror = (e) => console.error(`❌ WS Error:`, e);
    ws.onclose = () => {
      clearInterval(streamInterval);
      clearTimeout(timer);
      resolve(receivedTranslations);
    };
  });
}

// -------------------------------------------------------------
// BENCHMARK 2: gemini-3.1-flash-live-preview (Single-Stage Direct)
// -------------------------------------------------------------
async function runFlashLive31() {
  console.log(`\n========================================================================`);
  console.log(`🎙️ BENCHMARK 2: gemini-3.1-flash-live-preview (Single-Stage Direct)`);
  console.log(`========================================================================`);

  return new Promise((resolve) => {
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${API_KEY}`;
    const ws = new WebSocket(wsUrl);

    let streamInterval = null;
    let receivedTranslations = [];

    const timer = setTimeout(() => {
      console.log(`⏱️ Benchmark 2 finished.`);
      clearInterval(streamInterval);
      ws.close();
      resolve(receivedTranslations);
    }, 14000);

    ws.onopen = () => {
      const setupPayload = {
        setup: {
          model: "models/gemini-3.1-flash-live-preview",
          generationConfig: {
            responseModalities: ["AUDIO"],
            temperature: 0.1
          },
          outputAudioTranscription: {},
          systemInstruction: {
            parts: [
              {
                text: "You are a live speech-to-subtitle translator. Listen to the English audio and translate it into natural Serbian Latin subtitles (Srpska Latinica: a, b, c, č, ć, d, dž, đ, e, f, g, h, i, j, k, l, lj, m, n, nj, o, p, r, s, š, t, u, v, z, ž). Output ONLY the translated Serbian subtitle text."
              }
            ]
          }
        }
      };
      ws.send(JSON.stringify(setupPayload));
    };

    ws.onmessage = async (event) => {
      let raw = '';
      if (typeof event.data === 'string') raw = event.data;
      else if (event.data instanceof Blob) raw = await event.data.text();
      else if (Buffer.isBuffer(event.data) || event.data instanceof ArrayBuffer) raw = Buffer.from(event.data).toString('utf8');

      if (!raw) return;

      try {
        const data = JSON.parse(raw);

        if (data.setupComplete) {
          console.log(`🎉 Connected! Streaming 10s of real YouTube audio in 100ms chunks...`);
          const pcm = getRawPCM16k();
          const chunkSize = 1600 * 2;
          let offset = 0;

          streamInterval = setInterval(() => {
            if (offset + chunkSize > pcm.length) {
              clearInterval(streamInterval);
              console.log(`📡 Finished streaming all audio frames.`);
              return;
            }
            const chunk = pcm.subarray(offset, offset + chunkSize);
            offset += chunkSize;

            ws.send(JSON.stringify({
              realtimeInput: {
                audio: {
                  mimeType: "audio/pcm;rate=16000",
                  data: chunk.toString('base64')
                }
              }
            }));
          }, 100);
        }

        if (data.serverContent) {
          if (data.serverContent.outputTranscription?.text) {
            const txt = data.serverContent.outputTranscription.text;
            console.log(`🇷🇸 [Live Output Transcript]: "${txt}"`);
            receivedTranslations.push(txt);
          }
          if (data.serverContent.modelTurn?.parts) {
            for (const part of data.serverContent.modelTurn.parts) {
              if (part.text) {
                console.log(`🇷🇸 [ModelTurn Text]: "${part.text.trim()}"`);
                receivedTranslations.push(part.text.trim());
              }
            }
          }
        }
      } catch (e) {}
    };

    ws.onerror = (e) => console.error(`❌ WS Error:`, e);
    ws.onclose = () => {
      clearInterval(streamInterval);
      clearTimeout(timer);
      resolve(receivedTranslations);
    };
  });
}

async function run() {
  console.log(`========================================================================`);
  console.log(`🔬 REAL YOUTUBE AUDIO LIVE BENCHMARK (Video 9OnmNLYvv5Y)`);
  console.log(`Audio file: ${WAV_PATH} (${fs.statSync(WAV_PATH).size} bytes)`);
  console.log(`========================================================================`);

  await runLiveTranslate35();
  await runFlashLive31();

  console.log(`\n🏁 Real Audio Benchmarks Complete!`);
}

run();
