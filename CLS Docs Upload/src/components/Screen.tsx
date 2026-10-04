import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, shadow, spacing } from "../theme";

export function Screen({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return <View style={[styles.screen, { paddingTop: Math.max(8, insets.top + 8), paddingBottom: Math.max(24, insets.bottom + 12) }]}>{children}</View>;
}

export function Field(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput allowFontScaling placeholderTextColor={colors.subtle} {...props} style={[styles.field, props.style]} />;
}

type ButtonProps = { title: string; onPress: () => void; disabled?: boolean; icon?: string };

export function PrimaryButton({ title, onPress, disabled = false, icon }: ButtonProps) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.button, disabled && styles.disabled, pressed && styles.pressed]}>
      {icon ? <Text style={styles.buttonIcon}>{icon}</Text> : null}
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ title, onPress, disabled = false, icon }: ButtonProps) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.secondaryButton, disabled && styles.disabled, pressed && styles.pressed]}>
      {icon ? <Text style={styles.secondaryIcon}>{icon}</Text> : null}
      <Text style={styles.secondaryButtonText}>{title}</Text>
    </Pressable>
  );
}

export function Card({ children, onPress, style }: { children: React.ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle> }) {
  const content = <View style={[styles.card, style]}>{children}</View>;
  return onPress ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => pressed ? { opacity: 0.92 } : undefined}>{content}</Pressable> : content;
}

export function Loading() {
  return (
    <View accessibilityLabel="Loading content" style={styles.loading}>
      <ActivityIndicator color={colors.primary} size="small" />
      <Text style={styles.status}>Loading…</Text>
    </View>
  );
}

export function RealtimeStatus({ status }: { status: string }) {
  const connected = status === "connected";
  const working = status === "connecting" || status === "reconnecting";
  return (
    <View accessibilityLiveRegion="polite" style={styles.live}>
      <View style={[styles.liveDot, { backgroundColor: connected ? colors.success : working ? colors.warning : colors.subtle }]} />
      <Text style={styles.liveText}>{connected ? "Live updates on" : working ? "Reconnecting" : "Live updates off"}</Text>
    </View>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) { return <Text style={styles.sectionLabel}>{children}</Text>; }

export function Badge({ children, success = false }: { children: React.ReactNode; success?: boolean }) {
  return <View style={[styles.badge, success ? styles.successBadge : styles.pendingBadge]}><Text style={[styles.badgeText, { color: success ? colors.success : colors.primary }]}>{children}</Text></View>;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 24 },
  title: { color: colors.text, fontSize: 30, lineHeight: 38, fontWeight: "900" },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 4 },
  field: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, color: colors.text, fontSize: 15, minHeight: 52, paddingHorizontal: 16, paddingVertical: 12 },
  button: { alignItems: "center", backgroundColor: colors.primary, borderRadius: 16, minHeight: 54, justifyContent: "center", paddingHorizontal: 16, flexDirection: "row", gap: 8, ...shadow },
  buttonText: { color: "white", fontWeight: "800", fontSize: 15 },
  buttonIcon: { color: "white", fontSize: 18, fontWeight: "800" },
  secondaryButton: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 14, borderWidth: 1, minHeight: 52, justifyContent: "center", paddingHorizontal: 14, flexDirection: "row", gap: 8 },
  secondaryButtonText: { color: colors.primary, fontWeight: "800", fontSize: 14 },
  secondaryIcon: { color: colors.primary, fontSize: 17, fontWeight: "800" },
  disabled: { opacity: 0.45 },
  pressed: { transform: [{ scale: 0.98 }] },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 20, padding: 16, marginBottom: 16, ...shadow },
  customer: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: "900" },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 4 },
  badge: { alignSelf: "flex-start", borderRadius: radius.pill, marginTop: 10, paddingHorizontal: 12, paddingVertical: 7 },
  pendingBadge: { backgroundColor: colors.primarySoft },
  successBadge: { backgroundColor: colors.successSoft },
  badgeText: { fontSize: 11, fontWeight: "800" },
  row: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", gap: 12 },
  section: { color: colors.text, fontSize: 18, lineHeight: 24, fontWeight: "900", marginBottom: 10, marginTop: 20 },
  sectionLabel: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.8, marginBottom: 8, textTransform: "uppercase" },
  error: { backgroundColor: colors.dangerSoft, borderRadius: 12, color: colors.danger, fontSize: 13, fontWeight: "600", lineHeight: 19, marginBottom: 12, padding: 12 },
  success: { backgroundColor: colors.successSoft, borderRadius: 12, color: colors.success, fontSize: 13, fontWeight: "700", lineHeight: 19, marginBottom: 12, padding: 12 },
  status: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  live: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 8 },
  liveDot: { borderRadius: 999, height: 9, width: 9 },
  liveText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  loading: { alignItems: "center", flex: 1, gap: 10, justifyContent: "center", minHeight: 220 },
  search: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, color: colors.text, fontSize: 15, minHeight: 52, paddingHorizontal: 16, marginBottom: 14 },
  divider: { backgroundColor: colors.border, height: 1, marginVertical: 12 },
  headerCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, ...shadow },
  headerLogo: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.primarySoft },
  headerBadge: { backgroundColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  headerBadgeText: { color: colors.primary, fontSize: 11, fontWeight: "800" },
  avatarButton: { alignItems: "center", backgroundColor: colors.primary, borderRadius: 999, height: 42, justifyContent: "center", width: 42 },
  avatarText: { color: "white", fontSize: 15, fontWeight: "900" },
  menuButton: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, height: 38, justifyContent: "center", width: 38 },
  menuText: { color: colors.text, fontSize: 24, fontWeight: "700", lineHeight: 24 },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.25)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, marginTop: "auto", paddingHorizontal: 18, paddingTop: 14, paddingBottom: 24 },
  sheetItem: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  sheetLabel: { color: colors.text, fontSize: 15, fontWeight: "700" },
  sheetMeta: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  documentTypeButton: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 14, borderWidth: 1, minHeight: 54, justifyContent: "center", paddingHorizontal: 12, width: "48%" },
  documentTypeButtonSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  documentTypeText: { color: colors.primary, fontSize: 15, fontWeight: "800", textAlign: "center" },
  documentTypeTextSelected: { color: "white" },
  sourceButton: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 14, borderWidth: 1, flex: 1, minHeight: 54, justifyContent: "center" },
  sourceButtonSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  sourceButtonText: { color: colors.primary, fontSize: 16, fontWeight: "800" },
  sourceButtonTextSelected: { color: "white" },
  actionButton: { alignItems: "center", backgroundColor: colors.primary, borderRadius: 16, justifyContent: "center", minHeight: 54, width: "100%" },
  actionButtonText: { color: "white", fontWeight: "900", fontSize: 16 },
  subtleCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, padding: 14 }
});
