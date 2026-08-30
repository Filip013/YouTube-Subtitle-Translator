/**
 * Gemini Live Client for YouTube Subtitle Translator
 * Connects to Google's Multimodal Live API over WebSockets (gemini-3.1-flash-live)
 * with instant fragment finalization and direct persistence.
 */

class GeminiLiveClient {
  constructor(config = {}) {
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'gemini-3.1-flash-live';
    this.scriptType = config.scriptType || 'latin'; // 'latin' or 'cyrillic'

    this.ws = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.isSetupComplete = false;

    this.onSubtitleChunk = config.onSubtitleChunk || null;
    this.onStatusChange = config.onStatusChange || null;

    // Streaming text state
    this.currentUtterance = '';
    this.turnStartVideoTimeMs = 0;
    this.lastAudioVideoTimeMs = 0;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
  }

  updateConfig(config = {}) {
    let needsReconnect = false;
    if (config.apiKey !== undefined && config.apiKey !== this.apiKey) {
      this.apiKey = config.apiKey;
      needsReconnect = true;
    }
    if (config.model !== undefined && config.model !== this.model) {
      this.model = config.model;
      needsReconnect = true;
    }
    if (config.scriptType !== undefined && config.scriptType !== this.scriptType) {
      this.scriptType = config.scriptType;
      needsReconnect = true;
    }

    if (needsReconnect && this.isConnected) {
      this.reconnect();
    }
  }

