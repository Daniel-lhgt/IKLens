import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js";
import { auth, database } from "../firebase-config.js";

/* ============================================================
   CONSTANTS
   ============================================================ */
const USER_CACHE_KEY      = "iklens_user_cache_v1";
const FEATURED_CACHE_KEY  = "iklens_home_featured_v1";
const FEATURED_CACHE_TTL  = 5 * 60 * 1000; // 5 min
const CAROUSEL_INTERVAL   = 4000;

/* ============================================================
   MODULE STATE
   ============================================================ */
let unsubscribeAuth = null;
let controller      = null;
let requestNumber   = 0;

/* ============================================================
   HELPERS
   ============================================================ */
function getGreetingPhrase() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

function getFirstName(v) {
  if (typeof v !== "string") return "";
  const n = v.trim();
  if (!n || n.includes("@")) return "";
  return n.split(/\s+/)[0];
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function safeImageUrl(url) {
  if (typeof url !== "string") return "";
  const t = url.trim();
  return /^https?:\/\//i.test(t) ? t : "";
}

function readCachedUser() {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch { return null; }
}

function readFeaturedCache() {
  try {
    const raw = sessionStorage.getItem(FEATURED_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    if (Date.now() - (parsed.ts || 0) > FEATURED_CACHE_TTL) return null;
    return parsed.items;
  } catch { return null; }
}

function writeFeaturedCache(items) {
  try {
    sessionStorage.setItem(
      FEATURED_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), items })
    );
  } catch {}
}

/* ============================================================
   GREETING
   ============================================================ */
function showGreeting(firstName = "") {
  const greeting = document.getElementById("greeting-line");
  if (!greeting) return;

  greeting.replaceChildren();
  greeting.appendChild(document.createTextNode(getGreetingPhrase()));

  if (firstName) {
    greeting.appendChild(document.createTextNode(", "));
    const name = document.createElement("span");
    name.className = "greeting-name";
    name.textContent = firstName;
    greeting.appendChild(name);
  }

  greeting.appendChild(document.createTextNode(" "));
  const wave = document.createElement("span");
  wave.className = "wave";
  wave.textContent = "👋";
  greeting.appendChild(wave);
}

async function updateGreeting(user) {
  const thisReq = ++requestNumber;

  // Instant paint from cache
  const cached = readCachedUser();
  showGreeting(cached?.name ? getFirstName(cached.name) : "");

  if (!user) return;

  try {
    let snap = await get(ref(database, `users/${user.uid}/profile`));
    if (thisReq !== requestNumber) return;

    let profile = snap.exists() ? snap.val() || {} : null;

    if (!profile) {
      snap = await get(ref(database, `users/${user.uid}`));
      if (thisReq !== requestNumber) return;
      if (snap.exists()) {
        profile = snap.val() || {};
        if (profile.profile && typeof profile.profile === "object") {
          profile = { ...profile, ...profile.profile };
        }
      }
    }

    const firstName =
      getFirstName(profile?.firstName) ||
      getFirstName(profile?.name) ||
      getFirstName(profile?.displayName) ||
      getFirstName(user.displayName);

    if (thisReq === requestNumber) showGreeting(firstName);
  } catch (err) {
    console.error("[Home] greeting load failed:", err);
    if (thisReq === requestNumber) showGreeting(getFirstName(user.displayName));
  }
}

/* ============================================================
   FEATURED — DATA
   ============================================================ */
async function loadFeatured() {
  const cached = readFeaturedCache();
  if (cached && cached.length > 0) return cached;

  try {
    const snap = await get(ref(database, "templates"));
    if (!snap.exists()) return [];

    const all = Object.entries(snap.val())
      .map(([id, v]) => {
        if (!v || typeof v !== "object") return null;
        const image = safeImageUrl(v.image);
        if (!image) return null;
        return {
          id,
          name: v.name || "",
          category: v.category || "",
          image,
          copyCount: typeof v.copyCount === "number" ? v.copyCount : 0
        };
      })
      .filter(Boolean);

    if (all.length === 0) return [];

    // 🎲 Roll a random count between 5 and 7
    const targetCount = Math.floor(Math.random() * 3) + 5; 

    const trending = all
      .filter(t => t.copyCount > 0)
      .sort((a, b) => b.copyCount - a.copyCount)
      .slice(0, targetCount);

    if (trending.length >= targetCount) {
      writeFeaturedCache(trending);
      return trending;
    }

    const trendingIds = new Set(trending.map(t => t.id));
    const rest = all
      .filter(t => !trendingIds.has(t.id))
      .sort(() => Math.random() - 0.5);

    const combined = [...trending, ...rest].slice(0, targetCount);
    writeFeaturedCache(combined);
    return combined;
  } catch (err) {
    console.error("[Home] featured load failed:", err);
    return [];
  }
}

