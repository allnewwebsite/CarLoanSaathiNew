import React, { useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { errorMessage } from "../api/client";
import { uploadDocument } from "../api/documents";
import { Badge, Card, Field, Screen, styles } from "../components/Screen";
import { colors } from "../theme";
import { CANONICAL_DOCUMENT_TYPES, PickedFile } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Upload">;

function key() { return `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`; }

export function UploadScreen({ route, navigation }: Props) {
  const [type, setType] = useState(route.params.documentType || "");
  const [file, setFile] = useState<PickedFile | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const idem = useRef("");
  const busyRef = useRef(false);

  const choose = (next: PickedFile) => {
    setFile(next);
    idem.current = "";
    setError("");
    setMessage("");
  };

  const camera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError("Camera permission is required to photograph a document.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];
      choose({ uri: a.uri, name: a.fileName || `document-${Date.now()}.jpg`, type: a.mimeType || "image/jpeg", size: a.fileSize });
    }
  };

  const image = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];
      choose({ uri: a.uri, name: a.fileName || `document-${Date.now()}.jpg`, type: a.mimeType || "image/jpeg", size: a.fileSize });
    }
  };

  const pdf = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/jpeg", "image/png"], copyToCacheDirectory: true });
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];
      choose({ uri: a.uri, name: a.name, type: a.mimeType || "application/octet-stream", size: a.size });
    }
  };

  const submit = async () => {
    if (busyRef.current) return;
    if (!type || !file) {
      setError("Choose a document type and file first.");
      return;
    }
    if (file.size && file.size > 10 * 1024 * 1024) {
      setError("The selected file is larger than the 10 MB limit.");
      return;
    }
    if (!idem.current) idem.current = key();
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    setProgress(0);
    try {
      await uploadDocument(route.params.leadId, type, file, idem.current, setProgress);
      setProgress(1);
      setMessage("Document uploaded successfully. The case will update automatically.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const typeOptions = CANONICAL_DOCUMENT_TYPES;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>Document upload</Text>
        <Text style={styles.title}>Add a document</Text>
        <Text style={styles.subtitle}>Send a clear PDF or image to the Finance Desk case.</Text>

        <View style={{ marginTop: 20 }}>
          <Text style={styles.sectionLabel}>Document type</Text>
          <Field
            accessibilityLabel="Document type"
            placeholder="Choose or enter type"
            value={type}
            onChangeText={value => { setType(value); idem.current = ""; }}
            editable={!route.params.documentType && !busy}
          />
        </View>

        {!route.params.documentType ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: 12, rowGap: 12 }}>
            {typeOptions.map(item => {
              const selected = type === item;
              return (
                <Pressable
                  key={item}
                  accessibilityRole="button"
                  accessibilityLabel={item}
                  onPress={() => { setType(item); idem.current = ""; }}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.documentTypeButton,
                    selected && styles.documentTypeButtonSelected,
                    pressed && !selected && { opacity: 0.9 }
                  ]}
                >
                  <Text style={[styles.documentTypeText, selected && styles.documentTypeTextSelected]}>{item}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <Text style={styles.section}>Choose source</Text>

        <View style={{ flexDirection: "row", gap: 12 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open camera"
            onPress={() => void camera()}
            disabled={busy}
            style={({ pressed }) => [
              styles.sourceButton,
              busy && styles.disabled,
              pressed && styles.sourceButtonSelected
            ]}
          >
            <Text style={[styles.sourceButtonText, busy && { opacity: 0.5 }]}>Camera</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose from gallery"
            onPress={() => void image()}
            disabled={busy}
            style={({ pressed }) => [
              styles.sourceButton,
              busy && styles.disabled,
              pressed && styles.sourceButtonSelected
            ]}
          >
            <Text style={[styles.sourceButtonText, busy && { opacity: 0.5 }]}>Gallery</Text>
          </Pressable>
        </View>

        <View style={{ marginTop: 12 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose PDF or file"
            onPress={() => void pdf()}
            disabled={busy}
            style={({ pressed }) => [styles.actionButton, busy && styles.disabled, pressed && { opacity: 0.92 }]}
          >
            <Text style={styles.actionButtonText}>Choose PDF or file</Text>
          </Pressable>
        </View>

        <Text style={styles.section}>Selected file</Text>
        <View style={[styles.subtleCard, { marginBottom: 20, minHeight: 100, justifyContent: "center" }]}>
          {file ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.customer} numberOfLines={1}>{file.name}</Text>
                <Text style={styles.meta}>{file.size ? `${Math.max(1, Math.round(file.size / 1024))} KB` : "Ready to upload"}</Text>
              </View>
              <Badge>Ready</Badge>
            </View>
          ) : (
            <Text style={styles.subtitle}>No file selected yet. Use one of the source options above.</Text>
          )}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {message ? <Text style={styles.success}>{message}</Text> : null}

        {busy ? (
          <View style={{ marginBottom: 14 }}>
            <View style={styles.row}>
              <Text style={styles.status}>Uploading securely</Text>
              <Text style={styles.status}>{Math.round(progress * 100)}%</Text>
            </View>
            <View style={{ backgroundColor: colors.border, borderRadius: 999, height: 8, marginTop: 8, overflow: "hidden" }}>
              <View style={{ backgroundColor: colors.primary, borderRadius: 999, height: 8, width: `${Math.max(8, Math.round(progress * 100))}%` }} />
            </View>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Upload document"
          onPress={() => void submit()}
          disabled={busy}
          style={({ pressed }) => [
            styles.actionButton,
            busy && styles.disabled,
            pressed && { opacity: 0.94 }
          ]}
        >
          <Text style={styles.actionButtonText}>{busy ? "Uploading…" : "Upload document"}</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}
