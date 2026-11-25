import { ref, get, set, remove, increment, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js";
import { auth, database } from "../firebase-config.js";

const STATE = { templateId: null, templateData: null, fullPromptText: "", isGenerating: false, isFav: false };
let controller = null;
let els = {};

const safeImageUrl = (u) => (typeof u === "string" && u.trim()) ? u.trim() : "";

function showError(msg) { els.errorBox.textContent = "⚠️ " + msg; els.errorBox.classList.add("visible"); }
function hideError() { els.errorBox.classList.remove("visible"); }
function showOnly(state) {
  els.loadingState.hidden = state !== "loading";
  els.statePreview.hidden = state !== "preview";
  els.stateResult.hidden = state !== "result";
}
function showToast(msg) {
  els.copyToast.textContent = msg;
  els.copyToast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.copyToast.classList.remove("show"), 2500);
}

function setupImage(imgEl, placeholderEl, url, alt) {
  const safeUrl = safeImageUrl(url);
  placeholderEl.hidden = true;
  imgEl.classList.remove("is-loaded");
  imgEl.removeAttribute("src");
  // IMPORTANT: keep the <img> rendered (never display:none) while it loads.
  // Browsers may not even start downloading a hidden image, and it was only
  // being un-hidden by its own onload — so it never appeared. We fade it in
  // with opacity instead.
  imgEl.hidden = false;
  if (!safeUrl) { imgEl.hidden = true; placeholderEl.hidden = false; return; }
  imgEl.alt = alt || "Preview";
  imgEl.onload = () => { imgEl.classList.add("is-loaded"); placeholderEl.hidden = true; };
  imgEl.onerror = () => { imgEl.hidden = true; placeholderEl.hidden = false; };
  imgEl.src = safeUrl;
}

async function typewriterReveal(text, element) {
  element.textContent = "";
  const cursor = document.createElement("span");
  cursor.className = "typing-cursor";
  element.appendChild(cursor);
  let displayed = "";
  for (let i = 0; i < text.length; i += 3) {
    if (!STATE.isGenerating) return;
    displayed += text.slice(i, i + 3);
    element.textContent = displayed;
    element.appendChild(cursor);
    const lastChar = text.slice(i, i + 3).slice(-1);
    await new Promise(r => setTimeout(r, /[.!?;:]/.test(lastChar) ? 90 : 6));
  }
  cursor.remove();
}

async function handleGenerate() {
  if (STATE.isGenerating) return;
  const promptText = STATE.templateData?.prompt || "";
  if (!promptText) { showError("No prompt found."); return; }

  hideError();
  STATE.isGenerating = true;
  els.statePreview.hidden = true;
  els.stateResult.hidden = false;
  els.topbarTitle.textContent = "AI Prompt";

  setupImage(els.resultImage, els.resultPlaceholder, STATE.templateData.image, STATE.templateData.name);
  els.referenceTag.hidden = !safeImageUrl(STATE.templateData.image);
  els.promptOutput.textContent = "";
  els.regenerateBtn.disabled = true;
  els.regenerateBtnIcon.textContent = "⏳";

  try {
    await typewriterReveal(promptText, els.promptOutput);
    STATE.fullPromptText = promptText;
  } finally {
    STATE.isGenerating = false;
    els.regenerateBtn.disabled = false;
    els.regenerateBtnIcon.textContent = "🔁";
  }
}

async function handleCopy() {
  if (!STATE.fullPromptText) return;
  try {
    await navigator.clipboard.writeText(STATE.fullPromptText);
    showToast("✅ Copied to clipboard");
    // Count the copy (this feeds "Trending"). Failure here must never show "Copy failed".
    set(ref(database, `templates/${STATE.templateId}/copyCount`), increment(1)).catch(() => {});
  } catch { showError("Copy failed."); }
}

async function toggleFavorite() {
  if (!auth.currentUser) return;
  STATE.isFav = !STATE.isFav;
  els.favBtnTop.classList.toggle("active", STATE.isFav);
  try {
    const favRef = ref(database, `favorites/${auth.currentUser.uid}/${STATE.templateId}`);
    if (STATE.isFav) await set(favRef, true); else await remove(favRef);
  } catch {
    STATE.isFav = !STATE.isFav;
    els.favBtnTop.classList.toggle("active", STATE.isFav);
  }
}

