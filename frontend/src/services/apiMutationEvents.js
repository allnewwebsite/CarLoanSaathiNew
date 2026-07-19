const DATA_MUTATION_CHANNEL = "cls_data_mutation_v1";
const DATA_MUTATION_STORAGE_KEY = "cls_data_mutation_event_v1";

function isLeadMutationUrl(url = "") {
  const path = String(url || "");
  return path.startsWith("/bank/leads/")
    || path.startsWith("/dealer/leads")
    || path.startsWith("/gm/leads")
    || path.startsWith("/documents/");
}

function leadMutationMetadata(data = {}) {
  const payload = data?.lead && typeof data.lead === "object" ? data.lead : data;
  return {
    leadId: payload?.leadId || payload?.id || payload?.sourceId || "",
    caseId: payload?.caseId || "",
    status: payload?.status || payload?.leadStatus || "",
    dealershipId: payload?.dealershipId || payload?.dealershipEmail || payload?.dealerEmail || "",
    bankId: payload?.bankId || payload?.assignedBankId || payload?.assignedPartnerId || "",
    executiveId: payload?.assignedExecutiveId || payload?.updatedByExecutiveId || "",
    executiveEmail: payload?.assignedExecutiveEmail || "",
  };
}

export function createApiMutationEvents({ invalidateGetCache, requestPortalHeader }) {
  let dataMutationChannel = null;
  let dataMutationListenersReady = false;
  let lastRemoteMutationKey = "";
  const dataMutationSource = (() => {
    if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  })();

  function invalidateLeadCaches() {
    [
      "/bank/leads",
      "/bank/analytics",
      "/dealer/leads",
      "/gm/leads",
      "/timeline",
      "/notifications",
    ].forEach((prefix) => invalidateGetCache({ prefix, purge: true }));
    invalidateGetCache({ prefix: "/bank/dealerships", purge: true });
    invalidateGetCache({ prefix: "/dashboard", purge: true });
  }

  function dispatchDataMutation(payload) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("cls:data-mutated", {
      detail: payload,
    }));
  }

  function handleRemoteDataMutation(payload) {
    if (typeof window === "undefined" || !payload || payload.source === dataMutationSource) return;
    const mutationKey = `${payload.source || ""}:${payload.at || ""}:${payload.canonicalUrl || payload.url || ""}`;
    if (mutationKey === lastRemoteMutationKey) return;
    lastRemoteMutationKey = mutationKey;
    if (payload.kind === "lead") invalidateLeadCaches();
    else invalidateGetCache();
    dispatchDataMutation({ ...payload, remote: true });
  }

  function setupDataMutationListeners() {
    if (typeof window === "undefined" || dataMutationListenersReady) return;
    dataMutationListenersReady = true;
    try {
      if ("BroadcastChannel" in window) {
        dataMutationChannel = new BroadcastChannel(DATA_MUTATION_CHANNEL);
        dataMutationChannel.onmessage = (event) => handleRemoteDataMutation(event.data);
      }
    } catch {
      dataMutationChannel = null;
    }
    window.addEventListener("storage", (event) => {
      if (event.key !== DATA_MUTATION_STORAGE_KEY || !event.newValue) return;
      try {
        handleRemoteDataMutation(JSON.parse(event.newValue));
      } catch {
        // Cross-tab refresh is best-effort.
      }
    });
  }

  function emitDataMutation(url = "", data = {}) {
    if (typeof window === "undefined") return;
    setupDataMutationListeners();
    const leadMutation = isLeadMutationUrl(url);
    const payload = {
      url,
      canonicalUrl: leadMutation ? "/lead-mutation" : url,
      kind: leadMutation ? "lead" : "generic",
      ...(leadMutation ? leadMutationMetadata(data) : {}),
      at: Date.now(),
      source: dataMutationSource,
      portal: requestPortalHeader(),
    };
    dispatchDataMutation(payload);
    try {
      dataMutationChannel?.postMessage(payload);
    } catch {
      // BroadcastChannel is optional.
    }
    try {
      window.localStorage?.setItem(DATA_MUTATION_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Storage events are optional.
    }
  }

  function handleMutationResponse(response) {
    if (["get", "head", "options"].includes(String(response.config?.method || "get").toLowerCase())) return;
    const url = String(response.config?.url || "");
    let shouldEmitMutation = false;
    if (isLeadMutationUrl(url)) {
      invalidateLeadCaches();
      shouldEmitMutation = true;
    } else if (url.startsWith("/bank/")) {
      invalidateGetCache({ prefix: "/bank/" });
      shouldEmitMutation = true;
    } else if (url.startsWith("/dealer/")) {
      invalidateGetCache({ prefix: "/dealer/" });
      shouldEmitMutation = true;
    } else if (url.startsWith("/gm/")) {
      invalidateGetCache({ prefix: "/gm/" });
      shouldEmitMutation = true;
    } else if (url.startsWith("/admin/")) {
      invalidateGetCache({ prefix: "/admin/" });
      shouldEmitMutation = true;
    } else if (url.startsWith("/notifications")) {
      invalidateGetCache({ prefix: "/notifications" });
    } else {
      invalidateGetCache();
    }
    if (shouldEmitMutation) emitDataMutation(url, response.data);
  }

  setupDataMutationListeners();

  return {
    handleMutationResponse,
    invalidateLeadCaches,
  };
}
