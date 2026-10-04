import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";
import { useAuth } from "../auth/AuthProvider";
import { Card, Screen, styles } from "../components/Screen";
import { colors } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Account">;

export function AccountScreen({ navigation }: Props) {
  const { user, signOut } = useAuth();

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        <View style={{ marginTop: 4 }}>
          <Text style={styles.sectionLabel}>Profile</Text>
          <Card style={{ paddingVertical: 14 }}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "800" }}>{user?.name || "Finance Desk User"}</Text>
            <Text style={[styles.meta, { marginTop: 6 }]}>{user?.email || "No email recorded"}</Text>
            <Text style={[styles.meta, { marginTop: 6 }]}>Role: {user?.role || "finance-desk"}</Text>
          </Card>

          <Text style={[styles.sectionLabel, { marginTop: 8 }]}>Dealership</Text>
          <Card style={{ paddingVertical: 14 }}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: "800" }}>{user?.dealershipName || user?.dealershipId || "Finance desk account"}</Text>
            <Text style={[styles.meta, { marginTop: 6 }]}>Dealership ID: {user?.dealershipId || "Not provided"}</Text>
            <Text style={[styles.meta, { marginTop: 6 }]}>Portal: Finance Desk</Text>
          </Card>

          <Text style={[styles.sectionLabel, { marginTop: 8 }]}>Account</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Logout"
            onPress={() => void signOut()}
            style={({ pressed }) => [{
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 16,
              paddingHorizontal: 16,
              paddingVertical: 14,
              marginTop: 8,
              opacity: pressed ? 0.9 : 1,
            }]}
          >
            <Text style={{ color: colors.danger, fontSize: 16, fontWeight: "800" }}>Logout</Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}
