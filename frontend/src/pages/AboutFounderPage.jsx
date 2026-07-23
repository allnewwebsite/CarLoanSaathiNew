import { useEffect } from "react";
import { ArrowRight, Award, Cloud, Code2, Cpu, HeartHandshake, Landmark, LockKeyhole, Radio, Rocket, ShieldCheck, Sparkles, Users, Zap } from "lucide-react";
import { Link } from "react-router-dom";

const profile = [
  ["Name", "Mohit"], ["Based in", "Bahadurgarh, Haryana"], ["Qualification", "Computer Engineering"],
  ["Company", "CarLoanSaathi"], ["Company type", "Startup"], ["Role", "Founder & CEO"], ["Profession", "Software Engineer"],
];

const platformPillars = [
  [Radio, "Real-Time Workflow", "Every case movement stays visible to the people who need to act."],
  [Users, "Multi-Role Collaboration", "Dealerships, finance desks, banks and executives work in one shared flow."],
  [Zap, "Live Notifications", "Timely updates keep teams aligned without manual chasing."],
  [ShieldCheck, "Secure Case Management", "Permissions and audit trails protect every customer journey."],
  [Landmark, "Dealership-Bank Connectivity", "A direct bridge between retail operations and lending partners."],
  [Cpu, "Scalable SaaS Architecture", "Built to grow with modern automotive finance operations."],
];

const technology = ["React", "Node.js", "Express", "Firebase", "Real-time Synchronization", "Secure Authentication", "Responsive Web Platform", "Modern Cloud Architecture"];
const values = [[HeartHandshake, "Trust"], [Sparkles, "Transparency"], [Rocket, "Innovation"], [LockKeyhole, "Security"], [Zap, "Speed"], [Award, "Customer First"]];

