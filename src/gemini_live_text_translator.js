/**
 * Gemini Live Text Translator (Stage 2: 100% WebSocket Translation)
 * Connects to gemini-3.1-flash-live-preview over WebSockets with outputAudioTranscription.
 * Discards all audio bytes and extracts real-time Serbian text subtitles with ZERO REST calls.
 */

class GeminiLiveTextTranslator {
  constructor(config = {}) {
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'gemini-3.1-flash-live-preview';
    this.scriptType = config.scriptType || 'latin'; // 'latin' or 'cyrillic'
    this.speakerGender = config.speakerGender || 'auto'; // 'auto', 'male', 'female'

    this.ws = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.isSetupComplete = false;
    this.pendingQueue = []; // Queue of texts waiting for setup
    this.pendingResolvers = new Map(); // requestId -> resolve function

    this.cache = new Map();
    this.lastContextText = '';
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

  connect() {
    if (!this.apiKey) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isConnecting = true;
    this.isSetupComplete = false;

    const cleanModel = this.model.replace(/^models\//, '');
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.isConnecting = false;
        this._sendSetupHandshake(cleanModel);
      };

      this.ws.onmessage = async (event) => {
        await this._handleMessage(event);
      };

      this.ws.onerror = (err) => {
        console.warn('[LiveTextTranslator] WebSocket error:', err);
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.isConnecting = false;
        this.isSetupComplete = false;
      };
    } catch (e) {
      this.isConnecting = false;
    }
  }

  _sendSetupHandshake(cleanModel) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const scriptInstruction = this.scriptType === 'cyrillic'
      ? 'Target script: Serbian Cyrillic (Srpska Ćirilica: а, б, в, г, д, ђ, е, ж, з, и, ј, к, л, љ, м, н, њ, о, п, р, с, т, ћ, у, ф, х, ц, ч, џ, ш).'
      : 'Target script: Serbian Latin (Srpska Latinica: a, b, c, č, ć, d, dž, đ, e, f, g, h, i, j, k, l, lj, m, n, nj, o, p, r, s, š, t, u, v, z, ž).';

    let genderInstruction = '';
    if (this.speakerGender === 'female') {
      genderInstruction = 'The speaker is FEMALE. Use feminine past tense verb forms and adjectives (e.g. bila sam, rekla sam, videla sam, srećna).';
    } else if (this.speakerGender === 'male') {
      genderInstruction = 'The speaker is MALE. Use masculine past tense verb forms and adjectives (e.g. bio sam, rekao sam, video sam, srećan).';
    }

    const systemPrompt = `You are a real-time English-to-Serbian subtitle translator.
Translate English text directly into natural Serbian subtitles.
${scriptInstruction}
${genderInstruction}
Strict Rules:
1. Output ONLY the translated Serbian text.
2. DO NOT include explanations, conversational replies, notes, or surrounding quotes.`;

    const setupPayload = {
      setup: {
        model: `models/${cleanModel}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          temperature: 0.1
        },
        outputAudioTranscription: {},
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        }
      }
    };

    this.ws.send(JSON.stringify(setupPayload));
  }

  async _handleMessage(event) {
    let rawText = '';
    if (typeof event.data === 'string') rawText = event.data;
    else if (event.data instanceof Blob) rawText = await event.data.text();
    else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(event.data)) rawText = Buffer.from(event.data).toString('utf8');

    if (!rawText) return;

    try {
      const data = JSON.parse(rawText);

      if (data.setupComplete) {
        this.isSetupComplete = true;
        // Process any queued translation requests
        while (this.pendingQueue.length > 0) {
          const item = this.pendingQueue.shift();
          this._sendText(item.text, item.resolve);
        }
      }

      if (data.serverContent?.outputTranscription) {
        const text = data.serverContent.outputTranscription.text || '';
        if (text && this.currentResolve) {
          this.currentOutputText = (this.currentOutputText || '') + text;
        }
      }

      if (data.serverContent?.turnComplete) {
        if (this.currentResolve) {
          const finalText = (this.currentOutputText || '').trim();
          this.currentResolve(finalText);
          this.currentResolve = null;
          this.currentOutputText = '';
        }
      }
    } catch (e) {}
  }

  /**
   * Translates English text to Serbian over the live WebSocket with 0 REST calls
   * @param {string} englishText 
   * @returns {Promise<string>}
   */
  async translateText(englishText) {
    if (!englishText || !englishText.trim()) return '';
    const cleanInput = englishText.trim();

    const cacheKey = `${cleanInput}_${this.scriptType}_${this.speakerGender}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    if (!this.isConnected || !this.isSetupComplete) {
      this.connect();
    }

    return new Promise((resolve) => {
      const wrappedResolve = (result) => {
        const clean = (result || cleanInput).replace(/^["']|["']$/g, '').trim();
        this.cache.set(cacheKey, clean);
        resolve(clean);
      };

      if (!this.isSetupComplete) {
        this.pendingQueue.push({ text: cleanInput, resolve: wrappedResolve });
        // Fallback timeout in case socket is slow
        setTimeout(() => wrappedResolve(cleanInput), 4000);
      } else {
        this._sendText(cleanInput, wrappedResolve);
      }
    });
  }

  _sendText(text, resolve) {
    this.currentResolve = resolve;
    this.currentOutputText = '';

    const textMsg = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text: `Translate to Serbian:\n"${text}"` }]
          }
        ],
        turnComplete: true
      }
    };

    try {
      this.ws.send(JSON.stringify(textMsg));
      // Safety timeout
      setTimeout(() => {
        if (this.currentResolve === resolve) {
          resolve(this.currentOutputText || text);
          this.currentResolve = null;
        }
      }, 3000);
    } catch (e) {
      resolve(text);
    }
  }

  reconnect() {
    this.disconnect();
    setTimeout(() => this.connect(), 200);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.isConnecting = false;
    this.isSetupComplete = false;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeminiLiveTextTranslator;
}
