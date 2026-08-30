/**
 * Exhaustive Test Suite for Gemini Live Text-to-Text Translation
 * Tests all models, API versions, and modality combinations.
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
const TEST_TEXT = "This is some of the hardest music I have ever written for a performer.";

const MODELS_TO_TEST = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-exp',
  'gemini-2.0-flash-realtime-exp',
  'gemini-2.5-flash',
  'gemini-2.5-flash-live',
  'gemini-3.1-flash-live-preview',
  'gemini-3.5-live-translate-preview'
];

const API_VERSIONS = ['v1alpha', 'v1beta'];

async function testCombination(apiVersion, modelName, responseModalities) {
  const label = `[${apiVersion}] ${modelName} with modalities ${JSON.stringify(responseModalities)}`;
  
  return new Promise((resolve) => {
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${apiVersion}.GenerativeService.BidiGenerateContent?key=${API_KEY}`;
    let ws;
    
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      console.log(`❌ ${label} -> Failed to open WebSocket: ${e.message}`);
      return resolve({ success: false, reason: e.message });
    }

    let resolved = false;
    let receivedText = '';

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        console.log(`⏱️ ${label} -> Timeout (No response in 5s)`);
        resolve({ success: false, reason: 'Timeout' });
      }
    }, 5000);

    ws.onopen = () => {
      const setupPayload = {
        setup: {
          model: `models/${modelName}`,
          generationConfig: {
            responseModalities: responseModalities,
            temperature: 0.1
          },
          systemInstruction: {
            parts: [
              {
                text: "You are a professional English-to-Serbian subtitle translator. Translate English into natural Serbian Latin (Srpska Latinica: a, b, c, č, ć, d, dž, đ, e, f, g, h, i, j, k, l, lj, m, n, nj, o, p, r, s, š, t, u, v, z, ž). Output ONLY the translated Serbian subtitle text. No extra commentary or quotes."
              }
            ]
          }
        }
      };

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
          // Send text prompt for translation
          const textMsg = {
            clientContent: {
              turns: [
                {
                  role: 'user',
                  parts: [{ text: TEST_TEXT }]
                }
              ],
              turnComplete: true
            }
          };
          ws.send(JSON.stringify(textMsg));
        }

        if (data.serverContent?.modelTurn?.parts) {
          for (const part of data.serverContent.modelTurn.parts) {
            if (part.text) {
              receivedText += part.text;
            }
          }

          if (receivedText.trim()) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              ws.close();
              console.log(`\n🎉 SUCCESS! ${label}`);
              console.log(`🇬🇧 Input: "${TEST_TEXT}"`);
              console.log(`🇷🇸 Output: "${receivedText.trim()}"\n`);
              resolve({ success: true, translation: receivedText.trim() });
            }
          }
        }
      } catch (err) {
        // ignore parse errors for binary audio
      }
    };

    ws.onerror = (err) => {
      // handled in onclose
    };

    ws.onclose = (event) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        console.log(`❌ ${label} -> Closed: Code ${event.code} (${event.reason || 'None'})`);
        resolve({ success: false, code: event.code, reason: event.reason });
      }
    };
  });
}

async function runAllTests() {
  console.log(`=============================================================`);
  console.log(`🔬 COMPREHENSIVE FLASH LIVE TEXT-TO-TEXT MATRIX TEST`);
  console.log(`=============================================================`);
  console.log(`🔑 Key: ${API_KEY.substring(0, 8)}...`);

  const results = [];

  for (const apiVersion of API_VERSIONS) {
    for (const model of MODELS_TO_TEST) {
      // Test 1: TEXT modality
      const resText = await testCombination(apiVersion, model, ['TEXT']);
      results.push({ apiVersion, model, modality: 'TEXT', ...resText });

      // If text modality succeeded, we have our winner!
      if (resText.success) {
        console.log(`✨ WINNER FOUND: ${model} on ${apiVersion} with TEXT modality!`);
        break;
      }
    }
  }

  console.log(`\n=============================================================`);
  console.log(`📊 SUMMARY OF TEST RESULTS:`);
  console.log(`=============================================================`);
  for (const r of results) {
    console.log(`${r.success ? '✅' : '❌'} [${r.apiVersion}] ${r.model} (${r.modality}): ${r.success ? r.translation : (r.reason || 'Failed')}`);
  }
}

runAllTests();
