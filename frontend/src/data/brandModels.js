export const BRAND_MODELS = {
  "Tata Motors": ["Nexon", "Punch", "Altroz", "Harrier", "Safari", "Tiago", "Tigor"],
  Hyundai: ["Creta", "Venue", "i20", "Verna", "Exter"],
  Mahindra: ["Scorpio", "XUV700", "Bolero", "Thar"],
  Kia: ["Seltos", "Sonet", "Carens"],
  Honda: ["City", "Amaze", "Elevate"],
  "Maruti Suzuki": ["Brezza", "Fronx", "Baleno", "Swift", "Dzire"],
};

export function getModelsForBrand(brand) {
  const normalized = String(brand || "").trim().toLowerCase();
  const key = Object.keys(BRAND_MODELS).find((item) => item.toLowerCase() === normalized || normalized.includes(item.toLowerCase()));
  return key ? BRAND_MODELS[key] : [];
}
