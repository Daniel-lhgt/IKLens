/**
 * IKLens V2 — Dashboard Initialization
 *
 * Handles:
 *   - Auth guard (redirect to login if not signed in)
 *   - Instant avatar paint from localStorage cache
 *   - Profile fetch from RTDB (users/{uid}/profile)
 *   - Fills both the mobile header avatar AND the sidebar user chip
 *
 * Depends on:
 *   - firebase-config.js (auth, database)
 *   - app.js (toast system available via window.IKLensApp)
 */

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js";
import { auth, database } from "./firebase-config.js";

const USER_CACHE_KEY = "iklens_user_cache_v1";

/* ---------- DOM ---------- */
const headerAvatarImg = document.getElementById("user-avatar");
const headerAvatarFallback = document.getElementById("avatar-fallback");
const sidebarAvatarImg = document.getElementById("sidebar-user-avatar-img");
const sidebarUserInitials = document.getElementById("sidebar-user-initials");
const sidebarUserName = document.getElementById("sidebar-user-name");
const appContent = document.getElementById("app-content");

/* ---------- HELPERS ---------- */

function firstString(...values) {
  return values.find(v => typeof v === "string" && v.trim())?.trim() || "";
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

function readCachedUser() {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object") ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedUser(data) {
  try {
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(data));
  } catch {}
}

function clearCachedUser() {
  try { localStorage.removeItem(USER_CACHE_KEY); } catch {}
}

/* ---------- PAINT AVATARS + SIDEBAR CHIP ---------- */

function paintAvatars(displayName, photoURL) {
  const initials = getInitials(displayName);

  // Header avatar
  if (headerAvatarFallback) headerAvatarFallback.textContent = initials;

  if (headerAvatarImg) {
    headerAvatarImg.classList.remove("loaded");
    headerAvatarImg.removeAttribute("src");

    if (photoURL) {
      headerAvatarImg.onload = () => headerAvatarImg.classList.add("loaded");
      headerAvatarImg.onerror = () => headerAvatarImg.classList.remove("loaded");
      headerAvatarImg.src = photoURL;
    }
  }

  // Sidebar avatar
  if (sidebarUserInitials) sidebarUserInitials.textContent = initials;

  if (sidebarAvatarImg) {
    sidebarAvatarImg.classList.remove("loaded");
    sidebarAvatarImg.removeAttribute("src");

    if (photoURL) {
      sidebarAvatarImg.onload = () => sidebarAvatarImg.classList.add("loaded");
      sidebarAvatarImg.onerror = () => sidebarAvatarImg.classList.remove("loaded");
      sidebarAvatarImg.src = photoURL;
    }
  }

  // Sidebar user name
  if (sidebarUserName) {
    sidebarUserName.textContent = displayName || "User";
  }
}

/* ---------- AUTH GUARD + PROFILE LOAD ---------- */

function init() {
  /* Instant paint from cache (returning users see their avatar immediately). */
  const cached = readCachedUser();
  if (cached) {
    paintAvatars(cached.name || "User", cached.photoURL || "");
  }

  const unsubscribe = onAuthStateChanged(
    auth,
    async (user) => {
      if (!user) {
        clearCachedUser();
        window.location.replace("login.html");
        return;
      }

      try {
        let displayName =
          user.displayName ||
          user.email?.split("@")[0] ||
          "User";
        let photoURL = user.photoURL || "";

        // Try users/{uid}/profile first
        let snap = await get(ref(database, `users/${user.uid}/profile`));
        let profile = null;

        if (snap.exists()) {
          profile = snap.val() || {};
        } else {
          // Fallback to users/{uid}
          snap = await get(ref(database, `users/${user.uid}`));
          if (snap.exists()) {
            profile = snap.val() || {};
            if (profile.profile && typeof profile.profile === "object") {
              profile = { ...profile, ...profile.profile };
            }
          }
        }

        if (profile) {
          displayName = firstString(
            profile.name,
            profile.fullName,
            profile.displayName,
            displayName
          );
          photoURL = firstString(
            profile.photoURL,
            profile.avatarURL,
            profile.avatarUrl,
            photoURL
          );
        }

        writeCachedUser({ name: displayName, photoURL, uid: user.uid });
        paintAvatars(displayName, photoURL);

      } catch (error) {
        console.error("[IKLens Dashboard] Profile load failed:", error);
        const fallbackName =
          user.displayName ||
          user.email?.split("@")[0] ||
          "User";
        paintAvatars(fallbackName, "");
      }
    },
    (error) => {
      console.error("[IKLens Dashboard] Auth check failed:", error);
      // Redirect to error.html on catastrophic auth failure
      const errorURL = new URL("error.html", document.baseURI);
      errorURL.searchParams.set(
        "message",
        "We couldn't verify your sign-in session. Please try again."
      );
      errorURL.searchParams.set("code", "AUTH_CHECK_FAILED");
      errorURL.searchParams.set("from", "home");
      window.location.replace(errorURL.href);
    }
  );

  window.addEventListener("pagehide", () => {
    try { unsubscribe(); } catch (_) {}
  });
}

/* ---------- RUN ---------- */

if (!headerAvatarImg || !headerAvatarFallback || !appContent) {
  console.error("[IKLens Dashboard] Required DOM elements missing.");
} else {
  init();
}