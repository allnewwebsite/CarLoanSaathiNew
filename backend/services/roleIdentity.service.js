export function cleanIdentity(value) {
  return String(value || "").trim();
}

export function normalizedMobile(value) {
  return cleanIdentity(value).replace(/\D/g, "").slice(-10);
}

export function normalizedIdentity(value) {
  return cleanIdentity(value).toLowerCase();
}

export function uniqueIdentities(values = []) {
  return [...new Set(values.map(cleanIdentity).filter(Boolean))];
}

export function executiveIdentityValues(record = {}) {
  return uniqueIdentities([
    record.id,
    record.uid,
    record.authUid,
    record.sourceId,
    record.executiveId,
    record.employeeId,
    record.employeeCode,
    record.jobId,
    record.assignedExecutiveId,
    record.email,
    record.officialEmail,
    record.assignedExecutiveEmail,
    normalizedMobile(record.mobile),
    normalizedMobile(record.phone),
    normalizedMobile(record.assignedExecutiveMobile),
    normalizedMobile(record.executiveMobile),
  ]);
}

export function executiveNameValues(record = {}) {
  return uniqueIdentities([record.name, record.fullName, record.assignedExecutiveName]);
}

export function leadExecutiveIdentityValues(lead = {}) {
  return uniqueIdentities([
    lead.assignedExecutiveId,
    lead.assignedExecutiveEmail,
    lead.executiveEmail,
    lead.loanExecutiveId,
    lead.updatedByExecutiveId,
    lead.assignedExecutiveJobId,
    lead.employeeId,
    lead.employeeCode,
    lead.jobId,
    normalizedMobile(lead.assignedExecutiveMobile),
    normalizedMobile(lead.executiveMobile),
    normalizedMobile(lead.assignedExecutivePhone),
    normalizedMobile(lead.loanExecutiveMobile),
  ]);
}

export function valuesMatch(values = [], targets = []) {
  const targetSet = new Set(targets.map(normalizedIdentity).filter(Boolean));
  return values.some((value) => targetSet.has(normalizedIdentity(value)));
}

export function loanExecutiveMatchesLead(executive = {}, lead = {}, { allowName = true } = {}) {
  if (valuesMatch(leadExecutiveIdentityValues(lead), executiveIdentityValues(executive))) return true;
  return allowName && valuesMatch([lead.assignedExecutiveName], executiveNameValues(executive));
}

export function executiveQueryArgs(user = {}) {
  return {
    executiveId: user.uid || user.id || user.email || "",
    executiveEmail: user.email || user.officialEmail || "",
    executiveMobile: user.mobile || user.assignedExecutiveMobile || user.executiveMobile || "",
    executiveIdentities: executiveIdentityValues(user),
    executiveNames: executiveNameValues(user),
  };
}
