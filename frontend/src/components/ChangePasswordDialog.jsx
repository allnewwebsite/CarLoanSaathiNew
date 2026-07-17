import { useEffect, useId, useRef, useState } from "react";
import { Eye, EyeOff, Loader2, LockKeyhole, X } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";

const LOGIN_PATHS = {
  "finance-desk": "/finance/login",
  gm: "/gm/login",
  "bank-manager": "/bank/login",
  "loan-executive": "/executive/login",
  "super-admin": "/admin/login",
};
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,64}$/;

function PasswordField({ label, name, value, onChange, error, autoComplete }) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <div className={`mt-1.5 flex h-11 items-center gap-2 rounded-md border bg-white px-3 focus-within:border-[#0d47a1] ${error ? "border-red-400" : "border-slate-300"}`}>
        <LockKeyhole className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          required
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          maxLength={64}
          onChange={onChange}
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none"
        />
        <button type="button" onClick={() => setVisible((current) => !current)} aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`} className="text-slate-500 hover:text-slate-700">
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error ? <span className="mt-1 block text-xs font-medium text-red-600">{error}</span> : null}
    </label>
  );
}

function clearRememberedAuthentication() {
  Object.keys(localStorage)
    .filter((key) => key === "cls_last_login_portal" || key.startsWith("cls_login_memory:"))
    .forEach((key) => localStorage.removeItem(key));
}

export function ChangePasswordDialog({ open, onClose, user }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const { changeCurrentPassword } = useAuth();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    dialogRef.current?.querySelector("input")?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open, submitting]);

  useEffect(() => {
    if (open) return;
    setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setErrors({});
    setServerError("");
    setSubmitting(false);
  }, [open]);

  if (!open) return null;

  const update = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: "" }));
    setServerError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (!form.currentPassword) nextErrors.currentPassword = "Current password is required.";
    if (!form.newPassword) nextErrors.newPassword = "New password is required.";
    else if (!PASSWORD_PATTERN.test(form.newPassword)) nextErrors.newPassword = "Use 8–64 characters with uppercase, lowercase, number, and special character.";
    else if (form.newPassword === form.currentPassword) nextErrors.newPassword = "New password must be different from your current password.";
    if (form.confirmPassword !== form.newPassword) nextErrors.confirmPassword = "Passwords do not match.";
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setSubmitting(true);
    setServerError("");
    try {
      const result = await changeCurrentPassword(form);
      clearRememberedAuthentication();
      sessionStorage.setItem("cls_auth_security_message", result?.message || "Password changed successfully. Please log in again using your new password.");
      window.location.assign(LOGIN_PATHS[user?.role] || "/dealer/login");
    } catch (error) {
      const code = error.response?.data?.code;
      const message = error.response?.data?.message;
      if (code === "CURRENT_PASSWORD_INCORRECT") setErrors({ currentPassword: "Current password is incorrect." });
      else if (code === "PASSWORD_MISMATCH") setErrors({ confirmPassword: "Passwords do not match." });
      else if (code === "PASSWORD_REUSED") setErrors({ newPassword: "New password must be different from your current password." });
      else if (code === "WEAK_PASSWORD") setErrors({ newPassword: "Password does not meet security requirements." });
      else setServerError(message || "Unable to change password. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !submitting) onClose();
    }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-lg overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[#0d47a1] text-white"><LockKeyhole className="h-5 w-5" /></span>
            <div><h2 id={titleId} className="text-lg font-semibold text-slate-950">Change Password</h2><p className="text-sm text-slate-500">Secure your CarLoanSaathi account</p></div>
          </div>
          <button type="button" disabled={submitting} onClick={onClose} aria-label="Close change password dialog" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-50"><X className="h-4 w-4" /></button>
        </header>
        <form onSubmit={submit} className="space-y-4 px-5 py-5 sm:px-6">
          <PasswordField label="Current Password" name="currentPassword" value={form.currentPassword} onChange={update} error={errors.currentPassword} autoComplete="current-password" />
          <PasswordField label="New Password" name="newPassword" value={form.newPassword} onChange={update} error={errors.newPassword} autoComplete="new-password" />
          <PasswordField label="Confirm New Password" name="confirmPassword" value={form.confirmPassword} onChange={update} error={errors.confirmPassword} autoComplete="new-password" />
          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">Password must be 8–64 characters and include uppercase, lowercase, number, and special character.</p>
          {serverError ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{serverError}</p> : null}
          <footer className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <button type="button" disabled={submitting} onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={submitting} className="inline-flex min-w-36 items-center justify-center gap-2 rounded-md bg-[#0d47a1] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0b3d8c] disabled:opacity-60">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}{submitting ? "Changing…" : "Change Password"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
