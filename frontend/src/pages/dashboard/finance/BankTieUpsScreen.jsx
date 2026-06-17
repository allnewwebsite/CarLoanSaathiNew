import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ButtonSpinner } from "../../../components/ui/Loading.jsx";
import { mutationUrlMatches, useBackgroundRefresh } from "../../../hooks/useRealtimeRefresh.js";
import { api, getCachedGetData } from "../../../services/api.js";
import { cleanText, display } from "../financeDesk.helpers.js";
import { SectionTitle } from "./FinanceDeskPanelParts.jsx";

const tieUpMutationFilter = (detail) => mutationUrlMatches(detail, ["/dealer/bank-tieups"]);

function bankKey(branch) {
  return branch.ifscCode || branch.id || "";
}

function mergeBranchesByKey(...groups) {
  const merged = new Map();
  groups.flat().filter(Boolean).forEach((branch) => {
    const key = bankKey(branch);
    if (!key) return;
    const existing = merged.get(key);
    merged.set(key, { ...branch, ...existing });
  });
  return [...merged.values()];
}

function BranchListSkeleton({ rows = 6 }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="grid min-w-[900px] grid-cols-[44px_1.3fr_1fr_1fr_1fr_1fr_130px] gap-3 border-b border-slate-100 px-3 py-3 last:border-b-0">
          <span className="h-4 w-4 animate-pulse rounded bg-slate-200" />
          <span className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
          <span className="h-4 w-3/4 animate-pulse rounded bg-slate-200/85" />
          <span className="h-4 w-2/3 animate-pulse rounded bg-slate-200/85" />
          <span className="h-4 w-1/2 animate-pulse rounded bg-slate-200/75" />
          <span className="h-4 w-1/2 animate-pulse rounded bg-slate-200/75" />
          <span className="h-4 w-20 animate-pulse rounded bg-slate-200/75" />
        </div>
      ))}
    </div>
  );
}

