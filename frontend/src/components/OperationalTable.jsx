import { memo } from "react";
import { List } from "react-window";

const VirtualRow = memo(function VirtualRow({ index, style, rows, gridTemplateColumns }) {
  const row = rows[index];
  return (
    <div style={{ ...style, gridTemplateColumns }} role="row" className="grid w-full border-b border-slate-100 bg-white hover:bg-slate-50" data-row-index={index}>
      {row.cells.map((cell, cellIndex) => (
        <div key={`${row.key || index}-${cellIndex}`} role="cell" className="min-w-0 overflow-hidden text-ellipsis px-3 py-3 text-sm leading-5 text-slate-600" title={typeof cell === "string" || typeof cell === "number" ? String(cell) : undefined}>
          {cell}
        </div>
      ))}
    </div>
  );
});

function MobileRows({ headers, rows }) {
  return (
    <div className="divide-y divide-slate-100 bg-white md:hidden">
      {rows.map((row) => (
        <article key={row.key} className="space-y-3 p-4">
          <div className="grid gap-2">
            {row.cells.map((cell, index) => (
              <div key={`${row.key}-mobile-${index}`} className={index > 5 ? "hidden sm:block" : ""}>
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">{headers[index]}</p>
                <div className="mt-1 min-w-0 break-words text-sm text-slate-700">{cell}</div>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

export function OperationalTable({
  title,
  headers,
  rows,
  loading,
  page,
  total,
  onPage,
  pageSize = 10,
  virtualizeAt = 25,
  height = 520,
  rowHeight = 48,
}) {
  const pages = Math.max(Math.ceil((total || rows.length) / pageSize), 1);
  const useVirtual = !loading && rows.length >= virtualizeAt;
  const gridTemplateColumns = `repeat(${headers.length}, minmax(150px, 1fr))`;

  return (
    <section className="card overflow-hidden">
      {title && <h2 className="border-b border-slate-200 px-4 py-4 text-base font-semibold text-slate-900">{title}</h2>}
      <div className="overflow-x-auto">
        <div role="table" className="hidden min-w-full text-left text-sm md:block">
          <div role="rowgroup" className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <div role="row" className="grid w-full" style={{ gridTemplateColumns }}>
              {headers.map((head) => <div role="columnheader" key={head} className="min-w-0 overflow-hidden text-ellipsis px-3 py-3 leading-4" title={head}>{head}</div>)}
            </div>
          </div>

          {loading && <div className="px-3 py-8 text-center text-slate-500">Loading...</div>}
          {!loading && !rows.length && <div className="px-3 py-8 text-center text-slate-500">No records found.</div>}

          {!loading && rows.length > 0 && useVirtual && (
            <List
              defaultHeight={Math.min(height, Math.max(rowHeight, rows.length * rowHeight))}
              rowCount={rows.length}
              rowHeight={rowHeight}
              overscanCount={8}
              rowComponent={VirtualRow}
              rowProps={{ rows, gridTemplateColumns }}
              style={{ height: Math.min(height, Math.max(rowHeight, rows.length * rowHeight)) }}
            />
          )}

          {!loading && rows.length > 0 && !useVirtual && (
            <div role="rowgroup" className="divide-y divide-slate-100 bg-white">
              {rows.map((row) => (
                <div role="row" key={row.key} className="grid w-full hover:bg-slate-50" style={{ gridTemplateColumns }}>
                  {row.cells.map((cell, index) => <div role="cell" key={`${row.key}-${index}`} className="min-w-0 overflow-hidden text-ellipsis px-3 py-3 text-sm leading-5 text-slate-600" title={typeof cell === "string" || typeof cell === "number" ? String(cell) : undefined}>{cell}</div>)}
                </div>
              ))}
            </div>
          )}
        </div>
        {!loading && rows.length > 0 ? <MobileRows headers={headers} rows={rows} /> : null}
        {loading ? <div className="px-3 py-8 text-center text-sm text-slate-500 md:hidden">Loading...</div> : null}
        {!loading && !rows.length ? <div className="px-3 py-8 text-center text-sm text-slate-500 md:hidden">No records found.</div> : null}
      </div>
      {onPage ? (
        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-3 py-3">
          <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm disabled:opacity-50">Prev</button>
          <span className="text-sm text-slate-500">Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm disabled:opacity-50">Next</button>
        </div>
      ) : null}
    </section>
  );
}
