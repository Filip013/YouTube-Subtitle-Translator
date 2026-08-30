/**
 * Test Gemini 2.0 Flash Exp over WebSocket as pure Text-to-Text Translator
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

async function testLiveTextToText() {
  const apiKey = getApiKey();
  const modelName = 'gemini-2.0-flash-exp';

  console.log(`🔌 Connecting to ${modelName} WebSocket for Text-to-Text translation...`);

  const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
  const ws = new WebSocket(wsUrl);

  const testSentences = [
    "This is some of the hardest music I've ever wrote for a performer.",
    "There are no enormous chords, no spectacular runs."
  ];

  ws.onopen = () => {
    console.log(`✅ WebSocket Connected!`);
    const setupPayload = {
      setup: {
        model: `models/${modelName}`,
        generationConfig: {
          responseModalities: ['TEXT'],
          temperature: 0.1
        },
        systemInstruction: {
          parts: [
            {
              text: "You are an English-to-Serbian subtitle translator. When given English text, output ONLY the natural Serbian translation (Latinica). Do not explain or quote."
            }
          ]
        }
      }
    };

    console.log(`📤 Sending Setup Frame:`, JSON.stringify(setupPayload, null, 2));
    ws.send(JSON.stringify(setupPayload));
  };

  ws.onmessage = async (event) => {
    let rawText = '';
    if (typeof event.data === 'string') {
      rawText = event.data;
    } else if (event.data instanceof Blob) {
      rawText = await event.data.text();
    } else if (Buffer.isBuffer(event.data) || event.data instanceof ArrayBuffer) {
      rawText = Buffer.from(event.data).toString('utf8');
    }

    if (!rawText) return;

    try {
      const data = JSON.parse(rawText);

      if (data.setupComplete) {
        console.log(`🎉 setupComplete RECEIVED! Sending text input over WebSocket...`);

        for (let i = 0; i < testSentences.length; i++) {
          const textMsg = {
            clientContent: {
              turns: [
                {
                  role: 'user',
                  parts: [{ text: testSentences[i] }]
                }
              ],
              turnComplete: true
            }
          };

          console.log(`\n📤 Sending Text [${i + 1}]: "${testSentences[i]}"`);
          ws.send(JSON.stringify(textMsg));
          await new Promise(r => setTimeout(r, 2500));
        }

        setTimeout(() => {
          console.log(`\n🏁 Test finished! Closing socket.`);
          ws.close();
        }, 2000);
      }

      if (data.serverContent?.modelTurn?.parts) {
        for (const part of data.serverContent.modelTurn.parts) {
          if (part.text) {
            console.log(`🇷🇸 [Serbian Live Translation]: "${part.text.trim()}"`);
          }
        }
      }
    } catch (err) {
      console.error('Error parsing JSON:', err);
    }
  };

  ws.onerror = (err) => console.error(`❌ Error:`, err);
  ws.onclose = (e) => console.log(`🔌 Socket Closed: ${e.code} (${e.reason || 'None'})`);
}

testLiveTextToText();
