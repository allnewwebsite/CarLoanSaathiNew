export function valueOrDash(value) {
  if (value === null || value === undefined || value === "") return "Not metered";
  if (typeof value === "number") return new Intl.NumberFormat("en-IN").format(value);
  return value;
}

export function percent(value) {
  return value === null || value === undefined ? "Not metered" : `${value}%`;
}

export function dateTime(value) {
  if (!value) return "None";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Invalid" : date.toLocaleString();
}

export function yesNo(value) {
  return value ? "Yes" : "No";
}

export function shortText(value, maxLength = 90) {
  if (!value) return "None";
  const text = String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function rows(items = [], mapper) {
  return items.map((item, index) => ({ key: `${item.key || item.endpoint || item.title || index}`, cells: mapper(item, index) }));
}
