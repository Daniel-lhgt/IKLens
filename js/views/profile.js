import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import { ref, get, push, set, update } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js";
import { auth, database } from "../firebase-config.js";

let currentUser = null;
let unsubscribeAuth = null;
let controller = null;

const firstString = (...vals) => vals.find(v => typeof v === "string" && v.trim())?.trim() || "";

function getInitial(name) {
  const clean = String(name || "").trim();
  if (!clean) return "U";
  const source = clean.includes("@") ? clean.split("@")[0].trim() : clean;
  const m = source.match(/[A-Za-z]/);
  return m ? m[0].toUpperCase() : "U";
}

function paintAvatar(photoURL, name) {
  const el = document.getElementById("profile-avatar");
  if (!el) return;
  const initial = getInitial(name);
  el.textContent = initial;
  el.style.backgroundImage = "";
  const url = typeof photoURL === "string" ? photoURL.trim() : "";
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) return;
  const tester = new Image();
  tester.onload = () => { el.textContent = ""; el.style.backgroundImage = `url("${encodeURI(url).replace(/"/g, "%22")}")`; };
  tester.src = url;
}

function showNotice(msg, type = "success") {
  const n = document.getElementById("feedback-notice");
  if (!n) return;
  n.textContent = msg;
  n.className = "profile-notice " + type;
  n.hidden = false;
  setTimeout(() => { n.hidden = true; }, 5000);
}

async function loadProfile(user) {
  const nameEl = document.getElementById("profile-name");
  const emailEl = document.getElementById("profile-email");
  const genderEl = document.getElementById("profile-gender");
  if (!user) { if (nameEl) nameEl.textContent = "Guest"; return; }

  const authName = user.displayName || (user.email ? user.email.split("@")[0] : "") || "User";
  nameEl.textContent = authName;
  emailEl.textContent = user.email || "";
  paintAvatar(user.photoURL || "", authName);

  try {
    const snap = await get(ref(database, `users/${user.uid}/profile`));
    if (snap.exists()) {
      const p = snap.val();
      const finalName = firstString(p.fullName, p.name, p.displayName, authName);
      nameEl.textContent = finalName;
      if (genderEl) genderEl.textContent = p.gender || "Not specified";
      paintAvatar(firstString(p.photoURL, user.photoURL), finalName);
    }
  } catch {}
}

async function loadSubmissions(user) {
  const list = document.getElementById("submissions-list");
  try {
    const snap = await get(ref(database, "submissions"));
    if (!snap.exists()) return;
    const subs = Object.values(snap.val()).filter(s => s.uid === user.uid).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (subs.length === 0) return;

    list.innerHTML = "";
    subs.forEach(s => {
      const div = document.createElement("div");
      div.className = "sub-item";

      const img = document.createElement("img");
      img.className = "sub-img";
      img.alt = "";
      if (/^https?:\/\//i.test(String(s.image || ""))) img.src = s.image;

      const info = document.createElement("div");
      info.className = "sub-info";
      const title = document.createElement("div");
      title.className = "sub-title";
      title.textContent = s.title || "Untitled";
      const status = document.createElement("div");
      const safeStatus = String(s.status || "").toLowerCase().replace(/[^a-z_-]/g, "");
      status.className = "sub-status status-" + safeStatus;
      status.textContent = safeStatus.toUpperCase();
      info.append(title, status);

      div.append(img, info);
      list.appendChild(div);
    });
  } catch {}
}

const FOLLOW_CATEGORIES = [
  ["male", "Male"], ["female", "Female"], ["kids", "Kids"], ["couple", "Couples"], ["flyer", "Flyers"]
];

async function setupFollowedCategories(user, signal) {
  const wrap = document.getElementById("follow-chips");
  const saveBtn = document.getElementById("follow-save");
  const status = document.getElementById("follow-status");
  if (!wrap || !saveBtn || !user) return;

  const state = {};
  FOLLOW_CATEGORIES.forEach(([key]) => { state[key] = true; });

  try {
    const snap = await get(ref(database, `users/${user.uid}/profile/followedCategories`));
    if (snap.exists() && typeof snap.val() === "object") {
      const saved = snap.val();
      FOLLOW_CATEGORIES.forEach(([key]) => { state[key] = saved[key] !== false; });
    }
  } catch {}

  const paint = () => {
    wrap.querySelectorAll("[data-cat]").forEach(btn => {
      const on = !!state[btn.dataset.cat];
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", String(on));
    });
  };
  paint();

  wrap.addEventListener("click", e => {
    const btn = e.target.closest("[data-cat]");
    if (!btn) return;
    state[btn.dataset.cat] = !state[btn.dataset.cat];
    status.textContent = "";
    paint();
  }, { signal });

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    status.textContent = "Saving…";
    try {
      await update(ref(database, `users/${user.uid}/profile`), { followedCategories: { ...state }, updatedAt: Date.now() });
      status.textContent = "Saved. You'll get alerts for the categories you selected.";
    } catch {
      status.textContent = "Couldn't save. Please try again.";
    } finally {
      saveBtn.disabled = false;
    }
  }, { signal });
}