/* ============================================================
   FEATURED — RENDER
   ============================================================ */
function renderFeaturedSkeleton(track) {
  if (!track) return;
  track.innerHTML = "";
  for (let i = 0; i < 2; i++) {
    const s = document.createElement("div");
    s.className = "featured-skeleton";
    s.setAttribute("aria-hidden", "true");
    track.appendChild(s);
  }
}

function renderFeatured(track, items, signal) {
  if (!track) return;

  if (!items || items.length === 0) {
    track.innerHTML = `<div class="featured-empty">Featured prompts are on the way ✨</div>`;
    return;
  }

  track.innerHTML = "";

  items.forEach((t, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "featured-card";
    card.dataset.templateId = t.id;
    card.setAttribute("aria-label", `View template`);
    
    // No text overlays
    card.innerHTML = `
      <img
        src="${escapeHtml(t.image)}"
        alt=""
        loading="${index < 2 ? "eager" : "lazy"}"
        decoding="async"
        fetchpriority="low"
        onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
      />
      <div class="featured-fallback" style="display:none;" aria-hidden="true">🖼️</div>
    `;

    card.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("navigate", {
        detail: { route: "generate", params: { template: t.id } }
      }));
    }, { signal });

    track.appendChild(card);
  });
}

/* ============================================================
   FEATURED — AUTO-SCROLL CAROUSEL
   ============================================================ */
function setupFeaturedCarousel(track, signal) {
  if (!track || track.children.length < 2) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let paused = false;
  let timer  = null;

  const advance = () => {
    if (paused || !track.isConnected) return;

    const card = track.querySelector(".featured-card");
    if (!card) return;

    const styles = getComputedStyle(track);
    const gap    = parseFloat(styles.columnGap || styles.gap || "12") || 12;
    const step   = card.offsetWidth + gap;
    const maxScroll = track.scrollWidth - track.clientWidth;

    if (maxScroll <= 0) return;

    if (track.scrollLeft >= maxScroll - 8) {
      track.scrollTo({ left: 0, behavior: "smooth" });
    } else {
      track.scrollBy({ left: step, behavior: "smooth" });
    }
  };

  const start = () => {
    if (timer) return;
    timer = setInterval(advance, CAROUSEL_INTERVAL);
  };

  const stop = () => {
    if (timer) { clearInterval(timer); timer = null; }
  };

  const pause  = () => { paused = true;  };
  const resume = () => { paused = false; };

  track.addEventListener("mouseenter", pause, { signal });
  track.addEventListener("mouseleave", resume, { signal });
  track.addEventListener("touchstart", pause, { signal, passive: true });
  track.addEventListener("touchend", resume, { signal, passive: true });
  track.addEventListener("focusin", pause, { signal });
  track.addEventListener("focusout", resume, { signal });

  signal.addEventListener("abort", stop);
  start();
}

/* ============================================================
   VIEW DEFINITION
   ============================================================ */
