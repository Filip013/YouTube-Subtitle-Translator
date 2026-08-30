/**
 * Storage Manager for YouTube Subtitle Translator
 * Guarantees direct, immediate persistence to chrome.storage.local on every chunk
 */

class StorageManager {
  constructor() {
    this.inMemoryCache = new Map();
  }

  /**
   * Generates a unified storage key for a video
   */
  static getKey(videoId) {
    const cleanId = String(videoId || '').trim();
    return `yt_subs_${cleanId}`;
  }

  /**
   * Extracts clean Video ID from any YouTube URL (watch, shorts, embed, live)
   */
  static extractVideoId(urlStr) {
    if (!urlStr) return null;
    try {
      const url = new URL(urlStr);
      if (url.searchParams.has('v')) {
        return url.searchParams.get('v');
      }
      const match = url.pathname.match(/\/(shorts|embed|live|v)\/([a-zA-Z0-9_-]+)/);
      if (match && match[2]) {
        return match[2];
      }
    } catch (e) {
      const match = String(urlStr).match(/[?&]v=([a-zA-Z0-9_-]+)/);
      if (match) return match[1];
    }
    return null;
  }

  /**
   * Loads all saved subtitle cues for a specific video
   * @param {string} videoId 
   * @returns {Promise<Array<{id: string, text: string, originalText?: string, startMs: number, endMs: number}>>}
   */
  async loadSubtitles(videoId) {
    const cleanId = String(videoId || '').trim();
    if (!cleanId) return [];

    const key = StorageManager.getKey(cleanId);

    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        const cached = this.inMemoryCache.get(key) || [];
        resolve(cached);
        return;
      }

      const legacyLatinKey = `yt_subs_${cleanId}_latin`;
      const legacyCyrillicKey = `yt_subs_${cleanId}_cyrillic`;

