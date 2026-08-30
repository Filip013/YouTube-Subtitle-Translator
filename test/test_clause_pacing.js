/**
 * Test Clause-Level Pacing vs Sentence-Level Pacing on 30s Real Audio
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
const WAV_PATH = path.join(__dirname, '..', 'test_sample_30s_16k.wav');

function getRawPCM16k() {
  const fileBuffer = fs.readFileSync(WAV_PATH);
  return fileBuffer.subarray(44);
}

async function runClausePacingTest() {
  console.log(`========================================================================`);
  console.log(`⚡ TESTING CLAUSE-LEVEL FAST PACING ON 30S AUDIO`);
  console.log(`========================================================================`);

  return new Promise((resolve) => {
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${API_KEY}`;
    const ws = new WebSocket(wsUrl);

    let currentUtterance = '';
    let turnStartMs = 0;
    let lastAudioMs = 0;
    let streamInterval = null;

    const finalizeClause = () => {
      const trimmed = currentUtterance.trim();
      if (trimmed && trimmed.length >= 4) {
        const startMs = turnStartMs;
        const endMs = Math.max(startMs + 1000, lastAudioMs);
        console.log(`⏱️ [${(startMs/1000).toFixed(1)}s -> ${(endMs/1000).toFixed(1)}s]: "${trimmed}"`);
      }
      currentUtterance = '';
      turnStartMs = lastAudioMs;
    };

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
          console.log(`📡 WebSocket Ready! Streaming audio...`);
          const pcm = getRawPCM16k();
          const chunkSize = 1600 * 2;
          let offset = 0;

          streamInterval = setInterval(() => {
            if (offset + chunkSize > pcm.length) {
              clearInterval(streamInterval);
              setTimeout(finalizeClause, 1500);
              return;
            }
            const chunk = pcm.subarray(offset, offset + chunkSize);
            offset += chunkSize;
            lastAudioMs = Math.round((offset / pcm.length) * 30000);

            if (turnStartMs === 0) turnStartMs = Math.max(0, lastAudioMs - 200);

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

        if (data.serverContent?.outputTranscription?.text) {
          const outText = data.serverContent.outputTranscription.text;
          if (!currentUtterance || currentUtterance.endsWith(' ') || outText.startsWith(' ')) {
            currentUtterance += outText;
          } else {
            currentUtterance += ' ' + outText;
          }

          const trimmed = currentUtterance.trim();
          // Fast clause boundaries: ., ?, !, ,, ;, :, or pauses
          const hasClauseBreak = /[.!?,;:\n]$/.test(trimmed) && trimmed.length >= 6;

          if (hasClauseBreak) {
            finalizeClause();
          }
        }
      } catch (e) {}
    };

    setTimeout(() => {
      clearInterval(streamInterval);
      finalizeClause();
      ws.close();
      console.log(`\n========================================================================\n`);
      resolve();
    }, 35000);
  });
}

runClausePacingTest();
