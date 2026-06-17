import { useEffect } from "react";
import { pageDescription, pageTitle } from "./plansBilling.data.js";

function setMeta(selector, attribute, value) {
  const element = document.head.querySelector(selector);
  if (!element) return () => {};
  const previous = element.getAttribute(attribute);
  element.setAttribute(attribute, value);
  return () => {
    if (previous === null) element.removeAttribute(attribute);
    else element.setAttribute(attribute, previous);
  };
}

export function usePlansBillingMetadata() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = pageTitle;

    const restorers = [
      setMeta('meta[name="description"]', "content", pageDescription),
      setMeta('meta[property="og:title"]', "content", pageTitle),
      setMeta('meta[property="og:description"]', "content", pageDescription),
      setMeta('meta[property="og:url"]', "content", "https://carloansaathi.com/plans-and-billing"),
    ];

    const canonical = document.createElement("link");
    canonical.rel = "canonical";
    canonical.href = "https://carloansaathi.com/plans-and-billing";
    document.head.appendChild(canonical);

    const structuredData = document.createElement("script");
    structuredData.type = "application/ld+json";
    structuredData.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "CarLoanSaathi Professional",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: pageDescription,
      offers: {
        "@type": "Offer",
        price: "15000",
        priceCurrency: "INR",
        billingDuration: "P1M",
        description: "30-day manual subscription cycle after a 60-day free trial for approved dealerships.",
      },
    });
    document.head.appendChild(structuredData);

    return () => {
      document.title = previousTitle;
      restorers.forEach((restore) => restore());
      canonical.remove();
      structuredData.remove();
    };
  }, []);
}
