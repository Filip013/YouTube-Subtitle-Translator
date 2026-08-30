/**
 * Gemini Live Client for YouTube Subtitle Translator
 * Connects directly to gemini-3.5-live-translate-preview over v1alpha BidiGenerateContent.
 * Full-Sentence Classical Segmentation:
 * - Accumulates streaming tokens in the background
 * - Finalizes on complete sentence punctuation (. ? !)
 * - Renders classical, movie-style subtitles with zero word-by-word jitter
 */

class GeminiLiveClient {
  constructor(config = {}) {
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'gemini-3.5-live-translate-preview';
    this.scriptType = config.scriptType || 'latin'; // 'latin' or 'cyrillic'
    this.speakerGender = config.speakerGender || 'auto'; // 'auto', 'male', 'female'

    this.ws = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.isSetupComplete = false;
    this.autoReconnect = true;
    this.reconnectTimer = null;

    this.onSubtitleChunk = config.onSubtitleChunk || null;
    this.onStatusChange = config.onStatusChange || null;

    // Streaming state
    this.currentUtterance = '';
    this.turnStartVideoTimeMs = 0;
    this.lastAudioVideoTimeMs = 0;
    this.totalFramesSent = 0;
    this.totalWordsTranslated = 0;
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
      totalWordsTranslated: this.totalWordsTranslated,
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
    if (config.scriptType !== undefined && config.scriptType !== this.scriptType) {
      this.scriptType = config.scriptType;
      needsReconnect = true;
    }
    if (config.speakerGender !== undefined && config.speakerGender !== this.speakerGender) {
      this.speakerGender = config.speakerGender;
      needsReconnect = true;
    }

    if (needsReconnect && this.isConnected) {
      this.reconnect();
    }
  }

  /**
   * Establishes the WebSocket connection
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
    this._emitStatus('connecting', 'Connecting to 3.5 Live Translate WebSocket...');

    const cleanModel = this.model.replace(/^models\//, '');
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.isConnecting = false;
        this.lastError = null;
        this._sendSetupHandshake(cleanModel);
        this._emitStatus('connected', `Live Translate (${cleanModel})`);
        console.log('[GeminiLive] Connected to Live Translate WebSocket:', cleanModel);
      };

      this.ws.onmessage = async (event) => {
        await this._handleServerMessage(event);
      };

      this.ws.onerror = (err) => {
        this.lastError = 'Live WebSocket error.';
        console.warn('[GeminiLive] WebSocket error:', err);
        this._emitStatus('error', this.lastError);
      };

      this.ws.onclose = (event) => {
        this.lastCloseCode = event.code;
        this.lastCloseReason = event.reason || '';
        this.isConnected = false;
        this.isConnecting = false;
        this.isSetupComplete = false;

        let closeMsg = `WebSocket closed (code ${event.code}${event.reason ? ': ' + event.reason : ''})`;
        console.log(`[GeminiLive] ${closeMsg}`);
        this.lastError = closeMsg;

        this.flush();

        if (this.autoReconnect) {
          this._emitStatus('error', closeMsg + ' - Reconnecting...');
          this.reconnectTimer = setTimeout(() => {
            this.connect();
          }, 1500);
        } else {
          this._emitStatus('disconnected', 'Live Translate disconnected.');
        }
      };
    } catch (err) {
      this.lastError = `Connection failed: ${err.message}`;
      console.error('[GeminiLive] Failed to create WebSocket:', err);
      this.isConnecting = false;
      this._emitStatus('error', this.lastError);
      if (this.autoReconnect) {
        this.reconnectTimer = setTimeout(() => this.connect(), 2000);
      }
    }
  }

  _sendSetupHandshake(cleanModel) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Verified Protobuf Schema: translationConfig inside generationConfig
    const setupPayload = {
      setup: {
        model: `models/${cleanModel}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          temperature: 0.1,
          translationConfig: {
            targetLanguageCode: 'sr'
          }
        },
        outputAudioTranscription: {}
      }
    };

    this.ws.send(JSON.stringify(setupPayload));
    this.isSetupComplete = true;
    this.lastServerMessage = `Setup sent (model: models/${cleanModel}, target: sr)`;
    console.log('[GeminiLive] Setup handshake sent for models/' + cleanModel, setupPayload);
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
        audio: {
          mimeType: 'audio/pcm;rate=16000',
          data: base64PCM
        }
      }
    };

    try {
      this.ws.send(JSON.stringify(audioPayload));
    } catch (err) {
      console.error('[GeminiLive] Error sending audio frame:', err);
    }
  }

  async _handleServerMessage(event) {
    try {
      let rawText = '';
      if (typeof event.data === 'string') {
        rawText = event.data;
      } else if (event.data instanceof Blob) {
        rawText = await event.data.text();
      } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(event.data)) {
        rawText = Buffer.from(event.data).toString('utf8');
      }

      if (!rawText) return;
      this.lastServerMessage = rawText.length > 80 ? rawText.substring(0, 80) + '...' : rawText;

      const data = JSON.parse(rawText);

      if (data.setupComplete) {
        this.lastServerMessage = 'setupComplete received (Live Translate Ready)';
        this._emitStatus('connected', 'Live Translate Ready');
      }

      if (data.serverContent) {
        // 1. Accumulate streaming Serbian translation tokens in background
        if (data.serverContent.outputTranscription?.text) {
          const outText = data.serverContent.outputTranscription.text;
          
          if (!this.currentUtterance || this.currentUtterance.endsWith(' ') || outText.startsWith(' ')) {
            this.currentUtterance += outText;
          } else {
            this.currentUtterance += ' ' + outText;
          }

          this.lastServerMessage = `Translating: "${this.currentUtterance.trim()}"`;

          // Keep background telemetry updated without triggering on-screen typewriter effect
          if (this.onSubtitleChunk) {
            this.onSubtitleChunk({
              text: this.currentUtterance.trim(),
              startMs: this.turnStartVideoTimeMs,
              endMs: this.lastAudioVideoTimeMs + 1500,
              isFinal: false
            });
          }

          // Finalize strictly on sentence-ending punctuation (. ? !)
          const trimmed = this.currentUtterance.trim();
          const hasPunctuation = /[.!?]$/.test(trimmed) && trimmed.length >= 8;

          if (hasPunctuation) {
            this._finalizeCurrentUtterance();
          }
        }

        // 2. ModelTurn text fallback
        const modelTurn = data.serverContent.modelTurn;
        if (modelTurn && Array.isArray(modelTurn.parts)) {
          for (const part of modelTurn.parts) {
            if (part.text) {
              if (!this.currentUtterance.includes(part.text)) {
                this.currentUtterance += ' ' + part.text;
              }
              const trimmed = this.currentUtterance.trim();
              if (/[.!?]$/.test(trimmed) && trimmed.length >= 8) {
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
      // ignore binary parse errors
    }
  }

  _finalizeCurrentUtterance() {
    const finalText = this.currentUtterance.trim();
    if (finalText && finalText !== '[EMPTY]') {
      const startMs = this.turnStartVideoTimeMs;
      const endMs = Math.max(startMs + 1000, this.lastAudioVideoTimeMs);

      this.totalWordsTranslated += finalText.split(/\s+/).filter(Boolean).length;
      this.lastServerMessage = `Final: "${finalText}"`;

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
  module.exports = GeminiLiveClient;
}
