import React from "react";
import { ScrollView, Text, View } from "react-native";
import { useAuth } from "../auth/AuthProvider";
import { Screen, styles } from "../components/Screen";

export function ProfileScreen() {
  const { user } = useAuth();

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={{ marginTop: 8 }}>
          <Text style={styles.sectionLabel}>Account</Text>
          <View style={[styles.card, { paddingVertical: 18 }]}>
            <Text style={{ color: "#0F172A", fontSize: 18, fontWeight: "800" }}>{user?.name || "Finance Desk User"}</Text>
            <Text style={[styles.meta, { marginTop: 8 }]}>{user?.email || "No email recorded"}</Text>
          </View>

          <View style={[styles.card, { paddingVertical: 12 }]}>
            <View style={{ paddingVertical: 8 }}>
              <Text style={styles.sectionLabel}>Role</Text>
              <Text style={{ color: "#0F172A", fontSize: 15, fontWeight: "700" }}>{user?.role || "finance-desk"}</Text>
            </View>
            <View style={{ paddingVertical: 8 }}>
              <Text style={styles.sectionLabel}>Account status</Text>
              <Text style={{ color: "#0F172A", fontSize: 15, fontWeight: "700" }}>
                {user?.accountActive === false ? "Inactive" : user?.accountApproved === false ? "Pending approval" : "Active"}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
