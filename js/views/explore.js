import { ref, get, set, remove } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js";
import { auth, database } from "../firebase-config.js";

const safeImageUrl = (u) => (typeof u === "string" && u.trim()) ? u.trim() : "";

/* ============================================================
   MODULE STATE
   ============================================================ */
let isLoaded = false;
let cachedAll = [];          // ALL templates (shuffled)
let userFavorites = {};      // User's favorite IDs { "id": true }
let controller = null;
let currentQuery = "";
let loadStatus = "idle";     // idle | loading | loaded | error
let searchDebounce = null;

// Mode: "feed" | "deck"
let mode = "feed";

// Deck state
let deckIndex = 0;
let deckKeyHandler = null;
let swipeTouchStartX = 0;

// Preview
let previewNode = null;
let previewKeyHandler = null;

/* ============================================================
   HELPERS
   ============================================================ */
function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function matchesQuery(t, q) {
  if (!q) return true;
  const hay = `${t.name || ""} ${t.prompt || ""}`.toLowerCase();
  return hay.includes(q);
}

function getFiltered() {
  return cachedAll.filter(t => matchesQuery(t, currentQuery));
}

/* ============================================================
   FAVORITES
   ============================================================ */
async function toggleFavorite(templateId, btnEl) {
  if (!auth.currentUser) {
    console.warn("[Explore] Must be signed in to favorite.");
    return;
  }
  
  const isFav = userFavorites[templateId];
  // Optimistic UI update
  if (isFav) delete userFavorites[templateId];
  else userFavorites[templateId] = true;
  
  if (btnEl) btnEl.classList.toggle("active", !isFav);

  // Also update any matching hearts in the DOM instantly
  document.querySelectorAll(`.exp-fav-btn[data-id="${templateId}"]`).forEach(btn => {
    btn.classList.toggle("active", !isFav);
  });

  try {
    const favRef = ref(database, `favorites/${auth.currentUser.uid}/${templateId}`);
    if (isFav) await remove(favRef);
    else await set(favRef, true);
  } catch (err) {
    // Revert on failure
    if (isFav) userFavorites[templateId] = true;
    else delete userFavorites[templateId];
    
    if (btnEl) btnEl.classList.toggle("active", isFav);
    document.querySelectorAll(`.exp-fav-btn[data-id="${templateId}"]`).forEach(btn => {
      btn.classList.toggle("active", isFav);
    });
    console.error("[Explore] Favorite toggle failed:", err);
  }
}

function createFavBtn(templateId, extraClass = "") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `exp-fav-btn ${userFavorites[templateId] ? "active" : ""} ${extraClass}`;
  btn.dataset.id = templateId;
  btn.setAttribute("aria-label", "Toggle favorite");
  btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
  
  btn.onclick = (e) => {
    e.stopPropagation(); // Prevent opening the preview
    toggleFavorite(templateId, btn);
  };
  return btn;
}

/* ============================================================
   LOAD DATA
   ============================================================ */
async function loadData(signal) {
  loadStatus = "loading";
  try {
    const [tplSnap, favSnap] = await Promise.all([
      get(ref(database, "templates")),
      auth.currentUser ? get(ref(database, `favorites/${auth.currentUser.uid}`)) : Promise.resolve(null)
    ]);

    if (signal.aborted) return;

    // Process Favorites
    userFavorites = (favSnap && favSnap.exists()) ? favSnap.val() || {} : {};

    // Process Templates — shuffled once per load
    if (!tplSnap.exists()) {
      cachedAll = [];
    } else {
      const templates = Object.entries(tplSnap.val()).map(([id, val]) => ({ id, ...(val || {}) }));
      cachedAll = shuffle(templates);
    }

    isLoaded = true;
    loadStatus = "loaded";
  } catch (err) {
    console.error("[Explore] load failed:", err);
    loadStatus = "error";
  }
}

/* ============================================================
   FEED — Pinterest mixed layout
   ============================================================ */
