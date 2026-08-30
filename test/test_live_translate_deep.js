/**
 * Deep Diagnostic Test for gemini-3.5-live-translate-preview
 * Tests all possible setup permutations on v1alpha and v1beta
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

// Synthetic 16kHz PCM audio frame
function getAudioChunkBase64() {
  const samples = 1600; // 100ms
  const buf = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    buf[i] = Math.sin(2 * Math.PI * 440 * (i / 16000)) * 10000;
  }
  return Buffer.from(buf.buffer).toString('base64');
}

const SETUP_PERMUTATIONS = [
  {
    name: "1. Minimal Setup (AUDIO modality only)",
    apiVersion: "v1alpha",
    payload: {
      setup: {
        model: MODEL,
        generationConfig: {
          responseModalities: ["AUDIO"]
        }
      }
    }
  },
  {
    name: "2. translationConfig inside generationConfig",
    apiVersion: "v1alpha",
    payload: {
      setup: {
        model: MODEL,
        generationConfig: {
          responseModalities: ["AUDIO"],
          translationConfig: {
            targetLanguageCode: "sr"
          }
        }
      }
    }
  },
  {
    name: "3. translation_config (snake_case) in setup",
    apiVersion: "v1alpha",
    payload: {
      setup: {
        model: MODEL,
        generationConfig: {
          responseModalities: ["AUDIO"]
        },
        translation_config: {
          target_language_code: "sr"
        }
      }
    }
  },
  {
    name: "4. systemInstruction with target Serbian instruction",
    apiVersion: "v1alpha",
    payload: {
      setup: {
        model: MODEL,
        generationConfig: {
          responseModalities: ["AUDIO"]
        },
        systemInstruction: {
          parts: [{ text: "Translate spoken English audio to Serbian subtitles (Latinica)." }]
        }
      }
    }
  },
  {
    name: "5. Minimal Setup on v1beta",
    apiVersion: "v1beta",
    payload: {
      setup: {
        model: MODEL,
        generationConfig: {
          responseModalities: ["AUDIO"]
        }
      }
    }
  },
  {
    name: "6. systemInstruction on v1beta",
    apiVersion: "v1beta",
    payload: {
      setup: {
        model: MODEL,
        generationConfig: {
          responseModalities: ["AUDIO"]
        },
        systemInstruction: {
          parts: [{ text: "Translate spoken English audio to Serbian subtitles (Latinica)." }]
        }
      }
    }
  }
];

async function testPermutation(testCase) {
  console.log(`\n-------------------------------------------------------------`);
  console.log(`🧪 Testing: ${testCase.name} [${testCase.apiVersion}]`);
  console.log(`-------------------------------------------------------------`);

  return new Promise((resolve) => {
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${testCase.apiVersion}.GenerativeService.BidiGenerateContent?key=${API_KEY}`;
    const ws = new WebSocket(wsUrl);

    let isDone = false;
    const timer = setTimeout(() => {
      if (!isDone) {
        isDone = true;
        ws.close();
        console.log(`⏱️ Timeout (5s)`);
        resolve({ accepted: false, reason: 'Timeout' });
      }
    }, 5000);

    ws.onopen = () => {
      console.log(`📤 Sending setup...`);
      ws.send(JSON.stringify(testCase.payload));
    };

    ws.onmessage = async (event) => {
      let raw = '';
      if (typeof event.data === 'string') raw = event.data;
      else if (event.data instanceof Blob) raw = await event.data.text();
      else if (Buffer.isBuffer(event.data) || event.data instanceof ArrayBuffer) raw = Buffer.from(event.data).toString('utf8');

      if (!raw) return;

      try {
        const data = JSON.parse(raw);
        console.log(`📥 Server Message:`, Object.keys(data));

        if (data.setupComplete) {
          console.log(`🎉 setupComplete ACCEPTED by Google!`);
          
          // Send 3 audio frames
          for (let i = 0; i < 3; i++) {
            ws.send(JSON.stringify({
              realtimeInput: {
                audio: {
                  mimeType: "audio/pcm;rate=16000",
                  data: getAudioChunkBase64()
                }
              }
            }));
          }

          setTimeout(() => {
            if (!isDone) {
              isDone = true;
              clearTimeout(timer);
              ws.close();
              console.log(`✅ Permutation Works!`);
              resolve({ accepted: true });
            }
          }, 2000);
        }
      } catch (e) {}
    };

    ws.onerror = (e) => console.error(`❌ WS Error:`, e);

    ws.onclose = (e) => {
      if (!isDone) {
        isDone = true;
        clearTimeout(timer);
        console.log(`🔌 Closed: Code ${e.code} (${e.reason || 'None'})`);
        resolve({ accepted: false, code: e.code, reason: e.reason });
      }
    };
  });
}

async function run() {
  console.log(`🚀 Starting Deep Diagnostic for gemini-3.5-live-translate-preview...`);
  console.log(`🔑 Key: ${API_KEY.substring(0, 8)}...`);

  for (const testCase of SETUP_PERMUTATIONS) {
    const res = await testPermutation(testCase);
  }

  console.log(`\n🏁 Deep Diagnostic Complete!`);
}

run();
