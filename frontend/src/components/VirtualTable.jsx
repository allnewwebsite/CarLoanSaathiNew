import { memo, useEffect, useMemo } from "react";
import { List } from "react-window";
import { markTableRenderComplete, markTableRenderStart, useRenderDiagnostics } from "../services/frontendLatency.js";

const Row = memo(function Row({ index, style, rows, columns, gridTemplateColumns }) {
  const row = rows[index];
  return (
    <div style={{ ...style, gridTemplateColumns }} role="row" className="grid w-full border-b border-slate-100 bg-white hover:bg-slate-50">
      {columns.map((column) => (
        <div key={column.key} role="cell" className="flex min-w-0 items-center truncate px-2 py-1 text-xs leading-4 text-slate-600">
          {column.render ? column.render(row) : row[column.key]}
        </div>
      ))}
    </div>
  );
});

function columnWidth(label = "") {
  if (/action/i.test(label)) return 460;
  if (/email/i.test(label)) return 220;
  if (/document/i.test(label)) return 130;
  if (/status/i.test(label)) return 145;
  if (/mobile/i.test(label)) return 145;
  if (/amount|price/i.test(label)) return 150;
  if (/date|time/i.test(label)) return 145;
  if (/case/i.test(label)) return 125;
  return 145;
}

function MobileRows({ rows, columns }) {
  return (
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
  );
}

const MemoMobileRows = memo(MobileRows);

export const VirtualTable = memo(function VirtualTable({ columns, rows, rowHeight = 32, height = 520, overscan = 6, mobileLimit = 30 }) {
  const renderInfo = useMemo(() => markTableRenderStart({ component: "VirtualTable" }), [rows?.length]);
  useRenderDiagnostics("VirtualTable", { rowCount: rows?.length || 0 });
  const gridTemplateColumns = useMemo(() => columns.map((column) => `minmax(${columnWidth(column.label)}px, 1fr)`).join(" "), [columns]);
  const tableMinWidth = useMemo(() => `${Math.max(columns.reduce((sum, column) => sum + columnWidth(column.label), 0), 720)}px`, [columns]);
  const mobileRows = useMemo(() => rows.slice(0, mobileLimit), [mobileLimit, rows]);
  useEffect(() => {
    markTableRenderComplete(renderInfo, {
      component: "VirtualTable",
      title: "",
      rowCount: rows.length,
    });
  }, [renderInfo, rows.length]);
  return (
    <section className="card overflow-hidden">
      <div className="overflow-x-auto">
        <div role="table" className="hidden min-w-full text-left md:block" style={{ minWidth: tableMinWidth, width: tableMinWidth }}>
          <div role="rowgroup" className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <div role="row" className="grid w-full bg-slate-50" style={{ gridTemplateColumns }}>
              {columns.map((column) => <div role="columnheader" key={column.key} className="flex min-h-8 items-center overflow-hidden text-ellipsis px-2 py-1.5 leading-4" title={column.label}>{column.label}</div>)}
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
        <MemoMobileRows rows={mobileRows} columns={columns} />
      </div>
    </section>
  );
});