async function loadFavorites(user) {
  const grid = document.getElementById("favorites-grid");
  try {
    const favSnap = await get(ref(database, `favorites/${user.uid}`));
    if (!favSnap.exists()) return;
    const favIds = Object.keys(favSnap.val());
    if (favIds.length === 0) return;

    const tplSnap = await get(ref(database, "templates"));
    if (!tplSnap.exists()) return;
    const templates = tplSnap.val();

    grid.innerHTML = "";
    favIds.forEach(id => {
      if (templates[id]) {
        const t = templates[id];
        const div = document.createElement("div");
        div.className = "fav-card";
        const img = document.createElement("img");
        img.loading = "lazy";
        img.alt = "";
        if (/^https?:\/\//i.test(String(t.image || ""))) img.src = t.image;
        div.appendChild(img);
        div.onclick = () => window.IKLensRouter.navigate("generate", { template: id });
        grid.appendChild(div);
      }
    });
  } catch {}
}

function bindEvents() {
  const form = document.getElementById("feedback-form");
  const logoutBtn = document.getElementById("profile-logout");
  if (!form || !logoutBtn) return;
  const { signal } = controller;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const type = document.getElementById("feedback-type").value;
    const msg = document.getElementById("feedback-message").value.trim();
    if (!type || msg.length < 10) { showNotice("Enter at least 10 characters.", "error"); return; }

    const btn = document.getElementById("feedback-submit");
    btn.disabled = true;
    btn.textContent = "Submitting...";

    try {
      const pushRef = push(ref(database, "feedback"));
      await set(pushRef, {
        userId: currentUser.uid,
        name: currentUser.displayName || "User",
        email: currentUser.email,
        type,
        message: msg,
        status: "new",
        createdAt: Date.now()
      });
      showNotice("Thank you! Feedback submitted.");
      form.reset();
    } catch {
      showNotice("Failed to submit. Please try again.", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Submit Feedback";
    }
  }, { signal });

  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    window.location.replace("login.html");
  }, { signal });
}

