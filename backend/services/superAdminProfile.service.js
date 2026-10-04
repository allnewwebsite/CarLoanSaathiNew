export const SUPER_ADMIN_ROLE = "super-admin";

function normalized(value = "") {
  return String(value || "").trim();
}

function normalizedEmail(value = "") {
  return normalized(value).toLowerCase();
}

function firstText(...values) {
  return values.map(normalized).find(Boolean) || "";
}

export function superAdminProfileTarget(authUser) {
  const uid = normalized(authUser?.uid);
  const email = normalizedEmail(authUser?.email);
  if (!uid || !email) throw new Error("The configured Firebase Authentication user must have both a UID and email.");
  return { uid, email };
}

export function assertCompatibleSuperAdminProfile(profile, authUser) {
  if (!profile) return;
  const { uid, email } = superAdminProfileTarget(authUser);
  const profileUid = normalized(profile.uid || profile.authUid);
  const profileEmail = normalizedEmail(profile.email);
  const role = normalized(profile.role);

  if (profileUid && profileUid !== uid) throw new Error("The canonical users document has a different Firebase UID; refusing to overwrite it.");
  if (profileEmail && profileEmail !== email) throw new Error("The canonical users document has a different email; refusing to overwrite it.");
  if (role && role !== SUPER_ADMIN_ROLE) throw new Error("The canonical users document belongs to a different role; refusing to grant Super Admin access.");
}

export function buildSuperAdminProfilePatch({ authUser, existingProfile = {}, configuredName = "", configuredMobile = "" } = {}) {
  assertCompatibleSuperAdminProfile(existingProfile, authUser);
  const { uid, email } = superAdminProfileTarget(authUser);
  const name = firstText(existingProfile.name, existingProfile.fullName, configuredName, authUser.displayName, "Super Admin");
  const mobile = firstText(existingProfile.mobile, configuredMobile);
  const desired = {
    uid,
    email,
    name,
    fullName: firstText(existingProfile.fullName, name),
    mobile,
    role: SUPER_ADMIN_ROLE,
    approved: true,
    active: true,
    accountStatus: "active",
    accountApproved: true,
    accountActive: true,
    emailVerified: authUser.emailVerified === true,
    dealershipId: null,
    bankId: null,
    canonical: true,
  };

  return Object.fromEntries(
    Object.entries(desired).filter(([key, value]) => existingProfile[key] !== value),
  );
}

export function isActiveSuperAdminProfile(profile = {}, authUser) {
  const { uid, email } = superAdminProfileTarget(authUser);
  return normalized(profile.uid) === uid
    && normalizedEmail(profile.email) === email
    && profile.role === SUPER_ADMIN_ROLE
    && profile.approved === true
    && profile.active === true
    && profile.accountApproved === true
    && profile.accountActive === true
    && profile.accountStatus === "active"
    && profile.canonical === true;
}
