/**
 * Background Service Worker for YouTube Subtitle Translator
 * Handles extension installation, initial storage defaults, and message routing.
 */

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    const defaultSettings = {
      enabled: true,
      apiKey: '',
      model: 'gemini-3.5-flash-lite',
      scriptType: 'latin', // 'latin' (Latinica) or 'cyrillic' (Ćirilica)
      sensitivity: 'medium', // 'low', 'medium', 'high'
      fontSize: 22,
      fontColor: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.78)',
      bottomOffset: 12
    };

    chrome.storage.sync.get(defaultSettings, (items) => {
      chrome.storage.sync.set(items);
    });

    console.log('[GeminiSubtitles] Extension installed. Defaults initialized.');
  }
});

// Handle messages from popup / options
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openOptions') {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return true;
  }
});
