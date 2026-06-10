"use client";
import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, {
  type Region,
} from "wavesurfer.js/dist/plugins/regions.esm.js";
import { Card } from "@/components/ui";

interface SavedRegion {
  id: string;
  start: number;
  end: number;
  label: string;
}

const COLORS = "rgba(109,40,217,0.25)";

/**
 * Overview waveform where the user drags to create their own sections.
 * Regions persist per-song in localStorage. Clicking a region loops it via the
 * parent's playback engine (this view has no audio backend of its own).
 */
export function SectionEditor({
  peaks,
  duration,
  songId,
  onLoopRegion,
  onSeek,
}: {
  peaks: number[];
  duration: number;
  songId: string;
  onLoopRegion: (region: { start: number; end: number } | null) => void;
  onSeek: (time: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const [activeLoop, setActiveLoop] = useState<string | null>(null);
  const storageKey = `aisplit_regions_${songId}`;

  const persist = () => {
    const regions = regionsRef.current?.getRegions() ?? [];
    const data: SavedRegion[] = regions.map((r) => ({
      id: r.id,
      start: r.start,
      end: r.end,
      label: typeof r.content === "string" ? r.content : r.content?.textContent ?? "",
    }));
    localStorage.setItem(storageKey, JSON.stringify(data));
  };

  useEffect(() => {
    if (!containerRef.current || duration <= 0) return;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 64,
      waveColor: "#3f3f46",
      progressColor: "#6d28d9",
      cursorColor: "#a78bfa",
      normalize: true,
      peaks: [peaks],
      duration,
    });
    const regions = ws.registerPlugin(RegionsPlugin.create());
    regionsRef.current = regions;
    wsRef.current = ws;

    // Restore saved regions.
    try {
      const saved: SavedRegion[] = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      saved.forEach((s) =>
        regions.addRegion({ start: s.start, end: s.end, content: s.label, color: COLORS })
      );
    } catch {
      /* ignore */
    }

    regions.enableDragSelection({ color: COLORS });

    regions.on("region-created", () => persist());
    regions.on("region-updated", () => persist());
    regions.on("region-clicked", (region: Region, e: MouseEvent) => {
      e.stopPropagation();
      onSeek(region.start);
      setActiveLoop((cur) => {
        const next = cur === region.id ? null : region.id;
        onLoopRegion(next ? { start: region.start, end: region.end } : null);
        return next;
      });
    });
    ws.on("interaction", (t: number) => onSeek(t));

    return () => {
      ws.destroy();
      wsRef.current = null;
      regionsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  const renameActive = () => {
    const regions = regionsRef.current?.getRegions() ?? [];
    const target = regions.find((r) => r.id === activeLoop) ?? regions[regions.length - 1];
    if (!target) return;
    const label = prompt("Section name", typeof target.content === "string" ? target.content : "");
    if (label != null) {
      target.setContent(label);
      persist();
    }
  };

  const deleteActive = () => {
    const regions = regionsRef.current?.getRegions() ?? [];
    const target = regions.find((r) => r.id === activeLoop) ?? regions[regions.length - 1];
    if (!target) return;
    target.remove();
    if (target.id === activeLoop) {
      setActiveLoop(null);
      onLoopRegion(null);
    }
    persist();
  };

  const clearLoop = () => {
    setActiveLoop(null);
    onLoopRegion(null);
  };

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-300">Practice loop</h3>
        <div className="flex gap-2 text-xs">
          <button onClick={renameActive} className="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700">
            Rename
          </button>
          <button onClick={deleteActive} className="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700">
            Delete
          </button>
          <button
            onClick={clearLoop}
            disabled={!activeLoop}
            className="rounded bg-neutral-800 px-2 py-1 hover:bg-neutral-700 disabled:opacity-40"
          >
            Clear loop
          </button>
        </div>
      </div>
      <div ref={containerRef} className="w-full" />
      <p className="mt-2 text-xs text-neutral-500">
        Drag on the waveform to mark a region · click it to loop that part for rehearsal{" "}
        {activeLoop && <span className="text-brand">· looping</span>}
      </p>
    </Card>
  );
}
