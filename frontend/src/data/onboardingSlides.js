import { BarChart3, Building2, ClipboardCheck, FileCheck2, Landmark, MessageSquareText, Rocket, ShieldCheck, TrendingUp, Users, Zap } from "lucide-react";

function benefits(items = []) {
  return items.map((text) => ({ text }));
}

export function onboardingSlidesFor(user) {
  const safeUser = user && typeof user === "object" ? user : {};
  const role = String(safeUser.role || "").trim().toLowerCase();
  const selectedPlan = String(safeUser.selectedPlan || safeUser.subscriptionStatus || "").trim().toLowerCase();
  const isTrial = selectedPlan.includes("trial") || selectedPlan === "";

  if (role === "bank-manager") {
    return [
      {
        eyebrow: "Bank Manager",
        title: "Welcome to CarLoanSaathi",
        message: "Welcome to India's dealership-bank connectivity platform. Manage loan workflows, dealer relationships, approvals, and case tracking from a single dashboard.",
        icon: Landmark,
        visual: "Banking workspace",
      },
      {
        eyebrow: "Features",
        title: "Everything You Need in One Dashboard",
        icon: ClipboardCheck,
        highlights: benefits(["Real-time case tracking", "Instant dealership communication", "Centralized document review", "Faster approval workflows", "Branch performance visibility", "Secure audit trail"]),
      },
      {
        eyebrow: "Benefits",
        title: "Benefits for Bank Managers",
        icon: TrendingUp,
        highlights: benefits(["Reduced manual follow-ups", "Faster loan processing", "Better branch coordination", "More visibility into pending cases", "Higher productivity", "Better customer experience"]),
      },
      {
        eyebrow: "Ready",
        title: "You Are Ready",
        message: "Start managing cases, approvals, and dealership relationships.",
        icon: Rocket,
        cta: "Enter Dashboard",
      },
    ];
  }

  if (role === "finance-desk") {
    return [
      {
        eyebrow: "Dealership",
        title: "Welcome to CarLoanSaathi",
        message: "Digitize and accelerate your entire vehicle finance workflow.",
        icon: Building2,
        visual: "Dealership finance desk",
      },
      ...(isTrial ? [{
        eyebrow: "Free Trial",
        title: "Enjoy Your 2 Month Free Trial",
        icon: Zap,
        highlights: benefits(["Full platform access", "Unlimited case management", "Bank coordination", "Real-time tracking", "No upfront commitment"]),
      }] : []),
      {
        eyebrow: "Finance Desk",
        title: "Empower Your Finance Desk",
        icon: FileCheck2,
        highlights: benefits(["Faster document handling", "Direct bank communication", "Reduced manual effort", "Faster customer approvals", "Better visibility"]),
      },
      {
        eyebrow: "Growth",
        title: "Grow Faster with CarLoanSaathi",
        icon: TrendingUp,
        highlights: benefits(["Higher loan conversion", "Faster disbursement", "Reduced turnaround time", "Improved customer experience", "Better operational control"]),
      },
      {
        eyebrow: "Ready",
        title: "Ready To Start",
        message: "Your dealership workspace is ready for faster case movement and cleaner bank coordination.",
        icon: Rocket,
        cta: "Enter Dealership Dashboard",
      },
    ];
  }

  if (role === "gm") {
    return [
      { eyebrow: "General Manager", title: "Welcome General Manager", message: "Get a live view of your dealership finance operations and keep every case moving.", icon: Users },
      { eyebrow: "Tracking", title: "Track Every Case", icon: ClipboardCheck, highlights: benefits(["Complete visibility", "Dealer performance monitoring", "Bank coordination tracking", "Escalation management"]) },
      { eyebrow: "Tools", title: "Powerful Management Tools", icon: BarChart3, highlights: benefits(["Live dashboards", "Team monitoring", "Productivity tracking", "Workflow analytics"]) },
      { eyebrow: "Efficiency", title: "Improve Operational Efficiency", icon: TrendingUp, highlights: benefits(["Faster decisions", "Better control", "Improved reporting", "Reduced bottlenecks"]) },
      { eyebrow: "Ready", title: "Enter GM Dashboard", message: "Start reviewing cases, teams, and performance from your dashboard.", icon: Rocket, cta: "Enter GM Dashboard" },
    ];
  }

  if (role === "loan-executive") {
    return [
      { eyebrow: "Loan Executive", title: "Welcome Loan Executive", message: "Your assigned cases, documents, and status updates are now organized in one digital workspace.", icon: Users },
      { eyebrow: "Benefits", title: "Designed for Loan Executives", icon: Zap, highlights: benefits(["Real-time assignments", "Faster processing", "Better visibility", "Less paperwork"]) },
      { eyebrow: "Digital Follow-Up", title: "Reduce Physical Follow-Ups", message: "No more visiting multiple dealerships manually to collect updates and documents. Everything is available digitally.", icon: MessageSquareText },
      { eyebrow: "Automation", title: "Cases Delivered Automatically", icon: ShieldCheck, highlights: benefits(["Auto case allocation", "Real-time notifications", "Faster action", "Better productivity"]) },
      { eyebrow: "Ready", title: "Enter Executive Dashboard", message: "Start processing your assigned cases with speed and clarity.", icon: Rocket, cta: "Enter Executive Dashboard" },
    ];
  }

  return [];
}
