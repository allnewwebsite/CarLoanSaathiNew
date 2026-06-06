import { AlertCircle } from "lucide-react";
import { displayPortalText, formatPortalDateTime, pendingDocumentItems, pendingDocumentRequests } from "../utils/portalDisplay.js";

export function PendingDocumentsPanel({ lead }) {
  const documents = pendingDocumentItems(lead);
  const requests = pendingDocumentRequests(lead);
  const latest = requests[0];

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50/70 p-4">
      <div className="flex gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700">
          <AlertCircle className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Pending Documents</h2>
            {latest?.requestedAt ? <p className="text-xs text-amber-800">Requested: {formatPortalDateTime(latest.requestedAt)}</p> : null}
          </div>
          {documents.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {documents.map((document) => (
                <span key={document} className="rounded-md border border-amber-200 bg-white px-2.5 py-1 text-xs font-medium text-amber-800">
                  {document}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-600">No pending documents requested.</p>
          )}
          {latest?.notes ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">Remark: {latest.notes}</p> : null}
          {latest?.requestedBy ? <p className="mt-2 text-xs text-slate-500">Requested by {displayPortalText(latest.requestedBy)}</p> : null}
        </div>
      </div>
    </section>
  );
}
