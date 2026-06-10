import { create } from "zustand";
import type { Me } from "@/lib/types";
import { getToken, setToken } from "@/lib/api";

interface AuthState {
  me: Me | null;
  activeOrgId: string | null;
  hasToken: boolean;
  setMe: (me: Me | null) => void;
  setActiveOrg: (orgId: string) => void;
  signIn: (token: string) => void;
  signOut: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  me: null,
  activeOrgId: null,
  hasToken: typeof window !== "undefined" && !!getToken(),
  setMe: (me) =>
    set((s) => ({
      me,
      activeOrgId: s.activeOrgId ?? me?.memberships[0]?.org_id ?? null,
    })),
  setActiveOrg: (orgId) => set({ activeOrgId: orgId }),
  signIn: (token) => {
    setToken(token);
    set({ hasToken: true });
  },
  signOut: () => {
    setToken(null);
    set({ hasToken: false, me: null, activeOrgId: null });
  },
}));
