import { getNotifications, markNotificationRead } from "../services/notification.service.js";
import { processWhatsAppQueue } from "../services/whatsapp.service.js";

export async function listNotifications(req, res, next) {
  try {
    res.json(await getNotifications({ query: req.query, actor: req.user }));
  } catch (error) {
    next(error);
  }
}

export async function readNotification(req, res, next) {
  try {
    res.json(await markNotificationRead(req.params.id, req.user));
  } catch (error) {
    next(error);
  }
}

export async function processWhatsAppQueueNow(_req, res, next) {
  try {
    res.json({ processed: await processWhatsAppQueue() });
  } catch (error) {
    next(error);
  }
}
