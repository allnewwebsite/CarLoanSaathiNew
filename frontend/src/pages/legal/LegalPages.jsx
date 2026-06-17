import { Link } from "react-router-dom";
import { UPDATED_DATE, legalLinks, policyContent, sharedDisclosures } from "./legalContent.js";

function PolicySection({ title, paragraphs }) {
  return (
    <section className="border-b border-slate-200 py-6 last:border-b-0">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <div className="mt-3 space-y-3">
        {paragraphs.map((paragraph) => (
          <p key={paragraph} className="text-sm leading-7 text-slate-600">{paragraph}</p>
        ))}
      </div>
    </section>
  );
}

export function LegalPage({ policy }) {
  const content = policyContent[policy];
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50 px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <header className="border-b border-slate-300 pb-7">
          <p className="text-xs font-semibold uppercase text-[#0d47a1]">{content.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-950 sm:text-4xl">{content.title}</h1>
          <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">{content.summary}</p>
          <p className="mt-4 text-sm text-slate-500">Last updated: {UPDATED_DATE}</p>
        </header>

        <nav aria-label="Legal policies" className="flex flex-wrap gap-x-5 gap-y-2 border-b border-slate-200 py-4 text-sm">
          {legalLinks.map((item) => (
            <Link key={item.to} to={item.to} className={`font-medium ${item.label === content.title ? "text-[#0d47a1]" : "text-slate-600 hover:text-slate-950"}`}>
              {item.label}
            </Link>
          ))}
        </nav>

        <article className="mt-5 rounded-md border border-slate-200 bg-white px-5 sm:px-8">
          {content.sections.map((section) => <PolicySection key={section.title} {...section} />)}
          {sharedDisclosures.map((section) => <PolicySection key={section.title} {...section} />)}
          <PolicySection
            title="Policy Acceptance"
            paragraphs={[
              "Users should review all CarLoanSaathi legal policies before using the platform. Continued access or use after a policy update constitutes acceptance of the updated terms, subject to applicable law.",
            ]}
          />
        </article>

        <footer className="flex flex-col justify-between gap-3 py-7 text-sm text-slate-500 sm:flex-row">
          <p>(c) 2026 CarLoanSaathi.</p>
          <Link to="/" className="font-medium text-[#0d47a1]">Return to CarLoanSaathi</Link>
        </footer>
      </div>
    </main>
  );
}
