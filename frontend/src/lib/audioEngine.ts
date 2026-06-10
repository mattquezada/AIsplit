/**
 * MultitrackEngine — synchronized multi-stem playback via the Web Audio API.
 *
 * All stems share one AudioContext and start at the same context time, so they
 * stay sample-accurately in sync. Each stem has its own gain + stereo-pan node.
 * WaveSurfer is used only for waveform *visuals*; this engine owns transport.
 *
 * The metronome click is synthesized here from a clap sample, scheduled on the
 * song's actual detected beat grid (so it tracks the recording instead of a rigid
 * BPM line) with a small editable latency nudge. A count-in can lead playback in,
 * firing a callback per beat so the UI can speak the numbers in time.
 */

export interface LoadedStem {
  id: string;
  buffer: AudioBuffer;
  peaks: number[];
  gain: GainNode;
  pan: StereoPannerNode;
}

export interface ClickConfig {
  enabled: boolean;
  volume: number; // 0..1.5
  beats: number[]; // ascending song-times (already latency-adjusted)
  downbeats: number[]; // subset of `beats` to accent (song-times)
  beatsPerBar: number;
  countInBars: number; // 0 = no count-in
  bpm: number; // for count-in spacing
}

export interface GuideConfig {
  enabled: boolean;
  cues: { time: number; text: string }[]; // section start times + labels
  leadBeats: number; // announce the label this many beats before the section
}

const LOOKAHEAD_SEC = 0.25;
const SCHEDULER_MS = 25;

export class MultitrackEngine {
  readonly ctx: AudioContext;
  private master: GainNode;
  stems = new Map<string, LoadedStem>();
  private sources = new Map<string, AudioBufferSourceNode>();

  private startContextTime = 0; // ctx time at which song-time `startOffset` plays
  private startOffset = 0; // position (s) playback began from
  playing = false;
  duration = 0;
  loopRegion: { start: number; end: number } | null = null;

  // Click
  private clickGain: GainNode;
  private clickBuffer: AudioBuffer | null = null;
  private clickConfig: ClickConfig | null = null;
  private downSet = new Set<number>(); // rounded(ms) downbeat times
  private clickTimer: number | null = null;
  private nextBeatIdx = 0;
  private clickNodes = new Set<AudioBufferSourceNode>();
  private voiceTimers = new Set<number>();

  // Guide (spoken section cues, beat-aligned)
  private guideConfig: GuideConfig | null = null;
  private guideVoice: ((text: string) => void) | null = null;
  private guideBeatMap = new Map<number, string[]>(); // beat index → utterances

  constructor() {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.clickGain = this.ctx.createGain();
    this.clickGain.gain.value = 1;
    this.clickGain.connect(this.ctx.destination);
  }

  async loadStem(id: string, url: string): Promise<LoadedStem> {
    const res = await fetch(url);
    const arrayBuf = await res.arrayBuffer();
    const buffer = await this.ctx.decodeAudioData(arrayBuf);

    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();
    gain.connect(pan);
    pan.connect(this.master);

    const stem: LoadedStem = { id, buffer, peaks: computePeaks(buffer, 1000), gain, pan };
    this.stems.set(id, stem);
    this.duration = Math.max(this.duration, buffer.duration);
    return stem;
  }

  async loadClickSample(url: string): Promise<void> {
    try {
      const res = await fetch(url);
      const arrayBuf = await res.arrayBuffer();
      this.clickBuffer = await this.ctx.decodeAudioData(arrayBuf);
    } catch {
      this.clickBuffer = null;
    }
  }

  setGain(id: string, value: number) {
    const s = this.stems.get(id);
    if (s) s.gain.gain.value = value;
  }

  setPan(id: string, value: number) {
    const s = this.stems.get(id);
    if (s) s.pan.pan.value = value;
  }

  setMasterVolume(value: number) {
    this.master.gain.value = value;
  }

  setGuideVoice(cb: ((text: string) => void) | null) {
    this.guideVoice = cb;
  }

