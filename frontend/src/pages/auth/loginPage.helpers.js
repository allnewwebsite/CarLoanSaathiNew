export const portals = {
  dealer: {
    eyebrow: "Dealership Portal",
    title: "DEALERSHIP LOGIN",
    subtitle: "For approved dealership owners and dealership administrators.",
    note: "Access is available only for approved dealership users.",
    registrationPath: "/dealer/register",
    authPortal: "dealer",
  },
  finance: {
    eyebrow: "Finance Head Portal",
    title: "FINANCE HEAD LOGIN",
    subtitle: "For dealership finance managers responsible for customer loan processing and bank coordination.",
    note: "Finance Head access uses the approved dealership account and remains protected by dealership RBAC.",
    registrationPath: "/finance/register",
    authPortal: "finance",
  },
  gm: {
    eyebrow: "General Manager Portal",
    title: "GM LOGIN",
    subtitle: "For dealership General Managers tracking leads, salespersons, and case status.",
    note: "GM access is issued by the dealership Finance Head.",
    registrationPath: "/finance/register",
    authPortal: "finance",
  },
  bank: {
    eyebrow: "Bank Manager Portal",
    title: "BANK MANAGER LOGIN",
    subtitle: "For approved bank branch managers managing assigned loan workflows and executives.",
    note: "Your bank role is verified securely after email/password login.",
    registrationPath: "/bank/register",
    authPortal: "bank",
  },
  executive: {
    eyebrow: "Loan Executive Portal",
    title: "LOAN EXECUTIVE LOGIN",
    subtitle: "For bank-side executives managing assigned customer loan applications.",
    note: "Loan Executive access is issued and governed by the approved bank branch manager.",
    registrationPath: "/executive/register",
    authPortal: "bank",
  },
  admin: {
    eyebrow: "Private Super Admin",
    title: "SUPER ADMIN LOGIN",
    subtitle: "Authorized CarLoanSaathi administration only.",
    note: "Only the configured Super Admin account can access this control center.",
    authPortal: "admin",
  },
};

export const workflowSteps = ["Customer", "Salesperson", "Finance Desk", "Bank", "Approval", "Disbursement"];
export const REMEMBER_PREFIX = "cls_login_memory";
export const LAST_PORTAL_KEY = "cls_last_login_portal";

export function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

export function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function rememberedLogin(portal) {
  try {
    return JSON.parse(localStorage.getItem(`${REMEMBER_PREFIX}:${portal}`) || "{}");
  } catch {
    return {};
  }
}

export function storeRememberedLogin(portal, email, rolePortal) {
  localStorage.setItem(`${REMEMBER_PREFIX}:${portal}`, JSON.stringify({
    email,
    portal,
    rolePortal,
    rememberedAt: new Date().toISOString(),
  }));
  localStorage.setItem(LAST_PORTAL_KEY, portal);
}

export function clearRememberedLogin(portal) {
  localStorage.removeItem(`${REMEMBER_PREFIX}:${portal}`);
  if (localStorage.getItem(LAST_PORTAL_KEY) === portal) localStorage.removeItem(LAST_PORTAL_KEY);
}
