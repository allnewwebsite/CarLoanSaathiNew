import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { listRecords } from "./firestore.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(__dirname, "../../frontend/public");
const modelRoot = path.join(publicRoot, "assets/models");

const brandLogos = {
  maruti: "/logos/brands/maruti.png",
  hyundai: "/logos/brands/hyundai.png",
  tata: "/logos/brands/tata.png",
  mahindra: "/logos/brands/mahindra.png",
  kia: "/logos/brands/kia.png",
  toyota: "/logos/brands/toyota.png",
  honda: "/logos/brands/honda.png",
  mg: "/logos/brands/mg.png",
  skoda: "/logos/brands/skoda.png",
  volkswagen: "/logos/brands/volkswagen.png",
  nissan: "/logos/brands/nissan.png",
  renault: "/logos/brands/renault.png",
  bmw: "/logos/brands/bmw.png",
  mercedes: "/logos/brands/mercedes.png",
  audi: "/logos/brands/audi.png",
  volvo: "/logos/brands/volvo.png",
  ev: "/logos/brands/ev.png",
};

const fallbackBrands = [
  { name: "Maruti Suzuki", slug: "maruti", logo: brandLogos.maruti },
  { name: "Hyundai", slug: "hyundai", logo: brandLogos.hyundai },
  { name: "Tata Motors", slug: "tata", logo: brandLogos.tata },
  { name: "Mahindra", slug: "mahindra", logo: brandLogos.mahindra },
  { name: "Kia India", slug: "kia", logo: brandLogos.kia },
  { name: "Toyota", slug: "toyota", logo: brandLogos.toyota },
  { name: "Honda", slug: "honda", logo: brandLogos.honda },
  { name: "MG", slug: "mg", logo: brandLogos.mg },
  { name: "Skoda", slug: "skoda", logo: brandLogos.skoda },
  { name: "Volkswagen", slug: "volkswagen", logo: brandLogos.volkswagen },
  { name: "Nissan", slug: "nissan", logo: brandLogos.nissan },
  { name: "Renault", slug: "renault", logo: brandLogos.renault },
  { name: "BMW", slug: "bmw", logo: brandLogos.bmw },
  { name: "Mercedes-Benz", slug: "mercedes", logo: brandLogos.mercedes },
  { name: "Audi", slug: "audi", logo: brandLogos.audi },
  { name: "Volvo", slug: "volvo", logo: brandLogos.volvo },
];

const fallbackBanks = [
  { name: "HDFC Bank", logo: "/assets/banks/hdfc.png", interestRate: "7.45% p.a.", approvalSpeed: "Same day approval" },
  { name: "ICICI Bank", logo: "/assets/banks/icici.png", interestRate: "7.60% p.a.", approvalSpeed: "24 hour processing" },
  { name: "Axis Bank", logo: "/assets/banks/axis.png", interestRate: "7.70% p.a.", approvalSpeed: "Fast verification" },
  { name: "SBI", logo: "/assets/banks/sbi.png", interestRate: "7.65% p.a.", approvalSpeed: "Priority branch support" },
  { name: "Kotak Mahindra Bank", logo: "/assets/banks/kotak.png", interestRate: "7.75% p.a.", approvalSpeed: "Digital approval" },
  { name: "IndusInd Bank", logo: "/assets/banks/indusind.png", interestRate: "8.10% p.a.", approvalSpeed: "Quick documents" },
  { name: "Bank of Baroda", logo: "/assets/banks/bob.png", interestRate: "7.80% p.a.", approvalSpeed: "Dealer desk support" },
  { name: "Punjab National Bank", logo: "/assets/banks/pnb.png", interestRate: "7.90% p.a.", approvalSpeed: "24-48 hour approval" },
  { name: "IDFC First Bank", logo: "/assets/banks/idfc.jpg", interestRate: "8.25% p.a.", approvalSpeed: "Paper-light process" },
  { name: "AU Small Finance Bank", logo: "/assets/banks/au-small-finance.png", interestRate: "8.35% p.a.", approvalSpeed: "Fast city coverage" },
  { name: "Yes Bank", logo: "/assets/banks/yes-bank.jpg", interestRate: "8.15% p.a.", approvalSpeed: "Digital sanction" },
  { name: "Union Bank", logo: "/assets/banks/union-bank.jpg", interestRate: "7.95% p.a.", approvalSpeed: "Branch + digital support" },
  { name: "Bandhan Bank", logo: "/assets/banks/bandhan-bank.jpg" },
  { name: "Bank of India", logo: "/assets/banks/bank-of-india.png" },
  { name: "Bank of Maharashtra", logo: "/assets/banks/bank-of-maharashtra.png" },
  { name: "Canara Bank", logo: "/assets/banks/canara-bank.jpg" },
  { name: "Central Bank of India", logo: "/assets/banks/central-bank.png" },
  { name: "IDBI Bank", logo: "/assets/banks/idbi-bank.png" },
  { name: "Indian Bank", logo: "/assets/banks/indian-bank.png" },
  { name: "Indian Overseas Bank", logo: "/assets/banks/indian-overseas-bank.jpg" },
  { name: "Punjab & Sind Bank", logo: "/assets/banks/punjab-sind.jpg" },
  { name: "UCO Bank", logo: "/assets/banks/uco-bank.jpg" },
];