function createFeedCard(t, featured = false) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "exp-feed-card" + (featured ? " exp-feed-card-featured" : "");
  card.setAttribute("aria-label", t.name ? `Preview ${t.name}` : "Preview template");
  card.onclick = () => openPreview(t);

  const imgWrap = document.createElement("div");
  imgWrap.className = "exp-feed-img-wrap";

  const img = document.createElement("img");
  img.src = safeImageUrl(t.image);
  img.alt = t.name || "";
  img.loading = "lazy";
  img.decoding = "async";
  img.onerror = () => {
    img.style.display = "none";
    const fb = document.createElement("div");
    fb.className = "exp-feed-fallback";
    fb.textContent = "🖼️";
    imgWrap.appendChild(fb);
  };
  imgWrap.appendChild(img);

  // Add Favorite Button to image wrap
  imgWrap.appendChild(createFavBtn(t.id, "exp-fav-feed"));

  if (featured) {
    const overlay = document.createElement("div");
    overlay.className = "exp-feed-overlay";
    overlay.innerHTML = `
      <div class="exp-feed-overlay-title">${esc(t.name || "Untitled")}</div>
      ${t.prompt ? `<div class="exp-feed-overlay-prompt">${esc(t.prompt.slice(0, 90))}${t.prompt.length > 90 ? "…" : ""}</div>` : ""}
    `;
    imgWrap.appendChild(overlay);
  }

  card.appendChild(imgWrap);

  if (!featured && t.copyCount > 0) {
    const badge = document.createElement("div");
    badge.className = "exp-copy-badge";
    badge.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg> ${t.copyCount}`;
    card.appendChild(badge);
  }

  return card;
}

function renderFeed() {
  const wrap = document.getElementById("exp-feed");
  const errorEl = document.getElementById("exp-error");
  const emptyEl = document.getElementById("exp-no-results");
  if (!wrap) return;

  if (errorEl) errorEl.style.display = "none";
  wrap.innerHTML = "";

  if (cachedAll.length === 0) {
    if (emptyEl) emptyEl.style.display = "none";
    wrap.innerHTML = `<div class="exp-empty">No templates available yet.</div>`;
    return;
  }

  const filtered = getFiltered();
  if (currentQuery && filtered.length === 0) {
    if (emptyEl) {
      emptyEl.style.display = "";
      const qEl = emptyEl.querySelector(".exp-no-results-q");
      if (qEl) qEl.textContent = currentQuery;
    }
    return;
  }
  if (emptyEl) emptyEl.style.display = "none";

  // Mix: every 6th card is a featured (wide) card
  const FEATURED_EVERY = 6;
  filtered.forEach((t, i) => {
    const featured = i > 0 && i % FEATURED_EVERY === 0;
    wrap.appendChild(createFeedCard(t, featured));
  });
}

/* ============================================================
   DECK — swipe style
   ============================================================ */
function renderDeck() {
  const wrap = document.getElementById("exp-deck");
  const errorEl = document.getElementById("exp-error");
  const emptyEl = document.getElementById("exp-no-results");
  if (!wrap) return;

  if (errorEl) errorEl.style.display = "none";

  const filtered = getFiltered();
  if (filtered.length === 0) {
    wrap.innerHTML = "";
    if (currentQuery) {
      if (emptyEl) {
        emptyEl.style.display = "";
        const qEl = emptyEl.querySelector(".exp-no-results-q");
        if (qEl) qEl.textContent = currentQuery;
      }
    } else {
      if (emptyEl) emptyEl.style.display = "none";
      wrap.innerHTML = `<div class="exp-empty">No templates available yet.</div>`;
    }
    return;
  }
  if (emptyEl) emptyEl.style.display = "none";

  // Clamp index
  if (deckIndex >= filtered.length) deckIndex = 0;
  if (deckIndex < 0) deckIndex = filtered.length - 1;

  const t = filtered[deckIndex];

  wrap.innerHTML = `
    <div class="exp-deck-stage" id="exp-deck-stage">
      <div class="exp-deck-card" id="exp-deck-card" tabindex="0" role="button" aria-label="Open ${esc(t.name || "template")}">
        ${t.image
          ? `<img src="${esc(safeImageUrl(t.image))}" alt="${esc(t.name || "")}" loading="lazy" decoding="async" />`
          : `<div class="exp-feed-fallback">🖼️</div>`}
        <div class="exp-deck-card-info">
          <div class="exp-deck-card-title">${esc(t.name || "Untitled")}</div>
          ${t.prompt ? `<div class="exp-deck-card-prompt">${esc(t.prompt.slice(0, 120))}${t.prompt.length > 120 ? "…" : ""}</div>` : ""}
        </div>
      </div>
    </div>

    <div class="exp-deck-controls">
      <button type="button" class="exp-deck-btn exp-deck-skip" id="exp-deck-prev" aria-label="Previous">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button type="button" class="exp-deck-btn exp-deck-use" id="exp-deck-use">
        Use this prompt →
      </button>
      <button type="button" class="exp-deck-btn exp-deck-next" id="exp-deck-next" aria-label="Next">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>

    <div class="exp-deck-progress" aria-live="polite">
      ${deckIndex + 1} of ${filtered.length}
    </div>

    <div class="exp-deck-dots" aria-hidden="true">
      ${filtered.slice(0, 8).map((_, i) => `<span class="exp-deck-dot ${i === deckIndex % 8 ? "active" : ""}"></span>`).join("")}
    </div>
  `;

  const card = document.getElementById("exp-deck-card");
  const prevBtn = document.getElementById("exp-deck-prev");
  const nextBtn = document.getElementById("exp-deck-next");
  const useBtn = document.getElementById("exp-deck-use");

  if (card) {
    // Add favorite button to deck card top right
    const favBtn = createFavBtn(t.id, "exp-fav-deck");
    card.appendChild(favBtn);

    card.addEventListener("click", () => openPreview(t));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openPreview(t);
      }
    });

    // Touch swipe
    card.addEventListener("touchstart", (e) => {
      swipeTouchStartX = e.touches[0].clientX;
    }, { passive: true });
    card.addEventListener("touchend", (e) => {
      const delta = e.changedTouches[0].clientX - swipeTouchStartX;
      if (Math.abs(delta) > 60) {
        if (delta > 0) deckPrev();
        else deckNext();
      }
    }, { passive: true });
  }

  if (prevBtn) prevBtn.addEventListener("click", deckPrev);
  if (nextBtn) nextBtn.addEventListener("click", deckNext);
  if (useBtn) useBtn.addEventListener("click", () => {
    window.IKLensRouter.navigate("generate", { template: t.id });
  });

  // Arrow-key navigation
  if (deckKeyHandler) document.removeEventListener("keydown", deckKeyHandler);
  deckKeyHandler = (e) => {
    if (mode !== "deck") return;
    const tag = (document.activeElement?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || document.activeElement?.isContentEditable) return;
    if (e.key === "ArrowLeft")  { e.preventDefault(); deckPrev(); }
    if (e.key === "ArrowRight") { e.preventDefault(); deckNext(); }
    if (e.key === "Enter" && document.activeElement === card) {
      e.preventDefault();
      openPreview(t);
    }
  };
  document.addEventListener("keydown", deckKeyHandler);
}

function deckNext() {
  const filtered = getFiltered();
  if (filtered.length === 0) return;
  deckIndex = (deckIndex + 1) % filtered.length;
  renderDeck();
}

function deckPrev() {
  const filtered = getFiltered();
  if (filtered.length === 0) return;
  deckIndex = (deckIndex - 1 + filtered.length) % filtered.length;
  renderDeck();
}

/* ============================================================
   MODE SWITCHING
   ============================================================ */
function setMode(next) {
  mode = next;

  const feed = document.getElementById("exp-feed");
  const deck = document.getElementById("exp-deck");
  const feedBtn = document.getElementById("exp-mode-feed");
  const deckBtn = document.getElementById("exp-mode-deck");

  if (feed) feed.style.display = mode === "feed" ? "" : "none";
  if (deck) deck.style.display = mode === "deck" ? "" : "none";

  if (feedBtn) feedBtn.classList.toggle("active", mode === "feed");
  if (deckBtn) deckBtn.classList.toggle("active", mode === "deck");

  // Update URL
  const q = currentQuery ? `q=${encodeURIComponent(currentQuery)}&` : "";
  const nextHash = `explore?${q}mode=${mode}`;
  if (window.location.hash.slice(1) !== nextHash) {
    history.replaceState(null, "", `#/${nextHash}`);
  }

  if (mode === "feed") renderFeed();
  else renderDeck();
}

