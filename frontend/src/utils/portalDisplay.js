export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object" && typeof value.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date?.getTime?.()) ? null : date;
  }
  if (typeof value === "object" && Number.isFinite(value.seconds)) {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeAmPm(text) {
  return String(text || "").replace(/\b(am|pm)\b/i, (match) => match.toLowerCase());
}

export function formatPortalDateTime(value) {
  const date = toDate(value);
  if (!date) return "-";
  return normalizeAmPm(date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }));
}

export function formatPortalDate(value) {
  const date = toDate(value);
  if (!date) return "-";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatPortalTime(value) {
  const date = toDate(value);
  if (!date) return "-";
  return normalizeAmPm(date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }));
}

export function cleanPortalText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function displayPortalText(value, fallback = "-") {
  const text = cleanPortalText(value);
  return text || fallback;
}

export function loanExecutiveRemark(lead) {
  const candidates = [
    lead?.loanExecutiveRemark,
    lead?.executiveRemark,
    lead?.pendingDocumentReason,
    lead?.rejectionRemarks,
    lead?.approvalRemarks,
    lead?.disbursementRemarks,
    lead?.bankRemarks,
    lead?.latestRemark,
    lead?.remarks,
  ];
  return candidates.map(cleanPortalText).find(Boolean) || "-";
}