  setGuide(config: GuideConfig) {
    this.guideConfig = config;
    this.recomputeGuideMap();
  }

  setClick(config: ClickConfig) {
    this.clickConfig = config;
    this.downSet = new Set(config.downbeats.map((t) => Math.round(t * 1000)));
    this.resetBeatPointer();
    this.recomputeGuideMap(); // guide lead-ins ride the same grid
    if (!config.enabled) this.clearClickNodes();
  }

  /** Map each guide cue to the beat that announces its section label. */
  private recomputeGuideMap() {
    this.guideBeatMap.clear();
    const g = this.guideConfig;
    const beats = this.clickConfig?.beats;
    if (!g || !beats || beats.length === 0) return;
    for (const cue of g.cues) {
      const k = nearestBeatIndex(beats, cue.time);
      if (k < 0) continue;
      // Announce the label a bar (leadBeats) before the section arrives.
      const labelIdx = Math.max(0, k - g.leadBeats);
      this.appendGuide(labelIdx, cue.text);
    }
  }

  private appendGuide(beatIdx: number, text: string) {
    const arr = this.guideBeatMap.get(beatIdx) ?? [];
    arr.push(text);
    this.guideBeatMap.set(beatIdx, arr);
  }

  get currentTime(): number {
    if (!this.playing) return this.startOffset;
    const t = this.startOffset + (this.ctx.currentTime - this.startContextTime);
    // Lower-clamp to startOffset so the playhead holds during a count-in.
    return Math.min(Math.max(t, this.startOffset), this.duration);
  }

  /** True while a count-in is sounding before the audio actually starts. */
  get countingIn(): boolean {
    return this.playing && this.ctx.currentTime < this.startContextTime;
  }

  play() {
    this._start(this.clickConfig?.countInBars ?? 0);
  }

  private _start(countInBars: number) {
    if (this.playing) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    const offset = Math.min(this.startOffset, this.duration);
    const cfg = this.clickConfig;
    const beatInterval = this.beatInterval();
    const beatsPerBar = cfg?.beatsPerBar ?? 4;
    const countInBeats = beatInterval > 0 ? countInBars * beatsPerBar : 0;
    const when = this.ctx.currentTime + countInBeats * beatInterval;

    this.startContextTime = when;
    this.startOffset = offset;
    this.resetBeatPointer();

    for (const [id, stem] of this.stems) {
      const src = this.ctx.createBufferSource();
      src.buffer = stem.buffer;
      src.connect(stem.gain);
      src.start(when, offset);
      this.sources.set(id, src);
    }
    this.playing = true;

    // Count-in: a clap on every beat of the lead-in bar(s).
    if (countInBeats > 0) {
      for (let i = 0; i < countInBeats; i++) {
        this.fireClick(this.ctx.currentTime + i * beatInterval, i % beatsPerBar === 0);
      }
    }
    this.startClickScheduler();
  }

  pause() {
    if (!this.playing) return;
    this.startOffset = this.currentTime;
    this.stopSources();
    this.stopClickScheduler();
    this.playing = false;
  }

  seek(time: number) {
    const clamped = Math.max(0, Math.min(time, this.duration));
    const wasPlaying = this.playing;
    if (wasPlaying) {
      this.stopSources();
      this.stopClickScheduler();
    }
    this.startOffset = clamped;
    if (wasPlaying) {
      this.playing = false;
      this._start(0); // seeking never re-triggers a count-in
    }
  }

  private stopSources() {
    for (const src of this.sources.values()) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
  }

  // ── Click scheduling ──────────────────────────────────────────────────────
  private beatInterval(): number {
    const cfg = this.clickConfig;
    if (cfg && cfg.bpm > 0) return 60 / cfg.bpm;
    if (cfg && cfg.beats.length >= 2) {
      const diffs = cfg.beats.slice(1, 9).map((t, i) => t - cfg.beats[i]);
      diffs.sort((a, b) => a - b);
      return diffs[Math.floor(diffs.length / 2)] || 0.5;
    }
    return 0.5;
  }

