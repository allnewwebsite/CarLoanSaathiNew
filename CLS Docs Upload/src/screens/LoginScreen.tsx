import React, { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View, Image } from "react-native";
import { useAuth } from "../auth/AuthProvider";
import { errorMessage } from "../api/client";
import { colors, shadow } from "../theme";
import { Field, PrimaryButton, Screen, SectionLabel, styles } from "../components/Screen";
const logo = require("../assets/brand/stamp.png");

export function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError("Enter your official email and password.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <Screen>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingVertical: 12 }}>
          <View style={{ alignItems: "center", marginBottom: 20 }}>
            <View accessibilityRole="image" accessibilityLabel="CarLoanSaathi logo" style={[{ alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft, borderRadius: 24, height: 90, width: 90, overflow: "hidden" }, shadow]}>
              <Image source={logo} style={{ width: 72, height: 72, borderRadius: 18 }} resizeMode="contain" />
            </View>
            <Text style={{ color: colors.primaryDark, fontSize: 30, fontWeight: "900", marginTop: 12 }}>
              CarLoan<Text style={{ color: colors.orange }}>Saathi</Text>
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "600", marginTop: 4 }}>Finance Desk document workspace</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>Sign in to securely manage requested documents.</Text>

            <View style={{ marginTop: 20 }}>
              <SectionLabel>Official email</SectionLabel>
              <Field accessibilityLabel="Official email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" placeholder="name@company.com" value={email} onChangeText={setEmail} returnKeyType="next" />
            </View>

            <View style={{ marginTop: 12 }}>
              <SectionLabel>Password</SectionLabel>
              <View style={{ position: "relative" }}>
                <Field
                  accessibilityLabel="Password"
                  secureTextEntry={!show}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChangeText={setPassword}
                  onSubmitEditing={() => void submit()}
                  returnKeyType="done"
                  style={{ paddingRight: 72 }}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={show ? "Hide password" : "Show password"}
                  onPress={() => setShow(!show)}
                  style={{ alignItems: "center", justifyContent: "center", minHeight: 48, minWidth: 64, position: "absolute", right: 6, top: 2 }}
                >
                  <Text style={{ color: colors.primary, fontWeight: "800" }}>{show ? "Hide" : "Show"}</Text>
                </Pressable>
              </View>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            <PrimaryButton title={busy ? "Signing in..." : "Sign in"} onPress={() => void submit()} disabled={busy} />
          </View>
        </ScrollView>
      </Screen>
    </KeyboardAvoidingView>
  );
}
