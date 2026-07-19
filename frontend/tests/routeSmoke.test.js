import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { ROLE_LOGIN_ROUTES, ROLES, dashboardPathForRole, loginPathForRole, passwordPathForRole } from "../src/auth/roleSystem.js";
import {
  loginSmokeRoutes,
  passwordSmokeRoutes,
  protectedSmokeRoutes,
  publicSmokeRoutes,
  registrationLifecycleRoutes,
  routeSmokeManifest,
} from "../src/routes/routeManifest.js";

const projectRoot = process.cwd();
const srcDir = path.join(projectRoot, "src");
const routerSource = await readFile(path.join(srcDir, "routes", "router.jsx"), "utf8");

function expectRouterPath(pathname) {
  assert.match(routerSource, new RegExp(`path:\\s*"${pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
}

function expectNestedRouterPath(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  const parent = `/${segments.slice(0, -1).join("/")}`;
  const child = segments.at(-1);
  expectRouterPath(parent);
  assert.match(routerSource, new RegExp(`path:\\s*"${child.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
}

test("smoke route paths are unique", () => {
  const paths = routeSmokeManifest.map((route) => route.path);
  assert.equal(new Set(paths).size, paths.length);
});

test("public and login smoke routes are present in the router", () => {
  [...publicSmokeRoutes, ...loginSmokeRoutes].forEach((route) => expectRouterPath(route.path));
});

test("registration lifecycle routes are present in the router", () => {
  registrationLifecycleRoutes.forEach((route) => expectRouterPath(route.path));
});

test("protected smoke routes have expected role login contracts", () => {
  protectedSmokeRoutes.forEach((route) => {
    assert.equal(loginPathForRole(route.role), route.loginPath);
    assert.equal(ROLE_LOGIN_ROUTES[route.role], route.loginPath);
  });
  assert.equal(dashboardPathForRole(ROLES.FINANCE_DESK), "/finance/total-leads");
  assert.equal(dashboardPathForRole(ROLES.GM), "/gm/total-leads");
  assert.equal(dashboardPathForRole(ROLES.BANK_MANAGER), "/bank-manager/leads");
  assert.equal(dashboardPathForRole(ROLES.LOAN_EXECUTIVE), "/loan-executive/leads");
  assert.equal(dashboardPathForRole(ROLES.SUPER_ADMIN), "/admin/dealerships");
});

test("forced first-login password routes are present for staff roles", () => {
  passwordSmokeRoutes.forEach((route) => {
    assert.equal(passwordPathForRole(route.role), route.path);
    expectNestedRouterPath(route.path);
  });
  expectRouterPath("/change-password");
});

test("route smoke modules exist on disk", async () => {
  await Promise.all(routeSmokeManifest.map((route) => (
    access(path.join(srcDir, "pages", route.module))
  )));
});

test("super admin dealership approval labels and realtime filters stay aligned", async () => {
  const layoutSource = await readFile(path.join(srcDir, "layouts", "DashboardLayout.config.js"), "utf8");
  const dashboardSource = await readFile(path.join(srcDir, "pages", "dashboard", "SuperAdminDashboard.jsx"), "utf8");
  const partsSource = await readFile(path.join(srcDir, "pages", "dashboard", "superAdmin", "SuperAdminParts.jsx"), "utf8");
  const dataSource = await readFile(path.join(srcDir, "pages", "dashboard", "superAdmin", "useAdminPanelData.js"), "utf8");
  const hooksSource = await readFile(path.join(srcDir, "pages", "dashboard", "superAdmin", "superAdmin.hooks.js"), "utf8");

  [layoutSource, dashboardSource, partsSource].forEach((source) => {
    assert.equal(source.includes("Pending Dealerships"), true);
    assert.equal(source.includes("Pending Approval Dealerships"), false);
  });
  assert.equal(dataSource.includes("adminPlatformMutationFilter"), true);
  assert.equal(hooksSource.includes("adminPlatformMutationFilter"), true);
  assert.equal(hooksSource.includes("\"/admin/approvals\""), true);
  assert.equal(hooksSource.includes("\"/dealers\""), true);
  assert.equal(hooksSource.includes("\"/banks\""), true);
});
