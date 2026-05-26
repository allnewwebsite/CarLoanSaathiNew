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
  city: cleanText(2),
  selectedBrand: cleanText(1),
  selectedModel: cleanText(1),
  carPrice: money,
  loanAmount: money,
  employmentType: cleanText(2),
  preferredBank: cleanText(2),
});

export const publicLeadSchema = publicLeadBaseSchema.refine((data) => data.loanAmount <= data.carPrice, {
  message: "Loan amount cannot be greater than car price",
  path: ["loanAmount"],
});

export const financeDeskLeadSchema = publicLeadBaseSchema.extend({
  assignedSalesperson: cleanText(1),
  remarks: z.string().trim().max(500).optional(),
  documents: z.array(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
}).refine((data) => data.loanAmount <= data.carPrice, {
  message: "Loan amount cannot be greater than car price",
  path: ["loanAmount"],
});
