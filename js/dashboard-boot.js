/**
 * IKLens — Dashboard boot
 * 1. Wait for auth
 * 2. Guard (redirect if not signed in)
 * 3. Paint avatar + notifications badge
 * 4. Boot router
 */

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import { ref, get, onValue } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js";
import { auth, database } from "./firebase-config.js";
import { initRouter } from "./router.js";

const USER_CACHE_KEY = "iklens_user_cache_v1";
const avatarImg      = document.getElementById("user-avatar");
const avatarFallback = document.getElementById("avatar-fallback");

/* ---------- helpers ---------- */
const firstString = (...vals) => vals.find(v => typeof v === "string" && v.trim())?.trim() || "";
const getInitials = (name) =>
  String(name || "User").trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map(p => p.charAt(0).toUpperCase()).join("") || "U";

function paintAvatar(displayName, photoURL) {
  if (!avatarImg || !avatarFallback) return;
  avatarFallback.textContent = getInitials(displayName);
  avatarFallback.style.display = "flex";
  avatarImg.classList.remove("loaded");
  avatarImg.removeAttribute("src");
  if (photoURL) {
    avatarImg.onload = () => {
      avatarImg.classList.add("loaded");
      avatarFallback.style.display = "none";
    };
    avatarImg.onerror = () => {
      avatarImg.classList.remove("loaded");
      avatarFallback.style.display = "flex";
    };
    avatarImg.src = photoURL;
  }
}

/* ---------- header scroll ---------- */
function setupHeaderScroll() {
  const header = document.getElementById("dash-header");
  if (!header) return;
  const update = () => header.classList.toggle("scrolled", window.scrollY > 10);
  update();
  window.addEventListener("scroll", update, { passive: true });
}

/* ---------- profile + notifications ---------- */
async function hydrateChrome(user) {
  try {
    let displayName = user.displayName || user.email?.split("@")[0] || "User";
    let photoURL = user.photoURL || "";

    let snap = await get(ref(database, `users/${user.uid}/profile`));
    let profile = snap.exists() ? snap.val() || {} : null;
    if (!profile) {
      snap = await get(ref(database, `users/${user.uid}`));
      if (snap.exists()) {
        profile = snap.val() || {};
        if (profile.profile && typeof profile.profile === "object") {
          profile = { ...profile, ...profile.profile };
        }
      }
    }
    if (profile) {
      displayName = firstString(profile.name, profile.fullName, profile.displayName, displayName);
      photoURL = firstString(profile.photoURL, profile.avatarURL, photoURL);
    }
    try { localStorage.setItem(USER_CACHE_KEY, JSON.stringify({ name: displayName, photoURL, uid: user.uid })); } catch {}
    paintAvatar(displayName, photoURL);

    // Notifications badge
    const unsubNotif = onValue(ref(database, `notifications/${user.uid}`), (ns) => {
      let unread = 0;
      if (ns.exists()) ns.forEach(c => { if (!c.val().read) unread++; });
      const badge = document.getElementById("dash-bell-badge");
      if (!badge) return;
      if (unread > 0) {
        badge.textContent = unread > 9 ? "9+" : unread;
        badge.style.display = "flex";
      } else {
        badge.style.display = "none";
      }
    });
    window.addEventListener("pagehide", () => { try { unsubNotif(); } catch {} });
  } catch (err) {
    console.error("[Boot] Profile hydration failed:", err);
    paintAvatar(user.displayName || user.email?.split("@")[0] || "User", "");
  }
}

/* ---------- boot ---------- */
function waitForFirstAuth() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    }, () => { unsub(); resolve(null); });
  });
}

(async function boot() {
  // Instant paint from cache
  try {
    const cached = JSON.parse(localStorage.getItem(USER_CACHE_KEY) || "null");
    if (cached?.name) paintAvatar(cached.name, cached.photoURL || "");
  } catch {}

  setupHeaderScroll();

  const user = await waitForFirstAuth();
  if (!user) {
    try { localStorage.removeItem(USER_CACHE_KEY); } catch {}
    window.location.replace("login.html");
    return;
  }

  // Start router immediately (home view renders while profile hydrates)
  initRouter();

  // Then hydrate avatar + notification badge in parallel
  hydrateChrome(user);
})();