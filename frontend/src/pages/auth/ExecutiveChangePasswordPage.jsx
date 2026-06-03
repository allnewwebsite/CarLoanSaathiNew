import { useMemo, useState } from "react";
import { Eye, EyeOff, Loader2, LockKeyhole } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";

function passwordChecks(value) {
  return {
    length: value.length >= 8,
    upper: /[A-Z]/.test(value),
    lower: /[a-z]/.test(value),
    number: /\d/.test(value),
    symbol: /[^A-Za-z0-9]/.test(value),
  };
}

function strengthLabel(score) {
  if (score >= 5) return "Strong";
  if (score >= 3) return "Medium";
  return "Weak";
}

function PasswordInput({ label, name, value, onChange, visible, onToggle, autoComplete, error }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <div className={`mt-1.5 flex h-11 items-center gap-2 rounded-md border bg-white px-3 ${error ? "border-red-300" : "border-slate-300 focus-within:border-[#0d47a1]"}`}>
        <LockKeyhole className="h-4 w-4 text-slate-400" />
        <input
          required
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoCorrect="off"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore="true"
          data-form-type="other"
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\s/g, ""))}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-900 outline-none"
        />
        <button type="button" onClick={onToggle} className="text-slate-500" aria-label={visible ? "Hide password" : "Show password"}>
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error ? <span className="mt-1 block text-xs font-semibold text-red-600">{error}</span> : null}
    </label>
  );
}

export function ExecutiveChangePasswordPage() {
  const navigate = useNavigate();
  const { changeCurrentPassword, user } = useAuth();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [visible, setVisible] = useState({ currentPassword: false, newPassword: false, confirmPassword: false });
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const checks = useMemo(() => passwordChecks(form.newPassword), [form.newPassword]);
  const score = Object.values(checks).filter(Boolean).length;
  const isExecutive = user?.role === "loan-executive";
  const destination = user?.role === "gm-sm" ? "/gm/dashboard" : isExecutive ? "/loan-executive/leads" : "/finance/dashboard";

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: "" }));
    setError("");
  };

  const validate = () => {
    const next = {};
    if (!form.currentPassword) next.currentPassword = "Current temporary password is required";
    if (score < 5) next.newPassword = "Use uppercase, lowercase, number, symbol, and minimum 8 characters";
    if (form.confirmPassword !== form.newPassword) next.confirmPassword = "Passwords do not match";
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setError("");
    try {
      await changeCurrentPassword(form);
      navigate(destination, { replace: true });
    } catch (err) {
      setError(err.code === "auth/wrong-password" || err.code === "auth/invalid-credential"
        ? "Current temporary password is incorrect."
        : err.message || "Unable to change password. Login again and retry.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{isExecutive ? "Loan Executive Security" : "Dealership Staff Security"}</p>
        <h1 className="mt-3 text-2xl font-semibold text-slate-950">Change Temporary Password</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">For security, change the temporary password issued by your {isExecutive ? "bank manager" : "dealership admin"} before opening your dashboard.</p>

        <form onSubmit={submit} className="mt-6 space-y-4" autoComplete="off" data-form-type="other">
          <PasswordInput label="Current Temporary Password" name="cls_current_temporary_password" value={form.currentPassword} onChange={(value) => update("currentPassword", value)} visible={visible.currentPassword} onToggle={() => setVisible((current) => ({ ...current, currentPassword: !current.currentPassword }))} autoComplete="off" error={fieldErrors.currentPassword} />
          <PasswordInput label="New Password" name="cls_new_private_password" value={form.newPassword} onChange={(value) => update("newPassword", value)} visible={visible.newPassword} onToggle={() => setVisible((current) => ({ ...current, newPassword: !current.newPassword }))} autoComplete="off" error={fieldErrors.newPassword} />

          <div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-[#0d47a1] transition-all" style={{ width: `${Math.max(score, 1) * 20}%` }} />
            </div>
            <p className="mt-2 text-xs font-semibold text-slate-600">Password strength: {strengthLabel(score)}</p>
          </div>

          <PasswordInput label="Confirm Password" name="cls_confirm_private_password" value={form.confirmPassword} onChange={(value) => update("confirmPassword", value)} visible={visible.confirmPassword} onToggle={() => setVisible((current) => ({ ...current, confirmPassword: !current.confirmPassword }))} autoComplete="off" error={fieldErrors.confirmPassword} />
          {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p> : null}
          <button type="submit" disabled={loading} className="flex h-11 w-full items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-semibold text-white disabled:opacity-70">
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Change Password"}
          </button>
        </form>
      </section>
    </main>
  );
}