async function handleShare() {
  if (!STATE.templateData) return;
  const url = window.location.href;
  const data = { title: STATE.templateData.name || "IKLens Prompt", text: "Check out this prompt on IKLens!", url };
  if (navigator.share) { try { await navigator.share(data); } catch {} }
  else {
    try { await navigator.clipboard.writeText(url); showToast("🔗 Link copied"); }
    catch { showError("Could not share."); }
  }
}

async function handleDownload() {
  const url = STATE.templateData?.image;
  if (!url) return;
  try {
    showToast("⬇️ Downloading...");
    if (url.includes("cloudinary.com")) {
      const dl = url.replace("/upload/", "/upload/fl_attachment/");
      const a = document.createElement("a");
      a.href = dl;
      a.target = "_blank";
      a.click();
    } else {
      const r = await fetch(url);
      const blob = await r.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${STATE.templateData.name || "template"}.jpg`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    }
  } catch { showError("Download failed."); }
}

async function handleOpenAi(url) {
  if (!STATE.fullPromptText) return;
  try {
    await navigator.clipboard.writeText(STATE.fullPromptText);
    window.open(url, "_blank");
    els.aiModal.classList.remove("open");
    showToast("✅ Prompt copied");
  } catch { showError("Could not copy prompt."); }
}

async function loadRelatedTemplates(category) {
  if (!category) return;
  try {
    const q = query(ref(database, "templates"), orderByChild("category"), equalTo(category));
    const snap = await get(q);
    if (!snap.exists()) return;
    const results = [];
    snap.forEach(child => {
      if (child.key !== STATE.templateId && results.length < 6) {
        results.push({ id: child.key, ...child.val() });
      }
    });
    if (results.length === 0) return;

    els.relatedGrid.innerHTML = "";
    results.forEach(t => {
      const card = document.createElement("div");
      card.className = "gen-related-card";
      const img = document.createElement("img");
      img.src = safeImageUrl(t.image);
      img.loading = "lazy";
      card.appendChild(img);
      card.addEventListener("click", () => window.IKLensRouter.navigate("generate", { template: t.id }));
      els.relatedGrid.appendChild(card);
    });
    els.relatedSection.hidden = false;
  } catch (e) { console.warn(e); }
}

function bindEvents() {
  const { signal } = controller;
  els.backBtn.addEventListener("click", () => window.IKLensRouter.navigate("gallery"), { signal });
  els.generateBtn.addEventListener("click", handleGenerate, { signal });
  els.regenerateBtn.addEventListener("click", handleGenerate, { signal });
  els.copyBtn.addEventListener("click", handleCopy, { signal });
  els.favBtnTop.addEventListener("click", toggleFavorite, { signal });
  els.shareBtn.addEventListener("click", handleShare, { signal });
  els.downloadBtn.addEventListener("click", handleDownload, { signal });
  els.openAiBtn.addEventListener("click", () => els.aiModal.classList.add("open"), { signal });
  els.closeAiModal.addEventListener("click", () => els.aiModal.classList.remove("open"), { signal });
  els.aiModal.addEventListener("click", (e) => { if (e.target === els.aiModal) els.aiModal.classList.remove("open"); }, { signal });
  document.querySelectorAll(".ai-app-btn").forEach(btn => {
    btn.addEventListener("click", () => handleOpenAi(btn.dataset.url), { signal });
  });
}

export default {
  title: "Generate Prompt — IKLens",

  template: () => `
    <section class="gen-shell" id="generate-view" data-view="generate">
      <header class="gen-topbar">
        <button class="gen-topbar-btn" id="backBtn" aria-label="Go back">‹</button>
        <h1 class="gen-topbar-title" id="topbarTitle">Generate Prompt</h1>
        <div class="gen-top-actions">
          <button class="gen-icon-btn" id="shareBtn" title="Share">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
          </button>
          <button class="gen-icon-btn" id="favBtnTop" title="Favorite">
            <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          </button>
        </div>
      </header>

      <div class="gen-loading" id="loadingState">
        <div class="gen-loading-spinner"></div><span>Loading template…</span>
      </div>
      <div class="gen-error" id="errorBox" role="alert"></div>

      <section class="gen-state" id="statePreview" hidden>
        <div class="gen-image-frame">
          <img id="previewImage" class="gen-image" alt="Template preview" />
          <div class="gen-image-placeholder" id="previewPlaceholder" hidden>
            <span class="gen-image-placeholder-icon">🖼️</span><span>No preview available</span>
          </div>
          <button class="gen-download-btn" id="downloadBtn" title="Download Image">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </button>
        </div>
        <div class="gen-action-row">
          <button type="button" class="gen-btn-primary" id="generateBtn"><span id="generateBtnLabel">Generate</span></button>
        </div>
      </section>

      <section class="gen-state" id="stateResult" hidden>
        <div class="gen-image-frame">
          <img id="resultImage" class="gen-image" alt="Reference image" />
          <div class="gen-image-placeholder" id="resultPlaceholder" hidden>
            <span class="gen-image-placeholder-icon">🖼️</span><span>No preview available</span>
          </div>
          <span class="gen-ref-tag" id="referenceTag" hidden>Reference</span>
        </div>
        <div class="gen-prompt-section">
          <div class="gen-prompt-label"><span class="gen-prompt-icon">✨</span><span>AI Prompt</span></div>
          <div class="gen-prompt-body" id="promptOutput" aria-live="polite"></div>
        </div>
        <div class="gen-action-row">
          <button type="button" class="gen-btn-icon" id="regenerateBtn" aria-label="Regenerate"><span id="regenerateBtnIcon">🔁</span></button>
          <button type="button" class="gen-btn-secondary" id="openAiBtn">🤖 Open in AI</button>
          <button type="button" class="gen-btn-primary" id="copyBtn"><span>📋 Copy</span></button>
        </div>
      </section>

      <section class="gen-related-section" id="relatedSection" hidden>
        <h3 class="gen-related-title">You might also like</h3>
        <div class="gen-related-scroll" id="relatedGrid"></div>
      </section>

      <div class="copy-toast" id="copyToast" role="status" aria-live="polite">✅ Copied to clipboard</div>

      <div class="ai-modal-backdrop" id="aiModal">
        <div class="ai-modal">
          <div class="ai-modal-head">
            <h3>Open in AI</h3>
            <button class="ai-modal-close" id="closeAiModal">✕</button>
          </div>
          <p class="ai-modal-sub">We'll copy the prompt, then open the app. Just paste it in!</p>
          <div class="ai-apps-grid">
            <button class="ai-app-btn" data-url="https://chatgpt.com"><span class="ai-icon">🤖</span> ChatGPT</button>
            <button class="ai-app-btn" data-url="https://leonardo.ai"><span class="ai-icon">🎨</span> Leonardo</button>
            <button class="ai-app-btn" data-url="https://gemini.google.com/app"><span class="ai-icon">✨</span> Gemini</button>
            <button class="ai-app-btn" data-url="https://claude.ai/new"><span class="ai-icon">🧠</span> Claude</button>
            <button class="ai-app-btn" data-url="https://discord.com/app"><span class="ai-icon">⛵</span> Midjourney</button>
            <button class="ai-app-btn" data-url="https://playground.com"><span class="ai-icon">🖼️</span> Playground</button>
          </div>
        </div>
      </div>
    </section>
  `,

  styles: `
    [data-view="generate"] {
      --ik-bg: #050714; --ik-surface: #0f1223; --ik-card: #151a30;
      --ik-border: rgba(124,138,255,0.12); --ik-accent: #7c8aff; --ik-accent-bright: #a5aeff;
      --ik-text: #eef0ff; --ik-text-secondary: #b0b8e6; --ik-text-muted: #6b72b0;
      --ik-success: #34d399; --ik-error: #f87171;
      --ik-gradient: linear-gradient(135deg, #8a2be2 0%, #00d2ff 100%);
      --ik-gradient-hover: linear-gradient(135deg, #9d4beb 0%, #33dfff 100%);
      --ik-radius: 12px; --ik-radius-lg: 16px; --ik-radius-xl: 22px; --ik-pill: 9999px;
      --ik-transition: 0.22s cubic-bezier(0.16,1,0.3,1);
      --ik-shadow-glow: 0 8px 28px rgba(138,43,226,0.35);
      --safe-bottom: env(safe-area-inset-bottom, 0px);
    }
    #generate-view { display: flex; flex-direction: column; width: 100%; max-width: 620px; margin: 0 auto; padding: 14px 14px 40px; }
    .gen-topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
    .gen-topbar-btn { width: 40px; height: 40px; border: none; background: transparent; color: var(--ik-text); font-size: 1.5rem; display: flex; align-items: center; justify-content: center; border-radius: 50%; cursor: pointer; }
    .gen-topbar-btn:hover { background: rgba(255,255,255,0.08); }
    .gen-topbar-title { flex: 1; text-align: center; font-size: 1.05rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .gen-top-actions { display: flex; gap: 6px; }
    .gen-icon-btn { width: 36px; height: 36px; border: none; background: transparent; color: var(--ik-text-secondary); display: flex; align-items: center; justify-content: center; border-radius: 50%; cursor: pointer; }
    .gen-icon-btn:hover { color: var(--ik-text); background: rgba(255,255,255,0.05); }
    .gen-icon-btn svg { width: 20px; height: 20px; fill: transparent; stroke: currentColor; stroke-width: 2; }
    .gen-icon-btn#favBtnTop.active svg { fill: #ef4444; stroke: #ef4444; }

    .gen-state { display: flex; flex-direction: column; gap: 16px; }
    .gen-state[hidden] { display: none !important; }

    .gen-image-frame { position: relative; width: 100%; aspect-ratio: 9/16; max-height: 65vh; background: #000; border-radius: var(--ik-radius-xl); overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,0.5); }
    .gen-image { width: 100%; height: 100%; object-fit: cover; display: block; opacity: 0; transition: opacity 0.3s ease; }
    .gen-image.is-loaded { opacity: 1; }
    .gen-image[hidden] { display: none; }
    .gen-image-placeholder { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--ik-text-muted); background: var(--ik-surface); }
    .gen-image-placeholder[hidden] { display: none; }
    .gen-ref-tag { position: absolute; top: 14px; right: 14px; padding: 6px 14px; background: rgba(0,0,0,0.75); backdrop-filter: blur(8px); color: #fff; font-size: 0.78rem; border-radius: var(--ik-pill); border: 1px solid rgba(255,255,255,0.1); z-index: 2; }
    .gen-download-btn { position: absolute; bottom: 14px; right: 14px; width: 40px; height: 40px; border-radius: 50%; background: rgba(0,0,0,0.6); backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.15); color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 2; }
    .gen-download-btn:hover { background: rgba(0,0,0,0.85); }
    .gen-download-btn svg { width: 20px; height: 20px; }

    .gen-prompt-section { display: flex; flex-direction: column; gap: 12px; }
    .gen-prompt-label { display: flex; align-items: center; gap: 10px; padding: 0 4px; font-size: 0.82rem; font-weight: 700; letter-spacing: 0.14em; color: var(--ik-text-secondary); text-transform: uppercase; }
    .gen-prompt-icon { width: 34px; height: 34px; border-radius: 10px; background: linear-gradient(135deg,#2a2350,#1b1e3a); border: 1px solid rgba(138,43,226,0.35); display: flex; align-items: center; justify-content: center; font-size: 1rem; }
    .gen-prompt-body { background: #0d1020; border: 1px solid rgba(124,138,255,0.14); border-radius: var(--ik-radius-xl); padding: 22px 20px; min-height: 150px; max-height: 40vh; overflow-y: auto; color: var(--ik-text); font-size: 0.98rem; line-height: 1.75; white-space: pre-wrap; word-break: break-word; }

    .gen-action-row { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
    .gen-action-row[hidden] { display: none !important; }
    .gen-btn-primary { flex: 1; min-height: 54px; padding: 14px 24px; border: none; border-radius: var(--ik-pill); background: var(--ik-gradient); color: #fff; font-size: 1rem; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; gap: 10px; box-shadow: var(--ik-shadow-glow); cursor: pointer; }
    .gen-btn-primary:hover:not(:disabled) { background: var(--ik-gradient-hover); }
    .gen-btn-primary:disabled { opacity: 0.55; cursor: not-allowed; }
    .gen-btn-secondary { flex: 1; min-height: 54px; padding: 14px 20px; border: 1px solid rgba(124,138,255,0.3); border-radius: var(--ik-pill); background: rgba(124,138,255,0.1); color: var(--ik-accent-bright); font-size: 0.95rem; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; }
    .gen-btn-secondary:hover { background: rgba(124,138,255,0.2); }
    .gen-btn-icon { width: 54px; height: 54px; border-radius: 50%; border: 1px solid rgba(124,138,255,0.3); background: rgba(124,138,255,0.1); color: var(--ik-accent-bright); display: flex; align-items: center; justify-content: center; font-size: 1.3rem; cursor: pointer; }
    .gen-btn-icon:hover:not(:disabled) { background: rgba(124,138,255,0.2); }

    .gen-related-section { margin-top: 30px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.05); }
    .gen-related-title { font-size: 1.05rem; font-weight: 600; margin-bottom: 14px; }
    .gen-related-scroll { display: flex; gap: 12px; overflow-x: auto; scrollbar-width: none; padding-bottom: 10px; }
    .gen-related-scroll::-webkit-scrollbar { display: none; }
    .gen-related-card { flex: 0 0 120px; aspect-ratio: 4/5; border-radius: var(--ik-radius); overflow: hidden; background: var(--ik-surface); cursor: pointer; border: 1px solid var(--ik-border); }
    .gen-related-card img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s; }
    .gen-related-card:hover img { transform: scale(1.05); }

    .ai-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(4px); z-index: 1000; display: flex; align-items: flex-end; justify-content: center; opacity: 0; pointer-events: none; transition: opacity 0.3s; }
    .ai-modal-backdrop.open { opacity: 1; pointer-events: auto; }
    .ai-modal { width: 100%; max-width: 500px; background: var(--ik-card); border-radius: 24px 24px 0 0; padding: 24px; transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.16,1,0.3,1); }
    .ai-modal-backdrop.open .ai-modal { transform: translateY(0); }
    .ai-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .ai-modal-head h3 { font-size: 1.2rem; font-weight: 700; }
    .ai-modal-close { background: transparent; border: none; color: var(--ik-text-muted); font-size: 1.2rem; cursor: pointer; }
    .ai-modal-sub { font-size: 0.85rem; color: var(--ik-text-secondary); margin-bottom: 20px; }
    .ai-apps-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 12px; }
    .ai-app-btn { padding: 16px; border-radius: var(--ik-radius); border: 1px solid var(--ik-border); background: var(--ik-surface); color: var(--ik-text); font-size: 0.95rem; font-weight: 600; display: flex; align-items: center; gap: 12px; cursor: pointer; }
    .ai-app-btn:hover { background: rgba(124,138,255,0.1); border-color: rgba(124,138,255,0.3); }
    .ai-icon { font-size: 1.3rem; }

    .typing-cursor { display: inline-block; width: 2px; height: 1.1em; background: var(--ik-accent-bright); margin-left: 2px; animation: blink 0.9s step-end infinite; vertical-align: text-bottom; }
    @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
    .copy-toast { position: fixed; bottom: calc(90px + var(--safe-bottom)); left: 50%; transform: translateX(-50%) translateY(10px); background: rgba(20,24,40,0.95); border: 1px solid rgba(124,138,255,0.35); color: var(--ik-success); padding: 10px 20px; border-radius: var(--ik-pill); font-size: 0.85rem; opacity: 0; pointer-events: none; transition: opacity 0.25s, transform 0.25s; z-index: 500; }
    .copy-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
    .gen-error { background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.3); color: var(--ik-error); padding: 12px 16px; border-radius: var(--ik-radius); font-size: 0.9rem; display: none; }
    .gen-error.visible { display: block; }
    .gen-loading { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; min-height: 50vh; color: var(--ik-text-muted); }
    .gen-loading-spinner { width: 36px; height: 36px; border: 3px solid rgba(124,138,255,0.15); border-top-color: var(--ik-accent); border-radius: 50%; animation: spin 0.9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .gen-loading[hidden] { display: none !important; }
  `,

  async init(params = {}) {
    if (controller) controller.abort();
    controller = new AbortController();
    const { signal } = controller;

    els = {
      backBtn: document.getElementById("backBtn"),
      topbarTitle: document.getElementById("topbarTitle"),
      shareBtn: document.getElementById("shareBtn"),
      favBtnTop: document.getElementById("favBtnTop"),
      downloadBtn: document.getElementById("downloadBtn"),
      loadingState: document.getElementById("loadingState"),
      errorBox: document.getElementById("errorBox"),
      statePreview: document.getElementById("statePreview"),
      previewImage: document.getElementById("previewImage"),
      previewPlaceholder: document.getElementById("previewPlaceholder"),
      generateBtn: document.getElementById("generateBtn"),
      generateBtnLabel: document.getElementById("generateBtnLabel"),
      stateResult: document.getElementById("stateResult"),
      resultImage: document.getElementById("resultImage"),
      resultPlaceholder: document.getElementById("resultPlaceholder"),
      referenceTag: document.getElementById("referenceTag"),
      promptOutput: document.getElementById("promptOutput"),
      copyBtn: document.getElementById("copyBtn"),
      openAiBtn: document.getElementById("openAiBtn"),
      regenerateBtn: document.getElementById("regenerateBtn"),
      regenerateBtnIcon: document.getElementById("regenerateBtnIcon"),
      copyToast: document.getElementById("copyToast"),
      relatedSection: document.getElementById("relatedSection"),
      relatedGrid: document.getElementById("relatedGrid"),
      aiModal: document.getElementById("aiModal"),
      closeAiModal: document.getElementById("closeAiModal")
    };

    // Reset state
    STATE.templateId = params.template || null;
    STATE.isGenerating = false;
    STATE.fullPromptText = "";
    STATE.isFav = false;
    els.favBtnTop.classList.remove("active");
    els.relatedSection.hidden = true;
    els.aiModal.classList.remove("open");

    bindEvents();

    if (!STATE.templateId) { showError("No template selected."); showOnly("none"); return; }

    showOnly("loading");
    els.topbarTitle.textContent = "Generate Prompt";
    hideError();

    try {
      const snap = await get(ref(database, `templates/${STATE.templateId}`));
      if (signal.aborted) return;
      if (!snap.exists()) { showError("Template not found."); showOnly("none"); return; }
      const data = snap.val() || {};
      STATE.templateData = {
        id: STATE.templateId,
        name: data.name || "",
        image: data.image || "",
        prompt: data.prompt || "",
        category: data.category || ""
      };

      if (auth.currentUser) {
        try {
          const favSnap = await get(ref(database, `favorites/${auth.currentUser.uid}/${STATE.templateId}`));
          if (favSnap.exists()) { STATE.isFav = true; els.favBtnTop.classList.add("active"); }
        } catch (e) {
          console.warn("[Generate] couldn't read favorite state:", e);
        }
      }
      if (signal.aborted) return;

      loadRelatedTemplates(STATE.templateData.category);

      setupImage(els.previewImage, els.previewPlaceholder, STATE.templateData.image, STATE.templateData.name);
      els.generateBtn.disabled = false;
      els.generateBtnLabel.textContent = "Generate";
      showOnly("preview");
    } catch {
      showError("Failed to load template.");
      showOnly("none");
    }
  },

  dispose() {
    STATE.isGenerating = false;
    if (controller) { controller.abort(); controller = null; }
  }
};