export default {
  title: "Profile — IKLens",

  template: () => `
    <section class="profile-container" id="profile-view" data-view="profile">

      <!-- TOP BANNER PROFILE CARD -->
      <section class="profile-card">
        <div class="profile-card-left">
          <div class="avatar-wrapper">
            <div id="profile-avatar" class="avatar">U</div>
          </div>
          <div class="profile-header">
            <h2 id="profile-name" class="profile-name">Loading…</h2>
            <p id="profile-email" class="profile-email">Please wait</p>
            <span id="profile-gender" class="profile-badge">Not specified</span>
          </div>
        </div>
        <div class="profile-stats-row">
          <div class="stat-item"><span class="stat-label">Account</span><span class="stat-value" id="profile-status">Active</span></div>
          <div class="stat-item"><span class="stat-label">Member</span><span class="stat-value">IKLens</span></div>
        </div>
      </section>

      <!-- 2-COLUMN GRID ON DESKTOP -->
      <div class="profile-layout-grid">

        <!-- MAIN COLUMN -->
        <div class="profile-main-col">

          <section class="content-card">
            <div class="section-heading section-heading-row">
              <div>
                <h2 class="section-title">My Submissions</h2>
                <p class="section-subtitle">Prompts you've submitted for review.</p>
              </div>
              <a href="#/submit" data-route="submit" class="section-action-btn" aria-label="Submit a new prompt">
                <span aria-hidden="true">＋</span> New
              </a>
            </div>
            <div id="submissions-list" class="submission-list">
              <div class="empty-state-cta">
                <div class="empty-state-icon" aria-hidden="true">✨</div>
                <p class="empty-state-title">No submissions yet</p>
                <p class="empty-state-desc">Share your first prompt with the community. Our team reviews every submission.</p>
                <a href="#/submit" data-route="submit" class="empty-state-btn">Submit your first prompt →</a>
              </div>
            </div>
          </section>

          <section class="content-card">
            <div class="section-heading">
              <h2 class="section-title">My Favorites</h2>
              <p class="section-subtitle">Prompts you've saved.</p>
            </div>
            <div id="favorites-grid" class="fav-grid">
              <p class="empty-text">No favorites yet.</p>
            </div>
          </section>

          <section class="content-card">
            <div class="section-heading">
              <h2 class="section-title">Template Alerts</h2>
              <p class="section-subtitle">Get a notification when a new template is added in these categories.</p>
            </div>
            <div id="follow-chips" class="follow-chips">
              ${FOLLOW_CATEGORIES.map(([key, label]) => `<button type="button" class="follow-chip" data-cat="${key}" aria-pressed="true">${label}</button>`).join("")}
            </div>
            <button type="button" id="follow-save" class="profile-primary-btn follow-save"><span>Save alerts</span></button>
            <p id="follow-status" class="follow-status" role="status" aria-live="polite"></p>
          </section>

          <section class="content-card">
            <div class="section-heading">
              <h2 class="section-title">Send Feedback</h2>
              <p class="section-subtitle">Help us make IKLens better.</p>
            </div>
            <form id="feedback-form" class="feedback-form">
              <div class="profile-form-group">
                <label for="feedback-type" class="profile-form-label">Feedback type</label>
                <select id="feedback-type" class="profile-form-control" required>
                  <option value="">Select a category...</option>
                  <option value="suggestion">💡 Suggestion</option>
                  <option value="bug_report">🐛 Bug report</option>
                  <option value="complaint">⚠️ Complaint</option>
                  <option value="other">💬 Other</option>
                </select>
              </div>
              <div class="profile-form-group">
                <label for="feedback-message" class="profile-form-label">Your message</label>
                <textarea id="feedback-message" class="profile-form-control feedback-textarea" placeholder="Tell us what you think..." maxlength="2000" required></textarea>
              </div>
              <button type="submit" id="feedback-submit" class="profile-primary-btn">
                <span id="feedback-btn-text">Submit Feedback</span>
              </button>
              <div id="feedback-notice" class="profile-notice" role="status" aria-live="polite" hidden></div>
            </form>
          </section>

        </div>

        <!-- SIDEBAR COLUMN -->
        <div class="profile-side-col">

          <section class="content-card">
            <div class="section-heading"><h2 class="section-title">Information</h2></div>
            <nav class="info-links">
              <a href="pages/about.html" class="info-link"><span class="link-icon">ℹ️</span><span class="link-text">About IKLens</span><span class="link-arrow">›</span></a>
              <a href="pages/terms.html" class="info-link"><span class="link-icon">📄</span><span class="link-text">Terms of Service</span><span class="link-arrow">›</span></a>
              <a href="pages/privacy.html" class="info-link"><span class="link-icon">🔒</span><span class="link-text">Privacy Policy</span><span class="link-arrow">›</span></a>
            </nav>
          </section>

          <section class="logout-section">
            <div class="logout-description">
              <h3>Leaving IKLens?</h3>
              <p>You can sign back in whenever you want.</p>
            </div>
            <button type="button" id="profile-logout" class="logout-btn">
              <span aria-hidden="true">↪</span><span id="logout-btn-text">Log Out</span>
            </button>
          </section>

        </div>
      </div>
    </section>
  `,

  styles: `
    .profile-container {
      --profile-accent: #8792ff; --profile-accent-bright: #b0b8ff;
      --profile-surface: #0f1223; --profile-card: #151a30;
      --profile-border: rgba(124,138,255,0.15);
      --profile-text: #eef0ff; --profile-secondary: #b0b8e6; --profile-muted: #858bb9;
      --profile-success: #34d399; --profile-error: #f87171;

      width: 100%;
      max-width: 1050px;
      margin: 0 auto;
      padding: 24px 18px 40px;
      display: flex;
      flex-direction: column;
      gap: 22px;
      color: var(--profile-text);
    }

    /* ============================================================
       PROFILE BANNER CARD
       ============================================================ */
    .profile-card, .content-card, .logout-section {
      background: var(--profile-card);
      border: 1px solid var(--profile-border);
      border-radius: 20px;
    }

    .profile-card {
      padding: 32px 22px 26px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
    }

    .profile-card-left {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 18px;
      text-align: center;
    }

    .avatar-wrapper {
      position: relative;
      width: 108px;
      height: 108px;
      border-radius: 50%;
      padding: 4px;
      background: linear-gradient(135deg, var(--profile-accent), var(--profile-accent-bright));
    }

    .avatar {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background-color: var(--profile-surface);
      background-size: cover;
      background-position: center;
      color: var(--profile-accent-bright);
      font-size: 2.5rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .profile-header {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 7px;
    }

    .profile-name { font-size: 1.35rem; font-weight: 700; }
    .profile-email { color: var(--profile-secondary); font-size: 0.9rem; }
    .profile-badge { padding: 5px 13px; border-radius: 999px; background: rgba(124,138,255,0.14); color: var(--profile-accent-bright); font-size: 0.78rem; }

    .profile-stats-row {
      display: flex;
      justify-content: center;
      gap: 44px;
      width: 100%;
      padding-top: 20px;
      border-top: 1px solid var(--profile-border);
    }

    .stat-item { text-align: center; }
    .stat-label { display: block; margin-bottom: 5px; color: var(--profile-muted); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-value { font-size: 0.92rem; font-weight: 600; }

    /* ============================================================
       LAYOUT GRID
       ============================================================ */
    .profile-layout-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 22px;
    }

    .profile-main-col, .profile-side-col {
      display: flex;
      flex-direction: column;
      gap: 22px;
      min-width: 0;
    }

    /* ============================================================
       CONTENT CARDS
       ============================================================ */
    .content-card { padding: 24px; }
    .follow-chips { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
    .follow-chip {
      padding: 8px 16px; border-radius: 9999px; cursor: pointer;
      background: var(--bg-elevated); border: 1px solid var(--border-subtle);
      color: var(--text-secondary); font: inherit; font-size: 0.9rem; font-weight: 600;
    }
    .follow-chip.on { border-color: var(--brand-cyan); color: var(--text-primary); background: rgba(0, 210, 255, 0.12); }
    .follow-save { width: auto; padding-inline: 24px; }
    .follow-status { margin-top: 12px; font-size: 0.9rem; color: var(--text-secondary); min-height: 1.2em; }
    .section-heading { margin-bottom: 20px; }
    .section-title { font-size: 1.12rem; font-weight: 700; }
    .section-subtitle { margin-top: 5px; color: var(--profile-muted); font-size: 0.85rem; }
    .empty-text { color: var(--profile-muted); font-size: 0.9rem; }

    /* ==== NEW: Section header with inline action ==== */
    .section-heading-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
    }
    .section-action-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 8px 14px;
      border-radius: 999px;
      background: rgba(124,138,255,0.15);
      border: 1px solid rgba(124,138,255,0.35);
      color: var(--profile-accent-bright);
      font-size: 0.82rem;
      font-weight: 700;
      text-decoration: none;
      white-space: nowrap;
      flex-shrink: 0;
      transition: background 0.15s, transform 0.1s, border-color 0.15s;
    }
    .section-action-btn:hover {
      background: rgba(124,138,255,0.25);
      border-color: rgba(124,138,255,0.55);
      transform: translateY(-1px);
    }
    .section-action-btn:focus-visible {
      outline: 2px solid var(--profile-accent-bright);
      outline-offset: 3px;
    }

    /* ==== NEW: Empty state with CTA ==== */
    .empty-state-cta {
      grid-column: 1 / -1;
      text-align: center;
      padding: 32px 20px;
      border: 1px dashed var(--profile-border);
      border-radius: 14px;
    }
    .empty-state-icon { font-size: 2rem; margin-bottom: 10px; opacity: 0.8; }
    .empty-state-title { font-size: 0.95rem; font-weight: 700; margin-bottom: 6px; }
    .empty-state-desc {
      font-size: 0.85rem;
      color: var(--profile-muted);
      margin-bottom: 16px;
      max-width: 340px;
      margin-left: auto;
      margin-right: auto;
      line-height: 1.5;
    }
    .empty-state-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 10px 20px;
      min-height: 44px;
      border-radius: 999px;
      background: linear-gradient(135deg, var(--profile-accent), var(--profile-accent-bright));
      color: #fff;
      font-size: 0.875rem;
      font-weight: 700;
      text-decoration: none;
      box-shadow: 0 4px 16px rgba(124,138,255,0.3);
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .empty-state-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(124,138,255,0.45);
    }
    .empty-state-btn:focus-visible {
      outline: 2px solid var(--profile-accent-bright);
      outline-offset: 3px;
    }

    /* Submissions */
    .submission-list { display: grid; grid-template-columns: 1fr; gap: 12px; }
    .sub-item { display: flex; align-items: center; gap: 14px; padding: 12px; background: var(--profile-surface); border-radius: 12px; border: 1px solid transparent; transition: border-color 0.2s; }
    .sub-item:hover { border-color: rgba(255,255,255,0.1); }
    .sub-img { width: 48px; height: 60px; border-radius: 8px; object-fit: cover; background: #000; }
    .sub-info { flex: 1; min-width: 0; }
    .sub-title { font-size: 0.95rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sub-status { font-size: 0.7rem; font-weight: 700; padding: 3px 8px; border-radius: 4px; display: inline-block; margin-top: 6px; }
    .status-pending { background: rgba(251,191,36,0.15); color: #fbbf24; }
    .status-approved { background: rgba(52,211,153,0.15); color: #34d399; }
    .status-rejected { background: rgba(248,113,113,0.15); color: #f87171; }

    /* Favorites */
    .fav-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 12px; }
    .fav-card { aspect-ratio: 4/5; border-radius: 10px; overflow: hidden; cursor: pointer; background: var(--profile-surface); transition: transform 0.2s, box-shadow 0.2s; }
    .fav-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .fav-card:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.4); }

    /* Feedback Form */
    .feedback-form, .profile-form-group { display: flex; flex-direction: column; gap: 10px; }
    .feedback-form { gap: 20px; }
    .profile-form-label { color: var(--profile-secondary); font-size: 0.85rem; font-weight: 500; }
    .profile-form-control { width: 100%; padding: 13px 14px; border: 1px solid var(--profile-border); border-radius: 12px; background: var(--profile-surface); color: var(--profile-text); font: inherit; font-size: 0.92rem; outline: none; transition: border-color 0.2s, box-shadow 0.2s; }
    .profile-form-control:focus { border-color: var(--profile-accent); box-shadow: 0 0 0 3px rgba(124,138,255,0.15); }
    .feedback-textarea { min-height: 140px; resize: vertical; line-height: 1.5; }

    .profile-primary-btn { width: 100%; min-height: 48px; padding: 13px 18px; display: flex; justify-content: center; align-items: center; border-radius: 999px; background: linear-gradient(135deg, var(--profile-accent), var(--profile-accent-bright)); color: #fff; border: 0; font-weight: 650; cursor: pointer; transition: opacity 0.2s, transform 0.1s; }
    .profile-primary-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
    .profile-primary-btn:disabled { opacity: 0.6; cursor: not-allowed; }

    .profile-notice { padding: 13px 16px; border-radius: 10px; font-size: 0.88rem; font-weight: 500; }
    .profile-notice.success { background: rgba(52,211,153,0.1); color: var(--profile-success); border: 1px solid rgba(52,211,153,0.2); }
    .profile-notice.error { background: rgba(248,113,113,0.1); color: var(--profile-error); border: 1px solid rgba(248,113,113,0.2); }

    /* Info Links */
    .info-links { display: flex; flex-direction: column; gap: 4px; }
    .info-link { display: flex; align-items: center; gap: 13px; min-height: 49px; padding: 12px 14px; border-radius: 10px; color: var(--profile-text); text-decoration: none; transition: background 0.2s; }
    .info-link:hover { background: var(--profile-surface); }
    .link-text { flex: 1; font-size: 0.92rem; font-weight: 500; }
    .link-arrow { color: var(--profile-muted); font-size: 1.1rem; }

    /* Logout */
    .logout-section { padding: 24px; border-color: rgba(248,113,113,0.2); text-align: center; }
    .logout-description h3 { font-size: 1.05rem; font-weight: 700; }
    .logout-description p { margin-top: 6px; color: var(--profile-muted); font-size: 0.85rem; margin-bottom: 20px; }
    .logout-btn { width: 100%; min-height: 48px; border-radius: 999px; border: 1px solid rgba(248,113,113,0.4); background: rgba(248,113,113,0.08); color: #ff9292; display: flex; justify-content: center; align-items: center; gap: 9px; font-weight: 650; font-size: 0.95rem; cursor: pointer; transition: background 0.2s; }
    .logout-btn:hover { background: rgba(248,113,113,0.15); }

    /* ============================================================
       DESKTOP & TABLET RESPONSIVENESS
       ============================================================ */
    @media (min-width: 768px) {
      .profile-card {
        flex-direction: row;
        justify-content: space-between;
        padding: 32px 40px;
      }
      .profile-card-left {
        flex-direction: row;
        text-align: left;
        gap: 24px;
      }
      .profile-header {
        align-items: flex-start;
      }
      .profile-name {
        font-size: 1.6rem;
      }
      .profile-stats-row {
        border-top: none;
        border-left: 1px solid var(--profile-border);
        padding-top: 0;
        padding-left: 40px;
        width: auto;
        align-items: center;
        gap: 56px;
      }

      .profile-layout-grid {
        grid-template-columns: 1.6fr 1fr;
        align-items: start;
      }

      .submission-list {
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      }
    }
  `,

  async init() {
    if (controller) controller.abort();
    controller = new AbortController();
    if (unsubscribeAuth) { try { unsubscribeAuth(); } catch {} unsubscribeAuth = null; }

    bindEvents();

    unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (!user) return;
      currentUser = user;
      loadProfile(user);
      loadSubmissions(user);
      loadFavorites(user);
      setupFollowedCategories(user, controller.signal);
    });
  },

  dispose() {
    if (unsubscribeAuth) { try { unsubscribeAuth(); } catch {} unsubscribeAuth = null; }
    if (controller) { controller.abort(); controller = null; }
    currentUser = null;
  }
};