/**
 * IKLens V2 — SPA Router (module views)
 * Contract for each view module (default export):
 *   { title, template(), styles, init(params, root), dispose() }
 */

const ROUTES = {
  home:         { title: "Home — IKLens",         load: () => import("./views/home.js") },
  gallery:      { title: "Gallery — IKLens",      load: () => import("./views/gallery.js") },
  explore:      { title: "Explore — IKLens",      load: () => import("./views/explore.js") },
  profile:      { title: "Profile — IKLens",      load: () => import("./views/profile.js") },
  generate:     { title: "Generate Prompt — IKLens", load: () => import("./views/generate.js") },
  submit:       { title: "Submit a Prompt — IKLens", load: () => import("./views/submit.js") },
  notification: { title: "Notifications — IKLens", load: () => import("./views/notification.js") },
  error:        { title: "Error — IKLens",        load: () => import("./views/error.js") }
};

const DEFAULT_ROUTE = "home";
const moduleCache  = new Map();
const viewCache    = new Map();
const stylesInjected = new Set();

let currentRoute = null;
let navigationId = 0;
let listenersBound = false;

/* ---------- helpers ---------- */
function getRouteFromHash() {
  const raw = window.location.hash.replace(/^#\/?/, "").trim();
  if (!raw) return { route: DEFAULT_ROUTE, params: {} };
  const qIdx = raw.indexOf("?");
  const path = qIdx === -1 ? raw : raw.slice(0, qIdx);
  const query = qIdx === -1 ? "" : raw.slice(qIdx + 1);
  const params = {};
  new URLSearchParams(query).forEach((v, k) => { params[k] = v; });
  return { route: path.split("/")[0] || DEFAULT_ROUTE, params };
}

function injectStyles(route, css) {
  if (!css || stylesInjected.has(route)) return;
  stylesInjected.add(route);
  const tag = document.createElement("style");
  tag.dataset.view = route;
  tag.textContent = css;
  document.head.appendChild(tag);
}

function updateActiveNav(route) {
  document.querySelectorAll("[data-route]").forEach(el => {
    const isActive = el.getAttribute("data-route") === route;
    el.classList.toggle("active", isActive);
    if (isActive) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
}

function buildViewNode(route, view) {
  injectStyles(route, view.styles);
  const wrapper = document.createElement("div");
  wrapper.innerHTML = view.template();
  const node = wrapper.children.length === 1 ? wrapper.firstElementChild : wrapper;
  return node;
}

function fallbackToStandaloneError(route, err) {
  console.error(`[Router] Fatal — could not load "${route}":`, err);
  const url = new URL("error.html", document.baseURI);
  url.searchParams.set("message", "We couldn't load that page.");
  url.searchParams.set("code", "ROUTE_LOAD_FAILED");
  url.searchParams.set("from", route);
  window.location.replace(url.href);
}

/* ---------- module loading ---------- */
async function loadModule(route) {
  if (moduleCache.has(route)) return moduleCache.get(route);
  const cfg = ROUTES[route];
  if (!cfg) return null;
  const mod = await cfg.load();
  moduleCache.set(route, mod);
  return mod;
}

/* ---------- render ---------- */
async function renderRoute(route, params) {
  const container = document.getElementById("app-content");
  if (!container) return;

  const cfg = ROUTES[route];
  const actualRoute = cfg ? route : DEFAULT_ROUTE;
  const thisNav = ++navigationId;

  /* Dispose + hide previous */
  if (currentRoute && currentRoute !== actualRoute) {
    const prevMod = moduleCache.get(currentRoute);
    if (prevMod?.default?.dispose) {
      try { prevMod.default.dispose(); } catch (e) { console.warn(e); }
    }
    const prevNode = viewCache.get(currentRoute);
    if (prevNode) {
      prevNode._savedScrollY = window.scrollY;
      prevNode.style.display = "none";
    }
  }
  /* Hide any other cached nodes just in case */
  viewCache.forEach((node, r) => {
    if (r !== actualRoute) node.style.display = "none";
  });

  /* Load module */
  let mod;
  try {
    mod = await loadModule(actualRoute);
  } catch (err) {
    if (thisNav !== navigationId) return;
    fallbackToStandaloneError(actualRoute, err);
    return;
  }
  if (!mod || thisNav !== navigationId) return;

  const view = mod.default;
  document.title = view.title || cfg?.title || "IKLens";
  updateActiveNav(actualRoute);

  /* Mount (or re-show) */
  let node = viewCache.get(actualRoute);
  if (!node) {
    node = buildViewNode(actualRoute, view);
    container.appendChild(node);
    viewCache.set(actualRoute, node);
  } else {
    node.style.display = "";
  }

  currentRoute = actualRoute;

  /* Init */
  if (typeof view.init === "function") {
    try {
      await view.init(params || {}, node);
    } catch (err) {
      console.error(`[Router] View "${actualRoute}" init failed:`, err);
    }
  }

  /* Restore scroll (or top for fresh view) */
  if (node._savedScrollY != null) {
    window.scrollTo({ top: node._savedScrollY, behavior: "instant" });
  } else {
    window.scrollTo({ top: 0, behavior: "instant" });
  }
}

/* ---------- public API ---------- */
export async function navigate(route, params = {}) {
  if (!ROUTES[route] && route !== "error") return;
  const nextHash = route +
    (Object.keys(params).length ? `?${new URLSearchParams(params).toString()}` : "");
  if (window.location.hash.slice(1) !== nextHash) {
    window.location.hash = nextHash;
    return; // hashchange handles render
  }
  await renderRoute(route, params);
}

async function handleHashChange() {
  const { route, params } = getRouteFromHash();
  await renderRoute(route, params);
}

function bindGlobalListeners() {
  if (listenersBound) return;
  listenersBound = true;

  /* Click delegation for [data-route] */
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-route]");
    if (!trigger) return;
    if (event.defaultPrevented || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const routeVal = trigger.getAttribute("data-route") || DEFAULT_ROUTE;
    const qIdx = routeVal.indexOf("?");
    const route = qIdx === -1 ? routeVal : routeVal.slice(0, qIdx);
    const query = qIdx === -1 ? "" : routeVal.slice(qIdx + 1);
    const params = Object.fromEntries(new URLSearchParams(query));
    if (trigger.dataset.category && !params.category) params.category = trigger.dataset.category;
    navigate(route, params);
  });

  window.addEventListener("hashchange", handleHashChange);

  /* Programmatic navigate events */
  window.addEventListener("navigate", (event) => {
    const d = event.detail || {};
    if (d.route) navigate(d.route, d.params || {});
  });

  /* Prefetch common views after idle so first navigation is instant */
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 1200));
  idle(() => {
    ["gallery", "profile", "explore"].forEach(r => loadModule(r).catch(() => {}));
  }, { timeout: 2500 });
}

/* Export but do NOT auto-run — dashboard-boot.js controls timing after auth */
export function initRouter() {
  bindGlobalListeners();
  handleHashChange();
}

window.IKLensRouter = { navigate, initRouter };