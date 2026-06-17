import {
  Activity,
  BadgeCheck,
  BarChart3,
  BellRing,
  ClipboardCheck,
  FileCheck2,
  FileText,
  Gauge,
  Landmark,
  LayoutDashboard,
  MessageCircleMore,
  Network,
  Search,
  ShieldCheck,
  TrendingUp,
  UserRoundCheck,
  Users,
  Workflow,
  Zap,
} from "lucide-react";

export const pageTitle = "CarLoanSaathi Plans & Billing";
export const pageDescription =
  "Automotive loan workflow platform for dealerships and banks. 60-day free trial. \u20B915,000/month + GST. Real-time tracking, document management, and workflow automation.";

export const featureGroups = [
  {
    title: "Lead Management",
    icon: ClipboardCheck,
    accent: "bg-blue-50 text-blue-700",
    features: ["Unlimited Leads", "Lead Tracking", "Lead Timeline", "Lead Search", "Lead Status Monitoring", "Case History"],
  },
  {
    title: "Workflow Management",
    icon: Workflow,
    accent: "bg-violet-50 text-violet-700",
    features: ["Salesperson Workflow", "Finance Desk Workflow", "Loan Executive Workflow", "Bank Workflow", "Case Reassignment", "Activity Tracking"],
  },
  {
    title: "Document Management",
    icon: FileCheck2,
    accent: "bg-amber-50 text-amber-700",
    features: ["Document Upload", "Document Tracking", "Document Verification Workflow", "Secure Storage"],
  },
  {
    title: "Analytics",
    icon: BarChart3,
    accent: "bg-emerald-50 text-emerald-700",
    features: ["Dashboard Analytics", "Executive Performance", "Lead Performance", "Branch Performance", "Real-Time Metrics"],
  },
  {
    title: "Communication",
    icon: BellRing,
    accent: "bg-cyan-50 text-cyan-700",
    features: ["WhatsApp Notifications", "Real-Time Updates", "Activity Logs", "Alerts"],
  },
];

export const dealershipBenefits = [
  ["Faster Loan Processing", "Track every customer loan application from enquiry to disbursement.", Zap],
  ["Better Visibility", "Know exactly where every customer case stands.", Gauge],
  ["Reduced Manual Follow-Ups", "Minimize calls, spreadsheets, and repetitive coordination.", MessageCircleMore],
  ["Centralized Operations", "Manage salespersons, finance teams, and loan workflows in one place.", LayoutDashboard],
  ["Improved Customer Experience", "Provide customers with faster updates and smoother processing.", UserRoundCheck],
  ["Scalable Growth", "Works for small dealerships and large dealership groups.", TrendingUp],
];

export const bankBenefits = [
  ["Structured Lead Flow", "Receive organized dealership-originated cases.", Network],
  ["Faster Documentation", "Reduce delays caused by incomplete paperwork.", FileText],
  ["Case Tracking", "Track progress from submission to disbursement.", Search],
  ["Better Coordination", "Improve communication between dealership and banking teams.", Users],
  ["Operational Efficiency", "Reduce manual effort and operational bottlenecks.", Activity],
  ["Audit Trail", "Maintain visibility into every action and status update.", ShieldCheck],
];

export const workflowStages = [
  ["Customer", "Loan enquiry begins", Users],
  ["Salesperson", "Creates the customer case", UserRoundCheck],
  ["Finance Desk", "Reviews and coordinates", ClipboardCheck],
  ["Loan Executive", "Processes documents", FileCheck2],
  ["Bank", "Makes the loan decision", Landmark],
  ["Outcome", "Disbursed or rejected", BadgeCheck],
];

export const faqs = [
  ["Is there a free trial?", "Yes. Every approved dealership receives a 60-day free trial."],
  ["Is there any setup fee?", "No. There is no setup fee."],
  ["Are there any hidden charges?", "No. The subscription price and applicable GST are shown clearly."],
  ["Is billing monthly?", "Yes. Each paid subscription cycle is 30 days."],
  ["Is renewal automatic?", "No. Renewal is manual and there is no auto-renewal."],
  ["What happens after expiry?", "New lead creation is disabled until renewal. Existing leads, documents, and analytics remain accessible, with no data loss."],
  ["Can multiple dealership branches use the platform?", "Yes. Each dealership requires its own subscription."],
  [
    "Does CarLoanSaathi provide loans?",
    "No. CarLoanSaathi is a workflow and loan-tracking platform. Loan approvals, rejections, and disbursements are handled by participating financial institutions.",
  ],
];

export const legalLinks = [
  ["Terms & Conditions", "/terms"],
  ["Privacy Policy", "/privacy"],
  ["Refund Policy", "/refund-policy"],
  ["Subscription Policy", "/subscription-policy"],
];
