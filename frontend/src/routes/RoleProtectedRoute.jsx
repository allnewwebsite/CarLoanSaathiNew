import { Navigate, Outlet, useLocation } from "react-router-dom";
import { ROLES, isKnownRole, loginPathForRole, passwordPathForRole, requiresPasswordChange } from "../auth/roleSystem.js";
import { DetailPageSkeleton } from "../components/ui/Loading.jsx";
import { useAuth } from "../context/AuthContext.jsx";

export function RoleProtectedRoute({ allowedRoles = [], loginPath }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const fallbackLogin = loginPath || loginPathForRole(user?.role);
  const portalRoleMismatch = Boolean(!loading && user && isKnownRole(user.role) && allowedRoles.length && !allowedRoles.includes(user.role));

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <DetailPageSkeleton />
      </main>
    );
  }
  if (!user) return <Navigate to={fallbackLogin || "/dealer/login"} replace state={{ from: location }} />;
  if (!isKnownRole(user.role)) return <Navigate to={loginPathForRole(user.role)} replace />;
  if ([ROLES.FINANCE_DESK, ROLES.GM].includes(user.role) && (user.accountApproved !== true || user.accountActive === false)) {
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
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4 sm:p-6">
        <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-950">Portal access denied</h1>
          <p className="mt-2 text-sm text-slate-600">
            This portal is isolated from your current session. Open the matching portal explicitly to continue.
          </p>
        </section>
      </main>
    );
  }
  return <Outlet />;
}
