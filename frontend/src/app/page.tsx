"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/stores/auth";

export default function Home() {
  const router = useRouter();
  const hasToken = useAuth((s) => s.hasToken);

  useEffect(() => {
    router.replace(hasToken ? "/songs" : "/login");
  }, [hasToken, router]);

  return (
    <main className="flex min-h-screen items-center justify-center text-neutral-500">
      Loading…
    </main>
  );
}
