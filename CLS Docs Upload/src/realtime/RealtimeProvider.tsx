import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import EventSource from "react-native-sse";
import { api, API_BASE_URL } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { session } from "../auth/session";

export type RealtimeEvent = Record<string, any> & {
  event?: string;
  eventType?: string;
  id?: string | number;
  leadId?: string;
  caseId?: string;
  documentId?: string;
};

type RealtimeStatus = "disconnected" | "connecting" | "connected" | "reconnecting";
type EventListener = (event: RealtimeEvent) => void | Promise<void>;
type RealtimeValue = {
  status: RealtimeStatus;
  subscribe: (listener: EventListener) => () => void;
};

const RealtimeContext = createContext<RealtimeValue>({
  status: "disconnected",
  subscribe: () => () => undefined,
});

function eventIdFor(event: RealtimeEvent, lastEventId?: string) {
  const explicit = String(lastEventId || event.id || event.eventId || "").trim();
  if (explicit) return explicit;
  return [event.eventType || event.event, event.leadId, event.caseId, event.documentId, event.timestamp]
    .map((value) => String(value || ""))
    .join(":");
}

function parseEvent(data?: string) {
  try {
    const parsed = JSON.parse(data || "{}");
    return parsed && typeof parsed === "object" ? parsed as RealtimeEvent : null;
  } catch {
    return null;
  }
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<RealtimeStatus>("disconnected");
  const listeners = useRef(new Set<EventListener>());
  const userKey = user?.id || user?.uid || user?.email || "";

  const subscribe = useCallback((listener: EventListener) => {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  }, []);

  useEffect(() => {
    listeners.current.clear();
    if (!userKey) {
      setStatus("disconnected");
      return undefined;
    }

    let source: EventSource<any> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let connecting = false;
    let reconnectAttempt = 0;
    let appState: AppStateStatus = AppState.currentState;
    const seen = new Set<string>();
    const processing = new Set<string>();
    let lastEventId = "";
    let connectedBefore = false;
    let eventQueue = Promise.resolve();
    let recoveryReconciliationQueued = false;

    const closeSource = () => {
      source?.close();
      source = null;
    };

    const scheduleReconnect = (immediate = false) => {
      if (closed || appState !== "active" || reconnectTimer) return;
      setStatus("reconnecting");
      const delay = immediate ? 0 : Math.min(1000 * 2 ** reconnectAttempt, 15000);
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };

    const notifyListeners = async (event: RealtimeEvent) => {
      const outcomes = await Promise.allSettled([...listeners.current].map(listener => Promise.resolve().then(() => listener(event))));
      return outcomes.every(outcome => outcome.status === "fulfilled");
    };

    const requestReconciliation = async (reason: string) => {
      if (!await notifyListeners({ eventType: "REALTIME_RECONCILE_REQUIRED", reason, timestamp: new Date().toISOString() })) {
        closeSource();
        scheduleReconnect(true);
      }
    };

    const handleOperational = async (event: any) => {
      const payload = parseEvent(event?.data);
      if (!payload) return;
      const eventId = eventIdFor(payload, event?.lastEventId);
      if (eventId && (seen.has(eventId) || processing.has(eventId))) return;
      if (eventId) processing.add(eventId);
      try {
        if (!await notifyListeners(payload)) {
          closeSource();
          scheduleReconnect(true);
          return;
        }
        if (eventId) {
          const receivedId = String(event?.lastEventId || payload.eventId || "");
          if (receivedId && Number.isFinite(Number(receivedId)) && (!lastEventId || Number(receivedId) > Number(lastEventId))) {
            await session.setLastEventId(receivedId);
            lastEventId = receivedId;
          }
          seen.add(eventId);
          if (seen.size > 500) seen.delete(seen.values().next().value as string);
          void api.post("/realtime/ack", { eventIds: [eventId], lastEventId: eventId }).catch(() => undefined);
        }
      } finally {
        if (eventId) processing.delete(eventId);
      }
    };

    const handleFailure = () => {
      closeSource();
      if (!closed) scheduleReconnect();
    };

    const connect = async () => {
      if (closed || appState !== "active" || connecting || source) return;
      connecting = true;
      recoveryReconciliationQueued = false;
      setStatus(reconnectAttempt ? "reconnecting" : "connecting");
      try {
        const { data } = await api.post("/realtime/ticket");
        if (closed || appState !== "active") return;
        const ticket = data.ticket || data.data?.ticket;
        if (!ticket) throw new Error("Realtime ticket missing");
        if (!lastEventId) lastEventId = await session.getLastEventId();
        if (closed || appState !== "active") return;
        const params = new URLSearchParams({ ticket });
        if (lastEventId) params.set("lastEventId", lastEventId);
        const next: EventSource<"operational" | "replaced" | "connected" | "reconcile-required"> = new EventSource<"operational" | "replaced" | "connected" | "reconcile-required">(`${API_BASE_URL}/realtime/events?${params.toString()}`, {
          timeout: 0,
          timeoutBeforeConnection: 15000,
          pollingInterval: 0,
        });
        source = next;
        next.addEventListener("open", () => setStatus("connected"));
        const enqueue = (task: () => Promise<void>) => {
          eventQueue = eventQueue.then(async () => {
            if (closed || source !== next) return;
            await task();
          }).catch(() => {
            closeSource();
            scheduleReconnect();
          });
        };
        next.addEventListener("connected", (event: any) => {
          setStatus("connected");
          const connection = parseEvent(event?.data);
          if (connectedBefore || connection?.replayGap) {
            recoveryReconciliationQueued = true;
            enqueue(() => requestReconciliation(connection?.replayGap ? "replay-gap" : "reconnected"));
          }
          connectedBefore = true;
        });
        next.addEventListener("reconcile-required", (event: any) => {
          const recovery = parseEvent(event?.data);
          if (recoveryReconciliationQueued) return;
          recoveryReconciliationQueued = true;
          enqueue(() => requestReconciliation(String(recovery?.reason || "replay-gap")));
        });
        next.addEventListener("operational", event => { enqueue(() => handleOperational(event)); });
        next.addEventListener("error", handleFailure);
        next.addEventListener("replaced", handleFailure);
        reconnectAttempt = 0;
      } catch {
        closeSource();
        if (!closed) scheduleReconnect();
      } finally {
        connecting = false;
      }
    };

    const onAppStateChange = (nextState: AppStateStatus) => {
      const wasActive = appState === "active";
      appState = nextState;
      if (nextState !== "active") {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        closeSource();
        setStatus("disconnected");
      } else if (!wasActive) {
        reconnectAttempt = 0;
        scheduleReconnect(true);
      }
    };

    const subscription = AppState.addEventListener("change", onAppStateChange);
    void connect();

    return () => {
      closed = true;
      subscription.remove();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      closeSource();
      listeners.current.clear();
      setStatus("disconnected");
    };
  }, [userKey]);

  const value = useMemo(() => ({ status, subscribe }), [status, subscribe]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);
