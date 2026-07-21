import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const middleware = fs.readFileSync(new URL("../middleware/subscription.js", import.meta.url), "utf8");
const auth = fs.readFileSync(new URL("../../frontend/src/services/apiAuth.js", import.meta.url), "utf8");
const authHelpers = fs.readFileSync(new URL("../../frontend/src/context/AuthContext.helpers.js", import.meta.url), "utf8");
const authContext = fs.readFileSync(new URL("../../frontend/src/context/AuthContextCore.jsx", import.meta.url), "utf8");
const portal = fs.readFileSync(new URL("../../frontend/src/services/apiPortal.js", import.meta.url), "utf8");

test("subscription blocking is an authenticated 403 contract", () => {
  assert.match(middleware, /authenticated: true/);
  assert.match(middleware, /subscriptionExpired: expired/);
  assert.match(middleware, /redirect: "\/subscription-activation"/);
  assert.doesNotMatch(middleware, /status\(401\)/);
});

test("subscription expiry redirects without clearing authentication", () => {
  assert.match(auth, /error\.response\?\.status === 403/);
  assert.match(auth, /SUBSCRIPTION_EXPIRED/);
  assert.match(auth, /SUBSCRIPTION_PAYMENT_REQUIRED/);
  assert.match(auth, /window\.location\.assign/);
  assert.doesNotMatch(auth, /SUBSCRIPTION_EXPIRED[\s\S]{0,500}clearAuthStorage/);
  assert.doesNotMatch(authHelpers, /"SUBSCRIPTION_EXPIRED"/);
});

test("shared activation route keeps logout events scoped to the authenticated tab", () => {
  assert.match(authContext, /getAuthScope/);
  assert.match(authContext, /const currentScope = getAuthScope\(\)/);
  assert.doesNotMatch(authContext, /const currentScope = getCurrentPortalScope\(\)/);
  assert.match(auth, /const scope = getAuthScope\(\)/);
  assert.match(auth, /publishAuthEvent\("logout", \{ scope,/);
  assert.match(portal, /storedUser\?\.loginPortal/);
  assert.match(portal, /storedUser\?\.role === "gm"/);
});
