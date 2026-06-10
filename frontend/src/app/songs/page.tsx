"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/stores/auth";
import { useSession } from "@/hooks/useSession";
import { AppHeader } from "@/components/AppHeader";
import { UploadDropzone } from "@/components/UploadDropzone";
import { SongList } from "@/components/SongList";

export default function SongsPage() {
  const router = useRouter();
  const hasToken = useAuth((s) => s.hasToken);
  const activeOrgId = useAuth((s) => s.activeOrgId);
  const session = useSession();

  useEffect(() => {
    if (!hasToken) router.replace("/login");
  }, [hasToken, router]);

  if (!hasToken) return null;
  if (session.isLoading || !activeOrgId)
    return <main className="p-6 text-neutral-500">Loading workspace…</main>;

  return (
    <main className="min-h-screen">
      <AppHeader />
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <UploadDropzone orgId={activeOrgId} />
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Songs
          </h2>
          <SongList orgId={activeOrgId} />
        </div>
      </div>
    </main>
  );
}
