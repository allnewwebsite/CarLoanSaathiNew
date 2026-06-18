import {
  APPROVAL_LIST_FIELDS,
  APPROVAL_LIST_PROJECTION_FIELDS,
  approvalStatusOf,
  cached,
  countRecords,
  pendingApprovalStatus,
  queryRecords,
  safeDealershipApprovalRecord,
  today,
} from "./adminShared.controller.js";

export async function dealershipApprovalListPayload({ status, search, query }) {
  const page = await queryRecords("pendingDealershipApprovals", {
    ...(status ? { where: [{ field: "status", value: status }] } : {}),
    orderBy: "createdAt",
    direction: "desc",
    limit: query.limit || 100,
    maxLimit: 100,
    cursor: query.cursor || null,
    fields: APPROVAL_LIST_PROJECTION_FIELDS,
  });
  const requests = page.data.filter((item) => {
    const statusOk = !status || String(item.status || "").toLowerCase() === status;
    const typeOk = (item.accountType || item.type || "dealership") === "dealership";
    const text = [item.id, item.dealershipName, item.dealershipBrand, item.city, item.loginEmail, item.status, item.dealership?.authorizedDealerCode].filter(Boolean).join(" ").toLowerCase();
    return typeOk && statusOk && (!search || text.includes(search));
  }).map(safeDealershipApprovalRecord);
  const meta = await cached("admin:approvals:dealerships:meta", 30000, async () => {
    const [logsPage, dealershipCount] = await Promise.all([
      queryRecords("approvalLogs", {
        where: [{ field: "entityType", value: "dealership" }],
        orderBy: "createdAt",
        direction: "desc",
        limit: 100,
        maxLimit: 100,
        fields: ["id", "entityType", "newStatus", "createdAt", "approvedAt"],
      }),
      countRecords("dealerships"),
    ]);
    const logs = logsPage.data;
    return {
      approvedToday: logs.filter((item) => item.newStatus === "approved" && today(item.createdAt || item.approvedAt)).length,
      rejectedToday: logs.filter((item) => item.newStatus === "rejected" && today(item.createdAt)).length,
      activeDealerships: dealershipCount,
    };
  });
  return {
    data: requests,
    nextCursor: page.nextCursor,
    hasMore: Boolean(page.nextCursor),
    meta: {
      pending: requests.filter((item) => item.status === "pending").length,
      ...meta,
    },
  };
}

export async function bankApprovalListPayload({ status, search, query }) {
  const page = await queryRecords("pendingBankApprovals", {
    ...(status && status !== "pending" ? { where: [{ field: "status", value: status }] } : {}),
    orderBy: "updatedAt",
    direction: "desc",
    limit: query.limit || 100,
    maxLimit: 100,
    cursor: query.cursor || null,
    fields: APPROVAL_LIST_FIELDS,
  });
  const requests = page.data.filter((item) => {
    const itemStatus = approvalStatusOf(item);
    const statusOk = status === "pending" ? pendingApprovalStatus(item) : itemStatus === status;
    const typeOk = (item.accountType || item.type || "bank") === "bank";
    const text = [item.id, item.bankName, item.companyName, item.bankBranchLocation, item.branchLocation, item.ifsc, item.managerName, item.mobile, item.email, item.status].filter(Boolean).join(" ").toLowerCase();
    return typeOk && statusOk && (!search || text.includes(search));
  });
  return { data: requests, nextCursor: page.nextCursor, hasMore: Boolean(page.nextCursor) };
}
