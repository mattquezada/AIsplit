/**
 * Speech synthesis with a best-effort *natural* voice. Browsers ship a mix of
 * robotic and neural voices; we prefer the neural/"Natural"/Google/Apple ones
 * and fall back gracefully. Voices load asynchronously, so we re-pick on the
 * `voiceschanged` event.
 */
let chosen: SpeechSynthesisVoice | null = null;
let initialized = false;

// Highest-quality first. These match the neural voices on macOS, iOS, Chrome,
// and Edge; later entries are decent locals.
const PREFERRED: RegExp[] = [
  /Natural/i,
  /Google US English/i,
  /Google UK English Female/i,
  /Microsoft (Aria|Jenny|Guy|Emma|Ava).*Online/i,
  /Samantha/i,
  /\bAva\b/i,
  /Allison/i,
  /Serena/i,
  /Siri/i,
];

function choose(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const en = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const pool = en.length ? en : voices;
  for (const re of PREFERRED) {
    const m = pool.find((v) => re.test(v.name));
    if (m) return m;
  }
  // Otherwise a US-English voice, preferring a non-default one.
  return pool.find((v) => v.lang === "en-US") ?? pool[0];
}

export function initVoices() {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || initialized) return;
  initialized = true;
  const refresh = () => {
    const v = choose();
    if (v) chosen = v;
  };
  refresh();
  window.speechSynthesis.addEventListener("voiceschanged", refresh);
}

export function speak(
  text: string,
  opts: { interrupt?: boolean; rate?: number; pitch?: number; volume?: number } = {}
) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  initVoices();
  const u = new SpeechSynthesisUtterance(text);
  if (chosen) u.voice = chosen;
  u.rate = opts.rate ?? 1.0;
  u.pitch = opts.pitch ?? 1.0;
  u.volume = opts.volume ?? 1.0;
  if (opts.interrupt) window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}