/* ============================================================
   PREVIEW MODAL
   ============================================================ */
function openPreview(t) {
  closePreview();

  const overlay = document.createElement("div");
  overlay.className = "exp-preview-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", t.name || "Template preview");

  overlay.innerHTML = `
    <div class="exp-preview-sheet" role="document">
      <button type="button" class="exp-preview-close" aria-label="Close preview">✕</button>
      <div class="exp-preview-img-wrap">
        ${t.image
          ? `<img src="${esc(safeImageUrl(t.image))}" alt="${esc(t.name || "")}" />`
          : `<div class="exp-feed-fallback">🖼️</div>`}
      </div>
      <div class="exp-preview-body">
        <h2 class="exp-preview-title">${esc(t.name || "Untitled")}</h2>
        ${t.prompt ? `<p class="exp-preview-prompt">${esc(t.prompt)}</p>` : ""}
        <div class="exp-preview-actions">
          <button type="button" class="exp-preview-copy btn btn-ghost">Copy prompt</button>
          <button type="button" class="exp-preview-use btn btn-primary">Use this prompt →</button>
        </div>
      </div>
    </div>
  `;

  // Add Favorite to modal
  const imgWrap = overlay.querySelector(".exp-preview-img-wrap");
  const modalFavBtn = createFavBtn(t.id, "exp-fav-modal");
  imgWrap.appendChild(modalFavBtn);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePreview();
  });
  overlay.querySelector(".exp-preview-close").addEventListener("click", closePreview);
  overlay.querySelector(".exp-preview-use").addEventListener("click", () => {
    closePreview();
    window.IKLensRouter.navigate("generate", { template: t.id });
  });

  const copyBtn = overlay.querySelector(".exp-preview-copy");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const text = t.prompt || "";
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = "Copied ✓";
        setTimeout(() => { copyBtn.textContent = "Copy prompt"; }, 1500);
      } catch (_) {
        copyBtn.textContent = "Copy failed";
        setTimeout(() => { copyBtn.textContent = "Copy prompt"; }, 1500);
      }
    });
  }

  previewKeyHandler = (e) => { if (e.key === "Escape") closePreview(); };
  document.addEventListener("keydown", previewKeyHandler);

  document.body.appendChild(overlay);
  previewNode = overlay;

  requestAnimationFrame(() => {
    overlay.querySelector(".exp-preview-close")?.focus();
  });

  document.body.style.overflow = "hidden";
}

