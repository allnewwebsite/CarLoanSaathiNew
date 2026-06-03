class MemoryStorage {
  constructor() {
    this.items = new Map();
  }

  getItem(key) {
    return this.items.has(key) ? this.items.get(key) : null;
  }

  setItem(key, value) {
    this.items.set(key, String(value));
  }

  removeItem(key) {
    this.items.delete(key);
  }
}

globalThis.sessionStorage = new MemoryStorage();
globalThis.localStorage = new MemoryStorage();
globalThis.window = {
  location: { pathname: "/" },
  addEventListener: () => {},
  removeEventListener: () => {},
};

const {
  clearAuthStorage,
  getStoredToken,
  getStoredUser,
  storeAuthSession,
} = await import("../src/services/authSessionManager.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function setPath(pathname) {
  globalThis.window.location.pathname = pathname;
}

function session(email, role) {
  return { email, role, accountApproved: true, accountActive: true };
}

setPath("/finance/total-leads");
storeAuthSession(session("finance@example.com", "finance-desk"), "finance-token");
assert(getStoredToken() === "finance-token", "Finance token was not stored in finance scope.");
assert(getStoredUser()?.role === "finance-desk", "Finance user was not restored from finance scope.");

setPath("/gm/total-leads");
storeAuthSession(session("gm@example.com", "gm-sm"), "gm-token");
assert(getStoredToken() === "gm-token", "GM token was not stored in GM scope.");
assert(getStoredUser()?.role === "gm-sm", "GM user was not restored from GM scope.");

setPath("/finance/total-leads");
assert(getStoredToken() === "finance-token", "GM login overwrote finance token.");
assert(getStoredUser()?.email === "finance@example.com", "GM login overwrote finance user.");

setPath("/bank-manager/leads");
storeAuthSession(session("manager@example.com", "bank-manager"), "bank-manager-token");

setPath("/loan-executive/leads");
storeAuthSession(session("executive@example.com", "loan-executive"), "loan-executive-token");
assert(getStoredToken() === "loan-executive-token", "Loan executive token was not stored in executive scope.");

setPath("/bank-manager/leads");
assert(getStoredToken() === "bank-manager-token", "Loan executive login overwrote bank manager token.");

setPath("/loan-executive/leads");
clearAuthStorage();
assert(getStoredToken() === null, "Loan executive scoped logout did not clear executive token.");

setPath("/bank-manager/leads");
assert(getStoredToken() === "bank-manager-token", "Loan executive logout cleared bank manager token.");

setPath("/finance/total-leads");
assert(getStoredToken() === "finance-token", "Loan executive logout cleared finance token.");

console.log("Auth session isolation verification passed.");
