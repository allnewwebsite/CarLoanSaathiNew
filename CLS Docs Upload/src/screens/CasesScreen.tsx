import React, { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Image, Pressable, RefreshControl, Text, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { getCase, listCases } from "../api/cases";
import { useAuth } from "../auth/AuthProvider";
import { Badge, Card, Field, Loading, RealtimeStatus, Screen, SecondaryButton, styles } from "../components/Screen";
import { colors } from "../theme";
import { Lead, leadName, leadVehicle } from "../types";
import { RealtimeEvent, useRealtime } from "../realtime/RealtimeProvider";
import { CASE_LIST_RECONCILIATION_EVENTS, eventLeadId, mergeFirstPage, REALTIME_RECONCILE_REQUIRED } from "../realtime/reconciliation";
const logo = require("../assets/brand/stamp.png");

type Props = NativeStackScreenProps<RootStackParamList, "Cases">;

export function CasesScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { status: realtimeStatus, subscribe } = useRealtime();
  const dealershipName = user?.dealershipName || user?.dealershipId || "Finance Desk";
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Lead[]>([]);
  const [busy, setBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const ids = useRef(new Set<string>());
  const cursor = useRef<string | null>(null);
  const more = useRef(false);
  const loading = useRef(false);
  const reconciling = useRef(false);

  const load = useCallback(async (refresh = false, append = false) => {
    if (append && (!more.current || loading.current)) return;
    if (refresh) setRefreshing(true);
    else if (append) { loading.current = true; setLoadingMore(true); }
    else setBusy(true);
    setError("");
    try {
      const result = await listCases({ search: search.trim() || undefined, ...(append && cursor.current ? { cursor: cursor.current } : {}) });
      setItems(current => {
        const next = append
          ? [...new Map([...current, ...result.items].map(item => [item.id, item])).values()]
          : result.items;
        ids.current = new Set(next.map(item => item.id));
        return next;
      });
      setHasMore(result.hasMore);
      cursor.current = result.nextCursor;
      more.current = result.hasMore;
    } catch (e) {
      setError((e as any)?.userMessage || "Unable to load cases.");
    } finally {
      setBusy(false);
      setRefreshing(false);
      loading.current = false;
      setLoadingMore(false);
    }
  }, [search]);

  const reconcileFirstPage = useCallback(async () => {
    if (reconciling.current) return;
    reconciling.current = true;
    try {
      const result = await listCases({ search: search.trim() || undefined, limit: 25 });
      setItems(current => {
        const next = mergeFirstPage(current, result.items);
        ids.current = new Set(next.map(item => item.id));
        return next;
      });
      cursor.current = result.nextCursor;
      more.current = result.hasMore;
      setHasMore(result.hasMore);
      setError("");
    } catch (error) {
      // Preserve the page snapshot and make the provider reconnect so the server can replay this event.
      throw error;
    } finally {
      reconciling.current = false;
    }
  }, [search]);

  const refreshCase = useCallback(async (event: RealtimeEvent) => {
    const id = eventLeadId(event);
    if (!id || !ids.current.has(id)) return;
    try {
      const updated = await getCase(id);
      if (updated.isDeadCase === true) {
        ids.current.delete(id);
        setItems(current => current.filter(item => item.id !== id));
      } else {
        setItems(current => current.map(item => item.id === id ? { ...item, ...updated } : item));
      }
    } catch (error) {
      throw error;
    }
  }, []);

  useEffect(() => subscribe(async event => {
    const type = String(event.eventType || event.event || "").toUpperCase();
    if (type === REALTIME_RECONCILE_REQUIRED || CASE_LIST_RECONCILIATION_EVENTS.has(type)) {
      if (type === REALTIME_RECONCILE_REQUIRED || type === "LEAD_CREATED" || type === "DEAD_CASE_RESTORED" || type === "LEAD_RESTORED_FROM_DEAD") {
        await reconcileFirstPage();
      }
      if (type !== "LEAD_CREATED" && type !== REALTIME_RECONCILE_REQUIRED) await refreshCase(event);
    }
  }), [reconcileFirstPage, refreshCase, subscribe]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), search.trim() ? 350 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  return (
    <Screen>
      <View style={[styles.headerCard, { marginTop: 0, marginBottom: 16 }]}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
            <View style={[styles.headerLogo, { alignItems: "center", justifyContent: "center" }]}>
              <Image source={logo} style={{ width: 26, height: 26, borderRadius: 8 }} resizeMode="contain" />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: colors.primaryDark, fontSize: 18, fontWeight: "900", lineHeight: 22 }}>CarLoanSaathi</Text>
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700", marginTop: 1 }}>Finance Desk</Text>
              <Text numberOfLines={1} ellipsizeMode="tail" style={{ color: colors.muted, fontSize: 11, fontWeight: "600", marginTop: 2 }}>{dealershipName}</Text>
            </View>
          </View>

          <Pressable accessibilityRole="button" accessibilityLabel="Open account screen" onPress={() => navigation.navigate("Account")} style={styles.menuButton}>
            <Text style={styles.menuText}>⋮</Text>
          </Pressable>
        </View>
      </View>

      <View style={{ marginBottom: 8 }}>
        <Text style={[styles.title, { fontSize: 38, lineHeight: 46 }]}>Your cases</Text>
        <Text style={[styles.subtitle, { marginTop: 4, lineHeight: 20 }]}>Cases assigned to your dealership finance desk</Text>
      </View>

      <RealtimeStatus status={realtimeStatus} />

      <View style={{ marginTop: 12 }}>
        <Field accessibilityLabel="Search cases" style={styles.search} placeholder="Search customer or Case ID" value={search} onChangeText={setSearch} autoCapitalize="none" returnKeyType="search" />
      </View>

      {error ? (
        <>
          <Text style={styles.error}>{error}</Text>
          <SecondaryButton title="Retry" icon="↻" onPress={() => void load(true)} />
        </>
      ) : null}

      {busy && !refreshing ? <Loading /> : (
        <FlatList
          data={items}
          keyExtractor={item => item.id}
          onEndReached={() => { if (hasMore) void load(false, true); }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <Loading /> : null}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
          contentContainerStyle={items.length ? { paddingTop: 4, paddingBottom: 24 } : { flexGrow: 1, paddingBottom: 24 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={
            <View style={{ alignItems: "center", flex: 1, justifyContent: "center", padding: 28 }}>
              <Text style={{ color: colors.primary, fontSize: 32 }}>⌁</Text>
              <Text style={styles.customer}>No cases to work on</Text>
              <Text style={[styles.subtitle, { textAlign: "center" }]}>Authorized dealership cases will appear here.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const pending = item.pendingDocuments || item.pendingDocumentsRequested || [];
            const statusText = pending.length ? `${pending.length} document${pending.length > 1 ? "s" : ""} pending` : "All documents ready";
            return (
              <Card onPress={() => navigation.navigate("CaseDetails", { leadId: item.id })} style={{ paddingVertical: 12, paddingHorizontal: 14, marginBottom: 0 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" }}>CASE {item.caseId || item.id}</Text>
                    <Text numberOfLines={1} style={{ color: colors.text, fontSize: 18, fontWeight: "800", marginTop: 4 }}>{leadName(item)}</Text>
                    <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12, marginTop: 3, lineHeight: 18 }}>{leadVehicle(item)}{item.salespersonName ? ` · ${item.salespersonName}` : ""}</Text>
                    <View style={{ marginTop: 8 }}>
                      <Badge success={!pending.length}>{statusText}</Badge>
                    </View>
                  </View>
                  <Text style={{ color: colors.primary, fontSize: 22, fontWeight: "800", lineHeight: 22 }}>›</Text>
                </View>
              </Card>
            );
          }}
        />
      )}
    </Screen>
  );
}
