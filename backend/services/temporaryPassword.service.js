import crypto from "node:crypto";
import { jwtSecret } from "../config/env.js";

const HASH_VERSION = "scrypt-v1";
const KEY_LENGTH = 64;

function pepper() {
  return process.env.TEMP_PASSWORD_PEPPER || jwtSecret();
}

function derive(password, salt) {
  return crypto.scryptSync(String(password || ""), `${salt}:${pepper()}`, KEY_LENGTH);
}

export function hashTemporaryPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const key = derive(password, salt).toString("base64url");
  return `${HASH_VERSION}$${salt}$${key}`;
}

export function verifyTemporaryPassword(password, storedHash = "") {
  const [version, salt, expected] = String(storedHash || "").split("$");
  if (version !== HASH_VERSION || !salt || !expected) return false;
  const actual = derive(password, salt);
  const expectedBuffer = Buffer.from(expected, "base64url");
  if (actual.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actual, expectedBuffer);
}