  private resetBeatPointer() {
    const beats = this.clickConfig?.beats ?? [];
    // First beat at/after the playhead (binary search).
    let lo = 0;
    let hi = beats.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] < this.startOffset - 1e-6) lo = mid + 1;
      else hi = mid;
    }
    this.nextBeatIdx = lo;
  }

  private startClickScheduler() {
    this.stopClickScheduler();
    this.clickTimer = window.setInterval(() => this.scheduleWindow(), SCHEDULER_MS);
    this.scheduleWindow();
  }

  private stopClickScheduler() {
    if (this.clickTimer != null) {
      clearInterval(this.clickTimer);
      this.clickTimer = null;
    }
    for (const id of this.voiceTimers) clearTimeout(id);
    this.voiceTimers.clear();
    this.clearClickNodes();
  }

  private scheduleVoice(text: string, at: number) {
    if (!this.guideVoice) return;
    const cb = this.guideVoice;
    const id = window.setTimeout(() => cb(text), Math.max(0, (at - this.ctx.currentTime) * 1000));
    this.voiceTimers.add(id);
  }

  private clearClickNodes() {
    for (const src of this.clickNodes) {
      try {
        src.stop();
      } catch {
        /* already done */
      }
    }
    this.clickNodes.clear();
  }

  private scheduleWindow() {
    const cfg = this.clickConfig;
    const guide = this.guideConfig;
    const clickOn = !!(cfg && cfg.enabled && this.clickBuffer);
    const guideOn = !!(guide && guide.enabled && this.guideVoice && this.guideBeatMap.size);
    const beats = cfg?.beats ?? [];
    if (!this.playing || !beats.length || (!clickOn && !guideOn)) return;

    const ctxNow = this.ctx.currentTime;
    const horizon = ctxNow + LOOKAHEAD_SEC;

    while (this.nextBeatIdx < beats.length) {
      const tb = beats[this.nextBeatIdx];
      if (tb > this.duration) break;
      const ctxTb = this.startContextTime + (tb - this.startOffset);
      if (ctxTb > horizon) break;
      if (ctxTb < ctxNow - 0.05) {
        this.nextBeatIdx++;
        continue;
      }
      const at = Math.max(ctxTb, ctxNow);
      if (clickOn) this.fireClick(at, this.downSet.has(Math.round(tb * 1000)));
      if (guideOn) {
        const texts = this.guideBeatMap.get(this.nextBeatIdx);
        if (texts) for (const t of texts) this.scheduleVoice(t, at);
      }
      this.nextBeatIdx++;
    }
  }

  private fireClick(at: number, accent: boolean) {
    if (!this.clickBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.clickBuffer;
    const g = this.ctx.createGain();
    // One sound for every beat — downbeats are just a touch louder.
    g.gain.value = (this.clickConfig?.volume ?? 1) * (accent ? 1.0 : 0.82);
    src.connect(g);
    g.connect(this.clickGain);
    src.start(at);
    this.clickNodes.add(src);
    src.onended = () => this.clickNodes.delete(src);
  }

  destroy() {
    this.stopSources();
    this.stopClickScheduler();
    this.ctx.close();
  }
}

/** Index of the beat closest to `t` in an ascending array (or -1 if empty). */
function nearestBeatIndex(beats: number[], t: number): number {
  if (!beats.length) return -1;
  let lo = 0;
  let hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return 0;
  if (lo >= beats.length) return beats.length - 1;
  return t - beats[lo - 1] <= beats[lo] - t ? lo - 1 : lo;
}

/** Downsample one channel (mono mix) into `count` magnitude buckets for display. */
function computePeaks(buffer: AudioBuffer, count: number): number[] {
  const chan = buffer.getChannelData(0);
  const block = Math.floor(chan.length / count) || 1;
  const peaks: number[] = [];
  for (let i = 0; i < count; i++) {
    let max = 0;
    const start = i * block;
    for (let j = 0; j < block && start + j < chan.length; j++) {
      const v = Math.abs(chan[start + j]);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  return peaks;
}
