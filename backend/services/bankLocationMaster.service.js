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

export function validateBankLocation({ state = "", location = "" } = {}) {
  const normalizedState = normalizeBankState(state);
  const normalizedLocation = normalizeBankLocation(normalizedState, location);
  return {
    valid: Boolean(normalizedState && normalizedLocation),
    state: normalizedState,
    location: normalizedLocation,
  };
}
