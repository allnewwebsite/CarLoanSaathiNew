import { browserSessionPersistence, initializeAuth } from "firebase/auth";
import { app } from "./firebase.js";

export const auth = initializeAuth(app, { persistence: browserSessionPersistence });
