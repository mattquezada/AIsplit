"use client";
import { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";

/**
 * Renders a single stem's waveform from precomputed peaks (no audio backend —
 * playback is owned by MultitrackEngine). `progress` (0..1) moves the cursor.
 */
export function StemWaveform({
  peaks,
  duration,
  progress,
  onSeek,
}: {
  peaks: number[];
  duration: number;
  progress: number;
  onSeek: (time: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 48,
      waveColor: "#525252",
      progressColor: "#6d28d9",
      cursorColor: "#a78bfa",
      normalize: true,
      interact: true,
      peaks: [peaks],
      duration,
    });
    ws.on("interaction", (newTime: number) => onSeek(newTime));
    wsRef.current = ws;
    return () => {
      ws.destroy();
      wsRef.current = null;
    };
    // Build once per stem; peaks/duration are stable for a loaded stem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ws = wsRef.current;
    if (ws && duration > 0) {
      // setTime moves the visual cursor without triggering playback.
      try {
        ws.setTime(progress * duration);
      } catch {
        /* not ready yet */
      }
    }
  }, [progress, duration]);

  return <div ref={containerRef} className="w-full" />;
}
