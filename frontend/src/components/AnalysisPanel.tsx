"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Analysis } from "@/lib/types";
import { Badge, Button, Card, Input } from "@/components/ui";

function Confidence({ value }: { value: number | null }) {
  if (value == null) return null;
  const tone = value > 0.66 ? "green" : value > 0.33 ? "yellow" : "red";
  return <Badge tone={tone}>{Math.round(value * 100)}%</Badge>;
}

export function AnalysisPanel({ songId }: { songId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["analysis", songId],
    queryFn: () => api.getAnalysis(songId),
  });

  const [bpm, setBpm] = useState("");
  const [musicKey, setMusicKey] = useState("");
  const [timeSig, setTimeSig] = useState("");

  useEffect(() => {
    if (data) {
      setBpm(data.bpm?.toString() ?? "");
      setMusicKey(data.music_key ?? "");
      setTimeSig(data.time_signature ?? "");
    }
  }, [data]);

  const save = useMutation({
    mutationFn: (patch: Partial<Analysis>) => api.updateAnalysis(songId, patch),
    onSuccess: (updated) => qc.setQueryData(["analysis", songId], updated),
  });

  if (isLoading) return <p className="text-neutral-500">Loading analysis…</p>;
  if (!data) return <p className="text-neutral-500">No analysis available.</p>;

  return (
    <Card className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Field label="BPM" confidence={data.bpm_confidence}>
          <Input
            value={bpm}
            onChange={(e) => setBpm(e.target.value)}
            inputMode="decimal"
          />
        </Field>
        <Field label="Key" confidence={data.key_confidence}>
          <Input value={musicKey} onChange={(e) => setMusicKey(e.target.value)} />
        </Field>
        <Field label="Time Signature">
          <Input value={timeSig} onChange={(e) => setTimeSig(e.target.value)} />
        </Field>
      </div>

      <Button
        variant="subtle"
        disabled={save.isPending}
        onClick={() =>
          save.mutate({
            bpm: bpm ? parseFloat(bpm) : null,
            music_key: musicKey || null,
            time_signature: timeSig || null,
          })
        }
      >
        {save.isPending ? "Saving…" : "Save edits"}
      </Button>

      {data.sections && data.sections.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-neutral-400">Sections</h3>
          <ul className="space-y-1 text-sm">
            {data.sections.map((sec, i) => (
              <li key={i} className="flex items-center justify-between rounded bg-neutral-800/50 px-3 py-1">
                <span>{sec.label}</span>
                <span className="font-mono text-xs text-neutral-400">
                  {sec.start.toFixed(1)}s – {sec.end.toFixed(1)}s
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Field({
  label,
  confidence,
  children,
}: {
  label: string;
  confidence?: number | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <label className="text-xs uppercase tracking-wide text-neutral-400">{label}</label>
        {confidence != null && <Confidence value={confidence} />}
      </div>
      {children}
    </div>
  );
}
