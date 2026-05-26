import { SectionHeading } from "../components/SectionHeading.jsx";
import { services } from "../data/platformData.js";

export function ServicesPage() {
  return (
    <main className="container-shell py-12">
      <SectionHeading eyebrow="Loan services" title="Vehicle finance products for every dealership workflow">
        Configure leads for new cars, used cars, refinance, top-up, and commercial vehicle loans.
      </SectionHeading>
      <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {services.map((service) => (
          <article className="card p-6" key={service.title}>
            <h3 className="text-lg font-semibold text-ink">{service.title}</h3>
            <p className="mt-3 text-sm leading-6 text-muted">{service.desc}</p>
          </article>
        ))}
      </div>
    </main>
  );
}