export function AboutFounderPage() {
  useEffect(() => {
    const previous = document.title;
    document.title = "About Founder | CarLoanSaathi";
    return () => { document.title = previous; };
  }, []);

  return (
    <main className="overflow-hidden bg-white text-slate-900">
      <section className="relative isolate px-5 pb-20 pt-16 sm:px-8 lg:px-12 lg:pb-28 lg:pt-24">
        <div className="absolute inset-x-0 top-0 -z-10 h-[34rem] bg-[radial-gradient(circle_at_15%_20%,rgba(14,165,233,.14),transparent_34%),radial-gradient(circle_at_85%_0%,rgba(251,146,60,.13),transparent_32%)]" />
        <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.05fr_.95fr]">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-4 py-2 text-xs font-bold uppercase tracking-[.18em] text-blue-700"><Sparkles className="h-4 w-4" /> Founder story</p>
            <h1 className="max-w-3xl text-5xl font-semibold leading-[1.02] tracking-[-.055em] text-slate-950 sm:text-6xl lg:text-7xl">Meet the founder behind <span className="bg-gradient-to-r from-blue-700 to-cyan-500 bg-clip-text text-transparent">CarLoanSaathi</span></h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-slate-600">Building India&apos;s most trusted digital platform connecting dealerships and banks.</p>
            <Link to="/#showcase" className="mt-9 inline-flex h-12 items-center gap-2 rounded-xl bg-blue-700 px-6 text-sm font-bold text-white shadow-lg shadow-blue-700/20 transition hover:-translate-y-0.5 hover:bg-blue-800">Explore CarLoanSaathi <ArrowRight className="h-4 w-4" /></Link>
          </div>
          <div className="relative mx-auto w-full max-w-md">
            <div className="absolute -inset-5 rounded-[2.5rem] bg-gradient-to-br from-cyan-300/30 via-blue-300/10 to-orange-300/30 blur-2xl" />
            <div className="relative overflow-hidden rounded-[2.25rem] border border-white/80 bg-white/70 p-3 shadow-2xl shadow-blue-900/10 backdrop-blur-xl">
              <div className="flex aspect-square items-center justify-center overflow-hidden rounded-[1.8rem] bg-gradient-to-br from-blue-700 via-cyan-600 to-orange-400">
                <img src="/assets/founder-mohit.jpg" alt="Mohit, Founder and CEO of CarLoanSaathi" loading="lazy" className="h-[78%] w-[78%] rounded-full border-8 border-white/80 object-cover object-center shadow-2xl" />
              </div>
              <div className="absolute bottom-8 left-8 right-8 rounded-2xl border border-white/70 bg-white/85 p-4 shadow-lg backdrop-blur"><p className="text-xs font-bold uppercase tracking-[.16em] text-blue-700">Founder &amp; CEO</p><p className="mt-1 text-xl font-semibold text-slate-950">Mohit</p><p className="text-sm text-slate-500">Software Engineer · Bahadurgarh</p></div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 py-16 sm:px-8 lg:px-12"><div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[.8fr_1.2fr]">
        <div><p className="text-sm font-bold uppercase tracking-[.18em] text-blue-700">The person behind the platform</p><h2 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">Founder profile</h2></div>
        <div className="grid gap-3 sm:grid-cols-2">{profile.map(([label, value]) => <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5"><p className="text-xs font-bold uppercase tracking-[.13em] text-slate-400">{label}</p><p className="mt-2 text-sm font-semibold leading-6 text-slate-800">{value}</p></div>)}</div>
      </div></section>

      <section className="bg-slate-950 px-5 py-20 text-white sm:px-8 lg:px-12"><div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[.75fr_1.25fr]"><div><p className="text-sm font-bold uppercase tracking-[.18em] text-cyan-300">My journey</p><h2 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Technology with a purpose.</h2></div><p className="max-w-2xl text-lg leading-8 text-slate-300">I founded CarLoanSaathi with a vision to simplify the way dealerships and banks collaborate.<br /><br />Traditional loan processing often involves delays, disconnected communication, and manual follow-ups.<br /><br />CarLoanSaathi was built to create one secure, real-time platform where dealerships, finance teams, banks, and loan executives can collaborate efficiently.<br /><br />Every workflow, permission, notification, and synchronization has been designed to improve transparency, speed, and customer experience.</p></div></section>

      <section className="px-5 py-20 sm:px-8 lg:px-12"><div className="mx-auto max-w-6xl"><div className="grid gap-6 md:grid-cols-2"><div className="rounded-3xl bg-blue-50 p-8"><p className="text-sm font-bold uppercase tracking-[.18em] text-blue-700">Mission</p><h2 className="mt-3 text-3xl font-semibold">Building India&apos;s most trusted digital platform connecting dealerships and banks.</h2></div><div className="rounded-3xl bg-orange-50 p-8"><p className="text-sm font-bold uppercase tracking-[.18em] text-orange-700">Vision</p><h2 className="mt-3 text-3xl font-semibold">Create India&apos;s most reliable digital ecosystem for dealership finance operations.</h2></div></div></div></section>

      <section className="bg-slate-50 px-5 py-20 sm:px-8 lg:px-12"><div className="mx-auto max-w-6xl"><p className="text-sm font-bold uppercase tracking-[.18em] text-blue-700">Why CarLoanSaathi</p><h2 className="mt-3 text-4xl font-semibold tracking-tight">Designed for real work, not just dashboards.</h2><div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{platformPillars.map(([Icon, title, text]) => <article key={title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg"><Icon className="h-6 w-6 text-blue-700" /><h3 className="mt-5 font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{text}</p></article>)}</div></div></section>

      <section className="px-5 py-20 sm:px-8 lg:px-12"><div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[.8fr_1.2fr]"><div><p className="text-sm font-bold uppercase tracking-[.18em] text-blue-700">Built with care</p><h2 className="mt-3 text-4xl font-semibold">Technology behind CarLoanSaathi</h2></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{technology.map((item) => <div key={item} className="flex min-h-24 items-center rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-700 shadow-sm"><Code2 className="mr-2 h-4 w-4 shrink-0 text-blue-600" />{item}</div>)}</div></div></section>

      <section className="bg-blue-700 px-5 py-20 text-white sm:px-8 lg:px-12"><div className="mx-auto max-w-6xl"><p className="text-sm font-bold uppercase tracking-[.18em] text-blue-200">Core values</p><div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{values.map(([Icon, label]) => <div key={label} className="rounded-2xl border border-white/20 bg-white/10 p-5 text-center backdrop-blur"><Icon className="mx-auto h-6 w-6" /><p className="mt-3 text-sm font-semibold">{label}</p></div>)}</div></div></section>

      <section className="px-5 py-24 text-center sm:px-8 lg:px-12"><div className="mx-auto max-w-3xl"><p className="text-sm font-bold uppercase tracking-[.18em] text-blue-700">The road ahead</p><h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Let&apos;s transform dealership finance together.</h2><p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-slate-600">A more connected, transparent and dependable finance experience starts with one conversation.</p><div className="mt-8 flex flex-wrap justify-center gap-3"><Link to="/#showcase" className="inline-flex h-12 items-center rounded-xl bg-blue-700 px-6 text-sm font-bold text-white transition hover:bg-blue-800">Explore Platform</Link><Link to="/#contact" className="inline-flex h-12 items-center rounded-xl border border-slate-300 px-6 text-sm font-bold text-slate-700 transition hover:border-blue-300 hover:text-blue-700">Contact Us</Link></div></div></section>
    </main>
  );
}
