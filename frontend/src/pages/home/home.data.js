import {
  BadgeCheck,
  Building2,
  CheckCircle2,
  FileCheck2,
  FileText,
  Landmark,
  LayoutDashboard,
  LockKeyhole,
  MessageCircle,
  Network,
  PhoneCall,
  ShieldCheck,
  Table2,
  Users,
} from "lucide-react";

export const heroMetrics = [
  ["1,284", "Active cases", "+18% flow"],
  ["Live", "Realtime updates", "No refresh"],
  ["86", "Bank branches", "Coordinated"],
  ["99.2%", "Visibility", "Audit ready"],
];

export const workflowCards = [
  ["Dealer", "Creates and tracks dealership finance cases", Building2],
  ["Finance", "Validates documents and coordinates bank movement", Users],
  ["Bank", "Receives assigned cases with branch ownership", Landmark],
  ["Executive", "Updates field status and document requirements", BadgeCheck],
  ["Disbursement", "Keeps final movement visible to permitted roles", FileCheck2],
];

export const showcaseCards = [
  {
    title: "Finance Dashboard",
    description: "A live finance desk for cases, teams, documents, and bank tie-ups.",
    icon: LayoutDashboard,
    accent: "from-sky-500 to-blue-600",
    stats: ["247 cases", "18 pending docs", "12 bank tie-ups"],
  },
  {
    title: "Bank Dashboard",
    description: "Branch-level case queues, executive assignment, and status oversight.",
    icon: Landmark,
    accent: "from-blue-600 to-indigo-600",
    stats: ["96 assigned", "31 in review", "14 decisions"],
  },
  {
    title: "Executive Dashboard",
    description: "Focused case lists for loan executives with clear next actions.",
    icon: Users,
    accent: "from-cyan-500 to-sky-600",
    stats: ["38 active", "9 follow-ups", "6 uploads"],
  },
  {
    title: "Operations Dashboard",
    description: "Governance visibility across approvals, status movement, and operations.",
    icon: ShieldCheck,
    accent: "from-slate-700 to-blue-700",
    stats: ["Role checks", "Audit logs", "Portal isolation"],
  },
];

export const trustSignals = [
  ["Role Based Access", "Every portal opens only the role scope assigned to that user.", LockKeyhole],
  ["Portal Isolation", "Dealer, bank, executive, and finance surfaces stay separated.", ShieldCheck],
  ["Audit Logs", "Operational movement remains traceable for governance review.", FileCheck2],
  ["Workflow Visibility", "Teams see case movement without changing the underlying process.", Network],
  ["Secure Operations", "Access, approvals, and status handling remain controlled end to end.", CheckCircle2],
];

export const platformRows = [
  ["CLS-2048", "Verna SX", "Bank review", "HDFC - Pune", "18 min"],
  ["CLS-2054", "Creta", "Docs requested", "SBI - Jaipur", "32 min"],
  ["CLS-2061", "Baleno", "Disbursal queued", "Axis - Delhi", "8 min"],
];

export const dealershipBenefits = [
  ["Track every case easily", "See all active, pending, approved, rejected, and disbursed cases from one secure dashboard."],
  ["No more manual status chasing", "Finance teams no longer need repeated calls or WhatsApp follow-ups to know where a case stands."],
  ["Manage salespersons and finance staff", "Add, remove, and monitor salespersons and finance staff with clear role-based visibility."],
  ["Move beyond Excel sheets", "Keep dealership finance data organized in one platform instead of scattered files and manual registers."],
  ["Meeting-ready case status", "Open the dashboard during reviews and immediately see every case status, team workload, and bank movement."],
  ["Secure dealership data", "Customer case data, documents, status, and workflow history stay protected inside controlled portals."],
];

export const bankBenefits = [
  ["All car loan cases in one place", "Receive dealership cases through one platform instead of depending on scattered branch or field follow-ups."],
  ["Know every executive's workload", "Track loan executive details, assigned cases, pending actions, and status movement from the bank portal."],
  ["Continuous case inflow", "Keep receiving cases even when a specific executive is not physically present at a dealership."],
  ["No more manual status calls", "Branch managers can see case progress directly instead of asking teams for repeated updates."],
  ["Reduce dealership dependency", "Executives do not need to sit across different dealerships just to collect or follow up on cases."],
  ["Clear branch performance view", "See case volume, movement, and outcomes in one place for faster operational decisions."],
];

export const journeyStages = [
  ["Customer", "Case created"],
  ["Dealership", "Finance desk reviews"],
  ["Bank Branch", "Branch receives"],
  ["Loan Executive", "Field action"],
  ["Disbursed", "Journey complete"],
];

export const lifecycleStatuses = ["Created", "Assigned", "Documents Pending", "Approved", "Disbursed"];

export const animatedKpis = [
  ["Total Cases", 1284, "from all dealerships"],
  ["Approved", 418, "ready for next action"],
  ["Pending", 173, "needs attention"],
  ["Disbursed", 296, "completed cases"],
  ["Finance Managers", 42, "active users"],
  ["Bank Branches", 86, "connected partners"],
];

export const notificationFeed = [
  ["Case Assigned", "CLS-1024 moved to HDFC Pune"],
  ["Document Uploaded", "Bank statement received"],
  ["Status Updated", "Documents pending review"],
  ["Approved", "CLS-1024 approved by branch"],
  ["Disbursed", "Final disbursement marked"],
];

export const comparisonBefore = [
  ["Excel", Table2],
  ["WhatsApp", MessageCircle],
  ["Phone Calls", PhoneCall],
  ["Manual Tracking", FileText],
];

export const comparisonAfter = [
  ["Centralized Platform", LayoutDashboard],
  ["Case Visibility", Network],
  ["Role-Based Access", LockKeyhole],
  ["Workflow Management", CheckCircle2],
];
