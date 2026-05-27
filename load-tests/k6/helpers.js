import http from "k6/http";
import { check, sleep } from "k6";
import { API_BASE_URL, BASE_URL } from "./config.js";

export function rawGet(path, tags = {}) {
  return http.get(`${BASE_URL.replace(/\/$/, "")}${path}`, { tags });
}

export function apiGet(path, token, tags = {}) {
  return http.get(`${API_BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    tags,
  });
}

export function apiPost(path, body, token, tags = {}) {
  return http.post(`${API_BASE_URL}${path}`, JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    tags,
  });
}

export function assertOk(response, name) {
  check(response, {
    [`${name} status < 500`]: (res) => res.status < 500,
    [`${name} latency < 2s`]: (res) => res.timings.duration < 2000,
  });
}

export function pause() {
  sleep(Math.random() * 2 + 0.5);
}
