/**
 * IKLens — Single Page Application Router
 *
 * Responsibilities:
 * - Load Home, Gallery, and Profile into #app-content.
 * - Open generate.html as a standalone page.
 * - Support hash routes and query parameters.
 * - Support category navigation from Home to Gallery.
 * - Prevent stale navigation requests from overwriting newer pages.
 * - Initialize and dispose each view via window.init<Route>View / dispose<Route>View.
 * - Send navigation errors to error.html.
 * - Retry failed routes through the error-page retry event.
 *
 * Realtime Database only — no Firestore.
 *
 * IMPORTANT: Views are NEVER cached. Every navigation
 * fetches a fresh copy so edits to home.html / gallery.html /
 * profile.html take effect immediately.
 */

const ROUTE_MAP = {
  home: {
    view: "home.html"
  },

  gallery: {
    view: "gallery.html"
  },

  profile: {
    view: "profile.html"
  },

  create: {
    standalone: "generate.html"
  },

  "generate-prompt": {
    standalone: "generate.html"
  },

  "create-prompt": {
    standalone: "generate.html"
  }
};

const DEFAULT_ROUTE = "home";
const ERROR_PAGE = "error.html";

let activeAbortController = null;
let navigationId = 0;
let currentRouteName = null;
let currentRouteParams = {};
let failedNavigation = null;
let listenersInitialized = false;
let routerInitialized = false;
let isRedirectingToError = false;

/* Track dispose function for the currently rendered view. */
let activeDispose = null;


/* --------------------------------
   URL AND ROUTE HELPERS
--------------------------------- */

function resolvePath(path) {
  return new URL(path, document.baseURI).href;
}

function getRouteFromHash() {
  const rawHash = window.location.hash
    .trim()
    .replace(/^#\/?/, "");

  if (!rawHash) {
    return {
      route: DEFAULT_ROUTE,
      params: {}
    };
  }

  const questionIndex = rawHash.indexOf("?");

  const path = questionIndex === -1
    ? rawHash
    : rawHash.slice(0, questionIndex);

  const query = questionIndex === -1
    ? ""
    : rawHash.slice(questionIndex + 1);

  const params = {};

  new URLSearchParams(query).forEach((value, key) => {
    params[key] = value;
  });

  return {
    route: path.split("/")[0] || DEFAULT_ROUTE,
    params
  };
}

function paramsKey(params = {}) {
  return JSON.stringify(
    Object.keys(params)
      .sort()
      .reduce((result, key) => {
        result[key] = params[key];
        return result;
      }, {})
  );
}


/* --------------------------------
   VIEW LIFECYCLE HELPERS
--------------------------------- */

function viewInitName(route) {
  return "init" +
    route.charAt(0).toUpperCase() +
    route.slice(1) +
    "View";
}

function viewDisposeName(route) {
  return "dispose" +
    route.charAt(0).toUpperCase() +
    route.slice(1) +
    "View";
}

function callViewDispose() {
  if (typeof activeDispose === "function") {
    try {
      activeDispose();
    } catch (error) {
      console.warn("[IKLens Router] View dispose failed:", error);
    }
  }

  activeDispose = null;
}

function callViewInit(route, params) {
  const initName = viewInitName(route);

  if (typeof window[initName] === "function") {
    try {
      window[initName](params || {});
    } catch (error) {
      console.warn(`[IKLens Router] ${initName} failed:`, error);
    }
  }

  const disposeName = viewDisposeName(route);

  if (typeof window[disposeName] === "function") {
    activeDispose = window[disposeName];
  } else {
    activeDispose = null;
  }
}


/* --------------------------------
   NAVIGATION STATE
--------------------------------- */

function updateActiveNavigation(route) {
  const createRoutes = [
    "create",
    "create-prompt",
    "generate-prompt"
  ];

  document.querySelectorAll("[data-route]").forEach((element) => {
    const elementRoute = element.getAttribute("data-route");

    const isActive =
      elementRoute === route ||
      (
        createRoutes.includes(route) &&
        createRoutes.includes(elementRoute)
      );

    element.classList.toggle("active", isActive);

    if (isActive) {
      element.setAttribute("aria-current", "page");
    } else {
      element.removeAttribute("aria-current");
    }
  });
}

function showLoadingState(container) {
  container.innerHTML = `
    <div style="
      min-height:280px;
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      color:#94a3b8;
      font-family:inherit;
    ">
      <div style="
        width:36px;
        height:36px;
        border:3px solid rgba(255,255,255,.12);
        border-top-color:#00d2ff;
        border-radius:50%;
        animation:iklens-router-spin .8s linear infinite;
        margin-bottom:14px;
      "></div>
      <span>Loading...</span>
      <style>
        @keyframes iklens-router-spin {
          to { transform:rotate(360deg); }
        }
      </style>
    </div>
  `;

  container.setAttribute("aria-busy", "true");
}


/* --------------------------------
   ERROR HANDLING
--------------------------------- */

function redirectToErrorPage(error, failedRoute, params = {}) {
  console.error("[IKLens Router] Navigation failed:", error);

  if (isRedirectingToError) {
    console.error("[IKLens Router] Could not recover from the navigation error.");
    return;
  }

  isRedirectingToError = true;

  failedNavigation = {
    route: failedRoute || currentRouteName || DEFAULT_ROUTE,
    params: { ...params }
  };

  const errorURL = new URL(ERROR_PAGE, document.baseURI);

  errorURL.searchParams.set(
    "message",
    error?.message || "Something went wrong. Please try again."
  );

  errorURL.searchParams.set(
    "from",
    failedNavigation.route
  );

  errorURL.searchParams.set(
    "retryParams",
    JSON.stringify(failedNavigation.params)
  );

  window.location.assign(errorURL.href);
}


/* --------------------------------
   FETCH VIEW HTML — ALWAYS FRESH

   No caching. Every navigation fetches the latest HTML
   for the requested view, so edits take effect immediately.
--------------------------------- */

async function fetchViewHTML(viewPath, signal) {
  const baseUrl = resolvePath(viewPath);

  // Cache-buster so browsers and any intermediate cache
  // always return fresh HTML.
  const separator = baseUrl.includes("?") ? "&" : "?";
  const fetchUrl = `${baseUrl}${separator}v=${Date.now()}`;

  const response = await fetch(fetchUrl, {
    signal,
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
      "Pragma": "no-cache"
    }
  });

  if (!response.ok) {
    throw new Error(
      `Could not load ${viewPath}. Server returned ${response.status}.`
    );
  }

  return await response.text();
}


