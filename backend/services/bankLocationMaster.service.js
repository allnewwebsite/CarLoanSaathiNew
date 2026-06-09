export const BANK_LOCATION_MASTER = Object.freeze({
  Haryana: Object.freeze([
    "Ambala",
    "Bhiwani",
    "Charkhi Dadri",
    "Faridabad",
    "Fatehabad",
    "Gurugram",
    "Hansi",
    "Hisar",
    "Jhajjar",
    "Jind",
    "Kaithal",
    "Karnal",
    "Kurukshetra",
    "Mahendragarh",
    "Nuh",
    "Palwal",
    "Panchkula",
    "Panipat",
    "Rewari",
    "Rohtak",
    "Sirsa",
    "Sonipat",
    "Yamunanagar",
  ]),
  Delhi: Object.freeze([
    "Patel Nagar",
    "Karol Bagh",
    "Shakur Basti",
    "Shalimar Bagh",
    "Model Town",
    "Gandhi Nagar",
    "Vishwas Nagar",
    "Patparganj",
    "New Delhi",
    "Delhi Cantonment",
    "Burari",
    "Adarsh Nagar",
    "Badli",
    "Karawal Nagar",
    "Gokal Puri",
    "Yamuna Vihar",
    "Shahdara",
    "Kirari",
    "Nangloi Jat",
    "Rohini",
    "Sadar Bazar",
    "Chandni Chowk",
    "Mundka",
    "Narela",
    "Bawana",
    "Chhatarpur",
    "Malviya Nagar",
    "Deoli",
    "Mehrauli",
    "Jangpura",
    "Kalkaji",
    "Badarpur",
    "Najafgarh",
    "Matiala",
    "Dwarka",
    "Bijwasan",
    "Vikaspuri",
    "Janakpuri",
    "Rajouri Garden",
  ]),
});

export const BANK_LOAN_CAPACITY_RANGES = Object.freeze([
  "1-10",
  "11-25",
  "26-50",
  "51-100",
  "101-250",
  "250+",
]);

export const DEALERSHIP_BRANDS = Object.freeze([
  "Maruti Suzuki",
  "Hyundai",
  "Tata Motors",
  "Mahindra",
  "Kia",
  "Honda",
  "Toyota",
  "MG",
  "Skoda",
  "Volkswagen",
  "Nissan",
  "Renault",
  "BMW",
  "Audi",
  "Mercedes-Benz",
  "Volvo",
  "Jeep",
  "Citroen",
  "BYD",
  "Force Motors",
  "Isuzu",
  "Jaguar",
  "Land Rover",
  "Porsche",
  "Lexus",
  "Mini",
  "Rolls Royce",
  "Bentley",
  "Ferrari",
  "Lamborghini",
  "Maserati",
  "McLaren",
  "Aston Martin",
  "Others",
]);

export function normalizeIfsc(value = "") {
  return String(value || "").trim().toUpperCase();
}

export function normalizeBankState(value = "") {
  const state = String(value || "").trim();
  return Object.keys(BANK_LOCATION_MASTER).find((item) => item.toLowerCase() === state.toLowerCase()) || "";
}

export function normalizeBankLocation(state = "", value = "") {
  const normalizedState = normalizeBankState(state);
  const location = String(value || "").trim();
  if (!normalizedState) return "";
  return BANK_LOCATION_MASTER[normalizedState].find((item) => item.toLowerCase() === location.toLowerCase()) || "";
}

export function normalizeDealershipBrand(value = "") {
  const brand = String(value || "").trim();
  return DEALERSHIP_BRANDS.find((item) => item.toLowerCase() === brand.toLowerCase()) || "";
}

export function validateBankLocation({ state = "", location = "" } = {}) {
  const normalizedState = normalizeBankState(state);
  const normalizedLocation = normalizeBankLocation(normalizedState, location);
  return {
    valid: Boolean(normalizedState && normalizedLocation),
    state: normalizedState,
    location: normalizedLocation,
  };
}

export function normalizeLoanCapacity(value = "") {
  const capacity = String(value || "").trim();
  return BANK_LOAN_CAPACITY_RANGES.find((item) => item === capacity) || "";
}

export function loanCapacityUpperBound(value = "") {
  const capacity = normalizeLoanCapacity(value);
  if (!capacity) return 0;
  if (capacity.endsWith("+")) return Number.parseInt(capacity, 10) || 0;
  const [, upper] = capacity.split("-");
  return Number.parseInt(upper, 10) || 0;
}
