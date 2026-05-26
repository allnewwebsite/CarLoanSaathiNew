import { documents } from "../data/platformData.js";

export function DocumentChecklist() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {documents.map((doc, index) => (
        <div key={doc} className="flex items-center justify-between rounded-lg border border-line bg-white px-3 py-3">
          <div>
            <p className="text-sm font-semibold text-ink">{doc}</p>
            <p className="text-xs text-muted">{index < 5 ? "Verified" : "Correction requested"}</p>
          </div>
          <span className={`h-2.5 w-2.5 rounded-full ${index < 5 ? "bg-brand-600" : "bg-amber-500"}`} />
        </div>
      ))}
    </div>
  );
}
