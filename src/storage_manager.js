/**
 * Storage Manager for YouTube Subtitle Translator
 * Handles persistent storage of video subtitle tracks, individual fragment deletion,
 * video title metadata, and SRT/VTT export using chrome.storage.local
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
   * @param {string} [videoTitle] - Title of the YouTube video
   */
  saveCue(videoId, scriptType = 'latin', cue, videoTitle = '') {
    if (!videoId || !cue || !cue.text) return;
    const key = StorageManager.getKey(videoId, scriptType);

    if (!this.pendingSaves.has(key)) {
      this.pendingSaves.set(key, { cues: [], videoTitle: videoTitle });
    }
    const record = this.pendingSaves.get(key);
    record.cues.push(cue);
    if (videoTitle && !record.videoTitle) {
      record.videoTitle = videoTitle;
    }

    // Debounce flush to storage (400ms)
    if (this.flushTimers.has(key)) {
      clearTimeout(this.flushTimers.get(key));
    }

    const timer = setTimeout(() => {
      this._flushKey(key, videoId, scriptType);
    }, 400);

    this.flushTimers.set(key, timer);
  }

  async _flushKey(key, videoId, scriptType) {
    const record = this.pendingSaves.get(key);
    this.pendingSaves.delete(key);
    this.flushTimers.delete(key);

    if (!record || record.cues.length === 0) return;
    const { cues: newCues, videoTitle } = record;

    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

    chrome.storage.local.get([key, 'yt_saved_video_index'], (result) => {
      const existing = result[key] || {
        videoId: videoId,
        videoTitle: videoTitle || `YouTube Video (${videoId})`,
        scriptType: scriptType,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        cues: []
      };

      if (videoTitle) {
        existing.videoTitle = videoTitle;
      }

      const cueMap = new Map();
      for (const c of existing.cues) {
        cueMap.set(`${c.startMs}_${c.endMs}`, c);
      }
      for (const c of newCues) {
        cueMap.set(`${c.startMs}_${c.endMs}`, c);
      }

      const mergedCues = Array.from(cueMap.values()).sort((a, b) => a.startMs - b.startMs);
      existing.cues = mergedCues;
      existing.updatedAt = Date.now();

      let index = result.yt_saved_video_index || {};
      index[videoId] = {
        videoId: videoId,
        videoTitle: existing.videoTitle || `YouTube Video (${videoId})`,
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
   * Deletes an individual subtitle fragment from a video
   */
  async deleteCue(videoId, scriptType = 'latin', cueId) {
    if (!videoId || !cueId) return [];
    const key = StorageManager.getKey(videoId, scriptType);

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
          index[videoId] = {
            ...index[videoId],
            cueCount: data.cues.length,
            updatedAt: Date.now()
          };
        } else {
          delete index[videoId];
        }

        chrome.storage.local.set({
          [key]: data,
          yt_saved_video_index: index
        }, () => resolve(data.cues));
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
