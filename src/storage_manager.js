/**
 * Storage Manager for YouTube Subtitle Translator
 * Handles persistent storage of video subtitle tracks using chrome.storage.local
 */

class StorageManager {
  constructor() {
    this.pendingSaves = new Map(); // Key: `${videoId}_${scriptType}` -> Set of cues
    this.flushTimers = new Map();
  }

  /**
   * Generates a storage key for a video and script type
   */
  static getKey(videoId, scriptType = 'latin') {
    return `yt_subs_${videoId}_${scriptType}`;
  }

  /**
   * Loads all saved subtitle cues for a specific video and script
   * @param {string} videoId 
   * @param {string} scriptType 
   * @returns {Promise<Array<{id: string, text: string, startMs: number, endMs: number}>>}
   */
  async loadSubtitles(videoId, scriptType = 'latin') {
    if (!videoId) return [];
    const key = StorageManager.getKey(videoId, scriptType);

    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve([]);
        return;
      }

      chrome.storage.local.get([key], (result) => {
        if (result && result[key] && Array.isArray(result[key].cues)) {
          resolve(result[key].cues);
        } else {
          resolve([]);
        }
      });
    });
  }

  /**
   * Saves or merges a newly translated cue into persistent storage with debounced flushing.
   * @param {string} videoId 
   * @param {string} scriptType 
   * @param {Object} cue - { startMs: number, endMs: number, text: string }
   */
  saveCue(videoId, scriptType = 'latin', cue) {
    if (!videoId || !cue || !cue.text) return;
    const key = StorageManager.getKey(videoId, scriptType);

    if (!this.pendingSaves.has(key)) {
      this.pendingSaves.set(key, []);
    }
    this.pendingSaves.get(key).push(cue);

    // Debounce flush to storage (500ms)
    if (this.flushTimers.has(key)) {
      clearTimeout(this.flushTimers.get(key));
    }

    const timer = setTimeout(() => {
      this._flushKey(key, videoId, scriptType);
    }, 500);

    this.flushTimers.set(key, timer);
  }

  async _flushKey(key, videoId, scriptType) {
    const newCues = this.pendingSaves.get(key) || [];
    this.pendingSaves.delete(key);
    this.flushTimers.delete(key);

    if (newCues.length === 0) return;

    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

    chrome.storage.local.get([key, 'yt_saved_video_index'], (result) => {
      const existing = result[key] || {
        videoId: videoId,
        scriptType: scriptType,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        cues: []
      };

      const cueMap = new Map();
      // Add existing cues
      for (const c of existing.cues) {
        cueMap.set(`${c.startMs}_${c.endMs}`, c);
      }
      // Merge new cues
      for (const c of newCues) {
        cueMap.set(`${c.startMs}_${c.endMs}`, c);
      }

      const mergedCues = Array.from(cueMap.values()).sort((a, b) => a.startMs - b.startMs);
      existing.cues = mergedCues;
      existing.updatedAt = Date.now();

      // Update index of saved videos
      let index = result.yt_saved_video_index || {};
      index[videoId] = {
        videoId: videoId,
        cueCount: mergedCues.length,
        updatedAt: Date.now()
      };

      chrome.storage.local.set({
        [key]: existing,
        yt_saved_video_index: index
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
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve();
        return;
      }

      const latinKey = StorageManager.getKey(videoId, 'latin');
      const cyrillicKey = StorageManager.getKey(videoId, 'cyrillic');

      chrome.storage.local.get(['yt_saved_video_index'], (result) => {
        let index = result.yt_saved_video_index || {};
        delete index[videoId];

        chrome.storage.local.remove([latinKey, cyrillicKey], () => {
          chrome.storage.local.set({ yt_saved_video_index: index }, resolve);
        });
      });
    });
  }

  /**
   * Clears all saved subtitles and cache
   */
  async clearAll() {
    return new Promise((resolve) => {
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
