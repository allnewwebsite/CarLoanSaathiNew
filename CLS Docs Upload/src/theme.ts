export const colors = {
  primary: "#1554B4", primaryDark: "#092F6C", primarySoft: "#EAF2FF", orange: "#F97316",
  background: "#F4F7FC", surface: "#FFFFFF", surfaceMuted: "#F8FAFC", text: "#0F172A", muted: "#526175", subtle: "#8190A5", border: "#E2E8F0",
  success: "#047857", successSoft: "#ECFDF5", warning: "#B45309", warningSoft: "#FFF7ED", danger: "#C81E1E", dangerSoft: "#FFF1F2", shadow: "#0F2A55",
} as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;
export const shadow = { shadowColor: colors.shadow, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.07, shadowRadius: 13, elevation: 2 } as const;
