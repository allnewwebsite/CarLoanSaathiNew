import { Award, BadgeCheck, Banknote, Building2, Car, ChevronRight, Clock3, FileCheck2, Landmark, ShieldCheck, Sparkles, Star, Users, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApplyLoanForm } from "../components/ApplyLoanForm.jsx";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { brandLogos, fallbackBanks, fallbackBrands } from "../data/catalogFallback.js";
import { calculateEmi } from "../hooks/useEmi.js";
import { api } from "../services/api.js";

const iconMap = { zap: Zap, percent: Banknote, building: Landmark, file: FileCheck2 };

const whyChoose = [
  ["Zero handling fees", "Transparent loan processing with no surprise charges.", ShieldCheck],
  ["Bank-ready cases", "Clean application data, documents, and timelines for faster sanction.", FileCheck2],
  ["Dealer network engine", "Dealer, bank partner, and admin workflows run in one operating layer.", Building2],
  ["SLA backed operations", "Round-robin assignment and status tracking keep every lead moving.", Clock3],
];

const dealerBenefits = ["Instant lead submission", "Track every customer case", "Commission and payout visibility", "Bank coordination from one dashboard"];
const bankBenefits = ["Assigned lead queue", "Accept, reject, and update cases", "SLA visibility", "Sanction document uploads"];
const faqs = [
  ["Do you charge customers?", "No. CarLoanSaathi helps process car loans with zero handling charges from customers."],
  ["How fast is approval?", "Eligible cases can receive approval updates within 24 hours depending on bank policy and documents."],
  ["Can dealers submit leads?", "Yes. Dealers can register, submit customer leads, and track approval status from their portal."],
  ["Do bank partners get a dashboard?", "Yes. Bank partners get assigned leads, SLA tracking, document actions, and case timelines."],
];

function rupee(value) {
  return `Rs. ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value || 0)}`;
}

function SectionHeader({ eyebrow, title, text }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">{eyebrow}</p>
      <h2 className="mt-2 break-words text-2xl font-semibold leading-tight text-slate-900 sm:text-3xl">{title}</h2>
      {text && <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">{text}</p>}
    </div>
  );
}

function LogoFallback({ name }) {
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-sm font-medium text-[#0d47a1]">
      {name.split(" ").map((item) => item[0]).join("").slice(0, 2)}
    </div>
  );
}

function BrandCard({ brand }) {
  const [failed, setFailed] = useState(false);
  const logo = brandLogos[brand.slug] || brand.logo;
  const shouldUseFallback = failed || !logo;
  return (
    <div className="h-full">
      <Link to={`/cars/${brand.slug}`} className="group flex h-full min-h-24 flex-col items-center justify-center rounded-lg border border-slate-200 bg-white p-3 transition hover:border-[#0d47a1]/40 hover:bg-slate-50 sm:min-h-28">
        <div className="mx-auto flex h-12 items-center justify-center sm:h-14">
          {shouldUseFallback ? <LogoFallback name={brand.name} /> : <img loading="lazy" src={logo} alt={brand.name} onError={() => setFailed(true)} className="max-h-10 max-w-24 object-contain sm:max-h-12" />}
        </div>
        <p className="mt-2 break-words text-center text-xs font-medium leading-snug text-slate-900 sm:text-sm">{brand.name}</p>
      </Link>
    </div>
  );
}

function BankCard({ bank }) {
  const [failed, setFailed] = useState(false);
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 transition hover:bg-slate-50">
      <div className="flex min-h-12 items-center justify-center rounded-md bg-slate-50 p-2">
        {failed || !bank.logo ? <LogoFallback name={bank.name} /> : <img loading="lazy" src={bank.logo} alt={bank.name} onError={() => setFailed(true)} className="max-h-10 max-w-24 object-contain" />}
      </div>
      <h3 className="mt-3 min-h-10 break-words text-center text-sm font-medium leading-tight text-slate-900">{bank.name}</h3>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <div className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-[#0d47a1]">
          {bank.interestRate || "From 7.95%"}
        </div>
        <div className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
          {bank.approvalSpeed || "Fast approval"}
        </div>
      </div>
    </article>
  );
}

