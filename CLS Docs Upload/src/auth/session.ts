import * as SecureStore from "expo-secure-store";
import { User } from "../types";

const TOKEN = "cls_docs_finance_token";
const USER = "cls_docs_finance_user";
const LAST_EVENT_ID = "cls_docs_finance_last_event_id";

export const session = {
  async getToken() { return SecureStore.getItemAsync(TOKEN); },
  async getUser(): Promise<User | null> {
    const raw = await SecureStore.getItemAsync(USER);
    if (!raw) return null;
    try { return JSON.parse(raw) as User; } catch { return null; }
  },
  async set(token: string, user: User) {
    const currentUser = await this.getUser();
    if (currentUser?.id && currentUser.id !== user.id) await SecureStore.deleteItemAsync(LAST_EVENT_ID);
    await Promise.all([SecureStore.setItemAsync(TOKEN, token), SecureStore.setItemAsync(USER, JSON.stringify(user))]);
  },
  async getLastEventId() { return (await SecureStore.getItemAsync(LAST_EVENT_ID)) || ""; },
  async setLastEventId(eventId: string) { await SecureStore.setItemAsync(LAST_EVENT_ID, eventId); },
  async clear() { await Promise.all([SecureStore.deleteItemAsync(TOKEN), SecureStore.deleteItemAsync(USER), SecureStore.deleteItemAsync(LAST_EVENT_ID)]); },
};
