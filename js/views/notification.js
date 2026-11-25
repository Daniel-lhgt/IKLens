import { ref, get, update } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js";
import { auth, database } from "../firebase-config.js";

let controller = null;

/* ============================================================
   HELPERS
   ============================================================ */
function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

const TYPE_ICONS = {
  submission_approved: "✅",
  submission_rejected: "❌",
  submission_pending:  "⏳",
  new_follower:        "👤",
  system:              "📢",
  default:             "🔔",
};

function getIcon(n) {
  return n.icon || TYPE_ICONS[n.type] || TYPE_ICONS.default;
}

function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ============================================================
   BADGE (shared with dashboard shell)
   ============================================================ */
function updateBellBadge(unreadCount) {
  const badge = document.getElementById("dash-bell-badge");
  if (!badge) return;
  if (unreadCount > 0) {
    badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
    badge.style.display = "";
  } else {
    badge.style.display = "none";
    badge.textContent = "0";
  }
}

/* ============================================================
   FIREBASE
   ============================================================ */
async function markRead(uid, id) {
  try {
    await update(ref(database, `notifications/${uid}/${id}`), { read: true });
  } catch {}
}

async function markAllRead(uid, ids) {
  if (!ids.length) return;
  const updates = {};
  ids.forEach(id => { updates[`notifications/${uid}/${id}/read`] = true; });
  try {
    await update(ref(database), updates);
  } catch {}
}

/* ============================================================
   ORIGIN TRACKING — for back button (A + B)
   ============================================================ */
const ORIGIN_KEY = "iklens:notif-origin";

function captureOrigin() {
  try {
    const prev = sessionStorage.getItem(ORIGIN_KEY);
    if (prev) return; // already captured for this visit
    // Read current route before navigating to /notification
    const raw = window.location.hash.replace(/^#\/?/, "").trim();
    const from = raw.split("?")[0].split("/")[0] || "home";
    if (from !== "notification") {
      sessionStorage.setItem(ORIGIN_KEY, from);
    }
  } catch {}
}

function getOrigin() {
  try {
    return sessionStorage.getItem(ORIGIN_KEY) || "home";
  } catch {
    return "home";
  }
}

function clearOrigin() {
  try { sessionStorage.removeItem(ORIGIN_KEY); } catch {}
}

function goBack() {
  // If user navigated within SPA and has history, use it (preserves scroll, filters, etc.)
  if (window.history.length > 1 && document.referrer !== "") {
    window.history.back();
    // Safety net: if history.back() doesn't fire a route change (e.g. off-site referrer),
    // fall through after a beat.
    setTimeout(() => {
      const current = window.location.hash.replace(/^#\/?/, "").split("?")[0];
      if (current === "notification") {
        const origin = getOrigin();
        clearOrigin();
        window.IKLensRouter.navigate(origin || "home");
      }
    }, 120);
    return;
  }
  // Direct landing — no in-app history. Go to origin (or home).
  const origin = getOrigin();
  clearOrigin();
  window.IKLensRouter.navigate(origin || "home");
}

/* ============================================================
   RENDER STATES
   ============================================================ */
function renderSkeletons(listEl) {
  listEl.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    const s = document.createElement("div");
    s.className = "notif-skeleton";
    s.innerHTML = `
      <div class="notif-skeleton-icon"></div>
      <div class="notif-skeleton-body">
        <div class="notif-skeleton-line notif-skeleton-line-lg"></div>
        <div class="notif-skeleton-line notif-skeleton-line-sm"></div>
      </div>
    `;
    listEl.appendChild(s);
  }
}

function renderEmpty(listEl) {
  listEl.innerHTML = `
    <div class="notif-empty">
      <div class="notif-empty-circle" aria-hidden="true">🔔</div>
      <h2 class="notif-empty-title">You're all caught up</h2>
      <p class="notif-empty-desc">
        When something needs your attention — like a submission approval or a new template — it'll show up here.
      </p>
    </div>
  `;
}

function renderError(listEl, message, onRetry) {
  listEl.innerHTML = `
    <div class="notif-error" role="alert">
      <div class="notif-error-icon" aria-hidden="true">⚠️</div>
      <div class="notif-error-body">
        <h3>Couldn't load notifications</h3>
        <p>${esc(message || "Check your connection and try again.")}</p>
        <button type="button" class="notif-retry-btn" id="notif-retry">Retry</button>
      </div>
    </div>
  `;
  const btn = listEl.querySelector("#notif-retry");
  if (btn) btn.addEventListener("click", onRetry);
}

function renderList(listEl, items, uid, onMarkAllUpdate) {
  listEl.innerHTML = "";

  for (const n of items) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "notif-item" + (n.read ? "" : " unread");
    card.setAttribute("aria-label", esc(n.title || "Notification"));

    const icon = getIcon(n);
    const hasRoute = n.route && typeof n.route === "string";

    card.innerHTML = `
      <div class="notif-icon" aria-hidden="true">${esc(icon)}</div>
      <div class="notif-body">
        <div class="notif-title">${esc(n.title || "Notification")}</div>
        ${n.message ? `<div class="notif-msg">${esc(n.message)}</div>` : ""}
        <div class="notif-meta">
          ${n.createdAt ? `<span class="notif-time">${timeAgo(n.createdAt)}</span>` : ""}
          ${hasRoute ? `<span class="notif-go" aria-hidden="true">Open ›</span>` : ""}
        </div>
      </div>
      ${n.read ? "" : `<span class="notif-dot" aria-label="Unread"></span>`}
    `;

    card.addEventListener("click", async () => {
      if (!n.read) {
        card.classList.remove("unread");
        const dot = card.querySelector(".notif-dot");
        if (dot) dot.remove();
        await markRead(uid, n.id);
        // Refresh badge
        const remaining = listEl.querySelectorAll(".notif-item.unread").length;
        updateBellBadge(remaining);
        if (onMarkAllUpdate) onMarkAllUpdate(remaining);
      }
      if (hasRoute) {
        window.IKLensRouter.navigate(n.route, n.params || {});
      }
    });

    listEl.appendChild(card);
  }
}

