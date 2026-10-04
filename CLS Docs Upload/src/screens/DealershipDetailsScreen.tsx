import React from "react";
import { ScrollView, Text, View } from "react-native";
import { useAuth } from "../auth/AuthProvider";
import { Screen, styles } from "../components/Screen";

export function DealershipDetailsScreen() {
  const { user } = useAuth();

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={{ marginTop: 8 }}>
          <Text style={styles.sectionLabel}>Dealership</Text>
          <View style={[styles.card, { paddingVertical: 14 }]}>
            <View style={{ paddingVertical: 8 }}>
              <Text style={styles.sectionLabel}>Dealership name</Text>
              <Text style={{ color: "#0F172A", fontSize: 16, fontWeight: "800" }}>{user?.dealershipId || "Finance desk account"}</Text>
            </View>
            <View style={{ paddingVertical: 8 }}>
              <Text style={styles.sectionLabel}>Dealership ID</Text>
              <Text style={{ color: "#0F172A", fontSize: 15, fontWeight: "700" }}>{user?.dealershipId || "Not provided"}</Text>
            </View>
            <View style={{ paddingVertical: 8 }}>
              <Text style={styles.sectionLabel}>Portal</Text>
              <Text style={{ color: "#0F172A", fontSize: 15, fontWeight: "700" }}>Finance Desk</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
