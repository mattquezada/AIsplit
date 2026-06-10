"use client";
import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, putToStorage } from "@/lib/api";
import { Card } from "@/components/ui";

const ACCEPTED = [".wav", ".mp3", ".flac", ".aiff", ".aif", ".m4a"];

interface UploadItem {
  name: string;
  progress: number;
  status: "uploading" | "registering" | "done" | "error";
  error?: string;
}

export function UploadDropzone({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState<Record<string, UploadItem>>({});

  const patch = (name: string, p: Partial<UploadItem>) =>
    setItems((s) => ({ ...s, [name]: { ...s[name], ...p } }));

  const handleFiles = useCallback(
    async (files: FileList) => {
      for (const file of Array.from(files)) {
        const ext = "." + file.name.split(".").pop()?.toLowerCase();
        if (!ACCEPTED.includes(ext)) {
          setItems((s) => ({
            ...s,
            [file.name]: { name: file.name, progress: 0, status: "error", error: "Unsupported format" },
          }));
          continue;
        }
        setItems((s) => ({
          ...s,
          [file.name]: { name: file.name, progress: 0, status: "uploading" },
        }));
        try {
          const { upload_url, storage_key } = await api.getUploadUrl(
            orgId,
            file.name,
            file.type || "audio/wav"
          );
          await putToStorage(upload_url, file, (pct) => patch(file.name, { progress: pct }));
          patch(file.name, { status: "registering", progress: 100 });
          const title = file.name.replace(/\.[^.]+$/, "");
          await api.createSong(orgId, title, file.name, storage_key);
          patch(file.name, { status: "done" });
          qc.invalidateQueries({ queryKey: ["songs", orgId] });
        } catch (err) {
          patch(file.name, {
            status: "error",
            error: err instanceof Error ? err.message : "Upload failed",
          });
        }
      }
    },
    [orgId, qc]
  );

  const list = Object.values(items);

  return (
    <Card>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed py-10 text-center transition ${
          dragging ? "border-brand bg-brand/10" : "border-neutral-700 hover:border-neutral-600"
        }`}
      >
        <p className="font-medium">Drag &amp; drop audio here</p>
        <p className="mt-1 text-sm text-neutral-400">
          or click to browse · WAV, MP3, FLAC, AIFF, M4A · up to 1 GB
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED.join(",")}
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {list.length > 0 && (
        <ul className="mt-4 space-y-2">
          {list.map((it) => (
            <li key={it.name} className="text-sm">
              <div className="flex justify-between">
                <span className="truncate">{it.name}</span>
                <span className="text-neutral-400">
                  {it.status === "uploading" && `${it.progress}%`}
                  {it.status === "registering" && "processing…"}
                  {it.status === "done" && "queued ✓"}
                  {it.status === "error" && <span className="text-red-400">{it.error}</span>}
                </span>
              </div>
              {it.status === "uploading" && (
                <div className="mt-1 h-1 w-full rounded bg-neutral-800">
                  <div className="h-1 rounded bg-brand" style={{ width: `${it.progress}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
