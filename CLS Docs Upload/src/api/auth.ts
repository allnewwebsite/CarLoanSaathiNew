import { api } from "./client";
import { User } from "../types";

function normalizeUser(raw: any): User {
  return {
    ...raw,
    id: String(raw?.uid || raw?.id || raw?.email || ""),
    uid: raw?.uid,
    email: String(raw?.email || ""),
    name: raw?.name || raw?.displayName || raw?.profile?.name,
    role: String(raw?.role || ""),
    dealershipId: raw?.dealershipId || raw?.dealership?.id || raw?.dealerId,
    dealershipName: raw?.dealershipName || raw?.dealerName || raw?.dealership?.dealershipName || raw?.dealership?.name || raw?.profile?.dealershipName,
    accountApproved: raw?.accountApproved,
    accountActive: raw?.accountActive,
    dashboardAccessAllowed: raw?.dashboardAccessAllowed,
  };
}

export async function login(email: string, password: string) {
  const { data } = await api.post("/auth/login", { email: email.trim().toLowerCase(), password, portal: "finance", targetPortal: "finance" });
  return { token: String(data.token || data.accessToken || ""), user: normalizeUser(data.user || data.account) };
}
export async function currentSession() { const { data } = await api.get("/auth/session"); return normalizeUser(data.user || data.session?.user || data); }
export async function refreshSession() { const { data } = await api.post("/auth/session/refresh"); return { token: String(data.token || ""), user: normalizeUser(data.user || data.account) }; }
export async function logout() { await api.post("/auth/logout").catch(() => undefined); }