function closePreview() {
  if (previewKeyHandler) {
    document.removeEventListener("keydown", previewKeyHandler);
    previewKeyHandler = null;
  }
  if (previewNode && previewNode.parentNode) {
    previewNode.parentNode.removeChild(previewNode);
  }
  previewNode = null;
  document.body.style.overflow = "";
}

/* ============================================================
   SEARCH — debounced, URL-synced
   ============================================================ */
function syncQueryToUrl(q) {
  const parts = [];
  if (q) parts.push(`q=${encodeURIComponent(q)}`);
  parts.push(`mode=${mode}`);
  const nextHash = `explore?${parts.join("&")}`;
  if (window.location.hash.slice(1) !== nextHash) {
    history.replaceState(null, "", `#/${nextHash}`);
  }
}

function handleSearchInput(value) {
  currentQuery = value.trim().toLowerCase();
  syncQueryToUrl(currentQuery);

  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    if (loadStatus === "loaded") {
      if (mode === "feed") renderFeed();
      else { deckIndex = 0; renderDeck(); }
    } else if (loadStatus === "error") {
      renderError();
    }
  }, 180);
}

/* ============================================================
   ERROR / SKELETON
   ============================================================ */
function renderSkeletons() {
  const feed = document.getElementById("exp-feed");
  const deck = document.getElementById("exp-deck");
  const errorEl = document.getElementById("exp-error");
  const emptyEl = document.getElementById("exp-no-results");
  if (errorEl) errorEl.style.display = "none";
  if (emptyEl) emptyEl.style.display = "none";

  if (feed && mode === "feed") {
    feed.innerHTML = "";
    for (let i = 0; i < 8; i++) {
      const s = document.createElement("div");
      s.className = "exp-skeleton" + (i % 6 === 0 && i > 0 ? " exp-skeleton-featured" : "");
      feed.appendChild(s);
    }
  }
  if (deck && mode === "deck") {
    deck.innerHTML = `<div class="exp-deck-stage"><div class="exp-skeleton exp-skeleton-deck"></div></div>`;
  }
}

function renderError() {
  const feed = document.getElementById("exp-feed");
  const deck = document.getElementById("exp-deck");
  const errorEl = document.getElementById("exp-error");
  const emptyEl = document.getElementById("exp-no-results");
  if (feed) feed.innerHTML = "";
  if (deck) deck.innerHTML = "";
  if (emptyEl) emptyEl.style.display = "none";
  if (errorEl) errorEl.style.display = "";
}

/* ============================================================
   VIEW DEFINITION
   ============================================================ */
