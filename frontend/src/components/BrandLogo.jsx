export const BRAND_LOGO_SRC = "/assets/favicon.png";

export function BrandLogo({ className = "", imageClassName = "", alt = "CarLoanSaathi logo" }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden ${className}`}>
      <img
        src={BRAND_LOGO_SRC}
        alt={alt}
        className={`block h-full w-full object-contain ${imageClassName}`}
        decoding="async"
      />
    </span>
  );
}
