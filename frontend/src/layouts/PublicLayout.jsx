import { Menu, X } from "lucide-react";
import { useState } from "react";
import { Link, Outlet } from "react-router-dom";

const navItems = [
  { label: "Home", to: "/#home" },
  { label: "Banks", to: "/#banks" },
  { label: "EMI Calculator", to: "/#emi-calculator" },
  { label: "Apply Loan", to: "/#apply-now" },
  { label: "Dealer Registration", to: "/dealer-registration" },
  { label: "Bank Registration", to: "/bank-registration" },
  { label: "Dealer Login", to: "/dealer-login" },
  { label: "Bank Login", to: "/bank-login" },
];

export function PublicLayout() {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-white">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6 lg:px-8">
          <Link to="/#home" className="flex items-center gap-3">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-[#0d47a1]">
              <span className="absolute -top-1 h-4 w-7 rounded-t-lg border-2 border-[#ff6b4a] bg-white" />
              <span className="mt-3 h-4 w-8 rounded-md bg-white" />
              <span className="absolute bottom-2 left-2 h-1.5 w-1.5 rounded-full bg-[#ff6b4a]" />
              <span className="absolute bottom-2 right-2 h-1.5 w-1.5 rounded-full bg-[#ff6b4a]" />
            </span>
            <span className="text-base font-semibold leading-none sm:text-lg">
              <span className="text-[#08736d]">CarLoan</span><span className="text-[#d86508]">Saathi</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-5 lg:flex">
            {navItems.map((item) => (
              <a key={item.to} href={item.to} className="text-sm font-medium text-slate-700 transition hover:text-[#0d47a1]">
                {item.label}
              </a>
            ))}
          </nav>
          <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-800 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-[#071426]/55" onClick={() => setOpen(false)} aria-label="Close menu overlay" />
          <aside className="absolute right-0 top-0 h-full w-[80vw] max-w-xs overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-xl transition-transform">
            <div className="flex items-center justify-between">
              <p className="min-w-0 truncate text-lg font-semibold"><span className="text-[#08736d]">CarLoan</span><span className="text-[#d86508]">Saathi</span></p>
              <button className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-900" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
            </div>
            <nav className="mt-8 grid gap-2">
              {navItems.map((item) => (
                <a key={item.to} href={item.to} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-[#0d47a1]">
                  {item.label}
                </a>
              ))}
            </nav>
          </aside>
        </div>
      )}
      <Outlet />
    </div>
  );
}