export default {
  title: "Explore — IKLens",

  template: () => `
    <section class="explore-container" id="explore-view" data-view="explore">
      <div class="exp-header">
        <div>
          <h1>Explore</h1>
          <p>Discover prompts worth using.</p>
        </div>
        <div class="exp-header-actions">
          <button type="button" id="exp-shuffle" class="exp-mode-btn exp-shuffle-btn" aria-label="Shuffle templates">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Shuffle
          </button>
          <div class="exp-mode-toggle" role="tablist" aria-label="View mode">
            <button type="button" id="exp-mode-feed" class="exp-mode-btn active" role="tab" aria-selected="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              Feed
            </button>
            <button type="button" id="exp-mode-deck" class="exp-mode-btn" role="tab" aria-selected="false">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 12h6M12 9v6"/></svg>
              Deck
            </button>
          </div>
        </div>
      </div>

      <div class="exp-search-wrap">
        <svg class="exp-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7"></circle>
          <path d="M21 21l-4.3-4.3" stroke-linecap="round"></path>
        </svg>
        <input
          type="search"
          id="exp-search"
          class="exp-search-input"
          placeholder="Search by name or prompt…"
          autocomplete="off"
          spellcheck="false"
          aria-label="Search templates"
        />
        <button type="button" id="exp-search-clear" class="exp-search-clear" aria-label="Clear search" hidden>✕</button>
      </div>

      <div class="exp-error" id="exp-error" style="display:none;" role="alert">
        <div class="exp-error-icon" aria-hidden="true">⚠️</div>
        <div class="exp-error-body">
          <h3>Couldn't load templates</h3>
          <p>Check your connection and try again.</p>
          <button type="button" class="btn btn-primary exp-retry-btn" id="exp-retry">Retry</button>
        </div>
      </div>

      <div class="exp-no-results" id="exp-no-results" style="display:none;">
        <div class="exp-no-results-icon" aria-hidden="true">🔍</div>
        <h3>No results for "<span class="exp-no-results-q"></span>"</h3>
        <p>Try a different word or clear your search.</p>
        <button type="button" class="btn btn-ghost" id="exp-clear-search-empty">Clear search</button>
      </div>

      <div class="exp-feed" id="exp-feed"></div>
      <div class="exp-deck" id="exp-deck" style="display:none;"></div>
    </section>
  `,

  styles: `
    .explore-container { width: 100%; max-width: 1280px; margin: 0 auto; padding: 10px 0 40px; }

    /* Header */
    .exp-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .exp-header h1 { font-size: 1.8rem; font-weight: 800; color: var(--dash-text-primary); }
    .exp-header p { color: var(--dash-text-secondary); font-size: 0.95rem; margin-top: 4px; }

    .exp-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    /* Mode toggle */
    .exp-mode-toggle {
      display: inline-flex;
      background: var(--dash-surface-elevated);
      border: 1px solid var(--dash-border);
      border-radius: 10px;
      padding: 3px;
      gap: 2px;
    }
    .exp-mode-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      border-radius: 7px;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--dash-text-secondary);
      transition: background 0.15s, color 0.15s;
    }
    .exp-mode-btn svg { width: 14px; height: 14px; }
    .exp-mode-btn.active {
      background: var(--dash-surface);
      color: var(--dash-text-primary);
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    .exp-mode-btn:hover:not(.active) { color: var(--dash-text-primary); }

    /* Standalone shuffle button */
    .exp-shuffle-btn {
      background: var(--dash-surface-elevated);
      border: 1px solid var(--dash-border);
    }
    .exp-shuffle-btn:hover {
      background: var(--dash-surface);
      color: var(--dash-text-primary);
    }

    /* Search */
    .exp-search-wrap {
      position: relative;
      display: flex;
      align-items: center;
      margin-bottom: 24px;
    }
    .exp-search-icon {
      position: absolute;
      left: 14px;
      width: 18px;
      height: 18px;
      color: var(--dash-text-muted);
      pointer-events: none;
    }
    .exp-search-input {
      width: 100%;
      padding: 12px 44px 12px 42px;
      background: var(--dash-surface-elevated);
      border: 1px solid var(--dash-border);
      border-radius: 12px;
      color: var(--dash-text-primary);
      font-size: 0.95rem;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .exp-search-input::placeholder { color: var(--dash-text-muted); }
    .exp-search-input:focus {
      border-color: rgba(0, 210, 255, 0.5);
      box-shadow: 0 0 0 3px rgba(0, 210, 255, 0.12);
    }
    .exp-search-input::-webkit-search-cancel-button { display: none; }
    .exp-search-clear {
      position: absolute;
      right: 10px;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      color: var(--dash-text-secondary);
      font-size: 0.85rem;
      transition: background 0.15s, color 0.15s;
    }
    .exp-search-clear:hover { background: rgba(255,255,255,0.06); color: var(--dash-text-primary); }

    /* Error */
    .exp-error {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      padding: 20px;
      margin-bottom: 24px;
      background: rgba(248, 113, 113, 0.08);
      border: 1px solid rgba(248, 113, 113, 0.25);
      border-radius: 14px;
    }
    .exp-error-icon { font-size: 1.5rem; line-height: 1; }
    .exp-error-body h3 { font-size: 1rem; font-weight: 700; margin-bottom: 4px; color: var(--dash-text-primary); }
    .exp-error-body p { font-size: 0.875rem; color: var(--dash-text-secondary); margin-bottom: 12px; }
    .exp-retry-btn { min-height: 38px; padding: 6px 18px; font-size: 0.875rem; }

    /* No results */
    .exp-no-results {
      text-align: center;
      padding: 48px 20px;
      color: var(--dash-text-secondary);
    }
    .exp-no-results-icon { font-size: 2.5rem; margin-bottom: 12px; opacity: 0.6; }
    .exp-no-results h3 { font-size: 1.05rem; font-weight: 700; color: var(--dash-text-primary); margin-bottom: 6px; }
    .exp-no-results p { font-size: 0.875rem; margin-bottom: 18px; }

    /* ============ FEED (Style 4 — Pinterest mixed) ============ */
    .exp-feed {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      grid-auto-flow: dense;
    }
    @media (min-width: 640px) {
      .exp-feed { grid-template-columns: repeat(3, 1fr); gap: 16px; }
    }
    @media (min-width: 1024px) {
      .exp-feed { grid-template-columns: repeat(4, 1fr); gap: 20px; }
    }

    .exp-feed-card {
      position: relative;
      border-radius: 14px;
      overflow: hidden;
      background: var(--dash-surface-elevated);
      cursor: pointer;
      border: 1px solid var(--dash-border);
      transition: transform 0.2s, box-shadow 0.2s;
      padding: 0;
      aspect-ratio: 4/5;
      text-align: left;
      font: inherit;
      color: inherit;
    }
    .exp-feed-card:hover { transform: translateY(-3px); box-shadow: 0 8px 20px rgba(0,0,0,0.4); border-color: rgba(255,255,255,0.2); }
    .exp-feed-card:focus-visible { outline: 2px solid var(--dash-cyan); outline-offset: 3px; }

    .exp-feed-card-featured {
      grid-column: span 2;
      aspect-ratio: 16/10;
    }
    @media (min-width: 640px) { .exp-feed-card-featured { grid-column: span 2; } }
    @media (min-width: 1024px) { .exp-feed-card-featured { grid-column: span 2; } }

    .exp-feed-img-wrap { position: absolute; inset: 0; }
    .exp-feed-img-wrap img { width: 100%; height: 100%; object-fit: cover; display: block; }

    .exp-feed-fallback {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--dash-surface-elevated);
      color: var(--dash-text-muted);
      font-size: 1.8rem;
    }

    .exp-feed-overlay {
      position: absolute;
      inset: auto 0 0 0;
      padding: 16px;
      background: linear-gradient(to top, rgba(0,0,0,0.85), transparent);
      color: #fff;
      z-index: 2;
      pointer-events: none;
    }
    .exp-feed-overlay-title { font-size: 1rem; font-weight: 800; margin-bottom: 4px; }
    .exp-feed-overlay-prompt { font-size: 0.78rem; opacity: 0.85; line-height: 1.4; }

    .exp-copy-badge {
      position: absolute;
      bottom: 10px;
      left: 10px;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(4px);
      color: #fff;
      font-size: 0.7rem;
      font-weight: 600;
      padding: 4px 8px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      gap: 4px;
      z-index: 2;
    }
    .exp-copy-badge svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; }

    .exp-empty {
      grid-column: 1 / -1;
      padding: 40px 20px;
      text-align: center;
      color: var(--dash-text-muted);
      font-size: 0.9rem;
      border: 1px dashed var(--dash-border);
      border-radius: 14px;
    }

    /* ============ FAVORITE BUTTONS ============ */
    .exp-fav-btn {
      position: absolute;
      z-index: 10;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(4px);
      border: 1px solid rgba(255,255,255,0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background 0.2s, transform 0.2s;
    }
    .exp-fav-btn:hover { background: rgba(0,0,0,0.85); transform: scale(1.1); }
    .exp-fav-btn svg { width: 16px; height: 16px; fill: transparent; stroke: #fff; stroke-width: 2; transition: fill 0.2s, stroke 0.2s; }
    .exp-fav-btn.active svg { fill: #ef4444; stroke: #ef4444; }

    /* Positions */
    .exp-fav-feed { top: 10px; right: 10px; }
    .exp-fav-deck { top: 16px; right: 16px; width: 36px; height: 36px; }
    .exp-fav-modal { top: 12px; left: 12px; width: 36px; height: 36px; } /* Left side to avoid close button */

    /* ============ DECK (Style 2 — Swipe) ============ */
    .exp-deck { display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 10px 0 30px; }

    .exp-deck-stage {
      width: 100%;
      max-width: 380px;
      aspect-ratio: 4/5;
      position: relative;
    }

    .exp-deck-card {
      position: relative;
      width: 100%;
      height: 100%;
      border-radius: 20px;
      overflow: hidden;
      background: var(--dash-surface-elevated);
      border: 1px solid var(--dash-border);
      box-shadow: 0 20px 50px rgba(0,0,0,0.5);
      cursor: pointer;
      animation: expDeckIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      flex-direction: column;
    }
    @keyframes expDeckIn {
      from { transform: scale(0.96) translateY(10px); opacity: 0; }
      to   { transform: scale(1) translateY(0); opacity: 1; }
    }
    .exp-deck-card img { width: 100%; height: 100%; object-fit: cover; display: block; flex: 1; }

    .exp-deck-card-info {
      position: absolute;
      inset: auto 0 0 0;
      padding: 20px;
      background: linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.4) 60%, transparent);
      color: #fff;
      pointer-events: none;
    }
    .exp-deck-card-title { font-size: 1.15rem; font-weight: 800; margin-bottom: 6px; }
    .exp-deck-card-prompt { font-size: 0.8rem; opacity: 0.85; line-height: 1.5; }

    .exp-deck-controls {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .exp-deck-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 48px;
      border-radius: var(--radius-pill);
      border: 1px solid var(--dash-border);
      background: var(--dash-surface-elevated);
      color: var(--dash-text-primary);
      font-weight: 600;
      font-size: 0.9rem;
      padding: 0 18px;
      transition: transform 0.15s, background 0.15s, border-color 0.15s;
    }
    .exp-deck-btn:hover { background: var(--dash-surface); border-color: rgba(255,255,255,0.2); transform: translateY(-1px); }
    .exp-deck-btn:active { transform: scale(0.97); }

    .exp-deck-skip, .exp-deck-next {
      width: 48px;
      padding: 0;
    }
    .exp-deck-skip svg, .exp-deck-next svg { width: 20px; height: 20px; }

    .exp-deck-use {
      background: var(--dash-gradient);
      border: none;
      color: #fff;
      box-shadow: 0 4px 16px rgba(138, 43, 226, 0.4);
    }
    .exp-deck-use:hover {
      box-shadow: 0 6px 20px rgba(138, 43, 226, 0.55);
    }

    .exp-deck-progress {
      font-size: 0.8rem;
      color: var(--dash-text-muted);
      font-weight: 600;
    }

    .exp-deck-dots {
      display: flex;
      gap: 6px;
    }
    .exp-deck-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: rgba(255,255,255,0.15);
    }
    .exp-deck-dot.active { background: var(--dash-cyan); }

    /* ============ SKELETONS ============ */
    .exp-skeleton {
      aspect-ratio: 4/5;
      border-radius: 14px;
      background: linear-gradient(90deg, var(--dash-surface-elevated) 0%, #1f2738 50%, var(--dash-surface-elevated) 100%);
      background-size: 200% 100%;
      animation: expShimmer 1.4s linear infinite;
    }
    .exp-skeleton-featured {
      grid-column: span 2;
      aspect-ratio: 16/10;
    }
    .exp-skeleton-deck {
      width: 100%;
      max-width: 380px;
      aspect-ratio: 4/5;
      margin: 0 auto;
      border-radius: 20px;
    }
    @keyframes expShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    /* ============ PREVIEW MODAL ============ */
    .exp-preview-overlay {
      position: fixed;
      inset: 0;
      z-index: 2000;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: flex-end;
      justify-content: center;
      animation: expFadeIn 0.2s ease-out;
    }
    @media (min-width: 720px) {
      .exp-preview-overlay { align-items: center; padding: 24px; }
    }
    @keyframes expFadeIn { from { opacity: 0; } to { opacity: 1; } }

    .exp-preview-sheet {
      position: relative;
      width: 100%;
      max-width: 520px;
      max-height: 90vh;
      background: var(--dash-surface);
      border: 1px solid var(--dash-border);
      border-radius: 20px 20px 0 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      animation: expSlideUp 0.28s cubic-bezier(0.16, 1, 0.3, 1);
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }
    @media (min-width: 720px) { .exp-preview-sheet { border-radius: 20px; } }
    @keyframes expSlideUp {
      from { transform: translateY(40px); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }

    .exp-preview-close {
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 10;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
      font-size: 0.95rem;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }
    .exp-preview-close:hover { background: rgba(0, 0, 0, 0.75); }

    .exp-preview-img-wrap {
      width: 100%;
      aspect-ratio: 16/10;
      background: var(--dash-surface-elevated);
      overflow: hidden;
      flex-shrink: 0;
      position: relative;
    }
    .exp-preview-img-wrap img { width: 100%; height: 100%; object-fit: cover; display: block; }

    .exp-preview-body {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      overflow-y: auto;
    }
    .exp-preview-title { font-size: 1.15rem; font-weight: 800; color: var(--dash-text-primary); line-height: 1.3; }
    .exp-preview-prompt {
      font-size: 0.875rem;
      color: var(--dash-text-secondary);
      line-height: 1.6;
      max-height: 160px;
      overflow-y: auto;
      padding: 10px 12px;
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--dash-border);
      border-radius: 10px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .exp-preview-actions { display: flex; gap: 8px; margin-top: 4px; }
    .exp-preview-actions .btn { flex: 1; }

    @media (prefers-reduced-motion: reduce) {
      .exp-deck-card, .exp-preview-sheet, .exp-preview-overlay { animation: none; }
    }
  `,

  async init(params = {}) {
    if (controller) controller.abort();
    controller = new AbortController();
    const { signal } = controller;

    currentQuery = (params.q || "").trim().toLowerCase();
    mode = params.mode === "deck" ? "deck" : "feed";
    deckIndex = 0;

    const searchInput = document.getElementById("exp-search");
    const searchClear = document.getElementById("exp-search-clear");
    const retryBtn = document.getElementById("exp-retry");
    const clearEmptyBtn = document.getElementById("exp-clear-search-empty");
    const feedBtn = document.getElementById("exp-mode-feed");
    const deckBtn = document.getElementById("exp-mode-deck");
    const shuffleBtn = document.getElementById("exp-shuffle");

    if (feedBtn) feedBtn.addEventListener("click", () => setMode("feed"));
    if (deckBtn) deckBtn.addEventListener("click", () => setMode("deck"));

    if (shuffleBtn) {
      shuffleBtn.addEventListener("click", () => {
        if (loadStatus !== "loaded") return;
        cachedAll = shuffle(cachedAll);
        deckIndex = 0;
        if (mode === "feed") renderFeed();
        else renderDeck();
      });
    }

    if (searchInput) {
      searchInput.value = params.q || "";
      if (currentQuery && searchClear) searchClear.hidden = false;

      searchInput.addEventListener("input", (e) => {
        const v = e.target.value;
        if (searchClear) searchClear.hidden = !v;
        handleSearchInput(v);
      });

      const keyHandler = (e) => {
        if (e.key === "/" && document.activeElement !== searchInput) {
          const tag = (document.activeElement?.tagName || "").toLowerCase();
          if (tag === "input" || tag === "textarea" || document.activeElement?.isContentEditable) return;
          e.preventDefault();
          searchInput.focus();
        }
      };
      document.addEventListener("keydown", keyHandler);
      this._searchKeyHandler = keyHandler;
    }

    if (searchClear) {
      searchClear.addEventListener("click", () => {
        if (searchInput) { searchInput.value = ""; searchInput.focus(); }
        searchClear.hidden = true;
        handleSearchInput("");
      });
    }

    if (clearEmptyBtn) {
      clearEmptyBtn.addEventListener("click", () => {
        if (searchInput) searchInput.value = "";
        if (searchClear) searchClear.hidden = true;
        handleSearchInput("");
      });
    }

    if (retryBtn) {
      retryBtn.addEventListener("click", async () => {
        isLoaded = false;
        loadStatus = "idle";
        renderSkeletons();
        const localCtrl = new AbortController();
        controller = localCtrl;
        await loadData(localCtrl.signal);
        if (localCtrl.signal.aborted) return;
        if (loadStatus === "error") renderError();
        else setMode(mode);
      });
    }

    // Set initial mode UI
    const feed = document.getElementById("exp-feed");
    const deck = document.getElementById("exp-deck");
    if (feedBtn) feedBtn.classList.toggle("active", mode === "feed");
    if (deckBtn) deckBtn.classList.toggle("active", mode === "deck");
    if (feedBtn) feedBtn.setAttribute("aria-selected", String(mode === "feed"));
    if (deckBtn) deckBtn.setAttribute("aria-selected", String(mode === "deck"));
    if (feed) feed.style.display = mode === "feed" ? "" : "none";
    if (deck) deck.style.display = mode === "deck" ? "" : "none";

    // Already loaded
    if (isLoaded && loadStatus === "loaded") {
      // Background refresh of favorites only
      if (auth.currentUser) {
        get(ref(database, `favorites/${auth.currentUser.uid}`)).then(favSnap => {
          userFavorites = favSnap.exists() ? favSnap.val() || {} : {};
          document.querySelectorAll(".exp-fav-btn").forEach(btn => {
            btn.classList.toggle("active", !!userFavorites[btn.dataset.id]);
          });
        }).catch(() => {});
      }
      
      if (mode === "feed") renderFeed();
      else renderDeck();
      return;
    }
    if (loadStatus === "error" && cachedAll.length === 0) {
      renderError();
      return;
    }

    // First load
    renderSkeletons();
    await loadData(signal);
    if (signal.aborted) return;

    if (loadStatus === "error") renderError();
    else if (mode === "feed") renderFeed();
    else renderDeck();
  },

  dispose() {
    if (controller) { controller.abort(); controller = null; }
    if (this._searchKeyHandler) {
      document.removeEventListener("keydown", this._searchKeyHandler);
      this._searchKeyHandler = null;
    }
    if (deckKeyHandler) {
      document.removeEventListener("keydown", deckKeyHandler);
      deckKeyHandler = null;
    }
    clearTimeout(searchDebounce);
    closePreview();
  }
};