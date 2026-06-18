export function dealerRegistrationFromResponse(response, credential, selectedPlan) {
  return {
    registrationId: response.data.registrationId || null,
    uid: credential.user.uid,
    email: response.data.email || credential.user.email,
    status: response.data.status,
    approvalStatus: response.data.approvalStatus || response.data.status,
    accountState: response.data.accountState || null,
    emailVerified: response.data.emailVerified === true,
    registrationSubmitted: response.data.registrationSubmitted,
    message: response.data.message,
    redirectTo: response.data.redirectTo || "/dealer-registration/form",
    selectedPlan: response.data.selectedPlan || selectedPlan,
  };
}

export function dealerRegistrationStatusFromResponse(response, currentUser) {
  return {
    registrationId: response.data.registrationId || null,
    uid: currentUser.uid,
    email: response.data.email || currentUser.email,
    status: response.data.status,
    approvalStatus: response.data.approvalStatus || response.data.status,
    accountState: response.data.accountState || null,
    emailVerified: response.data.emailVerified === true,
    registrationSubmitted: response.data.registrationSubmitted,
    accountApproved: response.data.accountApproved === true,
    accountActive: response.data.accountActive === true,
    message: response.data.message,
    redirectTo: response.data.redirectTo || "/dealer-registration/form",
  };
}

export function bankRegistrationFromResponse(response, credential) {
  return {
    registrationId: response.data.registrationId || null,
    uid: credential.user.uid,
    email: response.data.email || credential.user.email,
    status: response.data.status,
    approvalStatus: response.data.approvalStatus || response.data.status,
    accountState: response.data.accountState || null,
    emailVerified: response.data.emailVerified === true,
    registrationSubmitted: response.data.registrationSubmitted,
    message: response.data.message,
    redirectTo: response.data.redirectTo || "/bank-registration/form",
  };
}

export function bankRegistrationStatusFromResponse(response, currentUser) {
  return {
    registrationId: response.data.registrationId || null,
    uid: currentUser.uid,
    email: response.data.email || currentUser.email,
    status: response.data.status,
    approvalStatus: response.data.approvalStatus || response.data.status,
    accountState: response.data.accountState || null,
    emailVerified: response.data.emailVerified === true,
    registrationSubmitted: response.data.registrationSubmitted,
    accountApproved: response.data.accountApproved === true,
    accountActive: response.data.accountActive === true,
    message: response.data.message,
    redirectTo: response.data.redirectTo || "/bank-registration",
  };
}
