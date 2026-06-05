import { getRecord, upsertRecord } from "./firestore.service.js";

export const defaultWorkflowSettings = {
  id: "workflow",
  roundRobinEnabled: false,
  autoReassignmentEnabled: false,
  slaEngineEnabled: true,
  slaAcceptMinutes: 30,
  idleReassignMinutes: 240,
  escalationMinutes: 60,
  minSlaScore: 50,
  maxActiveLeadsPerPartner: 25,
  defaultCommissionPercent: 1,
  bankPayoutPercent: 0.5,
  approvalBonusPercent: 0.25,
  notificationSettings: {
    emailEnabled: false,
    pushEnabled: false,
    whatsappEnabled: true,
    provider: process.env.WHATSAPP_PROVIDER || "cloud-api",
    maxRetries: 3,
  },
  assignmentRules: {
    requireCityCoverage: true,
    requireBrandSupport: true,
    requireBankSupport: true,
    cityMapping: "",
    bankMapping: "",
  },
};

export async function getWorkflowSettings() {
  return await getRecord("settings", "workflow").catch(() => null) || defaultWorkflowSettings;
}

export async function updateWorkflowSettings(payload) {
  const current = await getWorkflowSettings();
  const next = {
    ...current,
    ...payload,
    assignmentRules: {
      ...current.assignmentRules,
      ...(payload.assignmentRules || {}),
    },
    notificationSettings: {
      ...current.notificationSettings,
      ...(payload.notificationSettings || {}),
    },
  };
  return upsertRecord("settings", "workflow", next);
}
