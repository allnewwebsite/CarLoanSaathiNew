import http from "k6/http";
import { check, fail, sleep } from "k6";
import { API_BASE_URL, BASE_URL, FIREBASE_WEB_API_KEY, RUN_ID, SAFETY, TEST_USERS, isProductionTarget, sharedTags } from "./config.js";

const jsonHeaders = {
  "Content-Type": "application/json",
  "X-Load-Test-Run": RUN_ID,
};

export function enforceReadOnlySafety() {
  if (isProductionTarget() && !SAFETY.allowProduction) {
    fail("Refusing to load-test production. Use staging, or explicitly set ALLOW_PRODUCTION_LOAD=true for a tiny smoke test.");
  }
}

export function enforceWriteSafety() {
  enforceReadOnlySafety();
  if (!SAFETY.allowWrites) {
    fail("Write scenario blocked. Set ALLOW_WRITES=true only against isolated staging data.");
  }
}

export function rawGet(path, tags = {}, token = "") {
  return http.get(`${BASE_URL}${path}`, {
    headers: {
      "X-Load-Test-Run": RUN_ID,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    tags,
    timeout: "30s",
  });
}

export function apiGet(path, token, tags = {}) {
  return http.get(`${API_BASE_URL}${path}`, {
    headers: authHeaders(token),
    tags,
    timeout: "30s",
  });
}

export function apiPost(path, body, token, tags = {}) {
  return http.post(`${API_BASE_URL}${path}`, JSON.stringify(body), {
    headers: authHeaders(token),
    tags,
    timeout: "30s",
  });
}

export function apiPatch(path, body, token, tags = {}) {
  return http.patch(`${API_BASE_URL}${path}`, JSON.stringify(body), {
    headers: authHeaders(token),
    tags,
    timeout: "30s",
  });
}

export function authHeaders(token) {
  return {
    ...jsonHeaders,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function assertOk(response, name, maxMs = 2500) {
  check(response, {
    [`${name} status < 500`]: (res) => res.status < 500,
    [`${name} status ok`]: (res) => res.status >= 200 && res.status < 300,
    [`${name} latency < ${maxMs}ms`]: (res) => res.timings.duration < maxMs,
  });
}

export function parseJson(response) {
  try {
    return response.json();
  } catch {
    return {};
  }
}

export function randomFrom(values) {
  return values[Math.floor(Math.random() * values.length)];
}

export function pause(min = 0.25, max = 2) {
  sleep(Math.random() * (max - min) + min);
}

export function firebaseEmailLogin(email, password) {
  if (!FIREBASE_WEB_API_KEY || !email || !password) return null;
  const response = http.post(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_WEB_API_KEY}`,
    JSON.stringify({ email, password, returnSecureToken: true }),
    { headers: jsonHeaders, tags: sharedTags("firebase-auth"), timeout: "30s" },
  );
  check(response, {
    "firebase auth status ok": (res) => res.status === 200,
    "firebase auth returned id token": (res) => Boolean(parseJson(res).idToken),
  });
  return parseJson(response).idToken || null;
}

export function backendLogin(idToken, portal) {
  const response = apiPost("/auth/login", { idToken, portal }, null, sharedTags("backend-auth"));
  check(response, {
    "backend login status ok": (res) => res.status === 200,
    "backend login returned token": (res) => Boolean(parseJson(res).token),
  });
  return parseJson(response).token || null;
}

export function loginAs(roleName) {
  const user = TEST_USERS[roleName];
  if (__ENV.AUTH_TOKEN) return __ENV.AUTH_TOKEN;
  if (!user?.email || !user?.password) return "";
  const idToken = firebaseEmailLogin(user.email, user.password);
  return idToken ? backendLogin(idToken, user.portal) : "";
}

export function requireToken(token, label) {
  if (!token) fail(`${label} token is missing. Provide AUTH_TOKEN or role email/password env values.`);
}

export function handleSummary(data) {
  const path = __ENV.SUMMARY_PATH || `load-tests/results/${RUN_ID}-summary.json`;
  return {
    stdout: summaryText(data),
    [path]: JSON.stringify(data, null, 2),
  };
}

function summaryText(data) {
  const duration = data.metrics.http_req_duration;
  const failed = data.metrics.http_req_failed;
  return [
    "",
    `CarLoanSaathi k6 run: ${RUN_ID}`,
    `Requests: ${data.metrics.http_reqs?.values?.count || 0}`,
    `Failed rate: ${percent(failed?.values?.rate)}`,
    `p50: ${round(duration?.values?.["p(50)"] ?? duration?.values?.med)} ms`,
    `p95: ${round(duration?.values?.["p(95)"])} ms`,
    `p99: ${round(duration?.values?.["p(99)"])} ms`,
    "",
  ].join("\n");
}

function round(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "n/a";
}

function percent(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}
