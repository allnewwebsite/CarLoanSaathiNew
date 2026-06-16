import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { ROLE_LOGIN_ROUTES, ROLES, dashboardPathForRole, loginPathForRole } from "../src/auth/roleSystem.js";
import { loginSmokeRoutes, protectedSmokeRoutes, publicSmokeRoutes, routeSmokeManifest } from "../src/routes/routeManifest.js";

const projectRoot = process.cwd();
const srcDir = path.join(projectRoot, "src");
const routerSource = await readFile(path.join(srcDir, "routes", "router.jsx"), "utf8");

function expectRouterPath(pathname) {
  assert.match(routerSource, new RegExp(`path:\\s*"${pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
}

test("smoke route paths are unique", () => {
  const paths = routeSmokeManifest.map((route) => route.path);
  assert.equal(new Set(paths).size, paths.length);
});

test("public and login smoke routes are present in the router", () => {
  [...publicSmokeRoutes, ...loginSmokeRoutes].forEach((route) => expectRouterPath(route.path));
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
  assert.equal(dashboardPathForRole(ROLES.SUPER_ADMIN), "/admin/leads");
});

test("route smoke modules exist on disk", async () => {
  await Promise.all(routeSmokeManifest.map((route) => (
    access(path.join(srcDir, "pages", route.module))
  )));
});
