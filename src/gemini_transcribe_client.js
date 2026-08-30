/**
 * Gemini Live Transcribe Client for YouTube Subtitle Translator (Stage 1: ASR)
 * Connects to Google's gemini-3.5-transcribe-live over WebSockets
 * Supports interimInputTranscription and inputTranscription payloads from Google Live ASR.
 */

class GeminiTranscribeClient {
  constructor(config = {}) {
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'gemini-3.5-transcribe-live';

    this.ws = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.isSetupComplete = false;
    this.autoReconnect = true;
    this.reconnectTimer = null;

    this.onTranscriptChunk = config.onTranscriptChunk || null;
    this.onStatusChange = config.onStatusChange || null;

    // Telemetry state
    this.currentUtterance = '';
    this.turnStartVideoTimeMs = 0;
    this.lastAudioVideoTimeMs = 0;
    this.totalFramesSent = 0;
    this.totalWordsTranscribed = 0;
    this.lastServerMessage = 'None yet';
    this.lastCloseCode = null;
    this.lastCloseReason = null;
    this.lastError = null;
  }

  getDebugInfo() {
    let wsStateStr = 'CLOSED';
    if (this.ws) {
      if (this.ws.readyState === WebSocket.CONNECTING) wsStateStr = 'CONNECTING';
      else if (this.ws.readyState === WebSocket.OPEN) wsStateStr = 'OPEN';
      else if (this.ws.readyState === WebSocket.CLOSING) wsStateStr = 'CLOSING';
      else if (this.ws.readyState === WebSocket.CLOSED) wsStateStr = 'CLOSED';
    }

    return {
      wsState: wsStateStr,
      model: this.model,
      isSetupComplete: this.isSetupComplete,
      totalFramesSent: this.totalFramesSent,
      totalWordsTranscribed: this.totalWordsTranscribed,
      lastServerMessage: this.lastServerMessage,
      lastCloseCode: this.lastCloseCode,
      lastCloseReason: this.lastCloseReason,
      lastError: this.lastError
    };
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
    this._emitStatus('connecting', 'Connecting to Live Transcribe WebSocket...');

    const cleanModel = this.model.replace(/^models\//, '');
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.isConnecting = false;
        this.lastError = null;
        this._sendSetupHandshake(cleanModel);
        this._emitStatus('connected', `Connected (${cleanModel})`);
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
        this.lastCloseCode = event.code;
        this.lastCloseReason = event.reason || '';
        this.isConnected = false;
        this.isConnecting = false;
        this.isSetupComplete = false;

        let closeMsg = `WebSocket closed (code ${event.code}${event.reason ? ': ' + event.reason : ''})`;
        console.log(`[GeminiTranscribe] ${closeMsg}`);
        this.lastError = closeMsg;

        this.flush();

        if (this.autoReconnect) {
          this._emitStatus('error', closeMsg + ' - Reconnecting...');
          this.reconnectTimer = setTimeout(() => {
            this.connect();
          }, 1500);
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

  _sendSetupHandshake(cleanModel) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const setupPayload = {
      setup: {
        model: `models/${cleanModel}`,
        generationConfig: {
          responseModalities: ['TEXT']
        }
      }
    };

    this.ws.send(JSON.stringify(setupPayload));
    this.isSetupComplete = true;
    this.lastServerMessage = `Setup sent (model: models/${cleanModel})`;
    console.log('[GeminiTranscribe] Setup handshake sent for models/' + cleanModel);
  }

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

      if (data.setupComplete) {
        this.lastServerMessage = 'setupComplete received from Google!';
        this._emitStatus('connected', 'Live ASR Ready');
      }

      if (data.serverContent) {
        // 1. Handle live interim transcription (real-time words while speaking)
        if (data.serverContent.interimInputTranscription) {
          const interimText = data.serverContent.interimInputTranscription.text;
          if (interimText) {
            this.currentUtterance = interimText;
            this.lastServerMessage = `Live: "${interimText.trim()}"`;

            if (this.onTranscriptChunk) {
              this.onTranscriptChunk({
                text: interimText.trim(),
                startMs: this.turnStartVideoTimeMs,
                endMs: this.lastAudioVideoTimeMs + 1500,
                isFinal: false
              });
            }
          }
        }

        // 2. Handle finalized input transcription (completed phrase/sentence from Google)
        if (data.serverContent.inputTranscription) {
          const finalText = data.serverContent.inputTranscription.text;
          if (finalText && finalText.trim()) {
            const cleanFinal = finalText.trim();
            this.lastServerMessage = `Final: "${cleanFinal}"`;
            this.totalWordsTranscribed += cleanFinal.split(/\s+/).filter(Boolean).length;

            const startMs = this.turnStartVideoTimeMs;
            const endMs = Math.max(startMs + 1000, this.lastAudioVideoTimeMs);

            if (this.onTranscriptChunk) {
              this.onTranscriptChunk({
                text: cleanFinal,
                startMs: startMs,
                endMs: endMs,
                isFinal: true
              });
            }

            this.currentUtterance = '';
            this.turnStartVideoTimeMs = this.lastAudioVideoTimeMs;
          }
        }

        // 3. Handle model turn parts (if modelTurn is returned)
        if (data.serverContent.modelTurn && Array.isArray(data.serverContent.modelTurn.parts)) {
          for (const part of data.serverContent.modelTurn.parts) {
            if (part.text) {
              this.currentUtterance += part.text;
              this.totalWordsTranscribed += part.text.split(/\s+/).filter(Boolean).length;
              this.lastServerMessage = `Text: "${part.text.trim()}"`;

              if (this.onTranscriptChunk) {
                this.onTranscriptChunk({
                  text: this.currentUtterance.trim(),
                  startMs: this.turnStartVideoTimeMs,
                  endMs: this.lastAudioVideoTimeMs + 1500,
                  isFinal: false
                });
              }

              const trimmed = this.currentUtterance.trim();
              const durationMs = this.lastAudioVideoTimeMs - this.turnStartVideoTimeMs;
              const hasPunctuation = /[.!?\n]$/.test(trimmed) && trimmed.length >= 6;
              const isTimeThreshold = durationMs >= 2400 && trimmed.length >= 8;

              if (hasPunctuation || isTimeThreshold) {
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
