import {
  bankAnalytics,
  cityAnalytics,
  dealerAnalytics,
  disbursalAnalytics,
  monthlyLeadAnalytics,
  overviewAnalytics,
} from "../services/analytics.service.js";

export async function getAnalyticsOverview(_req, res, next) {
  try { res.json(await overviewAnalytics()); } catch (error) { next(error); }
}
export async function getAnalyticsMonthly(_req, res, next) {
  try { res.json(await monthlyLeadAnalytics()); } catch (error) { next(error); }
}
export async function getAnalyticsCities(_req, res, next) {
  try { res.json(await cityAnalytics()); } catch (error) { next(error); }
}
export async function getAnalyticsDealers(_req, res, next) {
  try { res.json(await dealerAnalytics()); } catch (error) { next(error); }
}
export async function getAnalyticsBanks(_req, res, next) {
  try { res.json(await bankAnalytics()); } catch (error) { next(error); }
}
export async function getAnalyticsDisbursals(_req, res, next) {
  try { res.json(await disbursalAnalytics()); } catch (error) { next(error); }
}
