import { useCallback, useEffect, useMemo, useState } from "react";
import { api, getCachedGetData } from "../../services/api.js";

const ENDPOINTS = {
  finance: "/dealer/salespersons",
  gm: "/gm/salespersons",
};

function isActive(person = {}) {
  const status = String(person.status || "").trim().toLowerCase();
  return person.active !== false && !["inactive", "disabled", "removed", "deleted"].includes(status);
}

export function salespersonOptionValue(person = {}) {
  return String(person.id || person.sourceId || person.salespersonId || person.jobId || person.email || "").trim();
}

export function useArchiveSalespersons(audience) {
  const endpoint = ENDPOINTS[audience] || "";
  const cached = endpoint ? getCachedGetData(endpoint) : null;
  const [salespersons, setSalespersons] = useState(() => Array.isArray(cached) ? cached.filter(isActive) : []);
  const [loading, setLoading] = useState(Boolean(endpoint && !cached));

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!endpoint) return;
    if (!silent) setLoading(true);
    try {
      const response = await api.get(endpoint);
      const rows = Array.isArray(response.data) ? response.data : response.data?.data || [];
      setSalespersons(rows.filter(isActive));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    if (!endpoint) return undefined;
    load({ silent: Boolean(cached) }).catch(() => {});
    const refresh = (event) => {
      const type = String(event.detail?.eventType || event.detail?.event || "");
      if (["SALESPERSON_CREATED", "SALESPERSON_UPDATED", "SALESPERSON_DELETED"].includes(type)) {
        load({ silent: true }).catch(() => {});
      }
    };
    window.addEventListener("cls:realtime-event", refresh);
    return () => window.removeEventListener("cls:realtime-event", refresh);
  }, [cached, endpoint, load]);

  return { salespersons, loading };
}

export function ArchiveSalespersonFilter({ audience, value, onChange }) {
  const { salespersons, loading } = useArchiveSalespersons(audience);
  const options = useMemo(() => salespersons
    .map((person) => ({ person, value: salespersonOptionValue(person) }))
    .filter((item) => item.value), [salespersons]);
  const selectedAvailable = !value || options.some((item) => item.value === value);

  if (!ENDPOINTS[audience]) return null;
  return (
    <div className="flex justify-end">
      <label htmlFor={`${audience}-archive-salesperson-filter`} className="sr-only">Select Salesperson</label>
      <select
        id={`${audience}-archive-salesperson-filter`}
        aria-label="Select Salesperson"
        className="field h-11 w-full sm:w-64"
        value={value}
        disabled={loading}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">All Salespersons</option>
        {!selectedAvailable ? <option value={value}>Unavailable salesperson</option> : null}
        {options.map(({ person, value: optionValue }) => (
          <option key={optionValue} value={optionValue}>
            {person.name || person.email || person.jobId || "Salesperson"}
          </option>
        ))}
      </select>
    </div>
  );
}
