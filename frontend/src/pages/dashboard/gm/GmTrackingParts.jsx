import { useNavigate } from "react-router-dom";
import { OperationalTable } from "../../../components/OperationalTable.jsx";

export const pageSize = 10;

export function Table({ title, headers, rows, loading, page, total, hasMore, onPage }) {
  return <OperationalTable title={title} headers={headers} rows={rows} loading={loading} page={page} total={total} hasMore={hasMore} onPage={onPage} pageSize={pageSize} />;
}

export function SectionTitle({ title, subtitle }) {
  return <div><p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">General Manager</p><h1 className="mt-1 text-xl font-semibold text-slate-900">{title}</h1>{subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}</div>;
}

export function DocumentsButton({ lead }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(`/gm/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View Documents</button>;
}