export function BankTieUpsScreen() {
  const cachedTieUps = getCachedGetData("/dealer/bank-tieups");
  const cachedBranches = Array.isArray(cachedTieUps?.availableBranches)
    ? cachedTieUps.availableBranches
    : Array.isArray(cachedTieUps?.availableBanks)
      ? cachedTieUps.availableBanks
      : [];
  const cachedCurrentTieUps = Array.isArray(cachedTieUps?.branchTieUps)
    ? cachedTieUps.branchTieUps
    : Array.isArray(cachedTieUps?.currentTieUps)
      ? cachedTieUps.currentTieUps
      : [];
  const [availableBranches, setAvailableBranches] = useState(() => mergeBranchesByKey(cachedBranches, cachedCurrentTieUps).filter((branch) => branch.active !== false && branch.approved !== false));
  const [selectedBranchIds, setSelectedBranchIds] = useState(() => cachedCurrentTieUps.map((branch) => bankKey(branch)).filter(Boolean));
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(() => !cachedTieUps);
  const [saving, setSaving] = useState(false);

  const loadTieUps = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const response = await api.get("/dealer/bank-tieups");
      const allBranches = Array.isArray(response.data?.availableBranches)
        ? response.data.availableBranches
        : Array.isArray(response.data?.availableBanks)
          ? response.data.availableBanks
          : [];
      const currentTieUps = Array.isArray(response.data?.branchTieUps)
        ? response.data.branchTieUps
        : Array.isArray(response.data?.currentTieUps)
          ? response.data.currentTieUps
          : [];
      setAvailableBranches(mergeBranchesByKey(allBranches, currentTieUps).filter((branch) => branch.active !== false && branch.approved !== false));
      setSelectedBranchIds(currentTieUps.map((branch) => bankKey(branch)).filter(Boolean));
    } catch (requestError) {
      setAvailableBranches((current) => current.length ? current : []);
      setSelectedBranchIds((current) => current.length ? current : []);
      setError("Unable to load banks. Please try again.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { loadTieUps({ silent: Boolean(cachedTieUps) }); }, [loadTieUps]);
  useBackgroundRefresh({ onRefresh: loadTieUps, refreshKey: "finance-bank-tieups", mutationFilter: tieUpMutationFilter });

  const cities = useMemo(() => [...new Set(availableBranches.map((branch) => branch.city).filter(Boolean))].sort(), [availableBranches]);
  const states = useMemo(() => [...new Set(availableBranches.map((branch) => branch.state).filter(Boolean))].sort(), [availableBranches]);
  const filteredBranches = useMemo(() => {
    const needle = cleanText(search).toLowerCase();
    return availableBranches.filter((branch) => {
      const text = [branch.bankName, branch.ifscCode, branch.branchName, branch.city, branch.state].filter(Boolean).join(" ").toLowerCase();
      return (!needle || text.includes(needle)) && (!city || branch.city === city) && (!state || branch.state === state);
    });
  }, [availableBranches, city, search, state]);

  const toggleBranch = (branchId) => {
    setMessage("");
    setError("");
    setSelectedBranchIds((current) => current.includes(branchId) ? current.filter((id) => id !== branchId) : [...current, branchId]);
  };

  const saveTieUps = async () => {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await api.patch("/dealer/bank-tieups", { bankTieUps: selectedBranchIds });
      await loadTieUps();
      setMessage("Bank tie-ups saved successfully.");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to save bank tie-ups. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle title="Bank Tie-Ups" subtitle="Select approved bank branches available for this dealership's lead routing." />
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid flex-1 gap-3 md:grid-cols-[1fr_180px_180px]">
            <div className="field flex h-10 items-center gap-2 rounded-md bg-white px-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search bank, IFSC, city, state" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
            </div>
            <select value={city} onChange={(event) => setCity(event.target.value)} className="field h-10 rounded-md bg-white">
              <option value="">All cities</option>
              {cities.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select value={state} onChange={(event) => setState(event.target.value)} className="field h-10 rounded-md bg-white">
              <option value="">All states</option>
              {states.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <button type="button" disabled={saving || loading} onClick={saveTieUps} className="inline-flex h-10 min-w-32 items-center justify-center rounded-md bg-[#0d47a1] px-4 text-sm font-medium text-white disabled:opacity-60">
            {saving ? <ButtonSpinner /> : "Save Tie-Ups"}
          </button>
        </div>
        {error ? <p className="mt-3 rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        {message ? <p className="mt-3 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p> : null}
        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
          <div className="grid min-w-[900px] grid-cols-[44px_1.3fr_1fr_1fr_1fr_1fr_130px] gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium uppercase text-slate-500">
            <span />
            <span>Bank Name</span>
            <span>IFSC Code</span>
            <span>Branch Name</span>
            <span>City</span>
            <span>State</span>
            <span>Approval Status</span>
          </div>
          <div className="overflow-x-auto">
            {loading && !availableBranches.length ? (
              <BranchListSkeleton />
            ) : !availableBranches.length ? (
              <p className="px-3 py-6 text-sm text-slate-500">No approved banks are currently available.</p>
            ) : !filteredBranches.length ? (
              <p className="px-3 py-6 text-sm text-slate-500">No approved bank branches match this search.</p>
            ) : (
              filteredBranches.map((branch) => {
                const id = bankKey(branch);
                const checked = selectedBranchIds.includes(id);
                return (
                  <label key={id} className="grid min-w-[900px] cursor-pointer grid-cols-[44px_1.3fr_1fr_1fr_1fr_1fr_130px] gap-3 border-b border-slate-100 px-3 py-3 text-sm text-slate-700 last:border-b-0 hover:bg-slate-50">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#0d47a1] focus:ring-[#0d47a1]" checked={checked} onChange={() => toggleBranch(id)} />
                    <span className="font-medium text-slate-900">{display(branch.bankName)}</span>
                    <span>{display(branch.ifscCode)}</span>
                    <span>{display(branch.branchName)}</span>
                    <span>{display(branch.city)}</span>
                    <span>{display(branch.state)}</span>
                    <span className={branch.catalogMissing ? "text-amber-700" : "text-emerald-700"}>{branch.catalogMissing ? "tie-up saved" : branch.approvalStatus || "approved"}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
