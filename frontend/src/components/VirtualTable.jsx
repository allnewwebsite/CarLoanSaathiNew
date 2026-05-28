import { memo } from "react";
import { List } from "react-window";

const Row = memo(function Row({ index, style, rows, columns, gridTemplateColumns }) {
  const row = rows[index];
  return (
    <div style={{ ...style, gridTemplateColumns }} role="row" className="grid w-full border-b border-slate-100 bg-white hover:bg-slate-50">
      {columns.map((column) => (
        <div key={column.key} role="cell" className="truncate px-3 py-3 text-sm text-slate-600">
          {column.render ? column.render(row) : row[column.key]}
        </div>
      ))}
    </div>
  );
});

export function VirtualTable({ columns, rows, rowHeight = 48, height = 520, overscan = 8 }) {
  const gridTemplateColumns = `repeat(${columns.length}, minmax(140px, 1fr))`;
  const tableMinWidth = `${Math.max(columns.length * 150, 720)}px`;
  return (
    <section className="card overflow-hidden">
      <div className="overflow-x-auto">
        <div role="table" className="hidden min-w-full text-left md:block" style={{ minWidth: tableMinWidth, width: tableMinWidth }}>
          <div role="rowgroup" className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <div role="row" className="grid w-full bg-slate-50" style={{ gridTemplateColumns }}>
              {columns.map((column) => <div role="columnheader" key={column.key} className="min-h-12 overflow-hidden text-ellipsis border-r border-slate-200/70 px-3 py-3 last:border-r-0" title={column.label}>{column.label}</div>)}
            </div>
          </div>
          <List
            defaultHeight={height}
            rowCount={rows.length}
            rowHeight={rowHeight}
            overscanCount={overscan}
            rowComponent={Row}
            rowProps={{ rows, columns, gridTemplateColumns }}
            style={{ height }}
          />
        </div>
        <div className="divide-y divide-slate-100 bg-white md:hidden">
          {rows.map((row) => (
            <article key={row.id || row.caseId} className="space-y-3 p-4">
              {columns.slice(0, 6).map((column) => (
                <div key={column.key}>
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">{column.label}</p>
                  <div className="mt-1 min-w-0 break-words text-sm text-slate-700">{column.render ? column.render(row) : row[column.key]}</div>
                </div>
              ))}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
