import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

export function SelectBox({ label, value, options, onChange, placeholder = "Select", error }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef(null);
  const selected = [value].filter(Boolean);
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return options.filter((option) => !search || option.toLowerCase().includes(search));
  }, [options, query]);

  useEffect(() => {
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const choose = (option) => {
    onChange(option);
    setOpen(false);
  };

  return (
    <label ref={ref} className="relative text-sm font-medium text-slate-700">
      {label}
      <button type="button" onClick={() => setOpen((current) => !current)} className={`mt-1.5 flex min-h-10 w-full items-center justify-between gap-2 rounded-md border bg-white px-3 py-2 text-left text-sm font-normal text-slate-900 outline-none transition hover:border-slate-400 ${error ? "border-red-300" : "border-slate-300"}`}>
        <span className={`min-w-0 truncate ${selected.length ? "" : "text-[#64748b]"}`}>{selected.length ? selected.join(", ") : placeholder}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-[#edf2f7] px-3 py-2">
            <Search className="h-4 w-4 text-[#64748b]" />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" className="h-9 min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#06152f] outline-none" />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.map((option) => (
              <button key={option} type="button" onClick={() => choose(option)} className={`block w-full px-3 py-2 text-left text-sm font-normal transition hover:bg-slate-50 ${selected.includes(option) ? "bg-blue-50 text-[#0d47a1]" : "text-slate-800"}`}>
                {option}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className={`validation-slot font-semibold ${error ? "" : "validation-slot-empty"}`}>{error || "No validation issue"}</p>
    </label>
  );
}

export function StandardSelect({ label, value, options, onChange, placeholder = "Select", error, required = true }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <select
        required={required}
        className={`field mt-1.5 h-10 rounded-md bg-white ${error ? "border-red-300" : ""}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
      <p className={`validation-slot font-semibold ${error ? "" : "validation-slot-empty"}`}>{error || "No validation issue"}</p>
    </label>
  );
}

export function SectionCard({ number, title, children }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center gap-3 border-b border-slate-100 pb-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0d47a1] text-xs font-medium text-white">{number}</span>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}
