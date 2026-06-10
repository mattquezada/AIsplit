"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/stores/auth";

/** Loads the current user (when a token is present) and seeds the auth store. */
export function useSession() {
  const hasToken = useAuth((s) => s.hasToken);
  const setMe = useAuth((s) => s.setMe);

  const query = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    enabled: hasToken,
  });

  useEffect(() => {
    if (query.data) setMe(query.data);
  }, [query.data, setMe]);

  return query;
}
