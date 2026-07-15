import { useMemo, useState } from "react";
import { SectionHeading } from "../components/SectionHeading.jsx";
import { featuredCars } from "../data/platformData.js";
import { calculateEmi, formatCurrency } from "../hooks/useEmi.js";

export function MarketplacePage() {
  const [brand, setBrand] = useState("");
  const brands = [...new Set(featuredCars.map((car) => car.brand))];
  const cars = useMemo(() => !brand ? featuredCars : featuredCars.filter((car) => car.brand === brand), [brand]);

  return (
    <main className="container-shell py-12">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <SectionHeading eyebrow="Marketplace" title="Cars with EMI previews and loan eligibility" />
        <select className="field md:w-56" value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="">Select Brand</option>
          {brands.map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>
      <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {cars.map((car) => (
          <article className="card overflow-hidden" key={car.id}>
            <img className="h-52 w-full object-cover" src={car.image} alt={`${car.brand} ${car.model}`} loading="lazy" decoding="async" />
            <div className="p-5">
              <p className="text-sm text-muted">{car.brand}</p>
              <h3 className="mt-1 text-lg font-semibold text-ink">{car.model}</h3>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-surface p-3">
                  <p className="text-muted">Price</p>
                  <p className="font-semibold text-ink">{formatCurrency(car.price)}</p>
                </div>
                <div className="rounded-lg bg-surface p-3">
                  <p className="text-muted">EMI preview</p>
                  <p className="font-semibold text-ink">{formatCurrency(calculateEmi(car.price * 0.8, car.rate, 60))}</p>
                </div>
              </div>
              <p className="mt-4 rounded-lg bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700">Eligible for up to 90% funding</p>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
