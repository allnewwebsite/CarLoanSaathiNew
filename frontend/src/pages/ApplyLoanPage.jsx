import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { ApplyLoanForm } from "../components/ApplyLoanForm.jsx";

export function ApplyLoanPage() {
  const location = useLocation();
  const stored = localStorage.getItem("cls_selected_car");
  const initialSelection = useMemo(() => {
    const saved = stored ? JSON.parse(stored) : {};
    return {
      ...saved,
      ...location.state,
    };
  }, [location.state, stored]);

  return (
    <main className="w-full overflow-x-hidden bg-slate-50 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-5xl">
        <p className="text-center text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Digital Loan Application</p>
        <h1 className="mt-3 break-words text-center text-3xl font-semibold leading-tight text-slate-900 md:text-4xl">
          Apply car loan online and get instant approval updates
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-center text-base leading-7 text-slate-600">Complete a guided application that submits securely through the CarLoanSaathi backend workflow.</p>
        <ApplyLoanForm initialSelection={initialSelection} />
      </div>
    </main>
  );
}