/* --------------------------------
   VIEW SCRIPT HANDLING
--------------------------------- */

async function executeViewScripts(container, thisNavigationId) {
  const scripts = Array.from(
    container.querySelectorAll("script")
  );

  for (const oldScript of scripts) {
    if (thisNavigationId !== navigationId) return;

    const newScript = document.createElement("script");

    for (const attribute of Array.from(oldScript.attributes)) {
      newScript.setAttribute(attribute.name, attribute.value);
    }

    if (oldScript.src) {
      const scriptURL = new URL(
        oldScript.getAttribute("src"),
        document.baseURI
      ).href;

      // Cache-bust external scripts too.
      const scriptSeparator = scriptURL.includes("?") ? "&" : "?";
      newScript.src = `${scriptURL}${scriptSeparator}v=${Date.now()}`;

      await new Promise((resolve, reject) => {
        newScript.onload = resolve;
        newScript.onerror = () => {
          reject(
            new Error(`Could not load script: ${scriptURL}`)
          );
        };

        document.body.appendChild(newScript);
      });

      newScript.remove();

    } else if (newScript.type === "module") {
      await new Promise((resolve, reject) => {
        newScript.onload = resolve;
        newScript.onerror = () => {
          reject(new Error("An inline view module failed to load."));
        };

        newScript.textContent = oldScript.textContent;
        document.body.appendChild(newScript);
      });

      newScript.remove();

    } else {
      newScript.textContent = oldScript.textContent;
      document.body.appendChild(newScript);
      newScript.remove();
    }

    oldScript.remove();
  }
}


/* --------------------------------
   LOAD A VIEW
--------------------------------- */

async function loadView(route, params = {}) {
  const container = document.getElementById("app-content");

  if (!container) {
    redirectToErrorPage(
      new Error("Dashboard content container #app-content was not found."),
      route,
      params
    );
    return;
  }

  const config = ROUTE_MAP[route];

  if (!config) {
    redirectToErrorPage(
      new Error(`Unknown route: ${route}`),
      route,
      params
    );
    return;
  }

  // Standalone pages open as full documents.
  if (config.standalone) {
    const targetURL = new URL(
      config.standalone,
      document.baseURI
    );

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        targetURL.searchParams.set(key, String(value));
      }
    });

    window.location.assign(targetURL.href);
    return;
  }

  if (activeAbortController) {
    activeAbortController.abort();
  }

  activeAbortController = new AbortController();

  const signal = activeAbortController.signal;
  const thisNavigationId = ++navigationId;

  currentRouteName = route;
  currentRouteParams = { ...params };

  updateActiveNavigation(route);

  try {
    showLoadingState(container);

    const html = await fetchViewHTML(config.view, signal);

    if (signal.aborted || thisNavigationId !== navigationId) {
      return;
    }

    // Dispose the previous view BEFORE swapping content.
    callViewDispose();

    container.innerHTML = html;

    await executeViewScripts(container, thisNavigationId);

    if (signal.aborted || thisNavigationId !== navigationId) {
      return;
    }

    // Initialize the new view WITH its params.
    callViewInit(route, params);

    window.dispatchEvent(
      new CustomEvent("viewParams", {
        detail: { ...params }
      })
    );

    window.dispatchEvent(
      new CustomEvent("viewLoaded", {
        detail: {
          route,
          params: { ...params }
        }
      })
    );

    container.setAttribute("aria-busy", "false");

  } catch (error) {
    if (error.name === "AbortError") return;

    if (thisNavigationId === navigationId) {
      redirectToErrorPage(error, route, params);
    }
  }
}