export default {
  title: "Home — IKLens",

  template: () => `
    <section class="home-view" id="home-view" data-view="home">

      <!-- GREETING -->
      <div class="greeting-section">
        <h1 class="greeting-text" id="greeting-line">Good Morning<span class="wave">👋</span></h1>
        <p class="greeting-subtitle">What will you create today?</p>
      </div>

      <!-- FEATURED CAROUSEL -->
      <section class="featured-section">
        <div class="featured-header">
          <h2 class="featured-title">
            <span class="featured-title-icon" aria-hidden="true">🔥</span>
            Featured Prompts
          </h2>
          <a href="#/gallery" class="featured-see-all" data-route="gallery">
            See all
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2.5"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </a>
        </div>
        <div
          class="featured-scroll"
          id="featured-track"
          role="region"
          aria-label="Featured templates"
        ></div>
      </section>

      <!-- CATEGORIES -->
      <section class="categories-section">
        <h2>Choose a category</h2>
        <div class="categories-grid">
          ${["male","female","kids","couple","flyer"].map(cat => {
            const label = cat.charAt(0).toUpperCase() + cat.slice(1);
            return `
              <button class="category-card" data-category="${cat}"
                aria-label="${label} — browse ${label.toLowerCase()} prompts">
                <img src="images/category-${cat}.jpg" alt="" loading="lazy" decoding="async"
                  onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
                <div class="card-fallback" style="display:none;" aria-hidden="true">${label}</div>
                <div class="card-overlay"><span class="card-label">${label}</span></div>
              </button>
            `;
          }).join("")}
        </div>
      </section>

    </section>
  `,

  styles: `
    /* ============================================================
       BASE
       ============================================================ */
    .home-view { width: 100%; }

    /* ============================================================
       GREETING
       ============================================================ */
    .greeting-section { margin: 8px 0 36px; }
    .greeting-text {
      font-size: clamp(1.3rem, 5vw, 2.5rem);
      font-weight: 800;
      line-height: 1.2;
      letter-spacing: -0.02em;
      color: var(--dash-text-primary);
    }
    .greeting-name {
      background: var(--dash-gradient);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      color: transparent;
    }
    .wave {
      display: inline-block;
      animation: wave 2.5s infinite;
      transform-origin: 70% 70%;
    }
    @keyframes wave {
      0%   { transform: rotate(0deg); }
      10%  { transform: rotate(14deg); }
      20%  { transform: rotate(-8deg); }
      30%  { transform: rotate(14deg); }
      40%  { transform: rotate(-4deg); }
      50%  { transform: rotate(10deg); }
      60%, 100% { transform: rotate(0deg); }
    }
    .greeting-subtitle {
      color: var(--dash-text-secondary);
      margin-top: 10px;
      font-size: 1rem;
    }

    /* ============================================================
       FEATURED CAROUSEL (Landscape Banners)
       ============================================================ */
    .featured-section { margin-bottom: 20px; margin-top: -10px;}

    .featured-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      gap: 12px;
    }
    .featured-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 1.15rem;
      font-weight: 700;
      color: var(--dash-text-primary);
      margin: 0;
    }
    .featured-title-icon { font-size: 1.1rem; }

    .featured-see-all {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 6px 12px;
      border-radius: 999px;
      background: transparent;
      border: 1px solid var(--dash-border);
      color: var(--dash-text-secondary);
      font-size: 0.78rem;
      font-weight: 600;
      text-decoration: none;
      transition: background 0.2s, border-color 0.2s, color 0.2s;
      white-space: nowrap;
    }
    .featured-see-all:hover {
      background: var(--dash-surface-elevated);
      border-color: rgba(255,255,255,0.16);
      color: var(--dash-text-primary);
    }

    .featured-scroll {
      display: flex;
      gap: 12px;
      overflow-x: auto;
      overflow-y: hidden;
      scroll-snap-type: x mandatory;
      scroll-behavior: smooth;
      /* Added padding to prevent the weird floating cut-off look */
      padding: 4px 5% 16px; 
      margin: -4px -5% 0;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
      overscroll-behavior-x: contain;
      scroll-padding-left: 5%; /* Helps snap align perfectly */
    }
    .featured-scroll::-webkit-scrollbar { display: none; }

    /* 
      LANDSCAPE BANNER
      - 90% width
      - 100px height (looks like a real banner, not a progress bar)
    */
    :root {
      --banner-width: 100%;
      --banner-height: 300px;
      --banner-radius: 12px;
    }
    /* Wider screens: show 2–3 banners at once instead of one huge, zoomed-in
       image, and stop the next slide from peeking past the page margin. */
    @media (min-width: 768px) {
      :root { --banner-width: calc((100% - 12px) / 2); }
      .featured-scroll { padding: 4px 0 16px; margin: -4px 0 0; scroll-padding-left: 0; }
    }
    @media (min-width: 1100px) {
      :root { --banner-width: calc((100% - 24px) / 3); }
    }

    .featured-card {
      flex: 0 0 var(--banner-width);
      height: var(--banner-height);
      scroll-snap-align: start;
      position: relative;
      border-radius: var(--banner-radius);
      overflow: hidden;
      background: var(--dash-surface-elevated);
      border: 1px solid var(--dash-border);
      padding: 0;
      cursor: pointer;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    
    .featured-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(0,0,0,0.4);
    }
    
    .featured-card img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .featured-fallback {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--dash-text-muted);
      font-size: 1.2rem;
      background: var(--dash-surface-elevated);
    }

    .featured-skeleton {
      flex: 0 0 var(--banner-width);
      height: var(--banner-height);
      border-radius: var(--banner-radius);
      background: linear-gradient(
        90deg,
        var(--dash-surface-elevated) 0%,
        #1f2738 50%,
        var(--dash-surface-elevated) 100%
      );
      background-size: 200% 100%;
      animation: featShimmer 1.4s linear infinite;
    }
    @keyframes featShimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    .featured-empty {
      flex: 1;
      padding: 20px;
      text-align: center;
      color: var(--dash-text-muted);
      font-size: 0.9rem;
      border: 1px dashed var(--dash-border);
      border-radius: var(--banner-radius);
    }

    /* ============================================================
       CATEGORIES
       ============================================================ */
    .categories-section h2 {
      font-size: 1.15rem;
      font-weight: 700;
      margin-bottom: 16px;
      color: var(--dash-text-primary);
    }
    .categories-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 14px;
    }
    /* Phones: 2 columns — let the odd last tile span the full row */
    @media (max-width: 639px) {
      .category-card:last-child:nth-child(odd) { grid-column: 1 / -1; aspect-ratio: 16 / 9; }
      .category-card:last-child:nth-child(odd) img { object-position: center 20%; }
    }
    @media (min-width: 640px) {
      .categories-grid { grid-template-columns: repeat(5, 1fr); gap: 14px; }
    }
    @media (min-width: 960px) {
      .categories-grid { grid-template-columns: repeat(5, 1fr); gap: 20px; }
    }

    .category-card {
      position: relative;
      border-radius: 14px;
      overflow: hidden;
      aspect-ratio: 3 / 4;
      cursor: pointer;
      transition: transform 0.25s ease, box-shadow 0.25s ease;
      background: var(--dash-surface-elevated);
      padding: 0;
      border: 1px solid var(--dash-border);
      width: 100%;
      font-family: inherit;
    }
    .category-card:hover {
      transform: translateY(-3px);
      box-shadow: 0 12px 28px rgba(0,0,0,0.4);
      border-color: rgba(255,255,255,0.18);
    }
    .category-card img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 0.4s ease;
    }
    .category-card:hover img { transform: scale(1.06); }

    .card-overlay {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 36px 14px 14px;
      background: linear-gradient(
        to top,
        rgba(0,0,0,0.88) 0%,
        rgba(0,0,0,0.4) 60%,
        transparent 100%
      );
      pointer-events: none;
    }
    .card-label {
      font-size: 0.95rem;
      font-weight: 700;
      color: #fff;
    }
    .card-fallback {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--dash-surface-elevated);
      color: var(--dash-text-secondary);
      font-size: 1rem;
      font-weight: 600;
    }

    /* ============================================================
       REDUCED MOTION
       ============================================================ */
    @media (prefers-reduced-motion: reduce) {
      .wave { animation: none; }
      .featured-card:hover img,
      .category-card:hover img { transform: none; }
    }
  `,

  async init() {
    // Fresh lifecycle context
    if (controller) controller.abort();
    controller = new AbortController();
    const { signal } = controller;

    if (unsubscribeAuth) {
      try { unsubscribeAuth(); } catch {}
      unsubscribeAuth = null;
    }
    requestNumber = 0;

    /* ---------- Greeting ---------- */
    const cached = readCachedUser();
    showGreeting(cached?.name ? getFirstName(cached.name) : "");

    unsubscribeAuth = onAuthStateChanged(
      auth,
      (user) => updateGreeting(user),
      () => showGreeting()
    );

    /* ---------- Category cards ---------- */
    document.addEventListener("click", (event) => {
      const card = event.target.closest(".category-card");
      const home = document.getElementById("home-view");
      if (!card || !home || !home.contains(card)) return;

      const category = card.dataset.category;
      if (!category) return;

      event.preventDefault();
      window.dispatchEvent(new CustomEvent("navigate", {
        detail: { route: "gallery", params: { category } }
      }));
    }, { signal });

    /* ---------- Featured carousel ---------- */
    const track = document.getElementById("featured-track");
    if (!track) return;

    renderFeaturedSkeleton(track);

    const items = await loadFeatured();
    if (signal.aborted) return;

    renderFeatured(track, items, signal);
    setupFeaturedCarousel(track, signal);
  },

  dispose() {
    if (unsubscribeAuth) {
      try { unsubscribeAuth(); } catch {}
      unsubscribeAuth = null;
    }
    if (controller) {
      controller.abort();
      controller = null;
    }
    requestNumber = 0;
  }
};