      chrome.storage.local.get([key, legacyLatinKey, legacyCyrillicKey], (result) => {
        let cues = [];
        if (result && result[key] && Array.isArray(result[key].cues) && result[key].cues.length > 0) {
          cues = result[key].cues;
        } else if (result && result[legacyLatinKey] && Array.isArray(result[legacyLatinKey].cues)) {
          cues = result[legacyLatinKey].cues;
        } else if (result && result[legacyCyrillicKey] && Array.isArray(result[legacyCyrillicKey].cues)) {
          cues = result[legacyCyrillicKey].cues;
        } else {
          cues = this.inMemoryCache.get(key) || [];
        }

        this.inMemoryCache.set(key, cues);
        console.log(`[StorageManager] ✅ Loaded ${cues.length} saved fragments from storage for video [${cleanId}]`);
        resolve(cues);
      });
    });
  }

  /**
   * Saves or updates a subtitle cue IMMEDIATELY into chrome.storage.local
   * @param {string} videoId 
   * @param {string} scriptType 
   * @param {Object} cue - { startMs: number, endMs: number, text: string, originalText?: string }
   * @param {string} [videoTitle] - Title of the YouTube video
   * @returns {Promise<void>}
   */
  async saveCue(videoId, scriptType = 'latin', cue, videoTitle = '') {
    const cleanId = String(videoId || '').trim();
    if (!cleanId || !cue || (!cue.text && !cue.originalText)) return;

    const key = StorageManager.getKey(cleanId);
    const cueItem = {
      id: `${cue.startMs}_${cue.endMs}`,
      text: (cue.text || cue.originalText || '').trim(),
      originalText: cue.originalText ? cue.originalText.trim() : (cue.text || '').trim(),
      startMs: cue.startMs,
      endMs: cue.endMs
    };

    // 1. Update in-memory cache synchronously
    const existingCached = this.inMemoryCache.get(key) || [];
    const filteredCached = existingCached.filter(c => c.id !== cueItem.id);
    filteredCached.push(cueItem);
    filteredCached.sort((a, b) => a.startMs - b.startMs);
    this.inMemoryCache.set(key, filteredCached);

    // 2. Direct write to chrome.storage.local
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve();
        return;
      }

      chrome.storage.local.get([key, 'yt_saved_video_index'], (result) => {
        const existingRecord = result[key] || {
          videoId: cleanId,
          videoTitle: videoTitle || `YouTube Video (${cleanId})`,
          scriptType: scriptType || 'latin',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          cues: []
        };

        if (videoTitle) {
          existingRecord.videoTitle = videoTitle;
        }

        const cueMap = new Map();
        for (const c of existingRecord.cues) {
          cueMap.set(`${c.startMs}_${c.endMs}`, c);
        }
        cueMap.set(`${cueItem.startMs}_${cueItem.endMs}`, cueItem);

        const mergedCues = Array.from(cueMap.values()).sort((a, b) => a.startMs - b.startMs);
        existingRecord.cues = mergedCues;
        existingRecord.updatedAt = Date.now();

        let index = result.yt_saved_video_index || {};
        index[cleanId] = {
          videoId: cleanId,
          videoTitle: existingRecord.videoTitle,
          cueCount: mergedCues.length,
          updatedAt: Date.now()
        };

        chrome.storage.local.set({
          [key]: existingRecord,
          yt_saved_video_index: index
        }, () => {
          console.log(`[StorageManager] 💾 SAVED TO CHROME STORAGE: "${cueItem.text}" (${mergedCues.length} total saved)`);
          resolve();
        });
      });
    });
  }

  /**
   * Deletes an individual subtitle fragment from a video
   */
  async deleteCue(videoId, scriptType = 'latin', cueId) {
    const cleanId = String(videoId || '').trim();
    if (!cleanId || !cueId) return [];
    const key = StorageManager.getKey(cleanId);

    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve([]);
        return;
      }

      chrome.storage.local.get([key, 'yt_saved_video_index'], (result) => {
        if (!result || !result[key]) {
          resolve([]);
          return;
        }

        const data = result[key];
        data.cues = (data.cues || []).filter(c => `${c.startMs}_${c.endMs}` !== cueId && c.id !== cueId);
        data.updatedAt = Date.now();

        let index = result.yt_saved_video_index || {};
        if (data.cues.length > 0) {
          index[cleanId] = {
            ...index[cleanId],
            cueCount: data.cues.length,
            updatedAt: Date.now()
          };
        } else {
          delete index[cleanId];
        }

        chrome.storage.local.set({
          [key]: data,
          yt_saved_video_index: index
        }, () => {
          this.inMemoryCache.set(key, data.cues);
          resolve(data.cues);
        });
      });
    });
  }

  /**
   * Retrieves summary list of all videos with saved subtitles
   */
  async getAllSavedVideos() {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve([]);
        return;
      }

      chrome.storage.local.get(['yt_saved_video_index'], (result) => {
        const index = result.yt_saved_video_index || {};
        resolve(Object.values(index));
      });
    });
  }

  /**
   * Deletes saved subtitles for a specific video
   */
  async deleteVideoSubtitles(videoId) {
    const cleanId = String(videoId || '').trim();
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve();
        return;
      }

      const key = StorageManager.getKey(cleanId);
      const legacyLatinKey = `yt_subs_${cleanId}_latin`;
      const legacyCyrillicKey = `yt_subs_${cleanId}_cyrillic`;

      chrome.storage.local.get(['yt_saved_video_index'], (result) => {
        let index = result.yt_saved_video_index || {};
        delete index[cleanId];

        chrome.storage.local.remove([key, legacyLatinKey, legacyCyrillicKey], () => {
          chrome.storage.local.set({ yt_saved_video_index: index }, () => {
            this.inMemoryCache.delete(key);
            resolve();
          });
        });
      });
    });
  }

  /**
   * Exports subtitle track as SRT format
   */
  static exportSRT(cues) {
    const formatSRTTime = (ms) => {
      const totalSec = Math.floor(ms / 1000);
      const hours = String(Math.floor(totalSec / 3600)).padStart(2, '0');
      const mins = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
      const secs = String(totalSec % 60).padStart(2, '0');
      const millis = String(ms % 1000).padStart(3, '0');
      return `${hours}:${mins}:${secs},${millis}`;
    };

    return cues.map((cue, idx) => {
      return `${idx + 1}\n${formatSRTTime(cue.startMs)} --> ${formatSRTTime(cue.endMs)}\n${cue.text}\n`;
    }).join('\n');
  }

  /**
   * Clears all saved subtitles and cache
   */
  async clearAll() {
    return new Promise((resolve) => {
      this.inMemoryCache.clear();
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve();
        return;
      }
      chrome.storage.local.clear(resolve);
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
}
