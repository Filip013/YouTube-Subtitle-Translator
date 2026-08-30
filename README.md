# YouTube Subtitle Translator (Powered by Gemini 3.5 Flash Lite) 🇷🇸✨

A high-performance Chrome Extension (Manifest V3) that captures real-time YouTube video audio, intelligently extracts speech segments with programmatic millisecond timestamps using client-side Voice Activity Detection (VAD), and translates the speech into natural **Serbian** using **Google Gemini 3.5 Flash Lite**.

---

## 🌟 Key Highlights

- 🎙️ **Audio-First Architecture**: Captures audio directly from the video stream via Web Audio API. Works on **any video**, even if YouTube captions or transcripts do not exist.
- ⏱️ **Programmatic Timestamps (VAD)**: Speech boundaries and start/end timestamps (`startMs`, `endMs`) are measured directly in the browser via an adaptive Voice Activity Detection engine. This completely bypasses LLM timestamp hallucinations.
- ⚡ **Gemini 3.5 Flash Lite**: Slices are resampled to 16kHz mono WAV and sent to Gemini Flash Lite for ultra-fast, context-aware translation (~200–300ms latency).
- 🇷🇸 **Dual Serbian Script Support**:
  - **Latinica (Serbian Latin)**: Standard Latin script (*abeceda: č, ć, ž, š, đ...*)
  - **Ћирилица (Serbian Cyrillic)**: Official Serbian Cyrillic script (*азбука: ч, ћ, ж, ш, ђ, љ, њ, џ...*)
- 🎨 **Native Subtitle Overlay**: High-contrast, responsive subtitle container overlaid inside YouTube's `#movie_player`, fully synchronized with playback speed, seeking, and Fullscreen/Theater modes.
- ⚙️ **Customizable**: Adjust font size, text colors, background opacity, vertical position, VAD sensitivity, and max chunk duration.

---

## 📁 Project Structure

```
YouTube-Translate/
├── manifest.json              # Chrome Manifest V3 configuration
├── icons/                     # Extension icons (16x16, 48x48, 128x128)
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   └── generate_icons.js
├── popup/                     # Quick-access extension popup
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── options/                   # Comprehensive settings dashboard & live preview
│   ├── options.html
│   ├── options.css
│   └── options.js
├── src/                       # Extension core engine
│   ├── audio_utils.js         # 16kHz resampling, 16-bit PCM WAV & Base64 encoder
│   ├── vad_processor.js       # Real-time Voice Activity Detection & chunker
│   ├── audio_capture.js       # HTML5 <video> stream capture via Web Audio API
│   ├── gemini_service.js      # Gemini 3.5 Flash Lite API translation client
│   ├── subtitle_renderer.js   # Synchronized DOM subtitle overlay engine
│   ├── content.js             # YouTube lifecycle & SPA orchestrator
│   ├── content.css            # YouTube-matching subtitle overlay styling
│   └── background.js          # Background Service Worker
├── test/
│   └── test_core.js           # Unit tests for audio encoding and VAD
└── README.md
```

---

## 🚀 Installation Guide

### Step 1: Open Chrome Extensions
1. Open Google Chrome (or Brave / Edge).
2. Navigate to `chrome://extensions` in the address bar.
3. Enable **Developer mode** using the toggle in the top-right corner.

### Step 2: Load Unpacked Extension
1. Click the **Load unpacked** button in the top-left.
2. Select the `YouTube-Translate` folder:
   ```
   d:\Documents\Coding Projects\YouTube-Translate
   ```
3. The extension **YouTube Subtitle Translator (Gemini Flash Lite)** will appear in your extensions list.

### Step 3: Configure Gemini API Key
1. Get a free Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Click the extension icon in your Chrome toolbar.
3. Paste your API key and click **Save**.
4. Click **⚡ Test Connection** to verify that the key is working with `gemini-3.5-flash-lite`.

---

## 🎬 How to Use

1. Open any video on [YouTube](https://www.youtube.com).
2. Press Play.
3. As the audio plays, the extension's VAD detects spoken phrases, translates them with Gemini 3.5 Flash Lite, and renders Serbian subtitles in real-time over the video.
4. Use the popup to quickly toggle between **Latinica** and **Ћирилица**, or adjust voice sensitivity.

---

## ⚙️ Advanced Settings

Right-click the extension icon and select **Options** (or click **⚙️ Settings** in the popup) to access:
- **Model Selection**: Default is `gemini-3.5-flash-lite`. You can also switch to `gemini-2.0-flash-lite` or `gemini-2.5-flash`.
- **VAD Silence Hangover**: Adjust sentence pause duration (default: `450ms`).
- **Max Speech Duration**: Max length of continuous monologue before chunking (default: `5500ms`).
- **Appearance & Styling**: Customize font size, color, background opacity, and vertical offset with a live preview.

---

## 🧪 Running Unit Tests

Run the core unit tests with Node.js:
```bash
node test/test_core.js
```
