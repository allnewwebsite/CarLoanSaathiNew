import { FileCheck2, Loader2, UploadCloud } from "lucide-react";
import { SectionCard, SelectBox, StandardSelect } from "./DealerRegistrationParts.jsx";
import { documentFields, salesCapacity } from "./dealerRegistration.constants.js";

const fieldClass = "field mt-1.5 h-10 rounded-md";
const labelClass = "text-sm font-medium text-slate-700";

export function DealershipInformationSection({ form, dealershipBrands, update }) {
  return (
    <SectionCard number="1" title="Dealership Information">
      <label className={labelClass}>Dealership Name *<input required className={fieldClass} value={form.dealershipName} onChange={(e) => update("dealershipName", e.target.value)} /></label>
      <SelectBox label="Dealership Brand *" value={form.dealershipBrand} options={dealershipBrands} onChange={(value) => update("dealershipBrand", value)} />
      <label className={labelClass}>Authorized Dealer Code *<input required className={fieldClass} value={form.authorizedDealerCode} onChange={(e) => update("authorizedDealerCode", e.target.value)} /></label>
      <label className={labelClass}>GSTIN Number *<input required maxLength={15} className={fieldClass} value={form.gstinNumber} onChange={(e) => update("gstinNumber", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15))} placeholder="06ABCDE1234F1Z5" /></label>
      <label className={labelClass}>
        Official Dealership Mobile Number *
        <div className="mt-2 flex h-10 overflow-hidden rounded-2xl border border-slate-200 bg-white focus-within:border-[#0d47a1]">
          <span className="inline-flex items-center border-r border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">+91</span>
          <input required maxLength={10} inputMode="numeric" className="h-full w-full px-3 outline-none" value={form.officialDealershipMobile} onChange={(e) => update("officialDealershipMobile", e.target.value.replace(/\D/g, "").slice(0, 10))} />
        </div>
      </label>
    </SectionCard>
  );
}

export function DealershipLocationSection({ bankStates, form, locationOptions, update }) {
  return (
    <SectionCard number="2" title="Dealership Location">
      <StandardSelect label="State *" value={form.state} options={bankStates} onChange={(value) => update("state", value)} placeholder="Select state" />
      <SelectBox label="Location *" value={form.city} options={locationOptions} onChange={(value) => update("city", value)} placeholder="Search supported location" />
      <label className={labelClass}>Pincode *<input required className={fieldClass} value={form.pincode} onChange={(e) => update("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
      <label className={labelClass}>Landmark<input className={fieldClass} value={form.landmark} onChange={(e) => update("landmark", e.target.value)} /></label>
      <label className={`${labelClass} md:col-span-2`}>Full Dealership Address *<textarea required className="field mt-2 min-h-28 rounded-2xl py-3" value={form.address} onChange={(e) => update("address", e.target.value)} /></label>
    </SectionCard>
  );
}

export function BusinessCapacitySection({ form, update }) {
  return (
    <SectionCard number="3" title="Business & Loan Capacity">
      <StandardSelect label="Monthly Car Sales Capacity *" value={form.monthlyCarSalesCapacity} options={salesCapacity} onChange={(value) => update("monthlyCarSalesCapacity", value)} placeholder="Select monthly capacity" />
    </SectionCard>
  );
}

export function DealerDocumentUploadsSection({ documents, removeDocument, setDocument }) {
  return (
    <SectionCard number="4" title="Document Uploads">
      <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-normal leading-6 text-slate-600">
        Optional during registration. You can upload dealership verification documents later after testing the required details.
      </div>
      {documentFields.map((doc) => (
        <label key={doc} className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm font-medium text-slate-700">
          <div className="flex items-center gap-3"><UploadCloud className="h-5 w-5" /> {doc}</div>
          <input type="file" className="mt-3 block w-full text-xs" accept=".pdf,image/jpeg,image/png" onChange={(e) => setDocument(doc, e.target.files?.[0])} />
          {documents[doc] && (
            <div className="mt-3 rounded-xl bg-white px-3 py-2 text-xs text-[#536173]">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {documents[doc].status === "uploading" ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin text-[#0d47a1]" /> : <FileCheck2 className="mr-2 inline h-4 w-4 text-emerald-600" />}
                  {documents[doc].file.name}
                </span>
                <span className="shrink-0 font-semibold text-[#0d47a1]">{documents[doc].progress || 0}%</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-[#dbe7f6]"><div className="h-1.5 rounded-full bg-[#0d47a1]" style={{ width: `${documents[doc].progress || 0}%` }} /></div>
              {documents[doc].status === "error" && <p className="mt-2 text-red-600">{documents[doc].error || "Upload failed"}</p>}
              <div className="mt-2 flex gap-2">
                {documents[doc].status === "error" && <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setDocument(doc, documents[doc].file); }} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700">Retry upload</button>}
                <button type="button" onClick={(event) => removeDocument(event, doc)} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700">Remove file</button>
              </div>
            </div>
          )}
        </label>
      ))}
    </SectionCard>
  );
}

export function AccountAccessSection({ form }) {
  return (
    <SectionCard number="5" title="Account Access">
      <label className={labelClass}>Official Login Email *<input required readOnly type="email" className={`${fieldClass} bg-slate-50`} value={form.loginEmail} /></label>
      <div className="rounded-lg bg-slate-50 p-3 text-sm font-normal text-slate-600">After approval, this email/password account can sign in to CarLoanSaathi. Passwords are handled only by Firebase Authentication.</div>
    </SectionCard>
  );
}
