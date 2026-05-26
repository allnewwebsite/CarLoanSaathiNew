export function Timeline({ items }) {
  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <div className="flex gap-3" key={item.title}>
          <div className="flex flex-col items-center">
            <span className="mt-1 h-3 w-3 rounded-full bg-brand-600" />
            {index < items.length - 1 && <span className="mt-1 h-full w-px bg-line" />}
          </div>
          <div className="pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-ink">{item.title}</p>
              <span className="text-xs text-muted">{item.time}</span>
            </div>
            <p className="mt-1 text-sm text-muted">{item.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
