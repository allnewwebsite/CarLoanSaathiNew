import { ArrowLeft, BadgeIndianRupee } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Skeleton } from "../components/ui/Skeleton.jsx";
import { fallbackBrands, getFallbackCarsByBrand } from "../data/catalogFallback.js";
import { api } from "../services/api.js";

function money(value) {
  if (!value) return "Check Offer";
  return `Rs. ${(Number(value) / 100000).toFixed(2)} Lakh*`;
}

function ModelCard({ car, index, onSelect }) {
  const [failed, setFailed] = useState(false);
  if (failed || !car.image?.trim()) return null;

  return (
    <article data-model-card key={car.slug} className="rounded-lg border border-slate-200 bg-white p-3 text-center transition hover:border-[#0d47a1]/40 hover:bg-slate-50">
      <div className="mx-auto flex aspect-square items-center justify-center rounded-lg bg-slate-100 p-3">
        <img
          loading="lazy"
          decoding="async"
          src={car.image}
          alt={car.name}
          className="h-full w-full object-contain"
          onError={() => setFailed(true)}
        />
      </div>
      <h2 className="mt-3 min-h-[44px] text-base font-semibold leading-snug text-slate-900">{car.name}</h2>
      <p className="mt-1 inline-flex items-center gap-1 text-sm font-normal text-slate-600"><BadgeIndianRupee className="h-4 w-4" /> Est. {money(car.price)}</p>
      <button onClick={() => onSelect(car)} className="mt-4 min-h-10 w-full rounded-md bg-[#0d47a1] px-3 py-2 text-sm font-medium leading-tight text-white">
        Select & Apply
      </button>
    </article>
  );
}

export function CarsPage() {
  const { brandSlug } = useParams();
  const navigate = useNavigate();
  const [models, setModels] = useState([]);
  const [brandName, setBrandName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([api.get("/brands"), api.get(`/cars/${brandSlug}`)])
      .then(([brandResponse, carsResponse]) => {
        if (!active) return;
        const brandList = brandResponse.data?.length ? brandResponse.data : fallbackBrands;
        const brand = brandList.find((item) => item.slug === brandSlug);
        setBrandName(brand?.name || brandSlug);
        const nextModels = carsResponse.data?.length ? carsResponse.data : getFallbackCarsByBrand(brandSlug);
        setModels(nextModels.filter((model) => model.image && model.image.trim() !== ""));
      })
      .catch(() => {
        if (!active) return;
        const brand = fallbackBrands.find((item) => item.slug === brandSlug);
        setBrandName(brand?.name || brandSlug);
        setModels(getFallbackCarsByBrand(brandSlug).filter((model) => model.image && model.image.trim() !== ""));
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [brandSlug]);

  const selectModel = (car) => {
    const selection = { selectedBrand: car.brand, selectedModel: car.name, carPrice: car.price || "", brandSlug: car.brandSlug || brandSlug };
    localStorage.setItem("cls_selected_car", JSON.stringify(selection));
    navigate("/apply-loan", { state: selection });
  };

  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <Link to="/#brands" className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-[#0d47a1]">
          <ArrowLeft className="h-4 w-4" /> Back to brands
        </Link>
        <div className="mt-6 w-full overflow-hidden rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Model Selection</p>
              <h1 className="mt-2 break-words text-3xl font-semibold leading-tight text-slate-900 md:text-4xl">{brandName} car models</h1>
              <p className="mt-2 text-base text-slate-600">Explore top models from {brandName} and apply for a loan instantly.</p>
            </div>
            <div className="rounded-lg bg-slate-50 px-4 py-3">
              <p className="text-sm font-medium text-slate-500">Finance preview</p>
              <p className="mt-1 text-base font-semibold text-slate-900">Low EMI offers available</p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {loading ? Array.from({ length: 10 }).map((_, index) => <Skeleton key={index} className="h-72" />) : models.length === 0 ? (
              <div className="col-span-full rounded-lg bg-slate-50 p-8 text-center text-sm font-medium text-slate-500">No models available for this brand yet.</div>
            ) : models.map((car, index) => <ModelCard key={car.slug} car={car} index={index} onSelect={selectModel} />)}
          </div>
        </div>
      </div>
    </main>
  );
}
