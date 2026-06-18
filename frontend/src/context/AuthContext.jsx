import * as core from "./AuthContextCore.jsx";

export function AuthProvider(...args) {
  return core.AuthProvider(...args);
}
export function useAuth(...args) {
  return core.useAuth(...args);
}
