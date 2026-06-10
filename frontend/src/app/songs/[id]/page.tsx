"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { useSession } from "@/hooks/useSession";
import { AppHeader } from "@/components/AppHeader";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { MultitrackPlayer } from "@/components/MultitrackPlayer";
import { RoutingPanel } from "@/components/RoutingPanel";
import { ExportPanel } from "@/components/ExportPanel";
import { Tabs } from "@/components/ui";

type Tab = "player" | "routing" | "export" | "details";

export default function SongDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const hasToken = useAuth((s) => s.hasToken);
  useSession();
  const [tab, setTab] = useState<Tab>("player");

  useEffect(() => {
    if (!hasToken) router.replace("/login");
  }, [hasToken, router]);

  const { data: song, isLoading } = useQuery({
    queryKey: ["song", id],
    queryFn: () => api.getSong(id),
    enabled: hasToken,
  });

  const favorite = useMutation({
    mutationFn: (next: boolean) => api.updateSong(id, { is_favorite: next }),
    onSuccess: (updated) => qc.setQueryData(["song", id], updated),
  });

  if (!hasToken) return null;

  return (
    <main className="min-h-screen">
      <AppHeader />
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <Link href="/songs" className="text-sm text-neutral-400 hover:text-neutral-100">
          ← Back to songs
        </Link>

        {isLoading || !song ? (
          <p className="text-neutral-500">Loading…</p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => favorite.mutate(!song.is_favorite)}
                    title={song.is_favorite ? "Unfavorite" : "Favorite"}
                    className={`text-xl leading-none ${
                      song.is_favorite ? "text-yellow-400" : "text-neutral-600 hover:text-neutral-400"
                    }`}
                  >
                    {song.is_favorite ? "★" : "☆"}
                  </button>
                  <h1 className="text-2xl font-semibold">{song.title}</h1>
                </div>
                <p className="text-sm text-neutral-500">{song.original_filename}</p>
              </div>
            </div>

            <Tabs<Tab>
              active={tab}
              onChange={setTab}
              tabs={[
                { id: "player", label: "Player" },
                { id: "routing", label: "Routing" },
                { id: "export", label: "Export" },
                { id: "details", label: "Details" },
              ]}
            />

            {/* Player stays mounted so the audio engine survives tab switches. */}
            <div hidden={tab !== "player"}>
              <MultitrackPlayer songId={id} />
            </div>
            {tab === "routing" && <RoutingPanel songId={id} orgId={song.org_id} />}
            {tab === "export" && <ExportPanel songId={id} />}
            {tab === "details" && <AnalysisPanel songId={id} />}
          </>
        )}
      </div>
    </main>
  );
}
