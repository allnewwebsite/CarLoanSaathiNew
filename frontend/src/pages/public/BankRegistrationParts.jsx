import { useState } from "react";
import { CheckCircle2, UploadCloud } from "lucide-react";
import { allowedTypes, maxSize } from "./bankRegistration.constants.js";

export function UploadBox({ doc, bankUid, value, onChange }) {
  const [error, setError] = useState("");

  const upload = async (file) => {
    setError("");
    if (!file) return;
    if (!allowedTypes.includes(file.type)) {
      setError("Only PDF, JPG, JPEG, and PNG files are allowed.");
      return;
    }
    if (file.size > maxSize) {
      setError("Maximum file size is 10MB.");
      return;
    }
    const storagePath = `bank-registration/${bankUid}/${doc.folder}/${Date.now()}-${file.name}`;
    onChange({ status: "uploading", progress: 0, fileName: file.name, storagePath, fileUrl: "" });
    try {
      const { uploadStorageFile } = await import("../../services/firebaseUpload.js");
      const { fileUrl } = await uploadStorageFile({
        file,
        storagePath,
        contentType: file.type,
        onProgress: (progress) => onChange((current) => ({ ...current, progress })),
      });
      onChange({
        status: "uploaded",
        progress: 100,
        fileName: file.name,
        storagePath,
        fileUrl,
        documentType: doc.type,
        label: doc.label,
        size: file.size,
      });
    } catch (uploadError) {
      setError(uploadError.message || "Upload failed.");
      onChange((current) => ({ ...current, status: "error" }));
    }
  };

  const remove = async () => {
    if (value?.storagePath) {
      try {
        const { deleteStoragePath } = await import("../../services/firebaseUpload.js");
        await deleteStoragePath(value.storagePath);
      } catch {
        // File may already be gone; UI state should still clear.
      }
    }
    onChange(null);
  };

  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-50 text-[#0d47a1]">
            <UploadCloud className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">{doc.label}</p>
            <p className="mt-1 text-xs text-slate-500">Optional for now. PDF, JPG, JPEG, PNG up to 10MB</p>
          </div>
        </div>
        {value?.status === "uploaded" && <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
      </div>
      <input
        className="mt-4 block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border file:border-slate-200 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700"
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={(event) => upload(event.target.files?.[0])}
      />
      {value && (
        <div className="mt-3 rounded-md bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
            <span className="truncate">{value.fileName}</span>
            <span>{value.progress || 0}%</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-slate-200">
            <div className="h-1.5 rounded-full bg-[#0d47a1]" style={{ width: `${value.progress || 0}%` }} />
          </div>
          <div className="mt-3 flex gap-2">
            {value.fileUrl && (
              <a href={value.fileUrl} target="_blank" rel="noreferrer" className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700">
                Preview
              </a>
            )}
            <button type="button" onClick={remove} className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
              Remove
            </button>
          </div>
        </div>
      )}
      <p className={`validation-slot mt-2 ${error ? "" : "validation-slot-empty"}`}>{error || "No validation issue"}</p>
    </div>
  );
}
