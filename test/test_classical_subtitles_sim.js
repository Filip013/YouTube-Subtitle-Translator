/**
 * Visual Playback Timeline Simulation of Classical Captions (Full Sentence Segmentation)
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

function getRawPCM16k() {
  const fileBuffer = fs.readFileSync(WAV_PATH);
  return fileBuffer.subarray(44);
}

class SimulatedSubtitleRenderer {
  constructor() {
    this.cues = [];
  }

  addCue(cue) {
    const cleanText = cue.text.trim();
    const wordCount = cleanText.split(/\s+/).length;
    const duration = Math.max(cue.endMs - cue.startMs, Math.max(2500, wordCount * 380));
    const endMs = cue.startMs + duration;

    const newCue = {
      id: `${cue.startMs}_${endMs}`,
      text: cleanText,
      startMs: cue.startMs,
      endMs: endMs
    };

    this.cues.push(newCue);
    this.cues.sort((a, b) => a.startMs - b.startMs);
  }

  getOnScreenText(currentTimeMs) {
    const activeCue = this.cues.find(
      c => currentTimeMs >= c.startMs - 150 && currentTimeMs <= c.endMs + 200
    );
    return activeCue ? activeCue.text : '[NO SUBTITLE]';
  }
}

async function runSimulation() {
  console.log(`========================================================================`);
  console.log(`🎬 FULL-SENTENCE CLASSICAL CAPTIONS SIMULATION (Video 9OnmNLYvv5Y)`);
  console.log(`========================================================================`);

  const renderer = new SimulatedSubtitleRenderer();

  return new Promise((resolve) => {
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${API_KEY}`;
    const ws = new WebSocket(wsUrl);

    let currentUtterance = '';
    let turnStartMs = 0;
    let lastAudioMs = 0;
    let streamInterval = null;

    const finalize = () => {
      const trimmed = currentUtterance.trim();
      if (trimmed) {
        const startMs = turnStartMs;
        const endMs = Math.max(startMs + 1000, lastAudioMs);
        renderer.addCue({
          text: trimmed,
          startMs: startMs,
          endMs: endMs
        });
        console.log(`\n💾 [Full Sentence Finalized]: "${trimmed}" [${(startMs/1000).toFixed(1)}s - ${(endMs/1000).toFixed(1)}s]`);
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
              setTimeout(finalize, 1500);
              return;
            }
            const chunk = pcm.subarray(offset, offset + chunkSize);
            offset += chunkSize;
            lastAudioMs = Math.round((offset / pcm.length) * 10000);

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
          // Finalize strictly on sentence-ending punctuation (., ?, !)
          const hasPunctuation = /[.!?]$/.test(trimmed) && trimmed.length >= 8;

          if (hasPunctuation) {
            finalize();
          }
        }
      } catch (e) {}
    };

    setTimeout(() => {
      clearInterval(streamInterval);
      finalize();
      ws.close();

      console.log(`\n========================================================================`);
      console.log(`📺 PLAYBACK TIMELINE (Second-by-second on-screen classical captions):`);
      console.log(`========================================================================`);

      for (let sec = 0; sec <= 10; sec++) {
        const tMs = sec * 1000;
        const onScreen = renderer.getOnScreenText(tMs);
        console.log(`⏱️ [00:${sec < 10 ? '0' + sec : sec}] -> 📺 "${onScreen}"`);
      }

      console.log(`========================================================================\n`);
      resolve();
    }, 14000);
  });
}

runSimulation();
