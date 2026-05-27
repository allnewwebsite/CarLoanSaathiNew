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
  return (
    <section className="card overflow-hidden">
      <div className="overflow-x-auto">
        <div role="table" className="min-w-full text-left">
          <div role="rowgroup" className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <div role="row" className="grid w-full" style={{ gridTemplateColumns }}>
              {columns.map((column) => <div role="columnheader" key={column.key} className="px-3 py-3">{column.label}</div>)}
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
      </div>
    </section>
  );
}
