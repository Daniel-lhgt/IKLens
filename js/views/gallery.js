import { ref, get, set, remove } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js";
import { auth, database } from "../firebase-config.js";

const VALID_CATEGORIES = ["all","male","female","kids","couple","flyer"];
const BATCH_SIZE = 16;
const MIN_LOAD_MORE_SPINNER_MS = 400;

// Module-level state (persists across navigations)
let allTemplates = [];
let filteredTemplates = [];
let visibleCount = 0;
let activeCategory = "all";
let currentUser = null;
let userFavorites = {};
let controller = null;
let listenersBound = false;

const $ = (id) => document.getElementById(id);
const safeImageUrl = (u) => (typeof u === "string" && u.trim()) ? u.trim() : "";

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function renderSkeletons(count = BATCH_SIZE) {
  const grid = $("gal-template-grid"); if (!grid) return;
  grid.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.className = "gal-skeleton";
    grid.appendChild(el);
  }
}

function renderVisible() {
  const grid = $("gal-template-grid");
  const emptyState = $("gal-empty");
  const loadMoreWrap = $("gal-load-more-wrap");
  if (!grid) return;

  grid.innerHTML = "";
  if (filteredTemplates.length === 0) {
    grid.style.display = "none";
    emptyState.style.display = "flex";
    loadMoreWrap.style.display = "none";
    return;
  }
  grid.style.display = "grid";
  emptyState.style.display = "none";

  const slice = filteredTemplates.slice(0, visibleCount);

  for (const t of slice) {
    const card = document.createElement("div");
    card.className = "gal-card";
    card.dataset.templateId = t.id;
    card.addEventListener("click", () => {
      window.IKLensRouter.navigate("generate", { template: t.id });
    });

    const url = safeImageUrl(t.image);
    if (url) {
      const img = document.createElement("img");
      img.alt = t.name || "";
      img.loading = "lazy";
      img.decoding = "async";
      img.src = url;
      img.onerror = () => {
        img.remove();
        const fb = document.createElement("div");
        fb.className = "gal-card-fallback";
        fb.textContent = "🖼️";
        card.appendChild(fb);
      };
      card.appendChild(img);
    } else {
      const fb = document.createElement("div");
      fb.className = "gal-card-fallback";
      fb.textContent = "🖼️";
      card.appendChild(fb);
    }

    const favBtn = document.createElement("button");
    favBtn.className = `gal-fav-btn ${userFavorites[t.id] ? "active" : ""}`;
    favBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
    
    // Handle Favorite toggles
    favBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!currentUser) return;
      const isFav = favBtn.classList.contains("active");
      favBtn.classList.toggle("active");
      if (isFav) delete userFavorites[t.id]; else userFavorites[t.id] = true;
      try {
        const favRef = ref(database, `favorites/${currentUser.uid}/${t.id}`);
        if (isFav) await remove(favRef); else await set(favRef, true);
      } catch {
        // Revert on failure
        favBtn.classList.toggle("active");
        if (isFav) userFavorites[t.id] = true; else delete userFavorites[t.id];
      }
    });
    
    card.appendChild(favBtn);
    grid.appendChild(card);
  }

  const hasMore = visibleCount < filteredTemplates.length;
  loadMoreWrap.style.display = hasMore ? "flex" : "none";
}

function setActiveCategory(cat) {
  activeCategory = VALID_CATEGORIES.includes(cat) ? cat : "all";
  const bar = $("gal-filter-bar");
  bar?.querySelectorAll(".gal-filter-chip").forEach(chip => {
    chip.classList.toggle("active", chip.dataset.category === activeCategory);
  });
  const filtered = activeCategory === "all"
    ? [...allTemplates]
    : allTemplates.filter(t => t.category === activeCategory);
  filteredTemplates = shuffleArray(filtered);
  visibleCount = Math.min(BATCH_SIZE, filteredTemplates.length);
  renderVisible();
}

async function fetchTemplates() {
  try {
    const snap = await get(ref(database, "templates"));
    allTemplates = !snap.exists() ? [] : Object.entries(snap.val() || {})
      .map(([id, v]) => {
        if (!v || typeof v !== "object") return null;
        return {
          id,
          name: v.name || "",
          category: (v.category || "").toLowerCase(),
          image: v.image || "",
          prompt: v.prompt || ""
        };
      }).filter(Boolean);
  } catch (err) {
    console.warn("[Gallery] fetch failed:", err);
    allTemplates = [];
  }
}

