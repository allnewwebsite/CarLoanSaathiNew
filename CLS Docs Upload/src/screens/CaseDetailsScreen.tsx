import React, { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { getCase } from "../api/cases";
import { listDocuments } from "../api/documents";
import { Badge, Card, Loading, PrimaryButton, RealtimeStatus, Screen, SecondaryButton, styles } from "../components/Screen";
import { colors } from "../theme";
import { DocumentRecord, documentName, leadName, leadVehicle, Lead } from "../types";
import { RealtimeEvent, useRealtime } from "../realtime/RealtimeProvider";
import { CASE_DETAIL_RECONCILIATION_EVENTS, REALTIME_RECONCILE_REQUIRED } from "../realtime/reconciliation";

type Props = NativeStackScreenProps<RootStackParamList, "CaseDetails">;

function matches(event: RealtimeEvent, id: string) {
  return [event.leadId, event.caseId, event.lead?.id, event.lead?.leadId, event.lead?.caseId, event.data?.leadId, event.data?.caseId].map(v => String(v || "").trim()).includes(id);
}

function complete(document: DocumentRecord) {
  return !["pending", "requested", "rejected"].includes(String(document.status || "Uploaded").toLowerCase());
}

export function CaseDetailsScreen({ route, navigation }: Props) {
  const { status, subscribe } = useRealtime();
  const [lead, setLead] = useState<Lead | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [busy, setBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setBusy(true);
    setError("");
    try {
      const [record, docs] = await Promise.all([getCase(route.params.leadId), listDocuments(route.params.leadId)]);
      setLead(record);
      setDocuments(docs);
      return true;
    } catch (e) {
      setError((e as any)?.userMessage || "Unable to load this case.");
      return false;
    } finally {
      setBusy(false);
      setRefreshing(false);
    }
  }, [route.params.leadId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribe(event => {
    const type = String(event.eventType || event.event || "").toUpperCase();
    if (type === REALTIME_RECONCILE_REQUIRED || (matches(event, route.params.leadId) && CASE_DETAIL_RECONCILIATION_EVENTS.has(type))) {
      return load(true).then(succeeded => {
        if (!succeeded) throw new Error("Case reconciliation failed");
      });
    }
  }), [load, route.params.leadId, subscribe]);

  if (busy && !lead) return <Screen><Loading /></Screen>;
  if (!lead) return <Screen><Text style={styles.error}>{error || "Case not found."}</Text><SecondaryButton title="Retry" onPress={() => void load()} /></Screen>;

  const uploaded = documents.filter(complete);
  const done = new Set(uploaded.map(document => documentName(document).toLowerCase()));
  const requested = lead.pendingDocuments || lead.pendingDocumentsRequested || [];
  const pending = requested.filter(type => !done.has(String(type).toLowerCase()));

  return (
    <Screen>
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />} contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <RealtimeStatus status={status} />

        <View style={{ marginTop: 12 }}>
          <Text style={styles.sectionLabel}>CASE {lead.caseId || lead.id}</Text>
          <Text style={[styles.title, { fontSize: 34, lineHeight: 42 }]}>{leadName(lead)}</Text>
          <Text style={[styles.subtitle, { marginTop: 6 }]}>{leadVehicle(lead)}</Text>
        </View>

        <Card style={{ marginTop: 18 }}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionLabel}>Document progress</Text>
              <Text style={{ color: colors.text, fontSize: 28, fontWeight: "900", marginTop: 4 }}>
                {uploaded.length}
                <Text style={{ color: colors.muted, fontSize: 16, fontWeight: "700" }}> uploaded</Text>
              </Text>
            </View>
            <Badge success={!pending.length}>{pending.length ? `${pending.length} pending` : "Complete"}</Badge>
          </View>
          {lead.salespersonName ? <Text style={styles.meta}>Salesperson: {lead.salespersonName}</Text> : null}
          {lead.bankName ? <Text style={styles.meta}>Bank: {lead.bankName}</Text> : null}
          <Text style={styles.meta}>Case status: {lead.status || "Not provided"}</Text>
        </Card>

        <Text style={styles.section}>Documents to upload</Text>
        {pending.length ? pending.map(type => (
          <Card key={`pending-${type}`}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.customer}>{type}</Text>
                <Text style={[styles.meta, { marginTop: 6 }]}>Requested by Finance Desk</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Upload ${type}`} onPress={() => navigation.navigate("Upload", { leadId: lead.id, documentType: type })} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}>
                <Text style={{ color: colors.primary, fontWeight: "900" }}>Upload ›</Text>
              </Pressable>
            </View>
          </Card>
        )) : <Text style={styles.subtitle}>No pending document request is recorded.</Text>}

        <Text style={styles.section}>Uploaded documents</Text>
        {uploaded.length ? uploaded.map(doc => (
          <Card key={doc.id || `${documentName(doc)}-${doc.createdAt}`}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.customer}>{documentName(doc)}</Text>
                <Text style={styles.meta}>{doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : "Document uploaded"}</Text>
              </View>
            </View>
          </Card>
        )) : <Text style={styles.subtitle}>No documents have been uploaded for this case.</Text>}

        <View style={{ marginTop: 8 }}>
          <PrimaryButton title="Upload another document" onPress={() => navigation.navigate("Upload", { leadId: lead.id })} />
        </View>
      </ScrollView>
    </Screen>
  );
}
