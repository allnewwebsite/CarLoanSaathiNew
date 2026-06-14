export const CONVERSION_EVENTS = Object.freeze({
  FREE_TRIAL: "free_trial_button_click",
  PROFESSIONAL_PLAN: "professional_plan_button_click",
  CONTACT_SALES: "contact_sales_click",
});

export function trackConversionEvent(eventName, location) {
  if (typeof window === "undefined") return;

  const detail = {
    event: eventName,
    cta_location: location,
    page_path: window.location.pathname,
    timestamp: new Date().toISOString(),
  };

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(detail);
  window.dispatchEvent(new CustomEvent("carloansaathi:conversion", { detail }));
}