/* ============================================================
   VIEW
   ============================================================ */
export default {
  title: "Notifications — IKLens",

  template: () => `
    <section class="notif-view" data-view="notification">

      <div class="notif-topbar">
        <button type="button" class="notif-back-btn" id="notif-back" aria-label="Go back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div class="notif-title-wrap">
          <h1>Notifications</h1>
          <span class="notif-unread-count" id="notif-unread-count" hidden></span>
        </div>
        <button type="button" class="notif-markall-btn" id="notif-markall" hidden>
          Mark all read
        </button>
      </div>

      <div class="notif-list" id="notif-list"></div>
    </section>
  `,

  styles: `
    .notif-view {
      width: 100%;
      max-width: 720px;
      margin: 0 auto;
      padding: 4px 0 40px;
    }

    /* ===== Topbar ===== */
    .notif-topbar {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 22px;
    }
    .notif-back-btn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: 1px solid var(--dash-border);
      background: var(--dash-surface);
      color: var(--dash-text-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s, border-color 0.15s, transform 0.1s;
    }
    .notif-back-btn svg { width: 18px; height: 18px; }
    .notif-back-btn:hover {
      background: var(--dash-surface-elevated);
      border-color: rgba(255,255,255,0.18);
    }
    .notif-back-btn:active { transform: scale(0.95); }
    .notif-back-btn:focus-visible {
      outline: 2px solid var(--dash-cyan);
      outline-offset: 3px;
    }

    .notif-title-wrap {
      display: flex;
      align-items: baseline;
      gap: 10px;
      flex: 1;
      min-width: 0;
    }
    .notif-title-wrap h1 {
      font-size: 1.5rem;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .notif-unread-count {
      font-size: 0.78rem;
      font-weight: 700;
      color: var(--dash-cyan);
      background: rgba(0,210,255,0.12);
      padding: 3px 9px;
      border-radius: 999px;
      white-space: nowrap;
    }
    .notif-unread-count[hidden] { display: none; }

    .notif-markall-btn {
      padding: 8px 14px;
      border-radius: 999px;
      background: transparent;
      border: 1px solid var(--dash-border);
      color: var(--dash-text-secondary);
      font-size: 0.78rem;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .notif-markall-btn:hover {
      background: var(--dash-surface-elevated);
      border-color: rgba(255,255,255,0.18);
      color: var(--dash-text-primary);
    }
    .notif-markall-btn[hidden] { display: none; }

    /* ===== List ===== */
    .notif-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* ===== Notification item ===== */
    .notif-item {
      position: relative;
      display: flex;
      gap: 14px;
      padding: 16px 18px;
      background: var(--dash-surface);
      border: 1px solid var(--dash-border);
      border-radius: 14px;
      cursor: pointer;
      text-align: left;
      font: inherit;
      color: inherit;
      transition: background 0.15s, border-color 0.15s, transform 0.1s;
      width: 100%;
    }
    .notif-item:hover {
      background: var(--dash-surface-elevated);
      border-color: rgba(255,255,255,0.14);
    }
    .notif-item:active { transform: scale(0.995); }
    .notif-item:focus-visible {
      outline: 2px solid var(--dash-cyan);
      outline-offset: 2px;
    }
    .notif-item.unread {
      border-left: 3px solid var(--dash-cyan);
      padding-left: 15px;
    }

    .notif-icon {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: rgba(0,210,255,0.1);
      border: 1px solid rgba(0,210,255,0.18);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.05rem;
      flex-shrink: 0;
    }

    .notif-body { flex: 1; min-width: 0; }
    .notif-title {
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--dash-text-primary);
      margin-bottom: 3px;
      line-height: 1.35;
    }
    .notif-msg {
      font-size: 0.85rem;
      color: var(--dash-text-secondary);
      line-height: 1.5;
      word-break: break-word;
    }
    .notif-meta {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 6px;
    }
    .notif-time {
      font-size: 0.72rem;
      color: var(--dash-text-muted);
    }
    .notif-go {
      font-size: 0.72rem;
      color: var(--dash-cyan);
      font-weight: 600;
    }

    .notif-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--dash-cyan);
      box-shadow: 0 0 8px rgba(0,210,255,0.6);
      flex-shrink: 0;
      align-self: center;
    }

    /* ===== Empty state ===== */
    .notif-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 56px 20px;
    }
    .notif-empty-circle {
      width: 88px;
      height: 88px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.2rem;
      margin-bottom: 20px;
      background: radial-gradient(circle at 30% 30%, rgba(0,210,255,0.15), rgba(138,43,226,0.1));
      border: 1px solid rgba(0,210,255,0.2);
      box-shadow: 0 0 30px rgba(0,210,255,0.08);
      opacity: 0.9;
    }
    .notif-empty-title {
      font-size: 1.15rem;
      font-weight: 800;
      color: var(--dash-text-primary);
      margin-bottom: 8px;
      letter-spacing: -0.01em;
    }
    .notif-empty-desc {
      font-size: 0.88rem;
      color: var(--dash-text-secondary);
      line-height: 1.6;
      max-width: 340px;
    }

    /* ===== Error state ===== */
    .notif-error {
      display: flex;
      gap: 14px;
      padding: 20px;
      background: rgba(248, 113, 113, 0.08);
      border: 1px solid rgba(248, 113, 113, 0.25);
      border-radius: 14px;
    }
    .notif-error-icon { font-size: 1.5rem; line-height: 1; flex-shrink: 0; }
    .notif-error-body h3 {
      font-size: 1rem;
      font-weight: 700;
      color: var(--dash-text-primary);
      margin-bottom: 4px;
    }
    .notif-error-body p {
      font-size: 0.875rem;
      color: var(--dash-text-secondary);
      margin-bottom: 12px;
      line-height: 1.5;
    }
    .notif-retry-btn {
      padding: 8px 18px;
      border-radius: 999px;
      border: none;
      background: var(--dash-gradient);
      color: #fff;
      font-size: 0.85rem;
      font-weight: 700;
      cursor: pointer;
      transition: transform 0.15s, box-shadow 0.15s;
      box-shadow: 0 4px 14px rgba(138,43,226,0.3);
    }
    .notif-retry-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 18px rgba(138,43,226,0.45);
    }

    /* ===== Skeletons ===== */
    .notif-skeleton {
      display: flex;
      gap: 14px;
      padding: 16px 18px;
      background: var(--dash-surface);
      border: 1px solid var(--dash-border);
      border-radius: 14px;
    }
    .notif-skeleton-icon {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--dash-surface-elevated);
      flex-shrink: 0;
      animation: notifPulse 1.4s ease-in-out infinite;
    }
    .notif-skeleton-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-top: 4px;
    }
    .notif-skeleton-line {
      height: 12px;
      border-radius: 4px;
      background: var(--dash-surface-elevated);
      animation: notifPulse 1.4s ease-in-out infinite;
    }
    .notif-skeleton-line-lg { width: 65%; }
    .notif-skeleton-line-sm { width: 40%; height: 10px; }
    @keyframes notifPulse {
      0%, 100% { opacity: 0.6; }
      50%      { opacity: 1;   }
    }

    @media (max-width: 480px) {
      .notif-title-wrap h1 { font-size: 1.3rem; }
      .notif-markall-btn { padding: 7px 12px; font-size: 0.72rem; }
    }

    @media (prefers-reduced-motion: reduce) {
      .notif-skeleton-icon,
      .notif-skeleton-line { animation: none; }
    }
  `,

  async init() {
    if (controller) controller.abort();
    controller = new AbortController();
    const { signal } = controller;

    const listEl = document.getElementById("notif-list");
    const backBtn = document.getElementById("notif-back");
    const markAllBtn = document.getElementById("notif-markall");
    const unreadCountEl = document.getElementById("notif-unread-count");

    // Capture origin for back button
    captureOrigin();

    if (backBtn) {
      backBtn.addEventListener("click", () => {
        clearOrigin();
        goBack();
      }, { signal });
    }

    const user = auth.currentUser;
    if (!user) {
      listEl.innerHTML = `
        <div class="notif-empty">
          <div class="notif-empty-circle" aria-hidden="true">🔒</div>
          <h2 class="notif-empty-title">Please sign in</h2>
          <p class="notif-empty-desc">Sign in to see your notifications.</p>
        </div>`;
      return;
    }

    // Refresh function (called on retry)
    const load = async () => {
      renderSkeletons(listEl);

      try {
        const snap = await get(ref(database, `notifications/${user.uid}`));
        if (signal.aborted) return;

        if (!snap.exists()) {
          renderEmpty(listEl);
          updateBellBadge(0);
          if (markAllBtn) markAllBtn.hidden = true;
          if (unreadCountEl) unreadCountEl.hidden = true;
          return;
        }

        const items = Object.entries(snap.val())
          .map(([id, val]) => ({ id, ...(val || {}) }))
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        if (!items.length) {
          renderEmpty(listEl);
          updateBellBadge(0);
          if (markAllBtn) markAllBtn.hidden = true;
          if (unreadCountEl) unreadCountEl.hidden = true;
          return;
        }

        const unreadCount = items.filter(n => !n.read).length;

        // Header indicators
        if (unreadCountEl) {
          if (unreadCount > 0) {
            unreadCountEl.textContent = `${unreadCount} unread`;
            unreadCountEl.hidden = false;
          } else {
            unreadCountEl.hidden = true;
          }
        }
        if (markAllBtn) markAllBtn.hidden = unreadCount === 0;
        updateBellBadge(unreadCount);

        renderList(listEl, items, user.uid, (remaining) => {
          // Called after any individual read
          if (unreadCountEl) {
            if (remaining > 0) {
              unreadCountEl.textContent = `${remaining} unread`;
              unreadCountEl.hidden = false;
            } else {
              unreadCountEl.hidden = true;
            }
          }
          if (markAllBtn) markAllBtn.hidden = remaining === 0;
        });
      } catch (err) {
        if (signal.aborted) return;
        console.error("[Notifications] load failed:", err);
        renderError(listEl, "Check your connection and try again.", load);
      }
    };

    // Mark all as read
    if (markAllBtn) {
      markAllBtn.addEventListener("click", async () => {
        markAllBtn.disabled = true;
        const unreadIds = Array.from(listEl.querySelectorAll(".notif-item.unread"))
          .map((_, i) => null); // placeholder — we need real IDs
        // Simpler: fetch again to get ids
        try {
          const snap = await get(ref(database, `notifications/${user.uid}`));
          if (!snap.exists()) return;
          const unread = Object.entries(snap.val())
            .filter(([, v]) => v && !v.read)
            .map(([id]) => id);
          await markAllRead(user.uid, unread);

          // Update UI
          listEl.querySelectorAll(".notif-item.unread").forEach(el => {
            el.classList.remove("unread");
            const dot = el.querySelector(".notif-dot");
            if (dot) dot.remove();
          });
          if (unreadCountEl) unreadCountEl.hidden = true;
          markAllBtn.hidden = true;
          updateBellBadge(0);
        } catch (err) {
          console.error("[Notifications] mark all failed:", err);
        } finally {
          markAllBtn.disabled = false;
        }
      }, { signal });
    }

    await load();
  },

  dispose() {
    if (controller) { controller.abort(); controller = null; }
    // Do NOT clear origin here — it's needed for the back button
  }
};