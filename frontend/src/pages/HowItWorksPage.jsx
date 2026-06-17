import { useEffect } from "react";
import { HowItWorksContent } from "./howItWorks/HowItWorksContent.jsx";

export function HowItWorksPage() {
  useEffect(() => {
    const oldTitle = document.title;
    document.title = "How It Works | CarLoanSaathi";
    let meta = document.querySelector('meta[name="description"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    const oldDescription = meta.content;
    meta.content = "See how CarLoanSaathi moves a vehicle loan enquiry from dealership and secure documents to bank review, decision, and disbursement.";
    return () => {
      document.title = oldTitle;
      if (created) meta.remove();
      else meta.content = oldDescription;
    };
  }, []);

  return <HowItWorksContent />;
}
