import { useEffect, useId, useMemo, useRef, useState } from "react";
import { LogOut, MoreVertical, UserRound, X } from "lucide-react";

const ROLE_LABELS = {
  "super-admin": "Super Admin",
  "finance-desk": "Finance Desk",
  "gm": "General Manager",
  "bank-manager": "Bank Manager",
  "loan-executive": "Loan Executive",
};

function valueFrom(user, ...keys) {
  for (const key of keys) {
    const value = user?.profile?.[key] ?? user?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return "";
}

function displayValue(value) {
  return value === undefined || value === null || String(value).trim() === "" ? "Not provided" : String(value);
}

function mobileValue(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const mobile = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return mobile.length === 10 ? `+91 ${mobile}` : displayValue(value);
}

function dateValue(value) {
  if (!value) return "Not provided";
  const seconds = typeof value === "object" ? value.seconds ?? value._seconds : null;
  const date = new Date(seconds ? Number(seconds) * 1000 : value);
  if (Number.isNaN(date.getTime())) return displayValue(value);
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function profileRows(user) {
  const commonStatus = displayValue(valueFrom(user, "status", "accountStatus") || (user?.active === false ? "Inactive" : "Active"));
  const createdAt = dateValue(valueFrom(user, "createdAt", "registeredAt", "approvedAt"));

  if (user?.role === "super-admin") {
    return [
      ["Name", displayValue(valueFrom(user, "name", "fullName", "displayName") || "Super Admin")],
      ["Email", displayValue(user.email)],
      ["Mobile", mobileValue(valueFrom(user, "mobile", "phone", "officialMobile"))],
      ["Role", ROLE_LABELS[user.role]],
      ["Created Date", createdAt],
    ];
  }

  if (["finance-desk", "gm"].includes(user?.role)) {
    return [
      ["Dealership Name", displayValue(valueFrom(user, "dealershipName", "dealerName"))],
      ["Owner Name", displayValue(valueFrom(user, "ownerName", "ownerFullName", "fullName", "name"))],
      ["Email", displayValue(valueFrom(user, "officialEmail", "email"))],
      ["Mobile", mobileValue(valueFrom(user, "officialMobile", "officialDealershipMobile", "mobile", "ownerMobile"))],
      ["GST Number", displayValue(valueFrom(user, "gstin", "gstNumber"))],
      ["Address", displayValue(valueFrom(user, "address", "fullAddress"))],
      ["City", displayValue(valueFrom(user, "city", "dealerCity"))],
      ["State", displayValue(valueFrom(user, "state"))],
      ["Created Date", createdAt],
      ["Status", commonStatus],
    ];
  }

  if (user?.role === "bank-manager") {
    return [
      ["Manager Name", displayValue(valueFrom(user, "managerName", "name", "fullName", "contactPerson"))],
      ["Bank Name", displayValue(valueFrom(user, "bankName", "companyName"))],
      ["Branch", displayValue(valueFrom(user, "branchName", "bankBranchLocation", "branchLocation", "city"))],
      ["IFSC Code", displayValue(valueFrom(user, "bankIfsc", "ifsc", "ifscCode"))],
      ["Official Email", displayValue(valueFrom(user, "officialEmail", "email"))],
      ["Mobile Number", mobileValue(valueFrom(user, "officialMobile", "mobile", "phone"))],
      ["Address", displayValue(valueFrom(user, "address", "fullAddress"))],
      ["City", displayValue(valueFrom(user, "city", "bankBranchLocation"))],
      ["State", displayValue(valueFrom(user, "state"))],
      ["Created Date", createdAt],
      ["Status", commonStatus],
    ];
  }

  if (user?.role === "loan-executive") {
    return [
      ["Executive Name", displayValue(valueFrom(user, "executiveName", "name", "fullName"))],
      ["Employee ID", displayValue(valueFrom(user, "employeeId", "employeeCode"))],
      ["Email", displayValue(valueFrom(user, "officialEmail", "email"))],
      ["Mobile Number", mobileValue(valueFrom(user, "mobile", "phone"))],
      ["Assigned Branch", displayValue(valueFrom(user, "branchName", "bankBranchLocation", "branch", "city"))],
      ["Assigned Bank", displayValue(valueFrom(user, "bankName"))],
      ["Status", commonStatus],
      ["Created Date", createdAt],
    ];
  }

  return [
    ["Email", displayValue(user?.email)],
    ["Role", displayValue(ROLE_LABELS[user?.role] || user?.role)],
    ["Status", commonStatus],
  ];
}

export function DashboardDetailsModal({ open, onClose, title = "Profile Information", subtitle = "", rows = [] }) {
  const titleId = useId();
  const modalRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const focusable = [...(modalRef.current?.querySelectorAll("button:not([disabled])") || [])];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus?.();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={modalRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-[min(88vh,760px)] w-full max-w-2xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#0d47a1] text-white">
              <UserRound className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold text-slate-950">{title}</h2>
              {subtitle ? <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p> : null}
            </div>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close profile" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[calc(min(88vh,760px)-9rem)] overflow-y-auto px-5 py-5 sm:px-6">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label} className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                <dt className="text-xs font-medium uppercase text-slate-500">{label}</dt>
                <dd className="mt-1 break-words text-sm font-semibold leading-6 text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <footer className="flex justify-end border-t border-slate-200 bg-slate-50 px-5 py-3 sm:px-6">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}

export function PortalUserMenu({ user, onLogout }) {
  const menuId = useId();
  const containerRef = useRef(null);
  const firstItemRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const rows = useMemo(() => profileRows(user), [user]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    firstItemRef.current?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          aria-label="Open account menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={() => setMenuOpen((value) => !value)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
        >
          <MoreVertical className="h-5 w-5" />
        </button>

        {menuOpen ? (
          <div id={menuId} role="menu" className="absolute right-0 top-11 z-50 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
            <button
              ref={firstItemRef}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setProfileOpen(true);
              }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <UserRound className="h-4 w-4 text-slate-500" />
              Profile
            </button>
            <div className="my-1 border-t border-slate-100" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onLogout();
              }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium text-red-700 hover:bg-red-50"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        ) : null}
      </div>
      <DashboardDetailsModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        title="Profile Information"
        subtitle={`${ROLE_LABELS[user?.role] || "Account"} registration details`}
        rows={rows}
      />
    </>
  );
}