const fallbackHomeContent = {
  features: [
    { icon: "zap", title: "Fast Approval", text: "Get approval in just 24 hours" },
    { icon: "percent", title: "Lowest Interest Rate", text: "Competitive rates from top banks" },
    { icon: "building", title: "All Banks Available", text: "Compare and choose from 10+ banks" },
    { icon: "file", title: "Minimum Documents", text: "Simple documentation process" },
  ],
  documents: [
    { icon: "ID", title: "Aadhaar Card", text: "Original Aadhaar Card with current address" },
    { icon: "PAN", title: "PAN Card", text: "Permanent Account Number Card" },
    { icon: "SL", title: "Salary Slip / ITR", text: "Last 3 months salary slip or ITR" },
    { icon: "BS", title: "Bank Statement", text: "Last 3-6 months bank statement" },
    { icon: "AD", title: "Address Proof", text: "Utility bill, Rent agreement, or Property Paper" },
    { icon: "MO", title: "Mobile No", text: "Active mobile number linked with your bank account" },
  ],
  testimonials: [
    { name: "Rahul Sharma", city: "Delhi", text: "The team made my auto loan approval easy and transparent. I received quick support and everything was completed smoothly." },
    { name: "Amit Verma", city: "Gurgaon", text: "Great experience from start to finish. My loan was approved on time and the process was handled in a very professional way." },
    { name: "Priya Gupta", city: "Noida", text: "Very clear communication and fast updates throughout. The approval process felt simple, and I got my car loan without stress." },
  ],
};

const priceByModel = new Map([
  ["swift", 600000],
  ["beleno", 666000],
  ["brezza", 834000],
  ["grand-vitara", 1080000],
  ["harrier", 1500000],
  ["harrier-ev", 2200000],
  ["nexon", 815000],
  ["xuv700", 1399000],
  ["creata", 1100000],
  ["seltos", 1090000],
  ["fortuner", 3343000],
]);

