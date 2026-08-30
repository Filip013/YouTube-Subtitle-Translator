/**
 * Gemini Live Transcribe Client for YouTube Subtitle Translator (Stage 1: ASR)
 * Connects to Google's Multimodal Live API over WebSockets (gemini-2.0-flash-exp / gemini-3.1-flash-live)
 * with robust auto-reconnection, Blob decoding, and live diagnostics reporting.
 */

class GeminiTranscribeClient {
  constructor(config = {}) {
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'gemini-2.0-flash-exp';

    this.ws = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.isSetupComplete = false;
    this.autoReconnect = true;
    this.reconnectTimer = null;

    this.onTranscriptChunk = config.onTranscriptChunk || null;
    this.onStatusChange = config.onStatusChange || null;

    // Streaming state & diagnostics
    this.currentUtterance = '';
    this.turnStartVideoTimeMs = 0;
    this.lastAudioVideoTimeMs = 0;
    this.totalFramesSent = 0;
    this.totalWordsTranscribed = 0;
    this.lastError = null;
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

    if (needsReconnect && this.isConnected) {
      this.reconnect();
    }
  }

  /**
   * Establishes the WebSocket connection with Gemini Live API
   */
  connect() {
    if (!this.apiKey) {
      this.lastError = 'API key is missing.';
      this._emitStatus('error', this.lastError);
      return;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.isConnecting = true;
    this.isSetupComplete = false;
    this.lastError = null;
    this._emitStatus('connecting', 'Connecting to Gemini Live WebSocket...');

    // Clean model name (ensure models/ prefix is handled properly in setup)
    const cleanModel = this.model.replace(/^models\//, '');
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.isConnecting = false;
        this.lastError = null;
        this._sendSetupHandshake(cleanModel);
        this._emitStatus('connected', `Connected to Gemini Live (${cleanModel})`);
        console.log('[GeminiTranscribe] WebSocket connected with model:', cleanModel);
      };

      this.ws.onmessage = async (event) => {
        await this._handleServerMessage(event);
      };

      this.ws.onerror = (err) => {
        this.lastError = 'WebSocket connection error.';
        console.warn('[GeminiTranscribe] WebSocket error:', err);
        this._emitStatus('error', this.lastError);
      };

      this.ws.onclose = (event) => {
        console.log(`[GeminiTranscribe] WebSocket closed (code: ${event.code}, reason: "${event.reason}")`);
        this.isConnected = false;
        this.isConnecting = false;
        this.isSetupComplete = false;

        if (event.reason) {
          this.lastError = `Closed: ${event.reason} (code ${event.code})`;
        } else if (event.code === 1006) {
          this.lastError = 'Connection closed abruptly (code 1006). Reconnecting...';
        }

        this.flush();

        if (this.autoReconnect) {
          this._emitStatus('error', this.lastError || 'Reconnecting...');
          this.reconnectTimer = setTimeout(() => {
            this.connect();
          }, 1200);
        } else {
          this._emitStatus('disconnected', 'Live Transcribe disconnected.');
        }
      };
    } catch (err) {
      this.lastError = `Connection failed: ${err.message}`;
      console.error('[GeminiTranscribe] Failed to create WebSocket:', err);
      this.isConnecting = false;
      this._emitStatus('error', this.lastError);
      if (this.autoReconnect) {
        this.reconnectTimer = setTimeout(() => this.connect(), 2000);
      }
    }
  }

  /**
   * Sends the initial BidiGenerateContentSetup for transcription
   */
  _sendSetupHandshake(cleanModel) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const systemPrompt = `You are a real-time speech-to-text transcriber.
Listen to the live audio stream and transcribe spoken words into clean, punctuated English.
Output ONLY the transcribed English text. Do not output filler, conversational replies, or timestamps.`;

    const setupPayload = {
      setup: {
        model: `models/${cleanModel}`,
        generationConfig: {
          responseModalities: ['TEXT'],
          temperature: 0.1
        },
        systemInstruction: {
          parts: [
            { text: systemPrompt }
          ]
        }
      }
    };

    this.ws.send(JSON.stringify(setupPayload));
    this.isSetupComplete = true;
    console.log('[GeminiTranscribe] Setup handshake sent for models/' + cleanModel);
  }

  /**
   * Streams a raw 16kHz 16-bit PCM audio frame to Live Transcribe
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
    this.totalFramesSent++;

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
      console.error('[GeminiTranscribe] Error sending audio frame:', err);
    }
  }

  /**
   * Handles incoming WebSocket messages safely handling text, Blob, or ArrayBuffer
   */
  async _handleServerMessage(event) {
    try {
      let rawText = '';
      if (typeof event.data === 'string') {
        rawText = event.data;
      } else if (event.data instanceof Blob) {
        rawText = await event.data.text();
      } else if (event.data instanceof ArrayBuffer) {
        rawText = new TextDecoder().decode(event.data);
      }

      if (!rawText) return;
      const data = JSON.parse(rawText);

      // Check for setup completion
      if (data.setupComplete) {
        console.log('[GeminiTranscribe] Server confirmed setupComplete!');
        this._emitStatus('connected', 'Live ASR Ready');
      }

      if (data.serverContent) {
        const modelTurn = data.serverContent.modelTurn;
        if (modelTurn && Array.isArray(modelTurn.parts)) {
          for (const part of modelTurn.parts) {
            if (part.text) {
              this.currentUtterance += part.text;
              this.totalWordsTranscribed += part.text.split(/\s+/).filter(Boolean).length;

              // 1. Emit live transcription preview
              if (this.onTranscriptChunk) {
                this.onTranscriptChunk({
                  text: this.currentUtterance.trim(),
                  startMs: this.turnStartVideoTimeMs,
                  endMs: this.lastAudioVideoTimeMs + 1500,
                  isFinal: false
                });
              }

              // 2. Auto-finalize condition
              const trimmed = this.currentUtterance.trim();
              const durationMs = this.lastAudioVideoTimeMs - this.turnStartVideoTimeMs;
              const hasPunctuation = /[.!?\n]$/.test(trimmed) && trimmed.length >= 6;
              const isTimeThreshold = durationMs >= 2600 && trimmed.length >= 10;
              const isLengthThreshold = trimmed.length >= 45;

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
      console.error('[GeminiTranscribe] Error parsing server message:', err);
    }
  }

  _finalizeCurrentUtterance() {
    const finalText = this.currentUtterance.trim();
    if (finalText && finalText !== '[EMPTY]') {
      const startMs = this.turnStartVideoTimeMs;
      const endMs = Math.max(startMs + 1000, this.lastAudioVideoTimeMs);

      if (this.onTranscriptChunk) {
        this.onTranscriptChunk({
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
    this.autoReconnect = false;
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
  module.exports = GeminiTranscribeClient;
}
