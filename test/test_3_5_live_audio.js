/**
 * Test gemini-3.5-live-translate-preview with translationConfig inside generationConfig
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
const MODEL = "models/gemini-3.5-live-translate-preview";

// Generates 16kHz PCM audio wave (voice-like frequency)
function generateVoiceLikeAudio(durationSec = 6, sampleRate = 16000) {
  const numSamples = durationSec * sampleRate;
  const buffer = new Int16Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const f1 = 300, f2 = 800, f3 = 2400;
    const val = 0.5 * Math.sin(2 * Math.PI * f1 * t) + 
                0.3 * Math.sin(2 * Math.PI * f2 * t) + 
                0.2 * Math.sin(2 * Math.PI * f3 * t);
    const envelope = Math.sin(Math.PI * 2 * 0.5 * t);
    buffer[i] = Math.floor(val * envelope * 12000);
  }

  return Buffer.from(buffer.buffer);
}

async function testLiveTranslateAudio() {
  console.log(`\n=============================================================`);
  console.log(`🎙️ TESTING gemini-3.5-live-translate-preview (translationConfig in generationConfig)`);
  console.log(`=============================================================`);

  return new Promise((resolve) => {
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${API_KEY}`;
    const ws = new WebSocket(wsUrl);

    let streamInterval = null;

    const timer = setTimeout(() => {
      console.log(`⏱️ Audio test completed.`);
      clearInterval(streamInterval);
      ws.close();
      resolve();
    }, 8000);

    ws.onopen = () => {
      console.log(`✅ Connected to WebSocket!`);
      const setupPayload = {
        setup: {
          model: MODEL,
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

      console.log(`📤 Sending Setup Frame:`, JSON.stringify(setupPayload, null, 2));
      ws.send(JSON.stringify(setupPayload));
    };

    ws.onmessage = async (event) => {
      let rawText = '';
      if (typeof event.data === 'string') rawText = event.data;
      else if (event.data instanceof Blob) rawText = await event.data.text();
      else if (Buffer.isBuffer(event.data) || event.data instanceof ArrayBuffer) rawText = Buffer.from(event.data).toString('utf8');

      if (!rawText) return;

      try {
        const data = JSON.parse(rawText);

        if (data.setupComplete) {
          console.log(`🎉 setupComplete received! Streaming 16kHz audio...`);

          const pcm = generateVoiceLikeAudio(5, 16000);
          const chunkSize = 1600 * 2;
          let offset = 0;

          streamInterval = setInterval(() => {
            if (offset + chunkSize > pcm.length) {
              clearInterval(streamInterval);
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
          if (data.serverContent.outputTranscription) {
            console.log(`📢 [outputTranscription (Serbian)]:`, data.serverContent.outputTranscription.text);
          }
          if (data.serverContent.interimInputTranscription) {
            console.log(`🗣️ [interimInput (English)]:`, data.serverContent.interimInputTranscription.text);
          }
          if (data.serverContent.inputTranscription) {
            console.log(`📝 [inputTranscription (English)]:`, data.serverContent.inputTranscription.text);
          }
          if (data.serverContent.modelTurn?.parts) {
            for (const part of data.serverContent.modelTurn.parts) {
              if (part.text) {
                console.log(`🇷🇸 [Serbian Text]: "${part.text.trim()}"`);
              }
            }
          }
        }
      } catch (err) {}
    };

    ws.onerror = (e) => console.error(`❌ WS Error:`, e);
    ws.onclose = (e) => {
      console.log(`🔌 WS Closed: Code ${e.code} (${e.reason || 'None'})`);
      clearInterval(streamInterval);
      clearTimeout(timer);
      resolve();
    };
  });
}

testLiveTranslateAudio();
