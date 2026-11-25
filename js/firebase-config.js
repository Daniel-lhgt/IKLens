/**
 * IKLens V2 — Shared Firebase Configuration
 *
 * Central place for Firebase initialization and shared services.
 * Every page that needs auth or database imports from here.
 *
 * Services used:
 *   - Auth          (email/password sign-in, session persistence)
 *   - Realtime DB   (templates, users, submissions, feedback, admins)
 *   - Storage       (kept for future use — not currently used by the app)
 *
 * Firebase SDK version: 13.0.0 (ESM, CDN-loaded)
 *
 * The config below is project-specific and safe to keep public.
 * Security is enforced by Realtime Database rules, not by hiding keys.
 */

import {
  initializeApp,
  getApp,
  getApps
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";

import {
  getDatabase
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js";

import {
  getStorage
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-storage.js";

/* ============================================================
   CONFIGURATION
   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyALa_PGUuqqo6dndDrsq5wTkkvuPjjggok",
  authDomain: "iklens-9354a.firebaseapp.com",
  databaseURL: "https://iklens-9354a-default-rtdb.firebaseio.com",
  projectId: "iklens-9354a",
  storageBucket: "iklens-9354a.firebasestorage.app",
  messagingSenderId: "393017001832",
  appId: "1:393017001832:web:b750e8a3013148e21778dd",
  measurementId: "G-MCSFX5BL5M"
};

const FIREBASE_SDK_VERSION = "13.0.0";

/* ============================================================
   APP INITIALIZATION (once per page load)
   ============================================================ */

function getFirebaseApp() {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

const app = getFirebaseApp();

/* ============================================================
   SHARED SERVICES
   ============================================================ */

export const auth = getAuth(app);
export const database = getDatabase(app);
export const storage = getStorage(app);

/* ============================================================
   AUTH READY HELPER
   Resolves when Firebase has restored the session from
   storage (or determined the user is signed out).
   Use this to skip skeleton flashes on returning visits.
   ============================================================ */

export function waitForAuthReady(timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (auth.currentUser !== null) {
      resolve(auth.currentUser);
      return;
    }

    let settled = false;
    let unsubscribe = () => {};

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { unsubscribe(); } catch (_) {}
      resolve(auth.currentUser);
    }, timeoutMs);

    unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { unsubscribe(); } catch (_) {}
        resolve(user);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { unsubscribe(); } catch (_) {}
        resolve(null);
      }
    );
  });
}

/* ============================================================
   ONLINE STATE HELPER
   ============================================================ */

export function isOnline() {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

/* ============================================================
   RE-EXPORTS (read-only, useful for diagnostics & PWA)
   ============================================================ */

export { firebaseConfig, FIREBASE_SDK_VERSION };
export { app };
export default app;