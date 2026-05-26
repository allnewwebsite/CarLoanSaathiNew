export function getOverview(_req, res) {
  res.json({
    cases: 1842,
    activeDealerships: 128,
    bankPartners: 22,
    monthlyPayouts: 27000000,
    approvalsThisMonth: 428,
  });
}
