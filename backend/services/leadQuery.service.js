import { countRecords, queryRecords } from "./firestore.service.js";
import { paginationParams, pageResponse } from "../utils/pagination.js";
import { LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";
import { logInfo } from "./logger.service.js";

const LEAD_FIELDS = [
  "id",
  "caseId",
  "fullName",
  "customerName",
  "mobile",
  "city",
  "dealershipCity",
  "bankBranchCity",
  "branchCity",
  "routingCity",
  "preferredBank",
  "bankPartner",
  "bankName",
  "branchName",
  "selectedBankName",
  "selectedBranchName",
  "ifscCode",
  "bankIfsc",
  "bankBranchId",
  "branchId",
  "assignedBankId",
  "assignedBankName",
  "assignedBankIfsc",
  "assignedPartnerId",
  "assignedExecutiveId",
  "assignedExecutiveEmail",
  "assignedExecutiveName",
  "assignedExecutiveMobile",
  "executiveMobile",
  "salespersonId",
  "salespersonName",
  "salespersonJobId",
  "salespersonEmail",
  "assignedSalesperson",
  "financeManagerId",
  "financeManagerName",
  "financeManagerMobile",
  "financeManagerEmail",
  "financeManagerEmployeeId",
  "assignedFinanceManager",
  "carPrice",
  "carOnRoadPrice",
  "loanAmount",
  "requiredLoanAmount",
  "status",
  "rejectionReason",
  "updatedByExecutiveName",
  "rejectedBy",
  "createdAt",
  "updatedAt",
  "generatedAt",
  "generatedDate",
  "generatedTime",
  "statusUpdatedAt",
  "dealershipId",
  "dealershipEmail",
  "dealershipName",
  "dealerEmail",
  "dealerName",
  "bankId",
  "vehicleNumber",
  "registrationNumber",
  "isDeadCase",
  "deadCaseDate",
  "deadCaseBy",
  "deadCaseReason",
  "deadCaseNotes",
  "deadCaseUpdatedAt",
];

const SEARCH_FIELDS = ["caseId", "fullName", "customerName", "mobile", "vehicleNumber", "registrationNumber", "city", "bankName", "assignedBankName", "selectedBankName", "branchName", "ifscCode", "bankPartner", "assignedExecutiveName", "assignedExecutiveEmail", "assignedSalesperson", "salespersonName", "financeManagerName", "assignedFinanceManager", "deadCaseReason"];

function normalizeFinanceStatus(status) {
  const normalized = normalizeStatus(status);
  const map = {
    NEW: "New",
    CONTACTED: "Contacted",
    REQUEST_DOCUMENT: "Pending Documents",
    DOCUMENT_RECEIVED: "Document Received",
    REQUEST_PENDING_DOCUMENTS: "Pending Documents",
    ALL_DOCUMENTS_RECEIVED: "Document Received",
    UNDER_BANK_PROCESS: "Under Bank Process",
    ASSIGNED: "New",
    ACCEPTED: "Under Bank Process",
    UNDER_REVIEW: "Under Bank Process",
    DOCS_PENDING: "Pending Documents",
    APPROVED: "Under Bank Process",
    REJECTED: "Rejected",
    DISBURSED: "Disbursed",
    CLOSED: "Disbursed",
  };
  return map[normalized] || "New";
}

function localFilters(leads, query = {}) {
  const status = String(query.status || "").trim();
  const salesperson = String(query.salesperson || "").trim().toLowerCase();
  const salespersonId = String(query.salespersonId || "").trim();
  const salespersonNeedles = new Set([
    salesperson,
    salespersonId.toLowerCase(),
    String(query.salespersonName || "").trim().toLowerCase(),
    String(query.salespersonJobId || "").trim().toLowerCase(),
    String(query.salespersonEmail || "").trim().toLowerCase(),
  ].filter(Boolean));
  const bank = String(query.bank || "").trim().toLowerCase();
  const financeManager = String(query.financeManager || "").trim().toLowerCase();
  const financeManagerId = String(query.financeManagerId || "").trim();
  const financeManagerNeedles = new Set([
    financeManager,
    financeManagerId.toLowerCase(),
    String(query.financeManagerName || "").trim().toLowerCase(),
    String(query.financeManagerEmployeeId || "").trim().toLowerCase(),
    String(query.financeManagerEmail || "").trim().toLowerCase(),
  ].filter(Boolean));
  const city = String(query.city || "").trim().toLowerCase();
  const date = String(query.date || "").trim();
  return leads.filter((lead) => {
    if (lead.isDeadCase === true) return false;
    const normalizedQueryStatus = normalizeStatus(status);
    const financeStatus = normalizeFinanceStatus(lead.status);
    const leadStatus = normalizeStatus(lead.status);
    const statusOk = !status
      || financeStatus === status
      || leadStatus === normalizedQueryStatus
      || (normalizedQueryStatus === LEAD_STATUSES.NEW && financeStatus === "New");
    const salespersonOk = !salespersonNeedles.size
      || [
        lead.salespersonId,
        lead.salespersonName,
        lead.salespersonJobId,
        lead.salespersonEmail,
        lead.assignedSalesperson,
      ].some((value) => salespersonNeedles.has(String(value || "").trim().toLowerCase()));
    const financeManagerOk = !financeManagerNeedles.size
      || [
        lead.financeManagerId,
        lead.financeManagerName,
        lead.financeManagerEmployeeId,
        lead.financeManagerEmail,
        lead.assignedFinanceManager,
      ].some((value) => financeManagerNeedles.has(String(value || "").trim().toLowerCase()));
    const bankText = String(lead.assignedBankName || lead.bankName || lead.selectedBankName || lead.bankPartner || lead.preferredBank || "").toLowerCase();
    const bankOk = !bank || bankText === bank || bankText.includes(bank);
    const cityOk = !city || String(lead.city || "").toLowerCase() === city;
    const dateOk = !date || String(lead.createdAt || lead.updatedAt || "").startsWith(date);
    return statusOk && salespersonOk && financeManagerOk && bankOk && cityOk && dateOk;
  });
}

function statusValuesForQuery(status) {
  const value = String(status || "").trim();
  if (!value) return [];
  const normalized = normalizeStatus(value);
  if (normalized === LEAD_STATUSES.NEW || value === "New Lead" || value === "New") return [LEAD_STATUSES.NEW, LEAD_STATUSES.ASSIGNED];
  if (value === "Bank Processing") return [LEAD_STATUSES.CONTACTED, LEAD_STATUSES.ALL_DOCUMENTS_RECEIVED, LEAD_STATUSES.UNDER_BANK_PROCESS, LEAD_STATUSES.ACCEPTED, LEAD_STATUSES.UNDER_REVIEW];
  if (value === "Pending Documents") return [LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING];
  if (value === "Document Received") return [LEAD_STATUSES.DOCUMENT_RECEIVED, LEAD_STATUSES.ALL_DOCUMENTS_RECEIVED];
  if (value === "Under Bank Process") return [LEAD_STATUSES.UNDER_BANK_PROCESS, LEAD_STATUSES.ACCEPTED, LEAD_STATUSES.UNDER_REVIEW, LEAD_STATUSES.APPROVED];
  if (value === "Disbursed") return [LEAD_STATUSES.DISBURSED, LEAD_STATUSES.CLOSED];
  if (value === "Rejected With Reason") return [LEAD_STATUSES.REJECTED];
  return [normalized];
}

function queryWhere(baseWhere = [], query = {}) {
  const where = [...baseWhere];
  const statuses = statusValuesForQuery(query.status);
  if (statuses.length === 1) where.push({ field: "status", value: statuses[0] });
  if (statuses.length > 1 && statuses.length <= 10) where.push({ field: "status", op: "in", value: statuses });
  if (query.salespersonId) where.push({ field: "salespersonId", value: String(query.salespersonId).trim() });
  if (query.financeManagerId) where.push({ field: "financeManagerId", value: String(query.financeManagerId).trim() });
  if (query.bankId) where.push({ field: "bankId", value: String(query.bankId).trim() });
  if (query.assignedExecutiveId) where.push({ field: "assignedExecutiveId", value: String(query.assignedExecutiveId).trim() });
  if (query.city) where.push({ field: "city", value: String(query.city).trim() });
  if (query.bankName) where.push({ field: "bankName", value: String(query.bankName).trim() });
  if (query.caseId) where.push({ field: "caseId", value: String(query.caseId).trim() });
  const search = String(query.search || "").trim();
  if (/^CLS-/i.test(search)) where.push({ field: "caseId", value: search.toUpperCase() });
  if (query.dateFrom) where.push({ field: "createdAt", op: ">=", value: String(query.dateFrom).trim() });
  if (query.dateTo) where.push({ field: "createdAt", op: "<=", value: String(query.dateTo).trim() });
  return where;
}

export async function queryDealershipLeads({ dealershipId, query = {}, fields = LEAD_FIELDS, requestId = null } = {}) {
  const startedAt = Date.now();
  const { limit, cursor, page } = paginationParams(query);
  const queryStartedAt = Date.now();
  const result = await queryRecords("leads", {
    where: queryWhere([{ field: "dealershipId", value: dealershipId }], query),
    orderBy: "createdAt",
    direction: "desc",
    limit,
    cursor,
    page,
    search: /^CLS-/i.test(String(query.search || "").trim()) ? "" : query.search,
    searchFields: SEARCH_FIELDS,
    fields,
  });
  const queryEndedAt = Date.now();
  const filterStartedAt = Date.now();
  const data = localFilters(result.data, query);
  const filterEndedAt = Date.now();
  const shapeStartedAt = Date.now();
  const response = pageResponse({ data, limit, nextCursor: result.nextCursor });
  const shapeEndedAt = Date.now();
  logInfo("Dealer fallback leads shaping completed", {
    tag: "SERIALIZATION-LATENCY",
    requestId,
    function: "queryDealershipLeads",
    collection: "leads",
    queryDurationMs: queryEndedAt - queryStartedAt,
    filterDurationMs: filterEndedAt - filterStartedAt,
    responseShapeDurationMs: shapeEndedAt - shapeStartedAt,
    totalDurationMs: Date.now() - startedAt,
    inputCount: Array.isArray(result.data) ? result.data.length : 0,
    outputCount: data.length,
    statusFormattingCallCount: Array.isArray(result.data) ? result.data.length : 0,
    financeManagerLookupCount: 0,
    executiveLookupCount: 0,
    dealershipLookupCount: 0,
    documentFormattingCount: 0,
  });
  return response;
}

export async function queryBankLeads({ bankId, query = {}, fields = LEAD_FIELDS }) {
  const { limit, cursor, page } = paginationParams(query);
  const result = await queryRecords("leads", {
    where: queryWhere([{ field: "bankId", value: bankId }], query),
    orderBy: "createdAt",
    direction: "desc",
    limit,
    cursor,
    page,
    search: /^CLS-/i.test(String(query.search || "").trim()) ? "" : query.search,
    searchFields: SEARCH_FIELDS,
    fields,
  });
  const data = localFilters(result.data, query);
  return pageResponse({ data, limit, nextCursor: result.nextCursor });
}

export async function queryExecutiveLeads({ executiveId, executiveEmail, query = {}, fields = LEAD_FIELDS }) {
  const { limit, cursor, page } = paginationParams(query);
  const identity = String(executiveId || executiveEmail || "").trim();
  const email = String(executiveEmail || "").trim();
  const idQuery = queryRecords("leads", {
    where: queryWhere([{ field: "assignedExecutiveId", value: identity }], query),
    orderBy: "createdAt",
    direction: "desc",
    limit,
    cursor,
    page,
    search: /^CLS-/i.test(String(query.search || "").trim()) ? "" : query.search,
    searchFields: SEARCH_FIELDS,
    fields,
  });
  const emailQuery = email && email !== identity
    ? queryRecords("leads", {
      where: queryWhere([{ field: "assignedExecutiveEmail", value: email }], query),
      orderBy: "createdAt",
      direction: "desc",
      limit,
      cursor,
      page,
      search: /^CLS-/i.test(String(query.search || "").trim()) ? "" : query.search,
      searchFields: SEARCH_FIELDS,
      fields,
    })
    : Promise.resolve(null);
  const [idResult, emailResult] = await Promise.all([idQuery, emailQuery]);
  let rows = idResult.data;
  let nextCursor = idResult.nextCursor;
  if (emailResult) {
    const byId = new Map(rows.map((lead) => [lead.id, lead]));
    for (const lead of emailResult.data) byId.set(lead.id, lead);
    rows = [...byId.values()].sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || ""))).slice(0, limit);
    nextCursor = idResult.nextCursor || emailResult.nextCursor;
  }
  const data = localFilters(rows, query);
  return pageResponse({ data, limit, nextCursor });
}

