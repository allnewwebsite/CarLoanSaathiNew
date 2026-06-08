import { connectRealtimeClient, consumeRealtimeTicket, createRealtimeTicket, realtimeStats } from "../services/realtime.service.js";
import { logRealtimeTicketStep, logRealtimeTicketSummary } from "../services/realtimeTicketLatency.service.js";

export async function createRealtimeConnectionTicket(req, res, next) {
  try {
    const ticket = createRealtimeTicket(req.user);
    const responseStartedAt = Date.now();
    res.set("Cache-Control", "no-store").json(ticket);
    logRealtimeTicketStep("response_creation", Date.now() - responseStartedAt, {
      responseBytes: res.locals.responseBytes || null,
      summaryField: "responseCreationDurationMs",
    });
    logRealtimeTicketSummary({
      responseBytes: res.locals.responseBytes || null,
      statusCode: res.statusCode,
    });
  } catch (error) {
    next(error);
  }
}

export async function streamRealtimeEvents(req, res) {
  const ticket = String(req.query.ticket || "").trim();
  const user = consumeRealtimeTicket(ticket);
  if (!user) {
    return res.status(401).json({ message: "Realtime ticket is invalid or expired" });
  }
  return connectRealtimeClient({ user, req, res });
}

export async function getRealtimeStats(_req, res, next) {
  try {
    res.set("Cache-Control", "no-store").json(realtimeStats());
  } catch (error) {
    next(error);
  }
}
