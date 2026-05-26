import { getStorage } from "firebase/storage";
import { app } from "./firebase.js";

export const storage = getStorage(app);
