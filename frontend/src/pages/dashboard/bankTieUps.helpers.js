export function uniqueBankValues(banks, key) {
  const values = new Set(banks.map((bank) => bank[key]).filter(Boolean));
  return ["All", ...Array.from(values).sort()];
}

export function filterAvailableBanks({ availableBanks, currentTieUps, searchQuery, filterCity, filterState }) {
  return availableBanks.filter((bank) => {
    if (currentTieUps.some((tieUp) => tieUp.ifscCode === bank.ifscCode)) {
      return false;
    }

    const query = searchQuery.toLowerCase();
    const matchesSearch =
      !query ||
      bank.bankName.toLowerCase().includes(query) ||
      bank.branchName.toLowerCase().includes(query) ||
      bank.ifscCode.toLowerCase().includes(query) ||
      bank.city.toLowerCase().includes(query);

    const matchesCity = filterCity === "All" || bank.city === filterCity;
    const matchesState = filterState === "All" || bank.state === filterState;

    return matchesSearch && matchesCity && matchesState;
  });
}
