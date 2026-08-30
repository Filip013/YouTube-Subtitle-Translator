/**
 * Storage Manager for YouTube Subtitle Translator
 * Immediate, rock-solid persistence of video subtitle tracks and fragments in chrome.storage.local
 */

class StorageManager {
  constructor() {
    this.inMemoryCache = new Map();
  }

  /**
   * Generates a storage key for a video and script type
   */
  static getKey(videoId, scriptType = 'latin') {
    const cleanId = String(videoId || '').trim();
    const cleanScript = String(scriptType || 'latin').toLowerCase().trim();
    return `yt_subs_${cleanId}_${cleanScript}`;
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
   * Loads all saved subtitle cues for a specific video and script
   * @param {string} videoId 
   * @param {string} scriptType 
   * @returns {Promise<Array<{id: string, text: string, originalText?: string, startMs: number, endMs: number}>>}
   */
  async loadSubtitles(videoId, scriptType = 'latin') {
    const cleanId = String(videoId || '').trim();
    if (!cleanId) return [];

    const key = StorageManager.getKey(cleanId, scriptType);

    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        const cached = this.inMemoryCache.get(key) || [];
        resolve(cached);
        return;
      }

      chrome.storage.local.get([key], (result) => {
        if (result && result[key] && Array.isArray(result[key].cues)) {
          this.inMemoryCache.set(key, result[key].cues);
          console.log(`[StorageManager] Successfully loaded ${result[key].cues.length} cues for [${key}]`);
          resolve(result[key].cues);
        } else {
          const cached = this.inMemoryCache.get(key) || [];
          resolve(cached);
        }
      });
    });
  }

  /**
   * Saves or merges a subtitle cue immediately into chrome.storage.local
   * @param {string} videoId 
   * @param {string} scriptType 
   * @param {Object} cue - { startMs: number, endMs: number, text: string, originalText?: string }
   * @param {string} [videoTitle] - Title of the YouTube video
   * @returns {Promise<void>}
   */
  async saveCue(videoId, scriptType = 'latin', cue, videoTitle = '') {
    const cleanId = String(videoId || '').trim();
    if (!cleanId || !cue || !cue.text) return;

    const key = StorageManager.getKey(cleanId, scriptType);
    const cueItem = {
      id: `${cue.startMs}_${cue.endMs}`,
      text: cue.text.trim(),
      originalText: cue.originalText ? cue.originalText.trim() : '',
      startMs: cue.startMs,
      endMs: cue.endMs
    };

    // Update in-memory cache immediately
    const existingCached = this.inMemoryCache.get(key) || [];
    const filteredCached = existingCached.filter(c => c.id !== cueItem.id);
    filteredCached.push(cueItem);
    filteredCached.sort((a, b) => a.startMs - b.startMs);
    this.inMemoryCache.set(key, filteredCached);

    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve();
        return;
      }

      chrome.storage.local.get([key, 'yt_saved_video_index'], (result) => {
        const existingRecord = result[key] || {
          videoId: cleanId,
          videoTitle: videoTitle || `YouTube Video (${cleanId})`,
          scriptType: scriptType,
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

        // Update global index
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
          this.inMemoryCache.set(key, mergedCues);
          console.log(`[StorageManager] Persisted cue: "${cueItem.text}" (Total stored: ${mergedCues.length})`);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('gemini_subtitles_updated', { detail: { count: mergedCues.length } }));
          }
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
    const key = StorageManager.getKey(cleanId, scriptType);

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

      const latinKey = StorageManager.getKey(cleanId, 'latin');
      const cyrillicKey = StorageManager.getKey(cleanId, 'cyrillic');

      chrome.storage.local.get(['yt_saved_video_index'], (result) => {
        let index = result.yt_saved_video_index || {};
        delete index[cleanId];

        chrome.storage.local.remove([latinKey, cyrillicKey], () => {
          chrome.storage.local.set({ yt_saved_video_index: index }, () => {
            this.inMemoryCache.delete(latinKey);
            this.inMemoryCache.delete(cyrillicKey);
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
