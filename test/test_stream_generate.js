/**
 * Test Streaming Text-to-Text Translation via streamGenerateContent
 * (Persistent HTTP/2 streaming token generation)
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

const TEST_SENTENCES = [
  "This is some of the hardest music I have ever written for a performer.",
  "There are no enormous chords, no spectacular runs."
];

const CANDIDATE_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-3.1-flash-lite'
];

async function testStreamModel(modelName) {
  console.log(`\n======================================================`);
  console.log(`🔍 TESTING STREAMING MODEL: ${modelName}`);
  console.log(`======================================================`);

  const systemPrompt = `You are a real-time English-to-Serbian subtitle translator.
Translate English text into natural Serbian Latin (Srpska Latinica: a, b, c, č, ć, d, dž, đ, e, f, g, h, i, j, k, l, lj, m, n, nj, o, p, r, s, š, t, u, v, z, ž).
Output ONLY the translated Serbian text. No explanations or quotes.`;

  for (const sentence of TEST_SENTENCES) {
    const startTime = Date.now();
    let firstTokenTime = 0;
    let fullText = '';

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?key=${API_KEY}&alt=sse`;

    const payload = {
      contents: [
        {
          parts: [{ text: `${systemPrompt}\n\nEnglish:\n"${sentence}"` }]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 200
      }
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const err = await response.text();
        console.log(`❌ ${modelName} -> Status ${response.status}: ${err.substring(0, 100)}`);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.replace('data: ', '').trim();
            if (jsonStr && jsonStr !== '[DONE]') {
              try {
                const data = JSON.parse(jsonStr);
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                if (text) {
                  if (!firstTokenTime) {
                    firstTokenTime = Date.now() - startTime;
                  }
                  fullText += text;
                }
              } catch (e) {}
            }
          }
        }
      }

      const totalTime = Date.now() - startTime;
      console.log(`\n🇬🇧 [EN]: "${sentence}"`);
      console.log(`🇷🇸 [SR]: "${fullText.trim()}"`);
      console.log(`⚡ Latency: First token in ${firstTokenTime}ms | Total: ${totalTime}ms`);
    } catch (err) {
      console.error(`❌ Error on ${modelName}:`, err.message);
    }
  }
}

async function run() {
  for (const model of CANDIDATE_MODELS) {
    await testStreamModel(model);
  }
}

run();
