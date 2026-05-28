import { RoleProtectedRoute } from "./RoleProtectedRoute.jsx";

export function ProtectedRoute({ roles, allowedRoles, loginPath = "/dealer/login" }) {
  return <RoleProtectedRoute allowedRoles={allowedRoles || roles || []} loginPath={loginPath} />;
}
