/**
 * Gemini Text Translator for YouTube Subtitle Translator (Stage 2: Translation)
 * Fast, accurate text-to-text translation from English transcripts to Serbian
 * using gemini-3.1-flash-lite with gender agreement and script selection.
 */

class GeminiTextTranslator {
  constructor(config = {}) {
    this.apiKey = config.apiKey || '';
    this.model = config.model || 'gemini-3.1-flash-lite';
    this.scriptType = config.scriptType || 'latin'; // 'latin' or 'cyrillic'
    this.speakerGender = config.speakerGender || 'auto'; // 'auto', 'male', 'female'

    this.cache = new Map(); // `${text}_${scriptType}_${speakerGender}` -> translation
    this.lastContextText = '';
  }

  updateConfig(config = {}) {
    if (config.apiKey !== undefined) this.apiKey = config.apiKey;
    if (config.model !== undefined) this.model = config.model;
    if (config.scriptType !== undefined) this.scriptType = config.scriptType;
    if (config.speakerGender !== undefined) this.speakerGender = config.speakerGender;
  }

  /**
   * Translates an English transcript sentence to Serbian
   * @param {string} englishText 
   * @returns {Promise<string>} Serbian translation
   */
  async translateText(englishText) {
    if (!englishText || !englishText.trim()) return '';
    if (!this.apiKey) {
      console.warn('[GeminiTranslator] Missing API key.');
      return '';
    }

    const cleanInput = englishText.trim();
    const cacheKey = `${cleanInput}_${this.scriptType}_${this.speakerGender}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const scriptInstruction = this.scriptType === 'cyrillic'
      ? 'Target script: Serbian Cyrillic (Srpska Ćirilica - азбука: а, б, в, г, д, ђ, е, ж, з, и, ј, к, л, љ, м, н, њ, о, п, р, с, т, ћ, у, ф, х, ц, ч, џ, ш).'
      : 'Target script: Serbian Latin (Srpska Latinica - abeceda: a, b, c, č, ć, d, dž, đ, e, f, g, h, i, j, k, l, lj, m, n, nj, o, p, r, s, š, t, u, v, z, ž).';

    let genderInstruction = '';
    if (this.speakerGender === 'female') {
      genderInstruction = 'The speaker is FEMALE. Use feminine past tense verb forms and adjectives (e.g. bila sam, rekla sam, videla sam, srećna).';
    } else if (this.speakerGender === 'male') {
      genderInstruction = 'The speaker is MALE. Use masculine past tense verb forms and adjectives (e.g. bio sam, rekao sam, video sam, srećan).';
    } else {
      genderInstruction = 'Default to standard natural Serbian phrasing with appropriate gender/neutral agreement.';
    }

    let contextHint = '';
    if (this.lastContextText) {
      contextHint = `Context from previous sentence: "${this.lastContextText}".`;
    }

    const systemPrompt = `You are an expert English to Serbian subtitle translator.
Translate the provided English transcript sentence directly and accurately into natural Serbian.
${scriptInstruction}
${genderInstruction}
${contextHint}

Strict Rules:
1. Output ONLY the translated Serbian subtitle text.
2. DO NOT include timestamps, explanations, notes, metadata, or surrounding quotes.
3. Keep the translation natural, concise, and contextually accurate for video subtitles.
4. If the text is unintelligible noise, output [EMPTY].`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const payload = {
      contents: [
        {
          parts: [
            { text: `${systemPrompt}\n\nEnglish Transcript to Translate:\n"${cleanInput}"` }
          ]
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
        const errorData = await response.json().catch(() => ({}));
        console.error('[GeminiTranslator] Translation error:', response.status, errorData);
        return cleanInput; // fallback
      }

      const data = await response.json();
      let translation = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

      if (translation === '[EMPTY]' || translation.toLowerCase() === 'empty') {
        translation = '';
      }

      if (translation) {
        translation = translation.replace(/^["']|["']$/g, '').trim();
        this.cache.set(cacheKey, translation);
        this.lastContextText = translation;
      }

      return translation;
    } catch (err) {
      console.error('[GeminiTranslator] Network request failed:', err);
      return '';
    }
  }

  clearCache() {
    this.cache.clear();
    this.lastContextText = '';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeminiTextTranslator;
}