  /**
   * Establishes the WebSocket connection with Gemini Multimodal Live API
   */
  connect() {
    if (!this.apiKey) {
      this._emitStatus('error', 'API key is missing.');
      return;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isConnecting = true;
    this.isSetupComplete = false;
    this._emitStatus('connecting', 'Connecting to Gemini Live WebSocket...');

    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this._sendSetupHandshake();
        this._emitStatus('connected', 'Live WebSocket connected.');
        console.log('[GeminiLive] Connected to Gemini Multimodal Live API:', this.model);
      };

      this.ws.onmessage = (event) => {
        this._handleServerMessage(event);
      };

      this.ws.onerror = (err) => {
        console.error('[GeminiLive] WebSocket error:', err);
        this._emitStatus('error', 'Live WebSocket error.');
      };

      this.ws.onclose = (event) => {
        console.log('[GeminiLive] WebSocket closed:', event.code, event.reason);
        this.isConnected = false;
        this.isConnecting = false;
        this.isSetupComplete = false;
        this._emitStatus('disconnected', 'Live WebSocket disconnected.');
      };
    } catch (err) {
      console.error('[GeminiLive] Failed to create WebSocket:', err);
      this.isConnecting = false;
      this._emitStatus('error', err.message);
    }
  }

  /**
   * Sends the initial BidiGenerateContentSetup configuration handshake
   */
  _sendSetupHandshake() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const scriptDesc = this.scriptType === 'cyrillic'
      ? 'Target script: Serbian Cyrillic (Srpska Ćirilica - азбука: а, б, в, г, д, ђ, е, ж, з, и, ј, к, л, љ, м, н, њ, о, п, р, с, т, ћ, у, ф, х, ц, ч, џ, ш).'
      : 'Target script: Serbian Latin (Srpska Latinica - abeceda: a, b, c, č, ć, d, dž, đ, e, f, g, h, i, j, k, l, lj, m, n, nj, o, p, r, s, š, t, u, v, z, ž).';

    const systemPrompt = `You are an expert real-time speech-to-subtitle translator.
You will hear live spoken audio from a video. Translate everything spoken directly into natural Serbian.
${scriptDesc}

CRITICAL RULES:
1. Pay close attention to speaker vocal pitch, gender, tone, and emotion to choose the correct Serbian past tense and adjective gender forms (e.g. bio sam vs bila sam, rekao sam vs rekla sam, srećan vs srećna).
2. Output ONLY the translated Serbian subtitle text.
3. DO NOT output conversational replies, conversational filler, greetings, timestamps, or quotes.
4. Output text continuously in concise 1-2 line subtitle sentences as speech progresses.
5. If there is only background music, ambient noise, laughter, or silence, DO NOT output anything.`;

    const setupPayload = {
      setup: {
        model: `models/${this.model}`,
        generationConfig: {
          responseModalities: ['TEXT'],
          temperature: 0.2
        },
        systemInstruction: {
          parts: [
            {
              text: systemPrompt
            }
          ]
        }
      }
    };

    this.ws.send(JSON.stringify(setupPayload));
    this.isSetupComplete = true;
    console.log('[GeminiLive] Setup handshake sent successfully.');
  }

  /**
   * Streams a raw 16kHz 16-bit PCM audio frame to the Live API
   * @param {string} base64PCM - Base64 encoded 16-bit little-endian PCM
   * @param {number} videoTimeSec - Current video playback time
   */
  sendAudioFrame(base64PCM, videoTimeSec) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isSetupComplete) {
      if (!this.isConnecting && !this.isConnected) {
        this.connect();
      }
      return;
    }

    const currentMs = Math.round(videoTimeSec * 1000);
    this.lastAudioVideoTimeMs = currentMs;

    if (this.turnStartVideoTimeMs === 0) {
      this.turnStartVideoTimeMs = Math.max(0, currentMs - 200);
    }

    const audioPayload = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: 'audio/pcm;rate=16000',
            data: base64PCM
          }
        ]
      }
    };

    try {
      this.ws.send(JSON.stringify(audioPayload));
    } catch (err) {
      console.error('[GeminiLive] Error sending audio frame:', err);
    }
  }

  /**
   * Handles incoming WebSocket messages from the Gemini Live Server
   */
  _handleServerMessage(event) {
    try {
      const data = JSON.parse(event.data);

      if (data.serverContent) {
        const modelTurn = data.serverContent.modelTurn;
        if (modelTurn && Array.isArray(modelTurn.parts)) {
          for (const part of modelTurn.parts) {
            if (part.text) {
              this.currentUtterance += part.text;
              
              // 1. Emit live preview immediately
              if (this.onSubtitleChunk) {
                this.onSubtitleChunk({
                  text: this.currentUtterance.trim(),
                  startMs: this.turnStartVideoTimeMs,
                  endMs: this.lastAudioVideoTimeMs + 1500,
                  isFinal: false
                });
              }

              // 2. Finalize fragment if clause ends, punctuation appears, or duration reaches threshold
              const trimmed = this.currentUtterance.trim();
              const durationMs = this.lastAudioVideoTimeMs - this.turnStartVideoTimeMs;
              const hasPunctuation = /[.!?\n]$/.test(trimmed) && trimmed.length >= 6;
              const isTimeThreshold = durationMs >= 3000 && trimmed.length >= 10;
              const isLengthThreshold = trimmed.length >= 50;

              if (hasPunctuation || isTimeThreshold || isLengthThreshold) {
                this._finalizeCurrentUtterance();
              }
            }
          }
        }

        if (data.serverContent.turnComplete) {
          this._finalizeCurrentUtterance();
        }

        if (data.serverContent.interrupted) {
          this._finalizeCurrentUtterance();
        }
      }
    } catch (err) {
      console.error('[GeminiLive] Error parsing server message:', err);
    }
  }

  /**
   * Finalizes the current utterance into a permanent subtitle fragment
   */
  _finalizeCurrentUtterance() {
    const finalText = this.currentUtterance.trim();
    if (finalText && finalText !== '[EMPTY]') {
      const startMs = this.turnStartVideoTimeMs;
      const endMs = Math.max(startMs + 1000, this.lastAudioVideoTimeMs);

      if (this.onSubtitleChunk) {
        this.onSubtitleChunk({
          text: finalText,
          startMs: startMs,
          endMs: endMs,
          isFinal: true
        });
      }
    }

    this.currentUtterance = '';
    this.turnStartVideoTimeMs = this.lastAudioVideoTimeMs;
  }

  flush() {
    if (this.currentUtterance.trim()) {
      this._finalizeCurrentUtterance();
    }
  }

  resetStream() {
    this.flush();
    this.currentUtterance = '';
    this.turnStartVideoTimeMs = 0;
  }

  reconnect() {
    this.disconnect();
    setTimeout(() => this.connect(), 200);
  }

  disconnect() {
    this.flush();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.isConnecting = false;
    this.isSetupComplete = false;
    this.currentUtterance = '';
    this.turnStartVideoTimeMs = 0;
    this._emitStatus('disconnected', 'Disconnected.');
  }

  _emitStatus(status, message) {
    if (this.onStatusChange) {
      this.onStatusChange(status, message);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeminiLiveClient;
}
