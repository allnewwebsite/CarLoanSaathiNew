import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "./src/auth/AuthProvider";
import { RealtimeProvider } from "./src/realtime/RealtimeProvider";
import { LoginScreen } from "./src/screens/LoginScreen";
import { CasesScreen } from "./src/screens/CasesScreen";
import { CaseDetailsScreen } from "./src/screens/CaseDetailsScreen";
import { UploadScreen } from "./src/screens/UploadScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { DealershipDetailsScreen } from "./src/screens/DealershipDetailsScreen";
import { AccountScreen } from "./src/screens/AccountScreen";
import { colors } from "./src/theme";

export type RootStackParamList = {
  Login: undefined;
  Cases: undefined;
  CaseDetails: { leadId: string };
  Upload: { leadId: string; documentType?: string };
  Account: undefined;
  Profile: undefined;
  DealershipDetails: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function AppNavigator() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShadowVisible: false,
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: "800", fontSize: 18 },
          headerStyle: { backgroundColor: colors.background },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {!user ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Cases" component={CasesScreen} options={{ headerShown: false }} />
            <Stack.Screen name="CaseDetails" component={CaseDetailsScreen} options={{ title: "Case details" }} />
            <Stack.Screen name="Upload" component={UploadScreen} options={{ title: "Upload documents" }} />
            <Stack.Screen name="Account" component={AccountScreen} options={{ title: "Account" }} />
            <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
            <Stack.Screen name="DealershipDetails" component={DealershipDetailsScreen} options={{ title: "Dealership Details" }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider>
        <RealtimeProvider>
          <AppNavigator />
        </RealtimeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
