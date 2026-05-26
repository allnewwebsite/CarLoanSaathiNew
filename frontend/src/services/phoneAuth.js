import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { auth } from "./firebase.js";

export function createRecaptchaVerifier(containerId = "recaptcha-container") {
  return new RecaptchaVerifier(auth, containerId, {
    size: "invisible",
  });
}

export async function sendOtp(phoneNumber, appVerifier) {
  return signInWithPhoneNumber(auth, phoneNumber, appVerifier);
}

export async function confirmOtp(confirmationResult, code) {
  return confirmationResult.confirm(code);
}
