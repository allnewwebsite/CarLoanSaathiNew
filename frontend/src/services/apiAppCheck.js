const APP_CHECK_CACHE_TTL_MS = 4 * 60 * 1000;

let appCheckCache = { token: "", expiresAt: 0, promise: null };
let appCheckModulePromise = null;

async function loadAppCheck() {
  if (!appCheckModulePromise) {
    appCheckModulePromise = Promise.all([
      import("firebase/app-check"),
      import("./firebaseAppCheck.js"),
    ])
      .then(([appCheckModule, firebaseModule]) => ({
        getToken: appCheckModule.getToken,
        appCheck: firebaseModule.appCheck,
      }))
      .catch(() => ({ getToken: null, appCheck: null }));
  }
  return appCheckModulePromise;
}

export async function appCheckHeaderToken() {
  if (!import.meta.env.VITE_FIREBASE_APPCHECK_RECAPTCHA_SITE_KEY) return "";
  if (appCheckCache.token && appCheckCache.expiresAt > Date.now()) return appCheckCache.token;
  if (!appCheckCache.promise) {
    appCheckCache.promise = loadAppCheck()
      .then(({ appCheck, getToken }) => {
        if (!appCheck || typeof getToken !== "function") return "";
        return getToken(appCheck, false);
      })
      .then((token) => {
        appCheckCache = {
          token: typeof token === "string" ? token : token?.token || "",
          expiresAt: Date.now() + APP_CHECK_CACHE_TTL_MS,
          promise: null,
        };
        return appCheckCache.token;
      })
      .catch(() => {
        appCheckCache.promise = null;
        return "";
      });
  }
  return appCheckCache.promise;
}
