import { Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { statusLabel } from "../../../constants/status.js";
import { SUPER_ADMIN_PAGE_SIZE as pageSize } from "./superAdmin.helpers.js";

export function Filters({ search, setSearch, status, setStatus, options = [] }) {
  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-4">
      <div className="relative md:col-span-2">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input className="h-9 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-[#0d47a1]" placeholder="Search records" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      {options.length ? <select className="h-9 rounded-md border border-slate-200 px-3 text-sm text-slate-700 outline-none focus:border-[#0d47a1]" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">Select Status</option>
        {options.map((item) => <option key={item} value={item}>{statusLabel(item) || item}</option>)}
      </select> : null}
    </div>
  );
}

export function usePagedRows(rows) {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") || 1);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const onPage = (nextPage) => setParams((current) => {
    const next = Object.fromEntries(current.entries());
    next.page = String(nextPage);
    return next;
  });
  return { page, pageRows, onPage };
}

export function responseRows(normalizeRows, response) {
  return normalizeRows(response);
}
