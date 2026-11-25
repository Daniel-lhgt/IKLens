/**
 * IKLens V2 — Shared Application Runtime
 *
 * Every page loads this file. It provides:
 *   - A unified toast system (auto-hide, persistent, dismissable)
 *   - Automatic offline/online notifications
 *   - Auto-lazy-loading of images with fade-in
 *   - Debounce, throttle, formatting, clipboard helpers
 *   - Auth passthrough (getCurrentUser, onAuthReady, logout)
 *   - PWA install prompt capture and version check hooks
 *
 * Global namespace: window.IKLensApp
 *
 * No dependencies on other IKLens files except firebase-config.js.
 */

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";

import {
  ref,
  get
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js";

import { auth, database } from "./firebase-config.js";

const IKLensApp = (() => {

  /* ============================================================
     AUTH STATE
     ============================================================ */

  let currentUser = auth.currentUser || null;
  let authInitialized = false;
  let authUnsubscribe = null;

  let authReadyResolve;
  const authReady = new Promise((resolve) => {
    authReadyResolve = resolve;
  });

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
          new CustomEvent("iklens:auth-changed", { detail: { user } })
        );
      },
      (error) => {
        console.error("[IKLens] Auth listener error:", error);
        if (!authInitialized) {
          authInitialized = true;
          authReadyResolve(null);
        }
      }
    );
  }

  async function getCurrentUser() {
    await authReady;
    return currentUser;
  }

  function onAuthReady() {
    return authReady;
  }

  async function logout() {
    try {
      await signOut(auth);
      window.location.replace("login.html");
    } catch (error) {
      console.error("[IKLens] Logout failed:", error);
      throw error;
    }
  }

  /* ============================================================
     TOAST SYSTEM
     ============================================================ */

  let toastStack = null;

  function ensureToastStack() {
    if (toastStack && document.body.contains(toastStack)) return toastStack;

    toastStack = document.createElement("div");
    toastStack.className = "toast-stack";
    toastStack.setAttribute("role", "status");
    toastStack.setAttribute("aria-live", "polite");
    document.body.appendChild(toastStack);
    return toastStack;
  }

  function createToastElement(message, type, persistent) {
    const el = document.createElement("div");
    el.className = "toast " + type + (persistent ? " persistent" : "");

    const text = document.createElement("span");
    text.textContent = message;
    el.appendChild(text);

    if (persistent) {
      const btn = document.createElement("button");
      btn.className = "toast-dismiss";
      btn.type = "button";
      btn.setAttribute("aria-label", "Dismiss");
      btn.textContent = "×";
      btn.addEventListener("click", () => el.remove());
      el.appendChild(btn);
    }

    return el;
  }

  function toast(message, type = "default", duration = 3200) {
    const stack = ensureToastStack();
    const el = createToastElement(message, type, false);

    stack.appendChild(el);

    // Force reflow so the "show" class animates in.
    void el.offsetWidth;
    el.classList.add("show");

    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 300);
    }, duration);

    return el;
  }

  function toastSuccess(message, duration) {
    return toast(message, "success", duration);
  }

  function toastError(message, duration) {
    return toast(message, "error", duration);
  }

  function toastWarning(message, duration) {
    return toast(message, "warning", duration);
  }

  function persistentToast(message, type = "warning") {
    const stack = ensureToastStack();
    const el = createToastElement(message, type, true);
    stack.appendChild(el);
    void el.offsetWidth;
    el.classList.add("show");
    return el;
  }

  /* ============================================================
     OFFLINE / ONLINE SYSTEM
     ============================================================ */

  let offlineToastEl = null;

  function handleOffline() {
    if (offlineToastEl && document.body.contains(offlineToastEl)) return;
    offlineToastEl = persistentToast(
      "📡 You're offline. Changes will sync when you reconnect.",
      "warning"
    );
  }

  function handleOnline() {
    if (offlineToastEl) {
      offlineToastEl.remove();
      offlineToastEl = null;
    }
    toastSuccess("✅ Back online");
  }

  function initOfflineDetection() {
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      handleOffline();
    }
  }

  /* ============================================================
     LAZY IMAGES + FADE-IN
     ============================================================ */

  function applyLazyAttributes(img) {
    if (!img.hasAttribute("loading") && !img.hasAttribute("data-eager")) {
      img.setAttribute("loading", "lazy");
    }
    if (!img.hasAttribute("decoding")) {
      img.setAttribute("decoding", "async");
    }
  }

  function attachFadeIn(img) {
    if (img.hasAttribute("data-eager")) return;
    if (img.dataset.fadeAttached === "true") return;
    img.dataset.fadeAttached = "true";

    if (img.complete && img.naturalWidth > 0) {
      img.classList.add("loaded");
      return;
    }

    img.classList.add("loaded-pending");
    img.addEventListener("load", () => {
      img.classList.remove("loaded-pending");
      img.classList.add("loaded");
    }, { once: true });
    img.addEventListener("error", () => {
      img.classList.remove("loaded-pending");
    }, { once: true });
  }

  function processImage(img) {
    if (!(img instanceof HTMLImageElement)) return;
    applyLazyAttributes(img);
    attachFadeIn(img);
  }

  function processAllImages(root = document) {
    root.querySelectorAll("img").forEach(processImage);
  }

  function initLazyImages() {
    processAllImages();

    // Watch for images added later (views, modals, gallery).
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          if (node.tagName === "IMG") {
            processImage(node);
          } else if (node.querySelectorAll) {
            node.querySelectorAll("img").forEach(processImage);
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ============================================================
     UTILITY HELPERS
     ============================================================ */

  function debounce(fn, wait = 250) {
    let t;
    return function debounced(...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function throttle(fn, wait = 100) {
    let last = 0;
    let timer = null;
    return function throttled(...args) {
      const now = Date.now();
      const remaining = wait - (now - last);
      if (remaining <= 0) {
        if (timer) { clearTimeout(timer); timer = null; }
        last = now;
        fn.apply(this, args);
      } else if (!timer) {
        timer = setTimeout(() => {
          last = Date.now();
          timer = null;
          fn.apply(this, args);
        }, remaining);
      }
    };
  }

  function formatDate(ts, opts) {
    if (!ts || typeof ts !== "number") return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
      ...(opts || {})
    });
  }

  function safeImageUrl(url) {
    if (typeof url !== "string") return "";
    const t = url.trim();
    if (!t) return "";
    if (
      /^https?:\/\//i.test(t) ||
      /^\/[^/]/.test(t) ||
      /^images\//i.test(t) ||
      /^\.\.?\//.test(t)
    ) {
      return t;
    }
    return "";
  }

  function getInitials(name) {
    return String(name || "User")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part.charAt(0).toUpperCase())
      .join("") || "U";
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      // Fallback for older browsers / non-secure contexts
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (err) {
      console.error("[IKLens] Copy failed:", err);
      return false;
    }
  }

  function prefersReducedMotion() {
    return window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /* ============================================================
     PWA INSTALL PROMPT CAPTURE
     ============================================================ */

  let deferredInstallPrompt = null;

  function initInstallPrompt() {
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      window.dispatchEvent(new CustomEvent("iklens:install-available"));
    });

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      window.dispatchEvent(new CustomEvent("iklens:install-completed"));
    });
  }

  async function promptInstall() {
    if (!deferredInstallPrompt) return false;
    deferredInstallPrompt.prompt();
    const result = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    return result.outcome === "accepted";
  }

  function canInstall() {
    return deferredInstallPrompt !== null;
  }

  /* ============================================================
     APP VERSION CHECK (Phase 4 prep)
     ============================================================ */

  async function checkAppVersion(currentVersion) {
    try {
      const snap = await get(ref(database, "app_config/latest_version"));
      if (!snap.exists()) return { updateAvailable: false };
      const latest = snap.val();
      return {
        updateAvailable: latest !== currentVersion,
        latestVersion: latest,
        currentVersion
      };
    } catch (err) {
      console.warn("[IKLens] Version check failed:", err);
      return { updateAvailable: false };
    }
  }

  /* ============================================================
     LOGOUT CONTROLS (data-action="logout" delegation)
     ============================================================ */

  function setupLogoutControls() {
    if (setupLogoutControls._attached) return;
    setupLogoutControls._attached = true;

    document.addEventListener("click", async (event) => {
      const btn = event.target.closest(
        '[data-action="logout"], [data-logout]'
      );
      if (!btn) return;
      event.preventDefault();
      if (btn.dataset.loggingOut === "true") return;
      btn.dataset.loggingOut = "true";
      try {
        await logout();
      } catch {
        btn.dataset.loggingOut = "false";
        toastError("We couldn't log you out. Please try again.");
      }
    });
  }

  /* ============================================================
     HEADER SCROLL
     ============================================================ */

  function setupHeader() {
    const header = document.getElementById("dash-header");
    if (!header) return;

    if (setupHeader._attached) {
      header.classList.toggle("scrolled", window.scrollY > 10);
      return;
    }

    const update = () => {
      header.classList.toggle("scrolled", window.scrollY > 10);
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    setupHeader._attached = true;
  }

  /* ============================================================
     INIT
     ============================================================ */

  function init() {
    initAuthListener();
    setupLogoutControls();
    setupHeader();
    initOfflineDetection();
    initLazyImages();
    initInstallPrompt();
  }

  function dispose() {
    if (authUnsubscribe) {
      try { authUnsubscribe(); } catch (_) {}
      authUnsubscribe = null;
    }
    window.removeEventListener("offline", handleOffline);
    window.removeEventListener("online", handleOnline);
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */

  return {
    // Auth
    init,
    dispose,
    getCurrentUser,
    onAuthReady,
    logout,
    get authInitialized() { return authInitialized; },

    // Toast
    toast,
    toastSuccess,
    toastError,
    toastWarning,
    persistentToast,

    // Lazy images
    processAllImages,
    processImage,

    // Utilities
    debounce,
    throttle,
    formatDate,
    safeImageUrl,
    getInitials,
    copyToClipboard,
    prefersReducedMotion,

    // PWA
    promptInstall,
    canInstall,
    checkAppVersion
  };
})();

/* ============================================================
   GLOBAL EXPOSURE
   ============================================================ */

window.IKLensApp = IKLensApp;

/* ============================================================
   AUTO INIT
   ============================================================ */

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", IKLensApp.init, { once: true });
} else {
  IKLensApp.init();
}

window.addEventListener("pagehide", () => IKLensApp.dispose());

/* ============================================================
   MODULE EXPORTS (for files that import via ES modules)
   ============================================================ */

export default IKLensApp;
export const getCurrentUser = IKLensApp.getCurrentUser;
export const onAuthReady = IKLensApp.onAuthReady;
export const logout = IKLensApp.logout;