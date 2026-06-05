import { memo } from "react";
import { List } from "react-window";

const VirtualRow = memo(function VirtualRow({ index, style, rows, gridTemplateColumns }) {
  const row = rows[index];
  return (
    <div style={{ ...style, gridTemplateColumns }} role="row" className="grid w-full border-b border-slate-100 bg-white hover:bg-slate-50" data-row-index={index}>
      {row.cells.map((cell, cellIndex) => (
        <div key={`${row.key || index}-${cellIndex}`} role="cell" className="flex min-w-0 items-center overflow-hidden text-ellipsis px-2 py-1 text-xs leading-4 text-slate-600" title={typeof cell === "string" || typeof cell === "number" ? String(cell) : undefined}>
          {cell}
        </div>
      ))}
    </div>
  );
});

function isPriorityHeader(header = "") {
  return /customer|status|amount|bank|action|document/i.test(header);
}

function columnWidth(header = "") {
  if (/action/i.test(header)) return 460;
  if (/official email|email/i.test(header)) return 220;
  if (/document/i.test(header)) return 130;
  if (/status/i.test(header)) return 145;
  if (/mobile/i.test(header)) return 145;
  if (/amount|price/i.test(header)) return 150;
  if (/date|time/i.test(header)) return 145;
  if (/ifsc/i.test(header)) return 140;
  if (/case/i.test(header)) return 125;
  return 150;
}

function columnTemplate(header = "") {
  const width = columnWidth(header);
  if (/action/i.test(header)) return `minmax(${width}px, 1.35fr)`;
  if (/official email|email/i.test(header)) return `minmax(${width}px, 1.2fr)`;
  return `minmax(${width}px, 1fr)`;
}

