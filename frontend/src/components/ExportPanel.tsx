"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { stemMeta, sortStems } from "@/lib/stems";
import { Badge, Button, Card } from "@/components/ui";

const RANGE = Array.from({ length: 13 }, (_, i) => i - 6); // -6..+6

/**
 * Playback Package Builder: assembles one song at a chosen key into a
 * self-contained bundle (stems + tempo/key + section markers) the user can
 * download as a manifest and grab every stem from.
 */
export function ExportPanel({ songId }: { songId: string }) {
  const [semitones, setSemitones] = useState(0);

  const { data: pkg, isLoading, error } = useQuery({
    queryKey: ["package", songId, semitones],
    queryFn: () => api.getPackage(songId, semitones),
    retry: false,
  });

  function downloadManifest() {
    if (!pkg) return;
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pkg.title.replace(/[^\w.-]+/g, "_")}_package.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const notReady =
    error instanceof ApiError && error.status === 404
      ? "These stems aren't rendered at this key yet — switch to the Player tab and select the key first."
      : null;

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-neutral-300">Key</span>
        <select
          value={semitones}
          onChange={(e) => setSemitones(parseInt(e.target.value, 10))}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
        >
          {RANGE.map((s) => (
            <option key={s} value={s}>
              {s === 0 ? "Original" : `${s > 0 ? "+" : ""}${s} semitones`}
            </option>
          ))}
        </select>
        <Button onClick={downloadManifest} disabled={!pkg}>
          Download package manifest
        </Button>
      </div>

      {isLoading && <p className="text-neutral-500">Building package…</p>}
      {notReady && <p className="text-sm text-yellow-400">{notReady}</p>}
      {error && !notReady && (
        <p className="text-sm text-red-400">
          {error instanceof Error ? error.message : "Failed to build package"}
        </p>
      )}

      {pkg && (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            {pkg.music_key && <Badge>Key {pkg.music_key}</Badge>}
            {pkg.bpm != null && <Badge>{Math.round(pkg.bpm)} BPM</Badge>}
            {pkg.time_signature && <Badge>{pkg.time_signature}</Badge>}
            <Badge>{pkg.stems.length} stems</Badge>
            <Badge>{pkg.markers.length} markers</Badge>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-300">Stems</h3>
              <button
                onClick={() => pkg.stems.forEach((s) => window.open(s.url, "_blank"))}
                className="text-xs text-brand hover:underline"
              >
                Download all
              </button>
            </div>
            <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800">
              {sortStems(pkg.stems).map((s) => (
                <li
                  key={s.name}
                  className="flex items-center justify-between px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: stemMeta(s.stem_type).color }}
                    />
                    {stemMeta(s.stem_type).label}
                  </span>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-200 hover:bg-neutral-700"
                  >
                    ↓ WAV
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-neutral-500">
            The manifest carries tempo, key, and section markers alongside signed
            stem links — everything a playback rig needs for this song.
          </p>
        </>
      )}
    </Card>
  );
}
