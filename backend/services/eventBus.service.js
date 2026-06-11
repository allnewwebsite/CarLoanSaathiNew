import { EventEmitter } from "events";
import { logError, logInfo } from "./logger.service.js";

export const DOMAIN_EVENTS = Object.freeze({
  NOTIFICATION_REQUESTED: "notification.requested",
  AUDIT_REQUESTED: "audit.requested",
});

const bus = new EventEmitter();
bus.setMaxListeners(50);

export function emitDomainEvent(type, payload = {}) {
  queueMicrotask(() => {
    try {
      bus.emit(type, {
        id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        payload,
        emittedAt: new Date().toISOString(),
      });
    } catch (error) {
      logError("Domain event emission failed", { type, error: error.message });
    }
  });
}

export function onDomainEvent(type, handler) {
  bus.on(type, async (event) => {
    try {
      await handler(event);
    } catch (error) {
      logError("Domain event handler failed", { type, eventId: event.id, error: error.message });
    }
  });
  logInfo("Domain event handler registered", { type });
}