const fallbackModels = {
  maruti: [["Swift", 600000], ["Baleno", 666000], ["Brezza", 834000], ["Fronx", 750000], ["Dzire", 680000], ["Wagon R", 560000], ["Grand Vitara", 1080000], ["Alto K10", 410000], ["Celerio", 530000], ["Ertiga", 870000], ["XL6", 1150000]],
  hyundai: [["Creta", 1100000], ["Venue", 790000], ["i20", 710000], ["Verna", 1110000], ["Exter", 610000], ["Alcazar", 1670000], ["Aura", 650000], ["Grand i10 Nios", 590000]],
  tata: [["Nexon", 815000], ["Punch", 613000], ["Harrier", 1500000], ["Safari", 1620000], ["Tiago", 565000], ["Curvv", 1000000], ["Altroz", 665000], ["Tigor", 630000]],
  mahindra: [["Scorpio N", 1385000], ["XUV700", 1399000], ["Thar", 1125000], ["Bolero", 980000], ["XUV 3XO", 799000], ["BE 6", 1890000], ["XEV 9S", 2190000]],
  kia: [["Seltos", 1090000], ["Sonet", 800000], ["Carens", 1060000], ["Syros", 900000], ["EV6", 6097000], ["Carens Clavis EV", 1800000]],
  toyota: [["Fortuner", 3343000], ["Innova Crysta", 1999000], ["Urban Cruiser Hyryder", 1114000], ["Glanza", 686000], ["Urban Cruiser Taisor", 774000], ["Camry Hybrid", 4620000], ["Hilux", 3030000]],
  honda: [["City", 1208000], ["Amaze", 720000], ["Elevate", 1169000]],
  mg: [["Hector", 1399000], ["Astor", 998000], ["Comet", 699000], ["Windsor EV", 999000], ["Gloster", 3820000], ["ZS EV", 1898000]],
  volkswagen: [["Virtus", 1156000], ["Taigun", 1170000]],
  skoda: [["Slavia", 1069000], ["Kushaq", 1089000], ["Kodiaq", 3900000]],
  nissan: [["Magnite", 600000], ["X-Trail", 4992000]],
  renault: [["Kwid", 470000], ["Kiger", 600000], ["Triber", 600000]],
  bmw: [["2 Series Gran Coupe", 4350000], ["3 Series Gran Coupe LWB", 6000000], ["5 Series", 7240000], ["7 Series", 18200000], ["M340i", 7400000]],
  mercedes: [["GLA", 5150000], ["GLC", 7550000], ["C-Class", 6100000], ["E-Class", 7850000]],
  audi: [["A4", 4600000], ["A6", 6500000], ["A8 L", 13400000]],
  volvo: [["XC40", 4690000], ["XC60", 6890000], ["XC90", 10089000], ["C40 Recharge", 6295000]],
};

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/\.(jpg|jpeg|png|jfif)$/i, "")
    .replace(/\.ev/g, "-ev")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function nameFromSlug(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function priceForModel(brandSlug, slug) {
  const configured = fallbackModels[brandSlug] || [];
  const match = configured.find(([name]) => slugify(name) === slug);
  return priceByModel.get(slug) || match?.[1] || null;
}

function normalizeFirestoreList(records) {
  return records.map(({ id, ...item }) => item);
}

function mergeCatalog(fallbackItems, firestoreItems, key = "slug") {
  const merged = new Map();

  fallbackItems.forEach((item) => {
    const id = String(item[key] || item.name || "").toLowerCase();
    if (id) {
      merged.set(id, {
        ...item,
        logo: brandLogos[item.slug || id] || item.logo || "/assets/favicon.png",
        slug: item.slug || slugify(item.name || id),
      });
    }
  });

  firestoreItems.forEach((item) => {
    const id = String(item[key] || item.name || "").toLowerCase();
    if (!id) return;
    const fallback = merged.get(id) || {};
    merged.set(id, {
      ...fallback,
      ...item,
      logo: brandLogos[item.slug || fallback.slug || id] || item.logo || fallback.logo || "/assets/favicon.png",
      name: item.name || fallback.name,
      slug: item.slug || fallback.slug || slugify(item.name || id),
    });
  });

  return Array.from(merged.values()).filter((item) => item.name && item.slug);
}

export async function getBrands() {
  const records = await listRecords("brands");
  return mergeCatalog(fallbackBrands, normalizeFirestoreList(records), "slug");
}

export async function getBanks() {
  const records = await listRecords("banks");
  return mergeCatalog(fallbackBanks, normalizeFirestoreList(records), "name");
}

export async function getHomeContent() {
  const records = await listRecords("homeContent");
  if (records.length) return records[0];
  return fallbackHomeContent;
}

export async function getCarsByBrand(brandSlug) {
  const records = await listRecords("cars");
  const firestoreCars = normalizeFirestoreList(records.filter((car) => car.brandSlug === brandSlug || car.brand === brandSlug));

  const brand = fallbackBrands.find((item) => item.slug === brandSlug);
  if (!brand) return [];

  const models = [];
  const imageDirectory = path.join(publicRoot, "images", "cars", brandSlug);
  if (fs.existsSync(imageDirectory)) {
    fs.readdirSync(imageDirectory)
      .filter((file) => /\.jpe?g$/i.test(file))
      .forEach((file) => {
        const slug = slugify(file);
        models.push({
          name: nameFromSlug(slug),
          slug,
          brand: brand.name,
          brandSlug,
          price: priceForModel(brandSlug, slug),
          image: `/images/cars/${brandSlug}/${file}`,
        });
      });
  }

  firestoreCars.forEach((car) => {
    const slug = car.slug || slugify(car.name || car.model || "");
    if (!slug) return;
    const index = models.findIndex((model) => model.slug === slug || model.name === car.name);
    const next = {
      ...models[index],
      ...car,
      name: car.name || car.model || models[index]?.name,
      slug,
      brand: car.brand || brand.name,
      brandSlug: car.brandSlug || brandSlug,
      image: car.image?.startsWith("/images/cars/") && fs.existsSync(path.join(publicRoot, car.image.replace(/^\//, "")))
        ? car.image
        : models[index]?.image || "",
    };
    if (!next.image) return;
    if (index >= 0) models[index] = next;
    else models.push(next);
  });

  return models.sort((a, b) => a.name.localeCompare(b.name));
}
