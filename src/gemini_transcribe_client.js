/**
 * Gemini Live Transcribe Client for YouTube Subtitle Translator (Stage 1: ASR)
 * Connects to Google's gemini-3.5-transcribe-live over WebSockets
 * for real-time, low-latency, noise-resilient speech-to-text transcription.
 */

class GeminiTranscribeClient {
  constructor(config = {}) {
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'gemini-3.5-transcribe-live';

    this.ws = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.isSetupComplete = false;

    this.onTranscriptChunk = config.onTranscriptChunk || null; // ({ text, startMs, endMs, isFinal })
    this.onStatusChange = config.onStatusChange || null;

    // Streaming transcription state
    this.currentUtterance = '';
    this.turnStartVideoTimeMs = 0;
    this.lastAudioVideoTimeMs = 0;
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
   * Establishes the WebSocket connection with Gemini Live Transcribe
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
    this._emitStatus('connecting', 'Connecting to Live Transcribe WebSocket...');

    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.isConnecting = false;
        this._sendSetupHandshake();
        this._emitStatus('connected', 'Live Transcribe connected.');
        console.log('[GeminiTranscribe] Connected to Live Transcribe:', this.model);
      };

      this.ws.onmessage = (event) => {
        this._handleServerMessage(event);
      };

      this.ws.onerror = (err) => {
        console.error('[GeminiTranscribe] WebSocket error:', err);
        this._emitStatus('error', 'Live Transcribe WebSocket error.');
      };

      this.ws.onclose = (event) => {
        console.log('[GeminiTranscribe] WebSocket closed:', event.code, event.reason);
        this.isConnected = false;
        this.isConnecting = false;
        this.isSetupComplete = false;
        this._emitStatus('disconnected', 'Live Transcribe disconnected.');
      };
    } catch (err) {
      console.error('[GeminiTranscribe] Failed to create WebSocket:', err);
      this.isConnecting = false;
      this._emitStatus('error', err.message);
    }
  }

  /**
   * Sends the initial BidiGenerateContentSetup for transcription
   */
  _sendSetupHandshake() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const setupPayload = {
      setup: {
        model: `models/${this.model}`,
        generationConfig: {
          responseModalities: ['TEXT']
        }
      }
    };

    this.ws.send(JSON.stringify(setupPayload));
    this.isSetupComplete = true;
    console.log('[GeminiTranscribe] Transcribe setup sent successfully.');
  }

  /**
   * Streams a raw 16kHz 16-bit PCM audio frame to Live Transcribe
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
      console.error('[GeminiTranscribe] Error sending audio frame:', err);
    }
  }

  /**
   * Handles incoming WebSocket messages from Live Transcribe
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

              // 1. Emit live transcription preview
              if (this.onTranscriptChunk) {
                this.onTranscriptChunk({
                  text: this.currentUtterance.trim(),
                  startMs: this.turnStartVideoTimeMs,
                  endMs: this.lastAudioVideoTimeMs + 1500,
                  isFinal: false
                });
              }

              // 2. Finalize fragment if sentence ends or duration threshold reached
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
    this.flush();
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
