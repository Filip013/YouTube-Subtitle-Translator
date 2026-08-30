/**
 * Standalone Automated Tester for Gemini Live WebSockets
 * Run with: node test/test_live_api.js
 * Reads API key from environment variable GEMINI_API_KEY or .env or test_secrets.json
 */

const fs = require('fs');
const path = require('path');

function getApiKey() {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY.trim();
  }

  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/GEMINI_API_KEY\s*=\s*["']?([^"'\r\n]+)/);
    if (match && match[1]) return match[1].trim();
  }

  const secretsPath = path.join(__dirname, '..', 'test_secrets.json');
  if (fs.existsSync(secretsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
      if (data.apiKey) return data.apiKey.trim();
    } catch (e) {}
  }

  return '';
}

/**
 * Generates a synthetic 16kHz PCM audio wave (10 seconds)
 */
function generateSyntheticAudio(durationSec = 10, sampleRate = 16000) {
  const numSamples = durationSec * sampleRate;
  const buffer = new Int16Array(numSamples);

  // Generate 440Hz tone modulated with voice-like harmonics
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const tone1 = Math.sin(2 * Math.PI * 440 * t);
    const tone2 = 0.5 * Math.sin(2 * Math.PI * 880 * t);
    const envelope = (Math.sin(2 * Math.PI * 0.5 * t) + 1) / 2; // slow speech envelope
    const sample = (tone1 + tone2) * envelope * 0.4;
    buffer[i] = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
  }

  return Buffer.from(buffer.buffer);
}

async function testModelWebSocket(modelName, apiKey, payloadBuilder) {
  console.log(`\n======================================================`);
  console.log(`🔍 TESTING MODEL: ${modelName}`);
  console.log(`======================================================`);

  return new Promise((resolve) => {
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    const ws = new WebSocket(wsUrl);

    let isSetup = false;
    let framesSent = 0;
    let responsesReceived = 0;
    let streamInterval = null;

    const timeout = setTimeout(() => {
      console.log(`⏱️ Test completed (timeout).`);
      clearInterval(streamInterval);
      ws.close();
      resolve();
    }, 8000);

    ws.onopen = () => {
      console.log(`✅ WebSocket Connected to Google v1alpha.`);
      const setupPayload = payloadBuilder(modelName);
      console.log(`📤 Sending Setup Frame:`, JSON.stringify(setupPayload, null, 2));
      ws.send(JSON.stringify(setupPayload));
      isSetup = true;
    };

    ws.onmessage = async (event) => {
      responsesReceived++;
      let rawText = '';
      if (typeof event.data === 'string') {
        rawText = event.data;
      } else if (event.data instanceof Blob) {
        rawText = await event.data.text();
      } else if (Buffer.isBuffer(event.data) || event.data instanceof ArrayBuffer) {
        rawText = Buffer.from(event.data).toString('utf8');
      }

      console.log(`📥 [Response #${responsesReceived}]:`, rawText.substring(0, 150) + (rawText.length > 150 ? '...' : ''));

      try {
        const data = JSON.parse(rawText);
        if (data.setupComplete) {
          console.log(`🎉 setupComplete RECEIVED! Starting audio streaming...`);

          // Start streaming 16kHz PCM chunks every 100ms
          const pcmData = generateSyntheticAudio(5, 16000);
          const chunkSize = 1600 * 2; // 100ms chunk (1600 samples * 2 bytes)
          let offset = 0;

          streamInterval = setInterval(() => {
            if (offset + chunkSize > pcmData.length) {
              clearInterval(streamInterval);
              return;
            }

            const chunk = pcmData.subarray(offset, offset + chunkSize);
            offset += chunkSize;
            framesSent++;

            const audioPayload = {
              realtimeInput: {
                audio: {
                  mimeType: 'audio/pcm;rate=16000',
                  data: chunk.toString('base64')
                }
              }
            };

            ws.send(JSON.stringify(audioPayload));
          }, 100);
        }

        if (data.serverContent) {
          if (data.serverContent.interimInputTranscription) {
            console.log(`🗣️ [Live Preview]: "${data.serverContent.interimInputTranscription.text}"`);
          }
          if (data.serverContent.inputTranscription) {
            console.log(`📝 [Final Text]: "${data.serverContent.inputTranscription.text}"`);
          }
          if (data.serverContent.modelTurn?.parts) {
            for (const part of data.serverContent.modelTurn.parts) {
              if (part.text) {
                console.log(`🇷🇸 [Serbian Model Output]: "${part.text}"`);
              }
            }
          }
        }
      } catch (err) {
        console.error('Error parsing JSON:', err);
      }
    };

    ws.onerror = (err) => {
      console.error(`❌ WebSocket Error:`, err.message || err);
    };

    ws.onclose = (event) => {
      console.log(`🔌 WebSocket Closed: Code ${event.code} (${event.reason || 'None'})`);
      clearTimeout(timeout);
      clearInterval(streamInterval);
      resolve();
    };
  });
}

async function run() {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error(`\n❌ No API key found!`);
    console.log(`Please provide your Gemini API key in one of these ways:`);
    console.log(`1. Create a file named .env with: GEMINI_API_KEY="AIzaSy..."`);
    console.log(`2. Or create test_secrets.json with: { "apiKey": "AIzaSy..." }`);
    console.log(`3. Or set in PowerShell: $env:GEMINI_API_KEY="AIzaSy..."`);
    process.exit(1);
  }

  console.log(`🔑 Using API Key: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`);

  // Test 1: gemini-3.5-transcribe-live (Stage 1 Speech-to-Text)
  await testModelWebSocket('gemini-3.5-transcribe-live', apiKey, (model) => ({
    setup: {
      model: `models/${model}`,
      generationConfig: {
        responseModalities: ['TEXT']
      }
    }
  }));

  // Test 2: gemini-3.1-flash-live-preview (Multimodal Live)
  await testModelWebSocket('gemini-3.1-flash-live-preview', apiKey, (model) => ({
    setup: {
      model: `models/${model}`,
      generationConfig: {
        responseModalities: ['AUDIO']
      },
      systemInstruction: {
        parts: [{ text: 'Translate audio to Serbian subtitles.' }]
      }
    }
  }));

  console.log(`\n🏁 Automated tests finished!`);
}

run();
