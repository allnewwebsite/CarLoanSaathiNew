import { useEffect } from "react";
import { X } from "lucide-react";
import { OperationalTable } from "../../components/OperationalTable.jsx";
import { LOAN_EXECUTIVE_PAGE_SIZE as pageSize } from "./loanExecutive.helpers.js";

export function PageTitle({ title }) {
  return <h1 className="text-lg font-semibold text-slate-950 lg:text-xl">{title}</h1>;
}

export function Table({ title, headers, rows, loading, page, total, hasMore, onPage }) {
  return <OperationalTable title={title} headers={headers} rows={rows} loading={loading} page={page} total={total} hasMore={hasMore} onPage={onPage} pageSize={pageSize} />;
}

export function Modal({ title, children, onClose, sheet = false }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className={`fixed inset-0 z-[70] flex bg-slate-950/45 p-0 sm:items-center sm:justify-center sm:p-4 ${sheet ? "items-end" : "items-center justify-center px-3"}`} onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className={`w-full overflow-hidden bg-white shadow-xl ${sheet ? "max-h-[82vh] rounded-t-lg sm:max-w-xl sm:rounded-lg" : "max-h-[88vh] max-w-xl rounded-lg"}`}>
        <header className="flex min-h-14 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4">
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-200/70"><X className="h-5 w-5" /></button>
        </header>
        <div className="max-h-[calc(88vh-3.5rem)] overflow-y-auto p-4">{children}</div>
      </section>
    </div>
  );
}

export function CompactPagination({ page, total, hasMore, onPage }) {
  const pageCount = Math.max(1, Math.ceil(Number(total || 0) / pageSize));
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="h-8 rounded-md border border-slate-200 px-3 font-semibold text-slate-700 disabled:opacity-40">Prev</button>
      <span className="font-medium text-slate-500">{page} / {pageCount}</span>
      <button type="button" disabled={!hasMore} onClick={() => onPage(page + 1)} className="h-8 rounded-md border border-slate-200 px-3 font-semibold text-slate-700 disabled:opacity-40">Next</button>
    </div>
  );
}
