import { formatPortalDate, formatPortalDateTime } from "../../utils/portalDisplay.js";

const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function display(value) {
  return value || "-";
}

export function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function cleanEmail(value) {
  return cleanText(value).toLowerCase();
}

export function digits10(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 10);
}

export function numericAmount(value) {
  const clean = String(value || "").replace(/[^\d]/g, "");
  return clean ? String(Number(clean)) : "";
}

export function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(value));
}

export function moneyValue(value) {
  return `Rs. ${money.format(Number(value || 0))}`;
}

export function dateValue(value) {
  return formatPortalDate(value);
}

export function dateTime(value) {
  return formatPortalDateTime(value);
}
