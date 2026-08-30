/**
 * Test Subtitle Resolution with Non-Overlapping Adjacent Cues & Reverse Search
 */

class FixedSubtitleRenderer {
  constructor() {
    this.cues = [];
  }

  addCue(cue, currentPlaybackMs = 0) {
    if (!cue || !cue.text) return;
    const cleanText = cue.text.trim();
    if (!cleanText) return;

    const wordCount = cleanText.split(/\s+/).length;
    const readingDurationMs = Math.max(2800, wordCount * 360);

    const baseEnd = Math.max(cue.endMs, cue.startMs + readingDurationMs);
    const liveEnd = currentPlaybackMs > 0 ? Math.max(baseEnd, currentPlaybackMs + readingDurationMs) : baseEnd;

    const newCue = {
      id: `${cue.startMs}_${liveEnd}`,
      text: cleanText,
      startMs: cue.startMs,
      endMs: liveEnd
    };

    // Cleanly truncate previous overlapping cue so it doesn't block the new one
    this.cues.forEach(c => {
      if (c.startMs < newCue.startMs && c.endMs > newCue.startMs) {
        c.endMs = newCue.startMs;
      }
    });

    this.cues = this.cues.filter(c => Math.abs(c.startMs - newCue.startMs) > 400);
    this.cues.push(newCue);
    this.cues.sort((a, b) => a.startMs - b.startMs);
  }

  getOnScreenText(currentTimeMs) {
    // Find the most recent active cue at currentTimeMs
    const activeCue = [...this.cues].reverse().find(
      c => currentTimeMs >= c.startMs - 150 && currentTimeMs <= c.endMs + 200
    );
    return activeCue ? activeCue.text : '[NO SUBTITLE]';
  }
}

const renderer = new FixedSubtitleRenderer();

// Simulate 5 consecutive incoming cues during 30s playback
renderer.addCue({ text: "Ovo je jedna od najtežih muzika koju sam ikada napisao za izvođača.", startMs: 100, endMs: 5500 }, 5500);
renderer.addCue({ text: "Ali ne zvuči teško.", startMs: 5500, endMs: 8400 }, 8400);
renderer.addCue({ text: "Nema ogromnih akorda, nema spektakularnih pasaža.", startMs: 8400, endMs: 13500 }, 13500);
renderer.addCue({ text: "Samo tri savršeno jasne muzičke linije...", startMs: 13500, endMs: 21600 }, 21600);
renderer.addCue({ text: "Pogledajte bilo koju od tih linija...", startMs: 21600, endMs: 28300 }, 28300);

console.log("=== VERIFYING CLEAN NON-BLOCKING SUBTITLE TRANSITIONS ===");
for (let sec = 0; sec <= 30; sec += 2) {
  const tMs = sec * 1000;
  console.log(`⏱️ [${sec}s]: "${renderer.getOnScreenText(tMs)}"`);
}
