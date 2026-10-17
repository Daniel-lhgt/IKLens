// IKLens — Main Application Controller
// Shared app utilities for authentication and dashboard behavior.
// Realtime Database only — no Firestore.

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";

import { auth } from "./firebase-config.js";

const IKLensApp = (() => {
  /* ---------- STATE ---------- */
  let currentUser = auth.currentUser || null;
  let authInitialized = false;

  let authReadyResolve;
  const authReady = new Promise((resolve) => {
    authReadyResolve = resolve;
  });

  let authUnsubscribe = null;

  /* ---------- INIT AUTH LISTENER ---------- */
  function initAuthListener() {
    if (authUnsubscribe) return;

    authUnsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        currentUser = user;

        if (!authInitialized) {
          authInitialized = true;
          authReadyResolve(user);
        }

        window.dispatchEvent(
          new CustomEvent("iklens:auth-changed", {
            detail: { user }
          })
        );
      },
      (error) => {
        console.error("IKLens authentication error:", error);

        if (!authInitialized) {
          authInitialized = true;
          authReadyResolve(null);
        }
      }
    );
  }

  /* ---------- PUBLIC: getCurrentUser ---------- */
  async function getCurrentUser() {
    await authReady;
    return currentUser;
  }

  /* ---------- PUBLIC: onAuthReady ---------- */
  function onAuthReady() {
    return authReady;
  }

  /* ---------- PUBLIC: logout ---------- */
  async function logout() {
    try {
      await signOut(auth);
      window.location.replace("login.html");
    } catch (error) {
      console.error("IKLens logout failed:", error);
      throw error;
    }
  }

  /* ---------- LOGOUT CONTROLS ---------- */
  function setupLogoutControls() {
    if (setupLogoutControls._attached) return;
    setupLogoutControls._attached = true;

    document.addEventListener("click", async (event) => {
      const logoutButton = event.target.closest(
        '[data-action="logout"], [data-logout]'
      );

      if (!logoutButton) return;

      event.preventDefault();

      if (logoutButton.dataset.loggingOut === "true") return;

      logoutButton.dataset.loggingOut = "true";

      try {
        await logout();
      } catch {
        logoutButton.dataset.loggingOut = "false";
        alert("We couldn't log you out. Please try again.");
      }
    });
  }

  /* ---------- HEADER SCROLL ---------- */
  function setupHeader() {
    const header = document.getElementById("dash-header");

    if (!header) return;

    if (setupHeader._attached) {
      // Re-run once in case the header was re-rendered.
      header.classList.toggle("scrolled", window.scrollY > 10);
      return;
    }

    const updateHeader = () => {
      header.classList.toggle("scrolled", window.scrollY > 10);
    };

    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });

    setupHeader._attached = true;
  }

  /* ---------- INIT ---------- */
  function init() {
    initAuthListener();
    setupLogoutControls();
    setupHeader();
  }

  /* ---------- CLEANUP ---------- */
  function dispose() {
    if (authUnsubscribe) {
      try { authUnsubscribe(); } catch (_) {}
      authUnsubscribe = null;
    }
  }

  /* ---------- PUBLIC API ---------- */
  return {
    init,
    dispose,
    getCurrentUser,
    onAuthReady,
    logout,
    get authInitialized() {
      return authInitialized;
    }
  };
})();

/* ---------- EXPOSE GLOBALLY ---------- */
window.IKLensApp = IKLensApp;

/* ---------- AUTO INIT ---------- */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", IKLensApp.init, {
    once: true
  });
} else {
  IKLensApp.init();
}

/* ---------- CLEANUP ON PAGE HIDE ---------- */
window.addEventListener("pagehide", () => {
  IKLensApp.dispose();
});

/* ---------- EXPORTS ---------- */
export default IKLensApp;
export const getCurrentUser = IKLensApp.getCurrentUser;
export const onAuthReady = IKLensApp.onAuthReady;
export const logout = IKLensApp.logout;