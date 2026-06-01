import { z } from "zod";
import { ALLOWED_LEAD_STATUSES, LEAD_STATUSES } from "../utils/status.constants.js";

export const leadSchema = z.object({
  customerName: z.string().min(2),
  mobile: z.string().min(10),
  vehicleModel: z.string().min(2),
  loanAmount: z.number().positive(),
  dealershipId: z.string().optional(),
  salespersonId: z.string().optional(),
  bankPartnerId: z.string().optional(),
  status: z.enum(ALLOWED_LEAD_STATUSES).default(LEAD_STATUSES.NEW),
});

const cleanText = (min = 1) => z.string().trim().min(min).max(120);
const money = z.coerce.number().positive().finite();

const publicLeadBaseSchema = z.object({
  fullName: cleanText(2),
  mobile: z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number"),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
  city: cleanText(2),
  selectedBrand: cleanText(1),
  selectedModel: cleanText(1),
  carPrice: money.max(20000000),
  loanAmount: money.max(20000000),
  employmentType: cleanText(2),
  preferredBank: cleanText(2),
});

export const publicLeadSchema = publicLeadBaseSchema.refine((data) => data.loanAmount <= data.carPrice, {
  message: "Loan amount cannot be greater than car price",
  path: ["loanAmount"],
});

export const financeDeskLeadSchema = publicLeadBaseSchema.extend({
  // Bank branch selection - MANDATORY - updated workflow
  ifscCode: z.string()
    .trim()
    .min(11, "Invalid IFSC code")
    .max(11, "Invalid IFSC code")
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC format"),
  bankId: cleanText(1), // Required
  bankName: cleanText(1), // Required - resolved from bank master
  branchName: cleanText(1), // Required - resolved from bank master
  
  // Salesperson assignment - MANDATORY
  salespersonId: cleanText(1), // Required
  assignedSalesperson: cleanText(1), // Required
  
  // Optional fields
  remarks: z.string().trim().max(500).optional(),
  documents: z.array(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  
  // Legacy field mapping (for backward compatibility)
  bankBranchId: z.string().trim().optional(),
}).refine((data) => data.loanAmount <= data.carPrice, {
  message: "Loan amount cannot be greater than car price",
  path: ["loanAmount"],
}).refine((data) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(data.ifscCode), {
  message: "Valid IFSC code required for branch selection",
  path: ["ifscCode"],
});
