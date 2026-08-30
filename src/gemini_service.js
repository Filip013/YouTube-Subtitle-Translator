/**
 * Gemini Service for YouTube Subtitle Translator
 * Handles communication with Google's Gemini API (defaulting to gemini-3.5-flash-lite)
 * with a concurrent lookahead worker queue and context chaining for natural Serbian translation.
 */

class GeminiService {
  constructor(config = {}) {
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'gemini-3.5-flash-lite';
    this.scriptType = config.scriptType || 'latin'; // 'latin' (Latinica) or 'cyrillic' (Ćirilica)
    this.concurrency = config.concurrency || 3; // Number of parallel requests
    this.enableContextChaining = config.enableContextChaining !== false;

    this.cache = new Map(); // Key: `${videoId}_${startMs}_${endMs}_${scriptType}` -> translation
    this.activeWorkers = 0;
    this.queue = [];
    this.lastContextText = ''; // Preceding translated subtitle for conversational context
  }

  updateConfig(config = {}) {
    if (config.apiKey !== undefined) this.apiKey = config.apiKey;
    if (config.model !== undefined) this.model = config.model;
    if (config.scriptType !== undefined) this.scriptType = config.scriptType;
    if (config.concurrency !== undefined) this.concurrency = config.concurrency;
    if (config.enableContextChaining !== undefined) this.enableContextChaining = config.enableContextChaining;
  }

  /**
   * Tests API key validity against Gemini API
   */
  static async testConnection(apiKey, model = 'gemini-3.5-flash-lite') {
    if (!apiKey) {
      return { success: false, message: 'API key is required.' };
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [
          {
            parts: [
              { text: 'Respond with the single word "OK" to verify API connection.' }
            ]
          }
        ],
        generationConfig: {
          maxOutputTokens: 10,
          temperature: 0.1
        }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errMsg = errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;
        return { success: false, message: errMsg };
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      return { success: true, message: `Connected successfully! (Model: ${model})` };
    } catch (err) {
      return { success: false, message: `Network error: ${err.message}` };
    }
  }

  /**
   * Enqueues an audio chunk for translation via the concurrent lookahead queue.
   * @param {Object} chunk - Speech chunk { base64Audio, startMs, endMs, durationMs }
   * @param {string} videoId - YouTube Video ID
   * @returns {Promise<{text: string|null, startMs: number, endMs: number}>}
   */
  enqueueTranslation(chunk, videoId) {
    const cacheKey = `${videoId}_${chunk.startMs}_${chunk.endMs}_${this.scriptType}`;
    if (this.cache.has(cacheKey)) {
      return Promise.resolve({
        text: this.cache.get(cacheKey),
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        cached: true
      });
    }

    return new Promise((resolve, reject) => {
      this.queue.push({
        chunk,
        videoId,
        resolve,
        reject,
        timestamp: chunk.startMs
      });

      // Sort queue so earliest chunks in video are processed with highest priority
      this.queue.sort((a, b) => a.timestamp - b.timestamp);

      this._processQueue();
    });
  }

  _processQueue() {
    while (this.activeWorkers < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      this.activeWorkers++;

      this._executeTranslation(task.chunk, task.videoId)
        .then(res => task.resolve(res))
        .catch(err => task.reject(err))
        .finally(() => {
          this.activeWorkers--;
          this._processQueue();
        });
    }
  }

  /**
   * Internal execution of Gemini API translation call
   */
  async _executeTranslation(chunk, videoId) {
    if (!this.apiKey) {
      return { text: null, startMs: chunk.startMs, endMs: chunk.endMs, error: 'NO_API_KEY' };
    }

    const cacheKey = `${videoId}_${chunk.startMs}_${chunk.endMs}_${this.scriptType}`;
    if (this.cache.has(cacheKey)) {
      return {
        text: this.cache.get(cacheKey),
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        cached: true
      };
    }

    const scriptInstruction = this.scriptType === 'cyrillic'
      ? 'Target script: Serbian Cyrillic (Srpska Ćirilica - азбука: а, б, в, г, д, ђ, е, ж, з, и, ј, к, л, љ, м, н, њ, о, п, р, с, т, ћ, у, ф, х, ц, ч, џ, ш).'
      : 'Target script: Serbian Latin (Srpska Latinica - abeceda: a, b, c, č, ć, d, dž, đ, e, f, g, h, i, j, k, l, lj, m, n, nj, o, p, r, s, š, t, u, v, z, ž).';

    let contextHint = '';
    if (this.enableContextChaining && this.lastContextText) {
      contextHint = `\nContext from immediately preceding sentence: "${this.lastContextText}" (use this only to maintain grammatical flow and pronouns).`;
    }

    const systemPrompt = `You are an expert real-time subtitle translator.
Listen carefully to the spoken speech in the provided audio clip and translate it directly and accurately into natural Serbian.
${scriptInstruction}${contextHint}

Strict Subtitle Rules:
1. Output ONLY the Serbian translation text.
2. DO NOT include any timestamps, explanations, notes, metadata, or quotation marks.
3. If there is NO speech (e.g. only background music, silence, ambient noise, coughs, laughter), output exactly: [EMPTY]
4. Keep the translation concise and natural for on-screen subtitles.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const payload = {
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: 'audio/wav',
                data: chunk.base64Audio
              }
            },
            {
              text: systemPrompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 256
      }
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[GeminiSubtitles] Translation API Error:', response.status, errorData);
        return { text: null, startMs: chunk.startMs, endMs: chunk.endMs, error: errorData.error?.message || `HTTP ${response.status}` };
      }

      const data = await response.json();
      let translation = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

      // Check if LLM detected empty/noise
      if (translation === '[EMPTY]' || translation === '' || translation.toLowerCase() === 'empty') {
        translation = null;
      }

      if (translation) {
        // Strip any accidental markdown formatting or surrounding quotes
        translation = translation.replace(/^["']|["']$/g, '').trim();
        this.cache.set(cacheKey, translation);
        this.lastContextText = translation;
      }

      return {
        text: translation,
        startMs: chunk.startMs,
        endMs: chunk.endMs
      };
    } catch (err) {
      console.error('[GeminiSubtitles] Network / API Request Failed:', err);
      return { text: null, startMs: chunk.startMs, endMs: chunk.endMs, error: err.message };
    }
  }

  /**
   * Resets context tracking and worker queue (e.g. on new video navigation)
   */
  resetQueue() {
    this.queue = [];
    this.lastContextText = '';
  }

  /**
   * Clear in-memory translation cache
   */
  clearCache() {
    this.cache.clear();
    this.lastContextText = '';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeminiService;
}
