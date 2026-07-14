import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeBankDealershipRows } from "../services/projectionBankDealership.service.js";

function canonicalLoader(rows) {
  return async (_collection, ids) => rows.filter((row) => ids.includes(row.id));
}

test("bank dealership labels use only canonical registration identity", async () => {
  const registrations = [{
    id: "dealer@example.com",
    dealershipName: "ABC Hyundai",
    city: "Karnal",
    officialDealershipMobile: "9999999999",
  }];
  const rows = await canonicalizeBankDealershipRows([{
      id: "bank-view-1",
      dealershipId: "dealer@example.com",
      dealershipName: "Hanuman",
      dealerName: "Finance Manager Hanuman",
      financeManagerName: "Hanuman",
      city: "Employee City",
      totalCases: 12,
    }], { loadDealerships: canonicalLoader(registrations) });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].dealershipName, "ABC Hyundai");
    assert.equal(rows[0].city, "Karnal");
    assert.equal(rows[0].dealerMobile, "9999999999");
    assert.equal(rows[0].totalCases, 12);
    assert.notEqual(rows[0].dealershipName, rows[0].financeManagerName);
});

test("canonical rename is reflected and deleted dealerships are excluded", async () => {
  const projection = { id: "bank-view-1", dealershipId: "dealer@example.com", dealershipName: "Old Employee Name" };
  const rows = await canonicalizeBankDealershipRows([projection, { ...projection, id: "duplicate-view" }], {
    loadDealerships: canonicalLoader([{ id: "dealer@example.com", dealershipName: "Renamed Motors" }]),
  });
  assert.deepEqual(rows.map((row) => row.dealershipName), ["Renamed Motors"]);
  assert.deepEqual(await canonicalizeBankDealershipRows([projection], { loadDealerships: canonicalLoader([]) }), []);
});