/* --------------------------------
   PUBLIC NAVIGATION
--------------------------------- */

export async function navigate(route, params = {}, force = false) {
  const targetRoute = route;
  const targetParams = { ...params };

  if (!ROUTE_MAP[targetRoute]) {
    redirectToErrorPage(
      new Error(`Unknown route: ${targetRoute}`),
      targetRoute,
      targetParams
    );
    return;
  }

  const config = ROUTE_MAP[targetRoute];

  if (config.standalone) {
    const targetURL = new URL(
      config.standalone,
      document.baseURI
    );

    Object.entries(targetParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        targetURL.searchParams.set(key, String(value));
      }
    });

    window.location.assign(targetURL.href);
    return;
  }

  const nextHash =
    targetRoute +
    (
      Object.keys(targetParams).length
        ? `?${new URLSearchParams(targetParams).toString()}`
        : ""
    );

  if (window.location.hash.slice(1) !== nextHash) {
    window.location.hash = nextHash;
  }

  // If we're already on the same route with the same params,
  // still reload the view — since we no longer cache,
  // this guarantees fresh content. This is a deliberate change
  // from the cached version.
  await loadView(targetRoute, targetParams);
}


/* --------------------------------
   DATA-ROUTE LINK SUPPORT
--------------------------------- */

function getNavigationFromElement(element) {
  const routeValue =
    element.getAttribute("data-route") || DEFAULT_ROUTE;

  const questionIndex = routeValue.indexOf("?");

  const route = questionIndex === -1
    ? routeValue
    : routeValue.slice(0, questionIndex);

  const query = questionIndex === -1
    ? ""
    : routeValue.slice(questionIndex + 1);

  const params = Object.fromEntries(
    new URLSearchParams(query)
  );

  Array.from(element.attributes).forEach((attribute) => {
    if (attribute.name.startsWith("data-param-")) {
      const key = attribute.name.slice("data-param-".length);
      params[key] = attribute.value;
    }
  });

  if (element.dataset.category && !params.category) {
    params.category = element.dataset.category;
  }

  return { route, params };
}


/* --------------------------------
   RETRY FAILED NAVIGATION
--------------------------------- */

function handleRetryNavigation(event) {
  const requestedRoute = event.detail?.route;
  const requestedParams = event.detail?.params;

  const route =
    requestedRoute ||
    failedNavigation?.route ||
    currentRouteName ||
    DEFAULT_ROUTE;

  if (!ROUTE_MAP[route]) {
    navigate(DEFAULT_ROUTE, {}, true);
    return;
  }

  let params = {};

  if (
    requestedParams &&
    typeof requestedParams === "object"
  ) {
    params = { ...requestedParams };
  } else if (failedNavigation?.route === route) {
    params = { ...failedNavigation.params };
  } else if (currentRouteName === route) {
    params = { ...currentRouteParams };
  }

  failedNavigation = {
    route,
    params: { ...params }
  };

  navigate(route, params, true);
}


/* --------------------------------
   EVENT LISTENERS
--------------------------------- */

function setupEventListeners() {
  if (listenersInitialized) return;
  listenersInitialized = true;

  window.addEventListener("hashchange", () => {
    const { route, params } = getRouteFromHash();

    // Always reload on hash change, even if route/params match,
    // since we no longer cache.
    navigate(route, params);
  });

  document.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof Element)) return;

    const trigger = target.closest("[data-route]");

    if (!trigger) return;

    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();

    const { route, params } = getNavigationFromElement(trigger);
    navigate(route, params);
  });

  window.addEventListener("navigate", (event) => {
    const detail = event.detail || {};

    if (!detail.route) {
      console.warn(
        "[IKLens Router] A navigate event needs a route."
      );
      return;
    }

    navigate(detail.route, detail.params || {});
  });

  window.addEventListener(
    "iklens:retry-navigation",
    handleRetryNavigation
  );

  window.addEventListener("pagehide", () => {
    callViewDispose();
    if (activeAbortController) {
      try { activeAbortController.abort(); } catch (_) {}
      activeAbortController = null;
    }
  });
}


/* --------------------------------
   INITIALIZE ROUTER
--------------------------------- */

export function initRouter() {
  setupEventListeners();

  if (routerInitialized) return;

  routerInitialized = true;

  const { route, params } = getRouteFromHash();

  navigate(route, params, true);
}


/* --------------------------------
   PUBLIC ROUTER API
--------------------------------- */

window.IKLensRouter = {
  navigate,
  initRouter,
  getCurrentRoute() {
    return currentRouteName;
  },
  getCurrentParams() {
    return { ...currentRouteParams };
  }
};


/* --------------------------------
   AUTO INIT
--------------------------------- */

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initRouter, {
    once: true
  });
} else {
  initRouter();
}