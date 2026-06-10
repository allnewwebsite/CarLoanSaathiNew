import { useEffect } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ROLES, isKnownRole, loginPathForRole, passwordPathForRole, requiresPasswordChange } from "../auth/roleSystem.js";
import { DetailPageSkeleton } from "../components/ui/Loading.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export function RoleProtectedRoute({ allowedRoles = [], loginPath }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const fallbackLogin = loginPath || loginPathForRole(user?.role);
  const portalRoleMismatch = Boolean(!loading && user && isKnownRole(user.role) && allowedRoles.length && !allowedRoles.includes(user.role));

  useEffect(() => {
    if (!portalRoleMismatch) return;
    navigate(loginPathForRole(user.role), { replace: true, state: { reason: "portal-role-mismatch" } });
  }, [navigate, portalRoleMismatch, user?.role]);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <DetailPageSkeleton />
      </main>
    );
  }
  if (!user) return <Navigate to={fallbackLogin || "/dealer/login"} replace state={{ from: location }} />;
  if (!isKnownRole(user.role)) return <Navigate to={loginPathForRole(user.role)} replace />;
  if ([ROLES.FINANCE_DESK, ROLES.GM_SM].includes(user.role) && (user.accountApproved !== true || user.accountActive === false)) {
    return <Navigate to="/dealer-registration/pending" replace />;
  }
  if ([ROLES.BANK_MANAGER, ROLES.LOAN_EXECUTIVE].includes(user.role) && (user.accountApproved !== true || user.accountActive === false)) {
    return <Navigate to="/bank-registration/pending" replace />;
  }
  const passwordRoute = passwordPathForRole(user.role);
  const allowedPasswordRoutes = [passwordRoute, "/change-password"].filter(Boolean);
  if (requiresPasswordChange(user) && passwordRoute && !allowedPasswordRoutes.includes(location.pathname)) {
    return <Navigate to={passwordRoute} replace />;
  }
  if (portalRoleMismatch) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <DetailPageSkeleton />
      </main>
    );
  }
  return <Outlet />;
}
