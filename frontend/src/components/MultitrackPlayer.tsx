"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Analysis } from "@/lib/types";
import { MultitrackEngine } from "@/lib/audioEngine";
import { effectiveGain, usePlayer } from "@/stores/player";
import { stemMeta, sortStems, SYNTHETIC_STEM_TYPES } from "@/lib/stems";
import { speak, initVoices } from "@/lib/speech";
import { Card } from "@/components/ui";
import { StemWaveform } from "@/components/StemWaveform";
import { SectionEditor } from "@/components/SectionEditor";
import { SectionManager } from "@/components/SectionManager";
import { MixPresets } from "@/components/MixPresets";

const CLICK_SAMPLE_URL = "/sounds/click.wav";

function fmt(t: number): string {
  if (!Number.isFinite(t)) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const CHROMA = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const RANGE = Array.from({ length: 13 }, (_, i) => i - 6); // -6..+6

function shiftKeyName(detected: string | null, semis: number): string | null {
  if (!detected) return null;
  const parts = detected.split(" ");
  const idx = CHROMA.indexOf(parts[0]);
  if (idx < 0) return null;
  const ni = (((idx + semis) % 12) + 12) % 12;
  return [CHROMA[ni], ...parts.slice(1)].join(" ");
}

function beatsPerBar(timeSig: string | null | undefined): number {
  const n = parseInt((timeSig ?? "4/4").split("/")[0], 10);
  return Number.isFinite(n) && n > 0 ? n : 4;
}

/** Largest index i with arr[i] <= t (or -1). */
function floorIndex(arr: number[], t: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

export function MultitrackPlayer({ songId }: { songId: string }) {
  const qc = useQueryClient();
  const [applied, setApplied] = useState(0);
  const [selected, setSelected] = useState(0);
  const [transposeMsg, setTransposeMsg] = useState<string | null>(null);
  const busy = transposeMsg !== null;

  const { data: analysis } = useQuery({
    queryKey: ["analysis", songId],
    queryFn: () => api.getAnalysis(songId),
  });
  const detectedKey = analysis?.music_key ?? null;
  const bpb = beatsPerBar(analysis?.time_signature);

  const saveAnalysis = useMutation({
    mutationFn: (patch: Partial<Analysis>) => api.updateAnalysis(songId, patch),
    onSuccess: (updated) => qc.setQueryData(["analysis", songId], updated),
  });

  // Editable sections (server markers) drive the ribbon; the guide route turns
  // them into spoken cues.
  const { data: markers } = useQuery({
    queryKey: ["markers", songId],
    queryFn: () => api.listMarkers(songId),
  });
  const sectionMarkers = useMemo(
    () =>
      (markers ?? [])
        .filter((m) => m.kind === "section")
        .sort((a, b) => a.position_sec - b.position_sec),
    [markers]
  );
  const { data: guideTrack } = useQuery({
    queryKey: ["guide", songId],
    queryFn: () => api.getGuide(songId),
  });

  const { data: allStems, isLoading } = useQuery({
    queryKey: ["stems", songId, applied],
    queryFn: () => api.listStems(songId, applied),
  });
  // Click/guide are synthesized in the transport, not shown as tracks.
  const stems = useMemo(
    () => sortStems((allStems ?? []).filter((s) => !SYNTHETIC_STEM_TYPES.has(s.stem_type))),
    [allStems]
  );

  const engineRef = useRef<MultitrackEngine | null>(null);
  const rafRef = useRef<number | null>(null);
  const loopRef = useRef<{ start: number; end: number } | null>(null);
  const resumeRef = useRef<{ time: number; playing: boolean } | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [countingIn, setCountingIn] = useState(false);

  const player = usePlayer();
  const { mix, isPlaying, currentTime, duration, masterVolume, click, guide } = player;

  // Warm up the speech voices once (they load asynchronously in the browser).
  useEffect(() => initVoices(), []);

  // ── Engine lifecycle (rebuilds when the stem set / key changes) ─────────────
  useEffect(() => {
    if (!stems.length) return;
    let cancelled = false;
    const engine = new MultitrackEngine();
    engineRef.current = engine;
    // The guide simply announces each section's name as it comes up.
    engine.setGuideVoice((text) => speak(text, { interrupt: true, rate: 0.98 }));
    player.reset();

    (async () => {
      try {
        await engine.loadClickSample(CLICK_SAMPLE_URL);
        for (const stem of stems) {
          await engine.loadStem(stem.id, stem.url);
          player.ensureStem(stem.id);
        }
        if (cancelled) return;
        player.setDuration(engine.duration);
        setReady(true);
        const resume = resumeRef.current;
        if (resume) {
          engine.seek(Math.min(resume.time, engine.duration));
          player.setCurrentTime(engine.currentTime);
          if (resume.playing) {
            engine.play();
            player.setPlaying(true);
          }
          resumeRef.current = null;
        }
      } catch (err) {
        if (!cancelled)
          setLoadError(err instanceof Error ? err.message : "Failed to load stems");
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      engine.destroy();
      engineRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stems]);

  // Mixing: per-stem gain/pan.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !ready) return;
    for (const id of engine.stems.keys()) {
      engine.setGain(id, effectiveGain(mix, id));
      engine.setPan(id, mix[id]?.pan ?? 0);
    }
  }, [mix, ready]);

  // Master volume.
  useEffect(() => {
    const engine = engineRef.current;
    if (engine && ready) engine.setMasterVolume(masterVolume);
  }, [masterVolume, ready]);

  // Click configuration: clap on the song's *actual* beat grid (so it tracks the
  // recording), shifted by the editable latency nudge. Falls back to a steady
  // grid from BPM only if no beats were detected.
  const nudge = analysis?.click_offset_sec ?? 0;
  const beats = useMemo(() => {
    const grid = analysis?.beat_grid;
    if (grid && grid.length) return grid.map((t) => t + nudge);
    const bpm = analysis?.bpm ?? 0;
    if (!bpm || !duration) return [] as number[];
    const step = 60 / bpm;
    const out: number[] = [];
    for (let t = 0; t < duration; t += step) out.push(t + nudge);
    return out;
  }, [analysis?.beat_grid, analysis?.bpm, nudge, duration]);
  const downbeats = useMemo(() => {
    const db = analysis?.downbeats;
    if (db && db.length) return db.map((t) => t + nudge);
    // Derive every Nth beat as a downbeat when none are stored.
    return beats.filter((_, i) => i % bpb === 0);
  }, [analysis?.downbeats, beats, bpb, nudge]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !ready) return;
    engine.setClick({
      enabled: click.enabled,
      volume: click.volume,
      beats,
      downbeats,
      beatsPerBar: bpb,
      countInBars: click.countIn ? 1 : 0,
      bpm: analysis?.bpm ?? 0,
    });
  }, [ready, click.enabled, click.volume, click.countIn, beats, downbeats, bpb, analysis?.bpm]);

  // Guide: section labels + a beat-locked lead-in count, scheduled by the engine.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !ready) return;
    engine.setGuide({
      enabled: guide.enabled,
      cues: (guideTrack?.cues ?? []).map((c) => ({ time: c.time + nudge, text: c.text })),
      leadBeats: bpb, // announce a bar ahead
    });
  }, [ready, guide.enabled, guideTrack, nudge, bpb]);

  // Transport RAF loop: clock, loop wrap, end-stop, count-in flag.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !ready) return;
    const tick = () => {
      const loop = loopRef.current;
      if (loop && engine.playing && engine.currentTime >= loop.end) {
        engine.seek(loop.start);
      }
      player.setCurrentTime(engine.currentTime);
      setCountingIn(engine.countingIn);

      if (engine.playing && !loop && !engine.countingIn && engine.currentTime >= engine.duration) {
        engine.pause();
        engine.seek(0);
        player.setPlaying(false);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const togglePlay = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.playing) {
      engine.pause();
      player.setPlaying(false);
    } else {
      engine.play();
      player.setPlaying(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seek = useCallback((time: number) => {
    engineRef.current?.seek(time);
    player.setCurrentTime(time);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function download(stemId: string) {
    const { url } = await api.downloadStem(stemId);
    window.open(url, "_blank");
  }

  async function applyKey(target: number) {
    setSelected(target);
    if (target === applied) return;
    const engine = engineRef.current;
    resumeRef.current = { time: engine?.currentTime ?? 0, playing: engine?.playing ?? false };
    if (target === 0) {
      setApplied(0);
      return;
    }
    try {
      const res = await api.transpose(songId, target);
      if (res.status === "ready") {
        setApplied(target);
        return;
      }
      setTransposeMsg("Rendering new key… 0%");
      for (let i = 0; i < 150; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const job = await api.getJob(songId).catch(() => null);
        if (job?.type === "transpose") {
          if (job.status === "succeeded") break;
          if (job.status === "failed") {
            setTransposeMsg(null);
            setLoadError(job.error ?? "Transpose failed");
            return;
          }
          setTransposeMsg(`Rendering new key… ${job.progress}%`);
        }
      }
      setApplied(target);
    } finally {
      setTransposeMsg(null);
    }
  }

  const peaks = ready ? engineRef.current?.stems.values().next().value?.peaks ?? [] : [];
  const resultingKey = shiftKeyName(detectedKey, selected) ?? detectedKey;

  // Visual metronome: which beat of the bar the playhead is on.
  const fi = floorIndex(beats, currentTime);
  const beatInBar = fi >= 0 ? ((fi % bpb) + bpb) % bpb : -1;

  // Ribbon spans: each section runs until the next one (or the end).
  const ribbon = useMemo(
    () =>
      sectionMarkers.map((m, i) => ({
        start: m.position_sec,
        end: sectionMarkers[i + 1]?.position_sec ?? duration,
        label: m.label,
      })),
    [sectionMarkers, duration]
  );

  return (
    <div className="space-y-4">
      <TransportBar
        isPlaying={isPlaying}
        countingIn={countingIn}
        currentTime={currentTime}
        duration={duration}
        ready={ready}
        busy={busy}
        onToggle={togglePlay}
        onSeek={seek}
        bpm={analysis?.bpm ?? null}
        timeSig={analysis?.time_signature ?? null}
        beatInBar={isPlaying ? beatInBar : -1}
        beatsPerBar={bpb}
        detectedKey={detectedKey}
        resultingKey={resultingKey}
        selectedSemis={selected}
        onSelectKey={applyKey}
        onSaveBpm={(bpm) => saveAnalysis.mutate({ bpm })}
        onNudgeOffset={(d) =>
          saveAnalysis.mutate({
            click_offset_sec: Math.max(-1, Math.min(1, (analysis?.click_offset_sec ?? 0) + d)),
          })
        }
        nudge={nudge}
        click={click}
        guide={guide}
        masterVolume={masterVolume}
        onClick={player.setClick}
        onGuide={player.setGuide}
        onMaster={player.setMasterVolume}
      />

      {/* Arrangement: section ribbon + custom-section editor + drag-to-loop. */}
      {ready && duration > 0 && (
        <>
          <SectionRibbon sections={ribbon} duration={duration} currentTime={currentTime} onSeek={seek} />
          <SectionManager songId={songId} currentTime={currentTime} duration={duration} onSeek={seek} />
          <SectionEditor
            peaks={peaks}
            duration={duration}
            songId={songId}
            onLoopRegion={(r) => (loopRef.current = r)}
            onSeek={seek}
          />
        </>
      )}

      {/* Console */}
      <Card className="p-0">
        {isLoading || busy ? (
          <p className="p-4 text-neutral-500">{busy ? transposeMsg ?? "Loading…" : "Loading stems…"}</p>
        ) : loadError ? (
          <p className="p-4 text-red-400">{loadError}</p>
        ) : !stems.length ? (
          <p className="p-4 text-neutral-500">No stems available.</p>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
              <MixPresets
                songId={songId}
                stems={stems.map((s) => ({ id: s.id, stem_type: s.stem_type }))}
              />
              <span className="text-xs text-neutral-500">{stems.length} tracks</span>
            </div>
            <div className="divide-y divide-neutral-800/70">
              {stems.map((stem) => (
                <TrackRow
                  key={stem.id}
                  stem={stem}
                  mix={mix[stem.id]}
                  peaks={engineRef.current?.stems.get(stem.id)?.peaks ?? []}
                  duration={duration}
                  progress={duration > 0 ? currentTime / duration : 0}
                  ready={ready}
                  onMute={() => player.toggleMute(stem.id)}
                  onSolo={() => player.toggleSolo(stem.id)}
                  onVolume={(v) => player.setVolume(stem.id, v)}
                  onPan={(p) => player.setPan(stem.id, p)}
                  onDownload={() => download(stem.id)}
                  onSeek={seek}
                />
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/* ── Transport bar ─────────────────────────────────────────────────────────── */
function TransportBar(props: {
  isPlaying: boolean;
  countingIn: boolean;
  currentTime: number;
  duration: number;
  ready: boolean;
  busy: boolean;
  onToggle: () => void;
  onSeek: (t: number) => void;
  bpm: number | null;
  timeSig: string | null;
  beatInBar: number;
  beatsPerBar: number;
  detectedKey: string | null;
  resultingKey: string | null;
  selectedSemis: number;
  onSelectKey: (s: number) => void;
  onSaveBpm: (bpm: number) => void;
  onNudgeOffset: (d: number) => void;
  nudge: number;
  click: { enabled: boolean; volume: number; countIn: boolean };
  guide: { enabled: boolean };
  masterVolume: number;
  onClick: (p: Partial<{ enabled: boolean; volume: number; countIn: boolean }>) => void;
  onGuide: (p: Partial<{ enabled: boolean }>) => void;
  onMaster: (v: number) => void;
}) {
  const [bpmText, setBpmText] = useState("");
  const tapsRef = useRef<number[]>([]);
  useEffect(() => setBpmText(props.bpm != null ? String(Math.round(props.bpm)) : ""), [props.bpm]);

  const commitBpm = () => {
    const v = parseFloat(bpmText);
    if (Number.isFinite(v) && v > 0 && v !== props.bpm) props.onSaveBpm(Math.round(v * 100) / 100);
  };
  const tap = () => {
    const now = performance.now();
    const taps = tapsRef.current.filter((t) => now - t < 2000);
    taps.push(now);
    tapsRef.current = taps;
    if (taps.length >= 2) {
      const intervals = taps.slice(1).map((t, i) => t - taps[i]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const bpm = Math.round((60000 / avg) * 10) / 10;
      setBpmText(String(Math.round(bpm)));
      props.onSaveBpm(bpm);
    }
  };

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* Play */}
        <button
          onClick={props.onToggle}
          disabled={!props.ready || props.busy}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-brand-fg transition hover:bg-violet-600 disabled:opacity-40"
          aria-label={props.isPlaying ? "Pause" : "Play"}
        >
          {props.isPlaying ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        <div className="font-mono text-sm tabular-nums text-neutral-300">
          {props.countingIn ? (
            <span className="text-yellow-400">Counting in…</span>
          ) : (
            <>
              {fmt(props.currentTime)} <span className="text-neutral-600">/</span> {fmt(props.duration)}
            </>
          )}
        </div>

        <Metronome beatInBar={props.beatInBar} beatsPerBar={props.beatsPerBar} />

        {/* BPM + tap + grid nudge */}
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] uppercase tracking-wide text-neutral-500">BPM</label>
          <input
            value={bpmText}
            onChange={(e) => setBpmText(e.target.value)}
            onBlur={commitBpm}
            onKeyDown={(e) => e.key === "Enter" && commitBpm()}
            inputMode="decimal"
            className="w-14 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm tabular-nums"
          />
          <button onClick={tap} className="rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700" title="Tap tempo">
            Tap
          </button>
        </div>

        {/* Click latency nudge — slide the whole grid earlier/later to lock it in. */}
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] uppercase tracking-wide text-neutral-500" title="Shift the click grid to line up with the song">
            Click
          </label>
          <button
            onClick={() => props.onNudgeOffset(-0.01)}
            className="rounded bg-neutral-800 px-1.5 py-1 text-xs hover:bg-neutral-700"
            title="Nudge click 10ms earlier"
          >
            −
          </button>
          <span className="w-12 text-center font-mono text-[11px] tabular-nums text-neutral-400">
            {props.nudge >= 0 ? "+" : ""}
            {Math.round(props.nudge * 1000)}ms
          </span>
          <button
            onClick={() => props.onNudgeOffset(0.01)}
            className="rounded bg-neutral-800 px-1.5 py-1 text-xs hover:bg-neutral-700"
            title="Nudge click 10ms later"
          >
            +
          </button>
        </div>

        {props.timeSig && (
          <span className="rounded bg-neutral-800 px-2 py-1 text-xs tabular-nums text-neutral-300">
            {props.timeSig}
          </span>
        )}

        {/* Key */}
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] uppercase tracking-wide text-neutral-500">Key</label>
          <select
            value={props.selectedSemis}
            disabled={props.busy}
            onChange={(e) => props.onSelectKey(parseInt(e.target.value, 10))}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
          >
            {RANGE.map((s) => {
              const name = shiftKeyName(props.detectedKey, s);
              const tag = s === 0 ? "orig" : `${s > 0 ? "+" : ""}${s}`;
              return (
                <option key={s} value={s}>
                  {name ? `${name} (${tag})` : tag}
                </option>
              );
            })}
          </select>
          {props.resultingKey && <span className="text-xs text-neutral-400">{props.resultingKey}</span>}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Master */}
          <label className="text-[10px] uppercase tracking-wide text-neutral-500">Master</label>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={props.masterVolume}
            onChange={(e) => props.onMaster(parseFloat(e.target.value))}
            className="w-24"
          />
        </div>
      </div>

      {/* Click / Guide / Count-in toggles */}
      <div className="flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-3 text-sm">
        <Toggle active={props.click.enabled} color="#a1a1aa" onClick={() => props.onClick({ enabled: !props.click.enabled })}>
          Click
        </Toggle>
        {props.click.enabled && (
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={props.click.volume}
            onChange={(e) => props.onClick({ volume: parseFloat(e.target.value) })}
            className="w-20"
            title="Click volume"
          />
        )}
        <Toggle active={props.click.countIn} color="#eab308" onClick={() => props.onClick({ countIn: !props.click.countIn })}>
          Count-in
        </Toggle>
        <Toggle active={props.guide.enabled} color="#f472b6" onClick={() => props.onGuide({ enabled: !props.guide.enabled })}>
          Guide
        </Toggle>
        <span className="text-xs text-neutral-500">
          Click is a steady grid you can edit (BPM/Tap/nudge). Guide speaks each section as it arrives.
        </span>
      </div>
    </Card>
  );
}

function Metronome({ beatInBar, beatsPerBar }: { beatInBar: number; beatsPerBar: number }) {
  return (
    <div className="flex items-center gap-1" title="Metronome">
      {Array.from({ length: beatsPerBar }).map((_, i) => {
        const active = i === beatInBar;
        return (
          <span
            key={i}
            className="rounded-full transition-transform duration-75"
            style={{
              height: 9,
              width: 9,
              background: active ? (i === 0 ? "#f472b6" : "#a3e635") : "#3f3f46",
              transform: active ? "scale(1.55)" : "scale(1)",
            }}
          />
        );
      })}
    </div>
  );
}

function Toggle({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition"
      style={{
        borderColor: active ? color : "#3f3f46",
        background: active ? `${color}22` : "transparent",
        color: active ? "#fafafa" : "#a1a1aa",
      }}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: active ? color : "#52525b" }} />
      {children}
    </button>
  );
}

/* ── Section ribbon ────────────────────────────────────────────────────────── */
function SectionRibbon({
  sections,
  duration,
  currentTime,
  onSeek,
}: {
  sections: { start: number; end: number; label: string }[];
  duration: number;
  currentTime: number;
  onSeek: (t: number) => void;
}) {
  if (!sections.length) return null;
  return (
    <div className="relative flex h-9 w-full overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/60">
      {sections.map((s, i) => {
        const left = (s.start / duration) * 100;
        const width = ((s.end - s.start) / duration) * 100;
        const active = currentTime >= s.start && currentTime < s.end;
        return (
          <button
            key={i}
            onClick={() => onSeek(s.start)}
            className="group relative h-full overflow-hidden border-r border-neutral-800 text-[11px] transition last:border-r-0"
            style={{
              position: "absolute",
              left: `${left}%`,
              width: `${width}%`,
              background: active ? "rgba(139,92,246,0.28)" : "transparent",
            }}
            title={`${s.label} · ${fmt(s.start)}`}
          >
            <span className="truncate px-2 text-neutral-300 group-hover:text-neutral-100">{s.label}</span>
          </button>
        );
      })}
      <div
        className="pointer-events-none absolute top-0 h-full w-0.5 bg-violet-300"
        style={{ left: `${(currentTime / duration) * 100}%` }}
      />
    </div>
  );
}

/* ── Track row ─────────────────────────────────────────────────────────────── */
function TrackRow({
  stem,
  mix,
  peaks,
  duration,
  progress,
  ready,
  onMute,
  onSolo,
  onVolume,
  onPan,
  onDownload,
  onSeek,
}: {
  stem: { id: string; name: string; stem_type: string };
  mix: { volume: number; pan: number; muted: boolean; soloed: boolean } | undefined;
  peaks: number[];
  duration: number;
  progress: number;
  ready: boolean;
  onMute: () => void;
  onSolo: () => void;
  onVolume: (v: number) => void;
  onPan: (p: number) => void;
  onDownload: () => void;
  onSeek: (t: number) => void;
}) {
  const meta = stemMeta(stem.stem_type);
  return (
    <div className="grid grid-cols-[200px_1fr] items-stretch gap-3 px-3 py-2">
      <div className="flex flex-col justify-center gap-1.5 border-l-[3px] pl-2.5" style={{ borderColor: meta.color }}>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium" title={meta.label}>
            {meta.label}
          </span>
          <div className="flex gap-1">
            <button
              onClick={onMute}
              className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                mix?.muted ? "bg-red-600 text-white" : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
              }`}
              title="Mute"
            >
              M
            </button>
            <button
              onClick={onSolo}
              className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                mix?.soloed ? "bg-yellow-500 text-black" : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
              }`}
              title="Solo"
            >
              S
            </button>
            <button
              onClick={onDownload}
              className="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-300 hover:bg-neutral-700"
              title="Download WAV"
            >
              ↓
            </button>
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.01}
          value={mix?.volume ?? 1}
          onChange={(e) => onVolume(parseFloat(e.target.value))}
          className="w-full"
          style={{ accentColor: meta.color }}
        />
        <div className="flex items-center gap-1 text-[10px] text-neutral-500">
          <span>L</span>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={mix?.pan ?? 0}
            onChange={(e) => onPan(parseFloat(e.target.value))}
            className="w-full"
          />
          <span>R</span>
        </div>
      </div>
      <div className="flex items-center">
        {ready ? (
          <StemWaveform peaks={peaks} duration={duration} progress={progress} onSeek={onSeek} />
        ) : (
          <div className="h-12 w-full animate-pulse rounded bg-neutral-800" />
        )}
      </div>
    </div>
  );
}
