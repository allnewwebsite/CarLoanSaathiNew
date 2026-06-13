import { ChevronDown, Landmark, Menu, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Outlet } from "react-router-dom";

const customerNav = [
  { label: "Home", to: "/#home" },
  { label: "Features", to: "/#showcase" },
  { label: "Plans & Billing", to: "/plans-and-billing" },
  { label: "About", to: "/#about" },
  { label: "Contact", to: "/#contact" },
];

const roleGroups = [
  {
    key: "dealerships",
    label: "For Dealerships",
    icon: Users,
    items: [
      { label: "Dealer Registration", to: "/dealer/register", description: "Create an approved dealership account." },
    ],
  },
  {
    key: "banks",
    label: "For Banks",
    icon: Landmark,
    items: [
      { label: "Bank Registration", to: "/bank/register", description: "Register a branch for approval." },
    ],
  },
];

function NavTarget({ item, className = "", onClick }) {
  if (item.to.includes("#")) {
    return (
      <a href={item.to} onClick={onClick} className={className}>
        {item.label}
      </a>
    );
  }
  return (
    <Link to={item.to} onClick={onClick} className={className}>
      {item.label}
    </Link>
  );
}

function RoleDropdown({ group, open, onOpen, onClose }) {
  const Icon = group.icon;
  return (
    <div className="relative" onMouseEnter={onOpen} onMouseLeave={onClose}>
      <button
        type="button"
        className="inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 hover:text-[#0d47a1] focus:outline-none focus:ring-2 focus:ring-[#0d47a1]/30"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? onClose() : onOpen())}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          if (event.key === "ArrowDown") onOpen();
        }}
      >
        <Icon className="h-4 w-4" />
        {group.label}
        <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      <div
        className={`absolute right-0 top-11 w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10 transition duration-150 ${
          open ? "visible translate-y-0 opacity-100" : "invisible -translate-y-1 opacity-0"
        }`}
        role="menu"
      >
        <p className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          {group.label}
        </p>
        <div className="grid gap-1">
          {group.items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={onClose}
              className="rounded-md px-3 py-2.5 transition hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
              role="menuitem"
            >
              <span className="block text-sm font-semibold text-slate-900">{item.label}</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-500">{item.description}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function MobileSection({ title, items, open, onToggle, onNavigate }) {
  return (
    <section className="border-b border-slate-100 py-2">
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-md px-2 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500"
        onClick={onToggle}
        aria-expanded={open}
      >
        {title}
        <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      <div className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="min-h-0">
          <nav className="grid gap-1 pb-2">
            {items.map((item) => (
              <NavTarget
                key={item.to}
                item={item}
                onClick={onNavigate}
                className="rounded-md px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:text-[#0d47a1]"
              />
            ))}
          </nav>
        </div>
      </div>
    </section>
  );
}

export function PublicLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState("");
  const [mobileSections, setMobileSections] = useState({ platform: true, dealerships: false, banks: false });
  const headerRef = useRef(null);

  useEffect(() => {
    const close = (event) => {
      if (headerRef.current && !headerRef.current.contains(event.target)) setOpenGroup("");
    };
    const escape = (event) => {
      if (event.key === "Escape") {
        setOpenGroup("");
        setMobileOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-white">
      <header ref={headerRef} className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 public-nav-blur">
        <div className="mx-auto grid h-14 w-full max-w-7xl grid-cols-[auto_auto] items-center gap-3 px-4 sm:h-16 sm:px-6 lg:grid-cols-[auto_1fr_auto] lg:px-8">
          <Link to="/#home" className="flex min-w-0 items-center gap-3">
            <img src="/assets/favicon.png" alt="CarLoanSaathi logo" className="h-9 w-9 shrink-0 object-contain" />
            <span className="truncate text-base font-semibold leading-none sm:text-lg">
              <span className="text-[#08736d]">CarLoan</span><span className="text-[#b45309]">Saathi</span>
            </span>
          </Link>

          <nav className="hidden items-center justify-center gap-1 lg:flex" aria-label="Platform navigation">
            {customerNav.map((item) => (
              <NavTarget key={item.to} item={item} className="rounded-md px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 hover:text-[#0d47a1]" />
            ))}
          </nav>

          <div className="hidden items-center justify-end gap-1 lg:flex" aria-label="Business portal navigation">
            {roleGroups.map((group) => (
              <RoleDropdown
                key={group.key}
                group={group}
                open={openGroup === group.key}
                onOpen={() => setOpenGroup(group.key)}
                onClose={() => setOpenGroup("")}
              />
            ))}
          </div>

          <button
            type="button"
            className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-800 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-[#071426]/55 transition-opacity" onClick={() => setMobileOpen(false)} aria-label="Close menu overlay" />
          <aside className="absolute right-0 top-0 h-full w-[86vw] max-w-sm overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-xl transition-transform">
            <div className="flex items-center justify-between">
              <p className="min-w-0 truncate text-lg font-semibold"><span className="text-[#08736d]">CarLoan</span><span className="text-[#b45309]">Saathi</span></p>
              <button className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-900" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
            </div>
            <div className="mt-6">
              <MobileSection
                title="Platform"
                items={customerNav}
                open={mobileSections.platform}
                onToggle={() => setMobileSections((current) => ({ ...current, platform: !current.platform }))}
                onNavigate={() => setMobileOpen(false)}
              />
              {roleGroups.map((group) => (
                <MobileSection
                  key={group.key}
                  title={group.label.replace("For ", "")}
                  items={group.items}
                  open={mobileSections[group.key]}
                  onToggle={() => setMobileSections((current) => ({ ...current, [group.key]: !current[group.key] }))}
                  onNavigate={() => setMobileOpen(false)}
                />
              ))}
            </div>
          </aside>
        </div>
      )}
      <Outlet />
    </div>
  );
}