export async function queryAllLeads({ query = {}, fields = LEAD_FIELDS }) {
  const { limit, cursor, page } = paginationParams(query);
  const where = queryWhere([], query);
  const result = await queryRecords("leads", {
    where,
    orderBy: "createdAt",
    direction: "desc",
    limit,
    cursor,
    page,
    search: /^CLS-/i.test(String(query.search || "").trim()) ? "" : query.search,
    searchFields: SEARCH_FIELDS,
    fields,
    allowGlobal: true,
  });
  return pageResponse({
    data: result.data.filter((lead) => lead.isDeadCase !== true),
    limit,
    nextCursor: result.nextCursor,
  });
}

export async function queryDeadCases({ dealershipId = "", bankId = "", executiveId = "", salespersonId = "", query = {}, fields = LEAD_FIELDS } = {}) {
  const { limit, cursor, page } = paginationParams(query);
  const where = [{ field: "isDeadCase", value: true }];
  if (dealershipId) where.push({ field: "dealershipId", value: dealershipId });
  if (bankId) where.push({ field: "bankId", value: bankId });
  if (executiveId) where.push({ field: "assignedExecutiveId", value: executiveId });
  if (salespersonId) where.push({ field: "salespersonId", value: salespersonId });
  if (query.status) where.push({ field: "status", value: normalizeStatus(query.status) });
  if (query.deadCaseReason) where.push({ field: "deadCaseReason", value: String(query.deadCaseReason).trim() });
  const result = await queryRecords("leads", {
    where,
    orderBy: "deadCaseDate",
    direction: "desc",
    limit,
    cursor,
    page,
    search: query.search,
    searchFields: SEARCH_FIELDS,
    fields,
    maxLimit: 100,
    allowGlobal: !dealershipId && !bankId && !executiveId && !salespersonId,
  });
  const bankIdentity = String(bankId || "").trim().toLowerCase();
  const executiveIdentity = String(executiveId || "").trim().toLowerCase();
  const salespersonIdentity = String(salespersonId || "").trim().toLowerCase();
  const matchesScopedIdentity = (lead = {}) => {
    const same = (values, expected) => !expected || values.some((value) => String(value || "").trim().toLowerCase() === expected);
    return same([lead.bankId, lead.assignedBankId, lead.bankPartnerId, lead.bankEmail, lead.assignedBankEmail], bankIdentity)
      && same([lead.assignedExecutiveId, lead.assignedExecutiveEmail, lead.executiveEmail, lead.loanExecutiveId], executiveIdentity)
      && same([lead.salespersonId, lead.salespersonEmail, lead.salespersonMobile, lead.salespersonJobId, lead.assignedSalesperson], salespersonIdentity);
  };
  return pageResponse({
    data: result.data.filter((lead) => lead.isDeadCase === true && matchesScopedIdentity(lead)),
    limit,
    nextCursor: result.nextCursor,
  });
}

export async function countOpenExecutiveLeads(executiveId) {
  if (!executiveId) return 0;
  const openStatuses = [
    LEAD_STATUSES.NEW,
    LEAD_STATUSES.CONTACTED,
    LEAD_STATUSES.REQUEST_DOCUMENT,
    LEAD_STATUSES.DOCUMENT_RECEIVED,
    LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS,
    LEAD_STATUSES.ALL_DOCUMENTS_RECEIVED,
    LEAD_STATUSES.UNDER_BANK_PROCESS,
    LEAD_STATUSES.ASSIGNED,
    LEAD_STATUSES.ACCEPTED,
    LEAD_STATUSES.UNDER_REVIEW,
    LEAD_STATUSES.DOCS_PENDING,
  ];
  const chunks = [];
  for (let index = 0; index < openStatuses.length; index += 10) {
    chunks.push(openStatuses.slice(index, index + 10));
  }
  const counts = await Promise.all(chunks.map((statuses) => countRecords("leads", {
    where: [
      { field: "assignedExecutiveId", value: executiveId },
      { field: "status", op: "in", value: statuses },
      { field: "isDeadCase", value: false },
    ],
  })));
  return counts.reduce((sum, count) => sum + Number(count || 0), 0);
}
