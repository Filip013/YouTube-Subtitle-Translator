/**
 * Test outputTranscription text from Flash Live
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
const TEST_SENTENCE = "This is some of the hardest music I have ever written for a performer.";

async function testOutputTranscription() {
  console.log(`\n=============================================================`);
  console.log(`🧪 TESTING outputTranscription FROM gemini-3.1-flash-live-preview`);
  console.log(`=============================================================`);

  return new Promise((resolve) => {
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${API_KEY}`;
    const ws = new WebSocket(wsUrl);

    let fullOutput = '';

    const timer = setTimeout(() => {
      console.log(`⏱️ Completed test.`);
      ws.close();
      resolve();
    }, 6000);

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
                text: "You are an English-to-Serbian subtitle translator. Translate the text into Serbian Latin (Srpska Latinica: a, b, c, č, ć, d, dž, đ, e, f, g, h, i, j, k, l, lj, m, n, nj, o, p, r, s, š, t, u, v, z, ž). Output ONLY the translated Serbian text. No quotes or intro."
              }
            ]
          }
        }
      };
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
          console.log(`🎉 setupComplete received! Sending: "${TEST_SENTENCE}"`);
          const textMsg = {
            clientContent: {
              turns: [
                {
                  role: 'user',
                  parts: [{ text: TEST_SENTENCE }]
                }
              ],
              turnComplete: true
            }
          };
          ws.send(JSON.stringify(textMsg));
        }

        if (data.serverContent?.outputTranscription) {
          console.log(`\n📢 outputTranscription payload:`, JSON.stringify(data.serverContent.outputTranscription));
          const text = data.serverContent.outputTranscription.text || '';
          if (text) {
            fullOutput += text;
            console.log(`📝 Text chunk: "${text}"`);
          }
        }

        if (data.serverContent?.turnComplete) {
          console.log(`\n=============================================================`);
          console.log(`🎉 FINAL TRANSLATION OVER LIVE WEBSOCKET:`);
          console.log(`🇬🇧 [EN]: "${TEST_SENTENCE}"`);
          console.log(`🇷🇸 [SR]: "${fullOutput.trim()}"`);
          console.log(`=============================================================`);
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      } catch (err) {}
    };

    ws.onerror = (e) => console.error(e);
    ws.onclose = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

testOutputTranscription();
