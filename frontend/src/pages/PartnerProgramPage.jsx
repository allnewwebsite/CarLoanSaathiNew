import { Button } from "../components/Button.jsx";
import { SectionHeading } from "../components/SectionHeading.jsx";

const programs = [
  { title: "Join as dealership", body: "Run the dealership finance desk, manage salespersons internally, and send complete files to banks." },
  { title: "Join as bank partner", body: "Process assigned dealer cases, request documents, approve or reject, and mark disbursements." },
];

export function PartnerProgramPage() {
  return (
    <main className="container-shell py-12">
      <SectionHeading eyebrow="Partner program" title="A shared operating layer for auto finance growth">
        Bring dealership finance desks, CarLoanSaathi operations, and bank partners into one controlled workflow.
      </SectionHeading>
      <div className="mt-8 grid gap-5 md:grid-cols-2">
        {programs.map((program) => (
          <article className="card p-6" key={program.title}>
            <h3 className="text-lg font-semibold text-ink">{program.title}</h3>
            <p className="mt-3 text-sm leading-6 text-muted">{program.body}</p>
            <Button to={program.title.includes("bank") ? "/bank-registration" : "/dealer-registration"} variant="brand" className="mt-5 w-full">Apply now</Button>
          </article>
        ))}
      </div>
    </main>
  );
}
