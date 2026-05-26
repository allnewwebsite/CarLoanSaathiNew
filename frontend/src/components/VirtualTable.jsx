import { memo, useMemo, useState } from "react";

const Row = memo(function Row({ row, columns, top, height }) {
  return (
    <tr style={{ transform: `translateY(${top}px)`, height }} className="absolute left-0 grid w-full border-b border-slate-100 bg-white hover:bg-slate-50">
      {columns.map((column) => (
        <td key={column.key} className="truncate px-3 py-3 text-sm text-slate-600">
          {column.render ? column.render(row) : row[column.key]}
        </td>
      ))}
    </tr>
  );
});

export function VirtualTable({ columns, rows, rowHeight = 48, height = 520, overscan = 8 }) {
  const [scrollTop, setScrollTop] = useState(0);
  const visible = useMemo(() => {
    const start = Math.max(Math.floor(scrollTop / rowHeight) - overscan, 0);
    const end = Math.min(Math.ceil((scrollTop + height) / rowHeight) + overscan, rows.length);
    return { start, end, rows: rows.slice(start, end) };
  }, [height, overscan, rowHeight, rows, scrollTop]);

  return (
    <section className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr className="grid w-full">
              {columns.map((column) => <th key={column.key} className="px-3 py-3">{column.label}</th>)}
            </tr>
          </thead>
        </table>
        <div style={{ height, overflow: "auto" }} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
          <table className="relative min-w-full text-left" style={{ height: rows.length * rowHeight }}>
            <tbody>
              {visible.rows.map((row, index) => (
                <Row key={row.id || row.caseId || visible.start + index} row={row} columns={columns} top={(visible.start + index) * rowHeight} height={rowHeight} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
