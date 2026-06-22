import { getNotifications, getUnreadNotificationCount, markAllNotificationsRead, markNotificationRead } from "../services/notification.service.js";
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

export async function readAllNotifications(req, res, next) {
  try {
    res.json(await markAllNotificationsRead(req.user));
  } catch (error) {
    next(error);
  }
}

export async function unreadNotificationCount(req, res, next) {
  try {
    res.json({ unread: await getUnreadNotificationCount(req.user) });
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
