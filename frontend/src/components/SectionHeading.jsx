export function SectionHeading({ eyebrow, title, children, align = "left" }) {
  return (
    <div className={align === "center" ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2 className="mt-3 text-2xl font-semibold text-ink sm:text-3xl">{title}</h2>
      {children && <p className="mt-3 text-sm leading-6 text-muted sm:text-base">{children}</p>}
    </div>
  );
}
