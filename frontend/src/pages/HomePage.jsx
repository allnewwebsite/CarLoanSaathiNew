import { Building2, CheckCircle2, Landmark, Phone } from "lucide-react";
import { Link } from "react-router-dom";
import { bankBenefits, dealershipBenefits, showcaseCards, trustSignals, workflowCards } from "./home/home.data.js";
import { HomeHero, PortalLink } from "./home/HomeHero.jsx";
import { EnterpriseAutomationSection, SectionHeader, ShowcaseMock } from "./home/HomePageParts.jsx";
export function HomePage() {
  return (
    <main id="home" className="w-full overflow-x-hidden bg-white text-slate-950">
      <HomeHero />

      <section id="about" className="px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div className="public-fade-in">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">About CarLoanSaathi</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.03em] text-slate-950 sm:text-4xl">
              A professional operating layer between dealerships and banks.
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              ["Case Tracking", "See where a case stands across permitted operational roles."],
              ["Bank Coordination", "Keep branch ownership, executive movement, and decisions visible."],
              ["Dealership Operations", "Help finance desks manage cases, teams, and bank tie-ups."],
              ["Governance Ready", "Preserve workflow visibility, audit trails, and access boundaries."],
            ].map(([title, text]) => (
              <article key={title} className="rounded-[1.5rem] border border-slate-200 bg-white p-5 public-soft-shadow public-fade-in">
                <h3 className="text-base font-semibold text-slate-950">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white px-4 pb-16 sm:px-6 sm:pb-20 lg:px-8">
        <div className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-2">
          <article id="dealerships" className="rounded-[2rem] border border-slate-200 bg-gradient-to-br from-white to-blue-50 p-7 public-soft-shadow public-fade-in">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-700 text-white">
              <Building2 className="h-6 w-6" />
            </div>
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">Benefits for Dealerships</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-slate-950">Run dealership finance without Excel, repeated calls, or status confusion.</h2>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              CarLoanSaathi gives dealership owners and finance heads one convenient, advanced, easy-to-operate workspace for cases, salespersons, finance staff, and bank movement.
            </p>
            <div className="mt-6 grid gap-3">
              {dealershipBenefits.map(([title, text]) => (
                <div key={title} className="flex items-start gap-3 rounded-2xl bg-white px-4 py-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{title}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article id="banks" className="rounded-[2rem] border border-emerald-100 bg-gradient-to-br from-white to-emerald-50 p-7 public-soft-shadow public-fade-in">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white">
              <Landmark className="h-6 w-6" />
            </div>
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-600">Benefits for Banks</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-slate-950">Receive more cases with less field dependency and clearer executive control.</h2>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              Banks get one branch workspace to receive dealership cases, track loan executives, monitor status, and keep case flow moving continuously.
            </p>
            <div className="mt-6 grid gap-3">
              {bankBenefits.map(([title, text]) => (
                <div key={title} className="flex items-start gap-3 rounded-2xl bg-white px-4 py-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{title}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>

      <EnterpriseAutomationSection />

      <section id="showcase" className="bg-slate-50 px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto w-full max-w-7xl">
          <SectionHeader
            eyebrow="Product Showcase"
            title="Dashboards for every operational role."
            text="A premium public preview of the platform experience without loading portal data or calling internal APIs."
          />
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {showcaseCards.map((card) => (
              <ShowcaseMock key={card.title} card={card} />
            ))}
          </div>
        </div>
      </section>

      <section id="workflow" className="px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto w-full max-w-7xl">
          <SectionHeader
            eyebrow="Workflow Overview"
            title="Dealer to disbursement, visualized in one connected flow."
            text="The public website now shows the platform motion clearly while keeping the actual internal workflow unchanged."
          />
          <div className="mt-12 grid gap-4 lg:grid-cols-5">
            {workflowCards.map(([title, text, Icon], index) => (
              <article key={title} className="relative rounded-[1.5rem] border border-slate-200 bg-white p-5 public-soft-shadow public-fade-in">
                {index < workflowCards.length - 1 && (
                  <div className="absolute -right-4 top-1/2 z-10 hidden h-px w-8 bg-gradient-to-r from-blue-300 to-transparent lg:block" />
                )}
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
                  <Icon className="h-6 w-6" />
                </div>
                <p className="mt-5 text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">Step {index + 1}</p>
                <h3 className="mt-2 text-xl font-semibold text-slate-950">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="trust" className="bg-[linear-gradient(135deg,#eff6ff_0%,#ffffff_48%,#f8fafc_100%)] px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto w-full max-w-7xl">
          <SectionHeader
            eyebrow="Enterprise Trust"
            title="Built around controlled access and operational confidence."
            text="The design highlights the production-grade qualities dealership owners and bank teams need to trust the platform."
          />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
            {trustSignals.map(([title, text, Icon]) => (
              <article key={title} className="rounded-[1.5rem] border border-white bg-white/85 p-5 public-glass public-fade-in">
                <Icon className="h-6 w-6 text-blue-700" />
                <h3 className="mt-4 text-base font-semibold text-slate-950">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="contact" className="px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto w-full max-w-7xl overflow-hidden rounded-[2rem] bg-slate-950 p-8 text-white public-premium-shadow lg:p-10">
          <div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-200">Explore CarLoanSaathi</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">Ready to modernize your dealership loan operations?</h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-blue-100">
                Approved teams can continue through their dedicated portal to manage dealership-to-bank workflows.
              </p>
            </div>
          </div>
          <div className="mt-9 border-t border-white/10 pt-7">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Already registered? Continue through your portal.</p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <PortalLink to="/dealer/login" label="Dealer Login" variant="dealer" />
              <PortalLink to="/bank/login" label="Bank Login" variant="bank" />
              <PortalLink to="/finance/login" label="Dealership Head Login" variant="head" />
              <PortalLink to="/executive/login" label="Loan Executive Login" variant="executive" />
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 text-sm text-slate-500">
          <div className="flex flex-col justify-between gap-4 sm:flex-row">
            <p>(c) 2026 CarLoanSaathi. Dealer-bank connectivity for controlled loan workflow management.</p>
            <p className="flex items-center gap-2"><Phone className="h-4 w-4" /> Platform access managed by operations.</p>
          </div>
          <nav aria-label="Legal policies" className="flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-100 pt-5">
            <Link to="/terms" className="hover:text-slate-900">Terms & Conditions</Link>
            <Link to="/privacy" className="hover:text-slate-900">Privacy Policy</Link>
            <Link to="/refund-policy" className="hover:text-slate-900">Refund Policy</Link>
            <Link to="/subscription-policy" className="hover:text-slate-900">Subscription Policy</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}

