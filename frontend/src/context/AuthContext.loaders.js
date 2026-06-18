let firebaseAuthLoaded = false;
let realtimeClientLoaded = false;
let apiClientPromise = null;

export async function loadApiClient() {
  if (!apiClientPromise) apiClientPromise = import("../services/api.js").then((module) => module.api);
  return apiClientPromise;
}

export async function loadFirebaseAuth() {
  const [firebaseAuth, authModule] = await Promise.all([
    import("firebase/auth"),
    import("../services/firebaseAuth.js"),
  ]);
  firebaseAuthLoaded = true;
  return { ...firebaseAuth, auth: authModule.auth };
}

export async function loadRealtimeClient() {
  const realtimeClient = await import("../services/realtimeClient.js");
  realtimeClientLoaded = true;
  return realtimeClient;
}

export function stopRealtimeIfLoaded(identity) {
  if (!realtimeClientLoaded) return;
  loadRealtimeClient().then(({ stopRealtimeClient }) => stopRealtimeClient(identity));
}

export function hasLoadedFirebaseAuth() {
  return firebaseAuthLoaded;
}
