"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/stores/auth";

export function AppHeader() {
  const router = useRouter();
  const me = useAuth((s) => s.me);
  const activeOrgId = useAuth((s) => s.activeOrgId);
  const setActiveOrg = useAuth((s) => s.setActiveOrg);
  const signOut = useAuth((s) => s.signOut);

  const orgs = me?.memberships ?? [];

  return (
    <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
      <div className="flex items-center gap-5">
        <Link href="/songs" className="text-lg font-semibold">
          AIsplit
        </Link>
        <nav className="flex items-center gap-4 text-sm text-neutral-400">
          <Link href="/songs" className="hover:text-neutral-100">
            Songs
          </Link>
          <Link href="/setlists" className="hover:text-neutral-100">
            Setlists
          </Link>
        </nav>
      </div>
      <div className="flex items-center gap-3 text-sm">
        {orgs.length > 1 && (
          <select
            value={activeOrgId ?? ""}
            onChange={(e) => setActiveOrg(e.target.value)}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
          >
            {orgs.map((m) => (
              <option key={m.org_id} value={m.org_id}>
                {m.org_id.slice(0, 8)} ({m.role})
              </option>
            ))}
          </select>
        )}
        <span className="text-neutral-400">{me?.user.email}</span>
        <button
          onClick={() => {
            signOut();
            router.replace("/login");
          }}
          className="text-neutral-400 hover:text-neutral-100"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
