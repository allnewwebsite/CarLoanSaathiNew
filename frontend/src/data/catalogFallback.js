export const brandLogos = {
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

export const fallbackBrands = [
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

export const fallbackBanks = [
  { name: "HDFC Bank", logo: "/assets/banks/hdfc.png", interestRate: "7.45% p.a.", approvalSpeed: "Same day approval" },
  { name: "ICICI Bank", logo: "/assets/banks/icici.png", interestRate: "7.60% p.a.", approvalSpeed: "24 hour processing" },
  { name: "Axis Bank", logo: "/assets/banks/axis.png", interestRate: "7.70% p.a.", approvalSpeed: "Fast verification" },
  { name: "State Bank of India (SBI)", logo: "/assets/banks/sbi.png", interestRate: "7.65% p.a.", approvalSpeed: "Priority branch support" },
  { name: "Kotak Mahindra Bank", logo: "/assets/banks/kotak.png", interestRate: "7.75% p.a.", approvalSpeed: "Digital approval" },
  { name: "IndusInd Bank", logo: "/assets/banks/indusind.png", interestRate: "8.10% p.a.", approvalSpeed: "Quick documents" },
  { name: "Bank of Baroda", logo: "/assets/banks/bob.png", interestRate: "7.80% p.a.", approvalSpeed: "Dealer desk support" },
  { name: "Punjab National Bank (PNB)", logo: "/assets/banks/pnb.png", interestRate: "7.90% p.a.", approvalSpeed: "24-48 hour approval" },
  { name: "IDFC FIRST Bank", logo: "/assets/banks/idfc.jpg", interestRate: "8.25% p.a.", approvalSpeed: "Paper-light process" },
  { name: "AU Small Finance Bank", logo: "/assets/banks/au-small-finance.png", interestRate: "8.35% p.a.", approvalSpeed: "Fast city coverage" },
  { name: "Yes Bank", logo: "/assets/banks/yes-bank.jpg", interestRate: "8.15% p.a.", approvalSpeed: "Digital sanction" },
  { name: "Union Bank of India", logo: "/assets/banks/union-bank.jpg", interestRate: "7.95% p.a.", approvalSpeed: "Branch + digital support" },
  { name: "Bank of India", logo: "/assets/banks/bank-of-india.png" },
  { name: "Indian Bank", logo: "/assets/banks/indian-bank.png" },
  { name: "Central Bank of India", logo: "/assets/banks/central-bank.png" },
  { name: "Bank of Maharashtra", logo: "/assets/banks/bank-of-maharashtra.png" },
  { name: "Indian Overseas Bank", logo: "/assets/banks/indian-overseas-bank.jpg" },
  { name: "UCO Bank", logo: "/assets/banks/uco-bank.jpg" },
  { name: "Punjab & Sind Bank", logo: "/assets/banks/punjab-sind.jpg" },
  { name: "Federal Bank" },
  { name: "South Indian Bank" },
  { name: "Karnataka Bank" },
  { name: "Karur Vysya Bank" },
  { name: "Tamilnad Mercantile Bank" },
  { name: "RBL Bank" },
  { name: "DCB Bank" },
  { name: "CSB Bank" },
  { name: "Equitas Small Finance Bank" },
  { name: "Ujjivan Small Finance Bank" },
  { name: "Jana Small Finance Bank" },
  { name: "Suryoday Small Finance Bank" },
  { name: "ESAF Small Finance Bank" },
  { name: "Utkarsh Small Finance Bank" },
  { name: "Capital Small Finance Bank" },
];

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function modelImagePath(brandSlug, modelName) {
  return `/images/cars/${brandSlug}/${slugify(modelName)}.jpg`;
}

export const fallbackModels = {
  maruti: [
    ["Swift", 600000], ["Baleno", 666000], ["Brezza", 834000], ["Fronx", 750000], ["Dzire", 680000], ["Wagon R", 560000], ["Grand Vitara", 1080000], ["Alto K10", 410000], ["Celerio", 530000], ["Ertiga", 870000], ["XL6", 1150000],
  ],
  hyundai: [
    ["Creta", 1100000], ["Venue", 790000], ["i20", 710000], ["Verna", 1110000], ["Exter", 610000], ["Alcazar", 1670000], ["Aura", 650000], ["Grand i10 Nios", 590000],
  ],
  tata: [
    ["Nexon", 815000], ["Punch", 613000], ["Harrier", 1500000], ["Safari", 1620000], ["Tiago", 565000], ["Curvv", 1000000], ["Altroz", 665000], ["Tigor", 630000],
  ],
  mahindra: [
    ["Scorpio N", 1385000], ["XUV700", 1399000], ["Thar", 1125000], ["Bolero", 980000], ["XUV 3XO", 799000], ["BE 6", 1890000], ["XEV 9S", 2190000],
  ],
  kia: [
    ["Seltos", 1090000], ["Sonet", 800000], ["Carens", 1060000], ["Syros", 900000], ["EV6", 6097000], ["Carens Clavis EV", 1800000],
  ],
  toyota: [
    ["Fortuner", 3343000], ["Innova Crysta", 1999000], ["Urban Cruiser Hyryder", 1114000], ["Glanza", 686000], ["Urban Cruiser Taisor", 774000], ["Camry Hybrid", 4620000], ["Hilux", 3030000],
  ],
  honda: [
    ["City", 1208000], ["Amaze", 720000], ["Elevate", 1169000],
  ],
  mg: [
    ["Hector", 1399000], ["Astor", 998000], ["Comet", 699000], ["Windsor EV", 999000], ["Gloster", 3820000], ["ZS EV", 1898000],
  ],
  volkswagen: [
    ["Virtus", 1156000], ["Taigun", 1170000], ["Tiguan", 3540000],
  ],
  skoda: [
    ["Slavia", 1069000], ["Kushaq", 1089000], ["Kodiaq", 3900000], ["Superb", 5400000],
  ],
  nissan: [
    ["Magnite", 600000], ["X-Trail", 4992000],
  ],
  renault: [
    ["Kwid", 470000], ["Kiger", 600000], ["Triber", 600000],
  ],
  bmw: [
    ["2 Series Gran Coupe", 4350000], ["3 Series Gran Coupe LWB", 6000000], ["5 Series", 7240000], ["7 Series", 18200000], ["M340i", 7400000],
  ],
  mercedes: [
    ["GLA", 5150000], ["GLC", 7550000], ["C-Class", 6100000], ["E-Class", 7850000],
  ],
  audi: [
    ["A4", 4600000], ["A6", 6500000], ["A8 L", 13400000],
  ],
  volvo: [
    ["XC40", 4690000], ["XC60", 6890000], ["XC90", 10089000], ["C40 Recharge", 6295000],
  ],
};

export function getFallbackCarsByBrand(brandSlug) {
  const brand = fallbackBrands.find((item) => item.slug === brandSlug);
  return (fallbackModels[brandSlug] || []).map(([name, price]) => ({
    name,
    price,
    brand: brand?.name || brandSlug,
    brandSlug,
    slug: slugify(name),
    image: modelImagePath(brandSlug, name),
  }));
}
