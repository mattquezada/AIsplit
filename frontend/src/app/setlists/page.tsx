"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { useSession } from "@/hooks/useSession";
import { AppHeader } from "@/components/AppHeader";
import { Button, Card, Input } from "@/components/ui";

export default function SetlistsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const hasToken = useAuth((s) => s.hasToken);
  const activeOrgId = useAuth((s) => s.activeOrgId);
  const session = useSession();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");

  useEffect(() => {
    if (!hasToken) router.replace("/login");
  }, [hasToken, router]);

  const { data: setlists, isLoading } = useQuery({
    queryKey: ["setlists", activeOrgId],
    queryFn: () => api.listSetlists(activeOrgId!),
    enabled: !!activeOrgId,
  });

  const create = useMutation({
    mutationFn: () => api.createSetlist(activeOrgId!, name.trim(), date || null),
    onSuccess: (sl) => {
      setName("");
      setDate("");
      qc.invalidateQueries({ queryKey: ["setlists", activeOrgId] });
      router.push(`/setlists/${sl.id}`);
    },
  });

  if (!hasToken) return null;
  if (session.isLoading || !activeOrgId)
    return <main className="p-6 text-neutral-500">Loading workspace…</main>;

  return (
    <main className="min-h-screen">
      <AppHeader />
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <h1 className="text-xl font-semibold">Service Plans</h1>

        <Card>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate();
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="flex-1">
              <label className="mb-1 block text-xs uppercase tracking-wide text-neutral-400">
                New service plan
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sunday Morning"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wide text-neutral-400">
                Date
              </label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? "Creating…" : "Create"}
            </Button>
          </form>
        </Card>

        {isLoading ? (
          <p className="text-neutral-500">Loading…</p>
        ) : !setlists?.length ? (
          <p className="text-neutral-500">No service plans yet — create one above.</p>
        ) : (
          <div className="grid gap-3">
            {setlists.map((sl) => (
              <Link key={sl.id} href={`/setlists/${sl.id}`}>
                <Card className="flex items-center justify-between transition hover:border-neutral-700">
                  <div>
                    <p className="font-medium">{sl.name}</p>
                    <p className="text-xs text-neutral-500">
                      {sl.service_date ? `${sl.service_date} · ` : ""}
                      {sl.items.length} {sl.items.length === 1 ? "song" : "songs"}
                    </p>
                  </div>
                  <span className="text-neutral-500">→</span>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