async function handleLoadMore() {
  const btn = $("gal-btn-load-more");
  const spinner = $("gal-load-spinner");
  const label = $("gal-load-more-label");
  if (!btn || visibleCount >= filteredTemplates.length) return;
  btn.disabled = true;
  spinner.style.display = "inline-block";
  label.textContent = "Loading";
  const start = Date.now();
  visibleCount = Math.min(visibleCount + BATCH_SIZE, filteredTemplates.length);
  renderVisible();
  await new Promise(r => setTimeout(r, Math.max(0, MIN_LOAD_MORE_SPINNER_MS - (Date.now() - start))));
  btn.disabled = false;
  spinner.style.display = "none";
  label.textContent = "Load more";
}

function bindOnce() {
  if (listenersBound) return;
  listenersBound = true;
  $("gal-filter-bar").addEventListener("click", (event) => {
    const chip = event.target.closest(".gal-filter-chip");
    if (chip) setActiveCategory(chip.dataset.category);
  });
  $("gal-btn-load-more").addEventListener("click", handleLoadMore);
}

export default {
  title: "Gallery — IKLens",

  template: () => `
    <section class="gal-container" id="iklens-gallery-workspace" data-view="gallery">
      <nav class="gal-filter-bar" aria-label="Category filter options" id="gal-filter-bar">
        <button type="button" class="gal-filter-chip active" data-category="all">All</button>
        <button type="button" class="gal-filter-chip" data-category="male">Male</button>
        <button type="button" class="gal-filter-chip" data-category="female">Female</button>
        <button type="button" class="gal-filter-chip" data-category="kids">Kids</button>
        <button type="button" class="gal-filter-chip" data-category="couple">Couple</button>
        <button type="button" class="gal-filter-chip" data-category="flyer">Flyer</button>
      </nav>
      <main class="gal-grid" id="gal-template-grid" role="region" aria-live="polite"></main>
      <div class="gal-empty" id="gal-empty" style="display:none;">
        <div class="gal-empty-icon">✨</div>
        <h3 class="gal-empty-title">No templates yet</h3>
        <p class="gal-empty-text">Check back soon — fresh prompts are on the way.</p>
      </div>
      <footer class="gal-load-more-wrap" id="gal-load-more-wrap" style="display:none;">
        <button type="button" class="gal-load-more-btn" id="gal-btn-load-more">
          <span id="gal-load-spinner" class="gal-spinner" style="display:none;"></span>
          <span id="gal-load-more-label">Load more</span>
        </button>
      </footer>
    </section>
  `,

  styles: `
    [data-view="gallery"] {
      --gal-bg: #07090e; --gal-surface: #0e131f; --gal-surface-elevated: #161c2e;
      --gal-border: rgba(255,255,255,0.08); --gal-border-hover: rgba(138,43,226,0.4);
      --gal-text-primary: #f8fafc; --gal-text-secondary: #94a3b8; --gal-text-muted: #64748b;
      --gal-purple-primary: #7c3aed; --gal-purple-light: #a855f7;
      --gal-radius-md: 12px; --gal-radius-full: 9999px; --gal-transition: 0.22s cubic-bezier(0.16,1,0.3,1);
    }
    .gal-container { width: 100%; min-height: calc(100vh - 160px); display: flex; flex-direction: column; gap: 16px; color: var(--gal-text-primary); }
    .gal-filter-bar { display: flex; align-items: center; gap: 8px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; }
    .gal-filter-bar::-webkit-scrollbar { display: none; }
    .gal-filter-chip { background: var(--gal-surface); border: 1px solid var(--gal-border); color: var(--gal-text-secondary); padding: 8px 18px; border-radius: var(--gal-radius-full); font-size: 0.85rem; font-weight: 500; cursor: pointer; white-space: nowrap; transition: all var(--gal-transition); font-family: inherit; }
    .gal-filter-chip:hover { border-color: rgba(255,255,255,0.2); color: var(--gal-text-primary); }
    .gal-filter-chip.active { background: linear-gradient(135deg, var(--gal-purple-primary) 0%, #3b82f6 100%); border-color: transparent; color: #fff; font-weight: 600; box-shadow: 0 4px 14px rgba(124,58,237,0.35); }
    .gal-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 4px; }
    @media (min-width: 640px) { .gal-grid { grid-template-columns: repeat(3, 1fr); gap: 16px; } }
    @media (min-width: 1024px) { .gal-grid { grid-template-columns: repeat(4, 1fr); gap: 20px; } }
    .gal-card { position: relative; aspect-ratio: 4/5; border-radius: var(--gal-radius-md); overflow: hidden; background: var(--gal-surface-elevated); cursor: pointer; border: 1px solid var(--gal-border); padding: 0; transition: transform var(--gal-transition), box-shadow var(--gal-transition), border-color var(--gal-transition); }
    .gal-card:hover { transform: translateY(-3px); box-shadow: 0 12px 28px rgba(0,0,0,0.45); border-color: var(--gal-border-hover); }
    .gal-card img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.4s ease; }
    .gal-card:hover img { transform: scale(1.05); }
    .gal-card-fallback { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--gal-text-muted); font-size: 1.6rem; background: var(--gal-surface-elevated); }
    .gal-fav-btn { position: absolute; top: 10px; right: 10px; z-index: 10; width: 32px; height: 32px; border-radius: 50%; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); border: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.2s, transform 0.2s; }
    .gal-fav-btn:hover { background: rgba(0,0,0,0.85); transform: scale(1.1); }
    .gal-fav-btn svg { width: 16px; height: 16px; fill: transparent; stroke: #fff; stroke-width: 2; transition: fill 0.2s, stroke 0.2s; }
    .gal-fav-btn.active svg { fill: #ef4444; stroke: #ef4444; }
    .gal-skeleton { aspect-ratio: 4/5; border-radius: var(--gal-radius-md); background: linear-gradient(90deg, var(--gal-surface-elevated) 0%, #1f2738 50%, var(--gal-surface-elevated) 100%); background-size: 200% 100%; animation: galShimmer 1.4s linear infinite; }
    @keyframes galShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .gal-empty { flex: 1; text-align: center; padding: 60px 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; }
    .gal-empty-icon { font-size: 2.4rem; opacity: 0.8; }
    .gal-empty-title { font-size: 1.2rem; font-weight: 700; }
    .gal-empty-text { font-size: 0.9rem; color: var(--gal-text-muted); max-width: 320px; }
    .gal-load-more-wrap { display: flex; align-items: center; justify-content: center; margin-top: auto; padding-top: 16px; padding-bottom: 20px; }
    .gal-load-more-btn { background: transparent; border: none; color: var(--gal-purple-light); font-size: 0.9rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 10px; padding: 12px 24px; border-radius: var(--gal-radius-full); transition: background var(--gal-transition); }
    .gal-load-more-btn:hover:not(:disabled) { background: rgba(168,85,247,0.1); }
    .gal-load-more-btn:disabled { opacity: 0.7; cursor: wait; }
    .gal-spinner { width: 16px; height: 16px; border: 2px solid rgba(168,85,247,0.3); border-top-color: var(--gal-purple-light); border-radius: 50%; animation: galSpin 0.7s linear infinite; }
    @keyframes galSpin { to { transform: rotate(360deg); } }
  `,

  async init(params = {}) {
    bindOnce();
    currentUser = auth.currentUser;

    // 🚀 FAST RESUME: If we already have data, do not reload!
    if (allTemplates.length > 0) {
      
      // If they arrived by clicking a category on the Home view
      if (params.category && params.category !== activeCategory) {
        setActiveCategory(params.category);
      }
      
      // Silently update favorites in the background (in case they toggled one on the Generate view)
      if (currentUser) {
        get(ref(database, `favorites/${currentUser.uid}`)).then(favSnap => {
          userFavorites = favSnap.exists() ? favSnap.val() || {} : {};
          // Update the DOM hearts without re-rendering the whole grid
          document.querySelectorAll(".gal-card").forEach(card => {
            const id = card.dataset.templateId;
            const btn = card.querySelector(".gal-fav-btn");
            if (btn) btn.classList.toggle("active", !!userFavorites[id]);
          });
        }).catch(() => {});
      }
      return; // Exit early — INSTANT load, no skeleton flash, no network wait
    }

    // 2. FIRST TIME LOAD
    renderSkeletons();
    $("gal-empty").style.display = "none";
    $("gal-load-more-wrap").style.display = "none";

    userFavorites = {};
    if (currentUser) {
      try {
        const favSnap = await get(ref(database, `favorites/${currentUser.uid}`));
        if (favSnap.exists()) userFavorites = favSnap.val() || {};
      } catch (e) { console.warn("[Gallery] favorites load failed", e); }
    }

    await fetchTemplates();
    setActiveCategory(params.category || "all");
  },

  dispose() {
    // Intentionally DO NOT clear allTemplates or filteredTemplates here.
    // Leaving them in memory allows `init()` to instantly re-render the view
    // when navigating back from Generate or Profile.
  }
};