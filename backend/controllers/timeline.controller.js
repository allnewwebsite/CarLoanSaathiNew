import { canReadTimelineLead, getTimelineEvents } from "../services/timeline.service.js";

export async function getLeadTimeline(req, res, next) {
  try {
    const allowed = await canReadTimelineLead(req.user, req.params.leadId);
    if (!allowed) return res.status(403).json({ message: "Timeline access denied" });
    res.json(await getTimelineEvents({ leadId: req.params.leadId, query: req.query, actor: req.user }));
  } catch (error) {
    next(error);
  }
}

export async function searchTimeline(req, res, next) {
  try {
    res.json(await getTimelineEvents({ query: req.query, actor: req.user }));
  } catch (error) {
    next(error);
  }
}
