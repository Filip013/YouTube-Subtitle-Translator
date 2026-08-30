/**
 * Real End-to-End Pipeline Test
 * Tests Speech Transcription + Fast Serbian Translation with real sentences
 */

const fs = require('fs');
const path = require('path');
const GeminiTextTranslator = require('../src/gemini_text_translator');

function getApiKey() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/GEMINI_API_KEY\s*=\s*["']?([^"'\r\n]+)/);
    if (match && match[1]) return match[1].trim();
  }
  return '';
}

async function testTranslation() {
  const apiKey = getApiKey();
  console.log(`🔑 Testing Stage 2 Translation with key: ${apiKey.substring(0, 8)}...`);

  const translator = new GeminiTextTranslator({
    apiKey: apiKey,
    model: 'gemini-3.1-flash-lite',
    scriptType: 'latin',
    speakerGender: 'auto'
  });

  const testSentences = [
    "This is some of the hardest music I've ever wrote for a performer.",
    "But it doesn't sound difficult.",
    "There are no enormous chords.",
    "There's no spectacular runs.",
    "Just being perfectly there in the music."
  ];

  console.log(`\nTranslating sentences from video 9OnmNLYvv5Y into Serbian (Latinica):`);

  for (const sentence of testSentences) {
    const startTime = Date.now();
    const serbian = await translator.translateText(sentence);
    const elapsed = Date.now() - startTime;
    console.log(`\n🇬🇧 [EN]: "${sentence}"`);
    console.log(`🇷🇸 [SR]: "${serbian}" (${elapsed}ms)`);
  }

  console.log(`\nNow testing Serbian Cyrillic (Ćirilica):`);
  translator.updateConfig({ scriptType: 'cyrillic' });

  for (const sentence of testSentences.slice(0, 2)) {
    const startTime = Date.now();
    const serbianCyrl = await translator.translateText(sentence);
    const elapsed = Date.now() - startTime;
    console.log(`\n🇬🇧 [EN]: "${sentence}"`);
    console.log(`🇷🇸 [SR-Cyrl]: "${serbianCyrl}" (${elapsed}ms)`);
  }
}

testTranslation();