function MobileRows({ headers, rows }) {
  return (
    <div className="divide-y divide-slate-100 bg-white md:hidden">
      {rows.map((row) => (
        <article key={row.key} className="space-y-3 p-4">
          <div className="grid gap-2">
            {row.cells.map((cell, index) => (
              <div key={`${row.key}-mobile-${index}`} className={index > 0 && !isPriorityHeader(headers[index]) ? "hidden" : ""}>
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">{headers[index]}</p>
                <div className="mt-1 min-w-0 break-words text-sm text-slate-700">{cell}</div>
              </div>
            ))}
          </div>
          {row.cells.some((_, index) => index > 0 && !isPriorityHeader(headers[index])) ? (
            <details className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold text-slate-600">More details</summary>
              <div className="mt-3 grid gap-2">
                {row.cells.map((cell, index) => index > 0 && !isPriorityHeader(headers[index]) ? (
                  <div key={`${row.key}-detail-${index}`}>
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">{headers[index]}</p>
                    <div className="mt-1 min-w-0 break-words text-sm text-slate-700">{cell}</div>
                  </div>
                ) : null)}
              </div>
            </details>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function TableSkeletonRows({ headers, rows = 8, gridTemplateColumns }) {
  return (
    <div role="rowgroup" className="divide-y divide-slate-100 bg-white" aria-hidden="true">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div role="row" key={rowIndex} className="grid w-full" style={{ gridTemplateColumns }}>
          {headers.map((header, cellIndex) => (
            <div key={`${header}-${cellIndex}`} role="cell" className="flex min-h-8 min-w-0 items-center px-2 py-1">
              <div className={`h-3 animate-pulse rounded bg-slate-200/85 ${cellIndex === 0 ? "w-3/4" : cellIndex % 3 === 0 ? "w-1/2" : "w-2/3"}`} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function MobileSkeletonRows({ rows = 4 }) {
  return (
    <div className="divide-y divide-slate-100 bg-white md:hidden" aria-hidden="true">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <article key={rowIndex} className="space-y-3 p-4">
          <div className="h-3 w-1/3 animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-4/5 animate-pulse rounded bg-slate-200/85" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-slate-200/75" />
        </article>
      ))}
    </div>
  );
}

export const OperationalTable = memo(function OperationalTable({
  title,
  headers,
  rows,
  loading,
  page,
  total,
  hasMore,
  onPage,
  pageSize = 10,
  virtualizeAt = 25,
  height = 520,
  rowHeight = 32,
  action = null,
}) {
  const knownTotal = Number.isFinite(Number(total)) && Number(total) > 0;
  const pages = knownTotal ? Math.max(Math.ceil(Number(total) / pageSize), 1) : Math.max(page + (hasMore ? 1 : 0), 1);
  const visibleRows = rows;
  const hasRows = visibleRows.length > 0;
  const useVirtual = hasRows && visibleRows.length >= virtualizeAt;
  const gridTemplateColumns = headers.map(columnTemplate).join(" ");
  const tableMinWidth = `${Math.max(headers.reduce((sum, head) => sum + columnWidth(head), 0), 720)}px`;

  return (
    <section className="card overflow-hidden">
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-3 py-2">
          {title ? <h2 className="min-w-0 truncate text-base font-semibold text-slate-900">{title}</h2> : <span />}
          {action}
        </div>
      )}
      <div className="overflow-x-auto overscroll-x-contain">
        <div role="table" className="hidden min-w-full text-left text-xs md:block" style={{ minWidth: tableMinWidth, width: tableMinWidth }}>
          <div role="rowgroup" className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <div role="row" className="grid w-full bg-slate-50" style={{ gridTemplateColumns }}>
              {headers.map((head) => <div role="columnheader" key={head} className="flex min-h-8 min-w-0 items-center overflow-hidden text-ellipsis px-2 py-1.5 leading-4" title={head}>{head}</div>)}
            </div>
          </div>

          {loading && !hasRows && <TableSkeletonRows headers={headers} gridTemplateColumns={gridTemplateColumns} />}
          {!loading && !hasRows && <div className="px-3 py-8 text-center text-slate-500">No records found.</div>}

          {hasRows && useVirtual && (
            <List
              defaultHeight={Math.min(height, Math.max(rowHeight, visibleRows.length * rowHeight))}
              rowCount={visibleRows.length}
              rowHeight={rowHeight}
              overscanCount={8}
              rowComponent={VirtualRow}
              rowProps={{ rows: visibleRows, gridTemplateColumns }}
              style={{ height: Math.min(height, Math.max(rowHeight, visibleRows.length * rowHeight)), width: "100%" }}
            />
          )}

          {hasRows && !useVirtual && (
            <div role="rowgroup" className="divide-y divide-slate-100 bg-white">
              {visibleRows.map((row) => (
                <div role="row" key={row.key} className="grid w-full hover:bg-slate-50" style={{ gridTemplateColumns }}>
                  {row.cells.map((cell, index) => <div role="cell" key={`${row.key}-${index}`} className="flex min-h-8 min-w-0 items-center overflow-hidden text-ellipsis px-2 py-1 text-xs leading-4 text-slate-600" title={typeof cell === "string" || typeof cell === "number" ? String(cell) : undefined}>{cell}</div>)}
                </div>
              ))}
            </div>
          )}
        </div>
        {hasRows ? <MobileRows headers={headers} rows={visibleRows} /> : null}
        {loading && !hasRows ? <MobileSkeletonRows /> : null}
        {!loading && !hasRows ? <div className="px-3 py-8 text-center text-sm text-slate-500 md:hidden">No records found.</div> : null}
      </div>
      {onPage ? (
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-3 py-1.5">
          <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded-md border border-slate-200 px-3 py-1 text-xs disabled:opacity-50">Prev</button>
          <span className="text-xs text-slate-500">{knownTotal ? `Page ${page} of ${pages}` : `Page ${page}`}</span>
          <button disabled={knownTotal ? page >= pages : !hasMore} onClick={() => onPage(page + 1)} className="rounded-md border border-slate-200 px-3 py-1 text-xs disabled:opacity-50">Next</button>
        </div>
      ) : null}
    </section>
  );
});

