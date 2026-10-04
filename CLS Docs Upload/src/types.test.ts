import { CANONICAL_DOCUMENT_TYPES, documentName, leadName, leadVehicle, responseData } from "./types";

test("normalizes customer and vehicle display values", () => {
  expect(leadName({ id: "1", fullName: "  Rahul Kumar " })).toBe("Rahul Kumar");
  expect(leadVehicle({ id: "1", selectedBrand: "Hyundai", vehicleModel: "Creta" })).toBe("Hyundai Creta");
  expect(documentName({ documentType: "PAN", status: "Uploaded" })).toBe("PAN");
});

test("uses the canonical finance desk customer document catalog from the backend/web workflow", () => {
  expect(CANONICAL_DOCUMENT_TYPES).toEqual([
    "Aadhaar",
    "PAN",
    "Salary Slip",
    "ITR",
    "Bank Statement",
    "Electricity Bill",
    "Rent Agreement",
    "Form 16",
    "Other Document",
  ]);
});

test("accepts both legacy and enveloped backend responses", () => {
  expect(responseData({ data: { id: "lead-1" } })).toEqual({ id: "lead-1" });
  expect(responseData({ id: "lead-2" })).toEqual({ id: "lead-2" });
});