export function HomePage() {
  const [brands, setBrands] = useState([]);
  const [banks, setBanks] = useState([]);
  const [content, setContent] = useState({ features: [], documents: [], testimonials: [] });
  const [loading, setLoading] = useState(true);
  const [loan, setLoan] = useState(700000);
  const [rate, setRate] = useState(8.25);
  const [tenure, setTenure] = useState(60);
  const emi = useMemo(() => calculateEmi(loan, rate, tenure), [loan, rate, tenure]);
  const totalPayment = emi * tenure;
  const totalInterest = Math.max(totalPayment - loan, 0);

  useEffect(() => {
    Promise.all([
      api.get("/brands").then((response) => setBrands(response.data?.length ? response.data : fallbackBrands)).catch(() => setBrands(fallbackBrands)),
      api.get("/banks").then((response) => setBanks(response.data?.length ? response.data : fallbackBanks)).catch(() => setBanks(fallbackBanks)),
      api.get("/home-content").then((response) => setContent(response.data)).catch(() => setContent({ features: [], documents: [], testimonials: [] })),
    ]).finally(() => setLoading(false));
  }, []);

  return (
    <main id="home" className="w-full overflow-x-hidden bg-white text-[#06152f]">
      <section className="relative overflow-hidden bg-[#071426]">
        <div className="absolute inset-0 bg-[url('/assets/cars/hero.jpeg')] bg-cover bg-center opacity-60" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,20,38,0.88)_0%,rgba(7,20,38,0.70)_50%,rgba(7,20,38,0.42)_100%)]" />
        <div className="relative mx-auto grid min-h-[560px] w-full max-w-7xl items-center gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
          <div className="text-white">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-[#9ec5ff]" /> India's smart car loan operating network
            </div>
            <h1 className="mt-5 max-w-full text-3xl font-semibold leading-tight text-white sm:text-5xl">
              Car loans approved faster with trusted banks and dealer-ready workflows.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-blue-50 sm:text-lg sm:leading-8">
              Apply online, compare partner banks, calculate EMI, and track a finance case from lead to disbursal with CarLoanSaathi.
            </p>
            <div className="mt-7 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <a href="#apply-now" className="inline-flex h-11 w-full items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white sm:w-auto sm:px-6">Apply Loan Now <ChevronRight className="ml-2 h-4 w-4" /></a>
              <a href="#emi-calculator" className="inline-flex h-11 w-full items-center justify-center rounded-md border border-white/25 bg-white/10 px-5 text-sm font-medium text-white sm:w-auto sm:px-6">Calculate EMI</a>
            </div>
            <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
              {[["24 hr", "Approval target"], ["11+", "Bank partners"], ["0", "Handling fees"]].map(([value, label]) => (
                <div key={label} className="rounded-xl border border-white/15 bg-white/10 p-4">
                  <p className="text-2xl font-semibold text-white">{value}</p>
                  <p className="mt-1 text-xs font-medium text-blue-100">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-white/30 bg-white p-5 sm:p-6">
            <div className="rounded-lg bg-white">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-600">Loan readiness score</p>
                  <p className="mt-1 text-4xl font-semibold text-slate-900">92%</p>
                </div>
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0d47a1] to-[#3f51ff] text-white">
                  <Car className="h-8 w-8" />
                </div>
              </div>
              <div className="mt-6 space-y-3">
                {["Customer details verified", "Bank partner mapped", "Documents ready for upload"].map((item) => (
                <div key={item} className="flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800">
                    <BadgeCheck className="h-5 w-5 text-emerald-600" /> {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-slate-50 px-4 py-12 sm:py-14">
        <div className="mx-auto w-full max-w-7xl px-0 sm:px-6 lg:px-8">
          <SectionHeader eyebrow="Loan Engine" title="Built for fast approvals and clean finance operations" text="A premium customer journey backed by dealer, admin, and bank partner workflows." />
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(loading ? Array.from({ length: 4 }) : content.features).map((item, index) => {
              if (loading) return <Skeleton key={index} className="h-48" />;
              const Icon = iconMap[item.icon] || Zap;
              return (
                <article key={item.title} className="rounded-lg border border-slate-200 bg-white p-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-[#0d47a1]"><Icon className="h-5 w-5" /></div>
                  <h3 className="mt-4 text-base font-semibold text-slate-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="brands" className="px-4 py-12 sm:py-14">
        <div className="mx-auto w-full max-w-7xl sm:px-6 lg:px-8">
          <SectionHeader eyebrow="Car Brands" title="Choose your car. We handle the loan." text="Explore popular brands and continue to model selection without leaving the financing journey." />
          <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
            {(loading ? Array.from({ length: 16 }) : brands).map((brand, index) => loading ? <Skeleton key={index} className="h-28 sm:h-32" /> : <BrandCard key={brand.slug} brand={brand} />)}
          </div>
        </div>
      </section>

      <section id="banks" className="bg-slate-50 px-4 py-12 sm:py-14">
        <div className="mx-auto w-full max-w-7xl sm:px-6 lg:px-8">
          <SectionHeader eyebrow="Partner Banks" title="Trusted finance partners with competitive rates" text="Compare rates, approval speeds, and coverage from leading banks and NBFC-style finance partners." />
          <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            {(loading ? Array.from({ length: 10 }) : banks).map((bank, index) => loading ? <Skeleton key={index} className="h-36" /> : <BankCard key={bank.name} bank={bank} />)}
          </div>
        </div>
      </section>

      <section id="emi-calculator" className="px-4 py-12 sm:py-14">
        <div className="mx-auto w-full max-w-7xl sm:px-6 lg:px-8">
          <SectionHeader eyebrow="EMI Calculator" title="Plan your monthly payment before you apply" />
          <div className="mt-8 grid w-full gap-5 rounded-lg border border-slate-200 bg-white p-5 sm:p-6 lg:grid-cols-[1fr_0.9fr]">
            <div className="grid gap-5">
              {[["Loan Amount", loan, setLoan], ["Interest Rate", rate, setRate], ["Tenure Months", tenure, setTenure]].map(([label, value, setter]) => (
                <label key={label} className="block text-sm font-medium text-slate-700">{label}
                  <input className="field mt-2" type="number" value={value} onChange={(e) => setter(Number(e.target.value))} />
                </label>
              ))}
            </div>
            <div className="grid gap-4">
              {[["Monthly EMI", emi], ["Total Interest", totalInterest], ["Total Payment", totalPayment]].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-[#0d47a1] p-4 text-white">
                  <p className="text-sm font-medium text-blue-100">{label}</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{rupee(value)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-slate-50 px-4 py-12 sm:py-14">
        <div className="mx-auto w-full max-w-7xl sm:px-6 lg:px-8">
          <SectionHeader eyebrow="Trust Layer" title="Why customers, dealers, and banks use CarLoanSaathi" />
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {whyChoose.map(([title, text, Icon]) => (
              <article key={title} className="rounded-lg border border-slate-200 bg-white p-5">
                <Icon className="h-6 w-6 text-[#0d47a1]" />
                <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="apply-now" className="px-4 py-12 sm:py-14">
        <div className="mx-auto w-full max-w-5xl sm:px-6 lg:px-8">
          <SectionHeader eyebrow="Apply Online" title="Complete your car loan application in guided steps" text="This form still submits through the backend API and creates a lead in Firestore." />
          <ApplyLoanForm initialSelection={{}} />
        </div>
      </section>

      <section className="bg-slate-50 px-4 py-12 sm:py-14">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-6 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
            <Users className="h-7 w-7 text-[#0d47a1]" />
            <h2 className="mt-4 text-xl font-semibold text-slate-900">Dealer benefits</h2>
            <div className="mt-5 grid gap-2">{dealerBenefits.map((item) => <p key={item} className="flex items-center gap-3 rounded-md bg-slate-50 px-3 py-2.5 text-sm font-normal text-slate-700"><BadgeCheck className="h-4 w-4 text-emerald-600" />{item}</p>)}</div>
          </div>
          <div id="bank-partner" className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
            <Landmark className="h-7 w-7 text-[#0d47a1]" />
            <h2 className="mt-4 text-xl font-semibold text-slate-900">Bank partner benefits</h2>
            <div className="mt-5 grid gap-2">{bankBenefits.map((item) => <p key={item} className="flex items-center gap-3 rounded-md bg-slate-50 px-3 py-2.5 text-sm font-normal text-slate-700"><BadgeCheck className="h-4 w-4 text-emerald-600" />{item}</p>)}</div>
          </div>
        </div>
      </section>

      <section className="px-4 py-12 sm:py-14">
        <div className="mx-auto w-full max-w-7xl sm:px-6 lg:px-8">
          <SectionHeader eyebrow="Customer Love" title="Trusted by car buyers and finance teams" />
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {content.testimonials.map((item) => (
              <article key={item.name} className="rounded-lg border border-slate-200 bg-white p-5">
                <div className="flex gap-1 text-[#f2a900]">{Array.from({ length: 5 }).map((_, index) => <Star key={index} className="h-4 w-4 fill-current" />)}</div>
                <p className="mt-5 text-sm leading-7 text-[#536173]">{item.text}</p>
                <div className="mt-6 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0d47a1] font-medium text-white">{item.name[0]}</div>
                  <div><p className="font-semibold text-slate-900">{item.name}</p><p className="text-xs font-normal text-slate-500">{item.city}</p></div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-slate-50 px-4 py-12 sm:py-14">
        <div className="mx-auto w-full max-w-5xl sm:px-6 lg:px-8">
          <SectionHeader eyebrow="FAQ" title="Everything you need before applying" />
          <div className="mt-10 grid gap-4">
            {faqs.map(([question, answer]) => (
              <details key={question} className="rounded-lg border border-slate-200 bg-white p-4">
                <summary className="cursor-pointer text-base font-medium text-slate-900">{question}</summary>
                <p className="mt-3 text-sm leading-6 text-slate-600">{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="overflow-hidden bg-white px-4 py-8 text-center">
        <p className="select-none break-words text-4xl font-semibold leading-none text-slate-900 opacity-5 md:text-6xl lg:text-7xl">
          CarLoanSaathi.com
        </p>
      </section>

      <footer className="bg-[#071426] px-4 py-12 text-white">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-9 sm:grid-cols-2 lg:grid-cols-4 lg:px-8">
          <div>
            <h3 className="text-xl font-semibold text-white">CarLoanSaathi</h3>
            <p className="mt-4 text-sm leading-7 text-blue-100">A fintech-grade car loan network connecting customers, dealers, and bank partners.</p>
          </div>
          <div><h4 className="font-semibold text-white">Trust Badges</h4><div className="mt-4 space-y-3 text-sm text-blue-100"><p>RBI compliant style workflows</p><p>Secure document handling</p><p>Firebase protected access</p></div></div>
          <div><h4 className="font-semibold text-white">Quick Links</h4><div className="mt-4 space-y-3 text-sm text-blue-100"><p>Home</p><p>Banks</p><p>EMI Calculator</p><p>Apply Now</p></div></div>
          <div><h4 className="font-semibold text-white">For Partners</h4><div className="mt-4 space-y-3 text-sm text-blue-100"><p>Dealer Registration</p><p>Bank Partner</p><p>Admin Operations</p></div></div>
        </div>
        <div className="mx-auto mt-10 flex w-full max-w-7xl flex-col justify-between gap-4 border-t border-white/10 pt-6 text-sm text-blue-100 sm:flex-row lg:px-8">
          <p>(c) 2026 CarLoanSaathi. All rights reserved.</p>
          <p className="flex items-center gap-2"><Award className="h-4 w-4" /> Built for transparent car finance.</p>
        </div>
      </footer>
    </main>
  );
}
