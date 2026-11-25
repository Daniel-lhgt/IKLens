import { ref, push, set, get, update } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js";
import { auth, database } from "../firebase-config.js";

const CLOUDINARY = { cloudName: "ejuli8vw", uploadPreset: "o13hipx3", folder: "iklens-submissions" };
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

let uploadedImageUrl = "";
let isUploading = false;
let isSubmitting = false;
let controller = null;
let els = {};

function showToast(msg, type = "success") {
  els.toast.textContent = msg;
  els.toast.className = "submit-toast " + type;
  els.toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.remove("show"), 3500);
}

async function uploadImage(file) {
  if (!ALLOWED.includes(file.type)) { showToast("Only JPG, PNG, or WEBP allowed.", "error"); return; }
  if (file.size > MAX_BYTES) { showToast("Image must be 5 MB or smaller.", "error"); return; }

  const localUrl = URL.createObjectURL(file);
  els.uploadPreview.innerHTML = `<img src="${localUrl}" />`;

  isUploading = true;
  els.uploadBtn.disabled = true;
  els.uploadBtnText.textContent = "Uploading…";
  els.uploadProgress.hidden = false;
  els.uploadProgressBar.style.width = "30%";

  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", CLOUDINARY.uploadPreset);
  fd.append("folder", CLOUDINARY.folder);

  try {
    els.uploadProgressBar.style.width = "60%";
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/image/upload`, { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || "Upload failed.");
    uploadedImageUrl = data.secure_url;
    els.uploadProgressBar.style.width = "100%";
    els.uploadBtnText.textContent = "Replace Image";
    showToast("Image uploaded successfully.");
  } catch (err) {
    showToast(err.message || "Upload failed.", "error");
    els.uploadPreview.innerHTML = `<span class="upload-preview-placeholder">🖼️</span>`;
    uploadedImageUrl = "";
    els.imageInput.value = "";
    els.uploadProgressBar.style.width = "0%";
  } finally {
    isUploading = false;
    els.uploadBtn.disabled = false;
    setTimeout(() => {
      els.uploadProgress.hidden = true;
      els.uploadProgressBar.style.width = "0%";
      if (!uploadedImageUrl) els.uploadBtnText.textContent = "Choose Image";
    }, 700);
    URL.revokeObjectURL(localUrl);
  }
}

function bindEvents() {
  const { signal } = controller;

  els.backBtn.addEventListener("click", () => window.IKLensRouter.navigate("profile"), { signal });

  els.consent.addEventListener("change", () => {
    els.submitBtn.disabled = !els.consent.checked;
  }, { signal });

  els.uploadBtn.addEventListener("click", () => {
    if (!isUploading && !isSubmitting) els.imageInput.click();
  }, { signal });

  els.imageInput.addEventListener("change", () => {
    const file = els.imageInput.files?.[0];
    if (file) uploadImage(file);
  }, { signal });

  /* ----- Consent modal checkbox → enables Start ----- */
  els.modalCheckbox.addEventListener("change", () => {
    els.modalAgree.disabled = !els.modalCheckbox.checked;
  }, { signal });

  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!auth.currentUser) return showToast("Please sign in.", "error");
    if (isUploading) return showToast("Wait for upload to finish.", "error");
    if (!els.consent.checked) return showToast("Please agree to the guidelines.", "error");
    if (isSubmitting) return;

    const title = els.title.value.trim();
    const category = els.category.value;
    const prompt = els.prompt.value.trim();
    if (!title) { showToast("Title is required.", "error"); return; }
    if (!category) { showToast("Category is required.", "error"); return; }
    if (!prompt) { showToast("Prompt is required.", "error"); return; }
    if (!uploadedImageUrl) { showToast("Please upload an image.", "error"); return; }

    isSubmitting = true;
    els.submitBtn.disabled = true;
    els.submitBtnText.textContent = "Submitting…";

    try {
      const subRef = push(ref(database, "submissions"));
      await set(subRef, {
        uid: auth.currentUser.uid,
        authorName: auth.currentUser.displayName || auth.currentUser.email?.split("@")[0] || "User",
        title, category, prompt, image: uploadedImageUrl,
        status: "pending", createdAt: Date.now()
      });
      showToast("Prompt submitted for review!");
      els.form.reset();
      els.uploadPreview.innerHTML = `<span class="upload-preview-placeholder">🖼️</span>`;
      uploadedImageUrl = "";
      els.uploadBtnText.textContent = "Choose Image";
      setTimeout(() => window.IKLensRouter.navigate("profile"), 1500);
    } catch {
      showToast("Could not submit. Please try again.", "error");
      isSubmitting = false;
      els.submitBtn.disabled = false;
      els.submitBtnText.textContent = "Submit for Review";
    }
  }, { signal });

  /* ----- Modal: Cancel now just closes (no navigation) ----- */
  els.modalCancel.addEventListener("click", () => {
    els.modal.classList.remove("open");
  }, { signal });

  /* ----- Modal: Start accepts → saves consent → closes ----- */
  els.modalAgree.addEventListener("click", async () => {
    if (!els.modalCheckbox.checked) return;
    if (auth.currentUser) {
      try {
        await update(ref(database, `users/${auth.currentUser.uid}/profile`), { submissionConsent: true });
      } catch {}
    }
    els.modal.classList.remove("open");
  }, { signal });
}

export default {
  title: "Submit a Prompt — IKLens",

  template: () => `
    <section class="submit-container" id="submit-view" data-view="submit">

      <div class="submit-topbar">
        <button class="submit-back-btn" id="submitBackBtn" aria-label="Back to profile">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <h1>Submit a Prompt</h1>
      </div>

      <div class="submit-header">
        <p>Share your creative prompt with the community. Our team will review it before publishing.</p>
      </div>

      <form id="submit-form" class="submit-form" novalidate>

        <div class="submit-form-group">
          <label class="submit-form-label" for="sub-title">Prompt Title</label>
          <input type="text" id="sub-title" class="submit-form-input" placeholder="e.g. Golden Hour Portrait" maxlength="80" required />
        </div>

        <div class="submit-form-group">
          <label class="submit-form-label" for="sub-category">Category</label>
          <select id="sub-category" class="submit-form-select" required>
            <option value="">Select a category…</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="kids">Kids</option>
            <option value="couple">Couple</option>
            <option value="flyer">Flyer</option>
          </select>
        </div>

        <div class="submit-form-group">
          <label class="submit-form-label" for="sub-prompt">AI Prompt</label>
          <textarea id="sub-prompt" class="submit-form-textarea" placeholder="Paste or write the full prompt here." required></textarea>
        </div>

        <div class="submit-form-group">
          <label class="submit-form-label">Reference Image</label>
          <div class="upload-box">
            <div class="upload-preview" id="upload-preview"><span class="upload-preview-placeholder">🖼️</span></div>
            <div class="upload-controls">
              <button type="button" class="upload-btn" id="upload-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span id="upload-btn-text">Choose Image</span>
              </button>
              <input type="file" id="image-input" accept="image/*" hidden />
              <span class="upload-hint">JPG, PNG, or WEBP · Max 5 MB</span>
              <div class="upload-progress" id="upload-progress" hidden>
                <div class="upload-progress-bar" id="upload-progress-bar"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="submit-warning">
          ℹ️ <strong>Review required:</strong> Submissions go to review before publishing and may be edited or declined. <a href="pages/terms.html" target="_blank" rel="noopener">Read guidelines</a>.
        </div>

        <label class="submit-consent">
          <input type="checkbox" id="consent-checkbox" required />
          <span>I confirm this content is mine (or licensed to me), and I agree to the submission guidelines.</span>
        </label>

        <button type="submit" class="submit-btn" id="submit-btn" disabled>
          <span id="submit-btn-text">Submit for Review</span>
        </button>
      </form>

      <!-- ===== Consent Modal ===== -->
      <div class="submit-modal-backdrop" id="submit-modal" role="dialog" aria-modal="true" aria-labelledby="submit-modal-title">
        <div class="submit-modal-card">
          <div class="submit-modal-icon" aria-hidden="true">📋</div>
          <h2 id="submit-modal-title">Before you submit</h2>
          <p>Your prompt will be reviewed by our team before it goes live. Here's what that means:</p>
          <ul>
            <li><strong>Review takes 24–48 hours</strong> — you'll be notified once it's approved.</li>
            <li><strong>We may edit the prompt text</strong> before publishing to keep quality consistent.</li>
            <li><strong>Your image must be your own</strong> or licensed for you to share.</li>
            <li><strong>Submissions can be rejected</strong> if they don't meet our guidelines.</li>
          </ul>

          <label class="submit-modal-consent">
            <input type="checkbox" id="modal-consent-checkbox" />
            <span>I've read and agree to the submission guidelines.</span>
          </label>

          <div class="submit-modal-actions">
            <button type="button" class="submit-btn-cancel" id="modal-cancel">Cancel</button>
            <button type="button" class="submit-btn-primary" id="modal-agree" disabled>Start</button>
          </div>
        </div>
      </div>

      <div class="submit-toast" id="toast" role="status" aria-live="polite"></div>
    </section>
  `,

  styles: `
    [data-view="submit"] {
      --sub-surface: var(--dash-surface, #0f131c);
      --sub-surface-elevated: var(--dash-surface-elevated, #161c28);
      --sub-border: var(--dash-border, rgba(255,255,255,0.08));
      --sub-border-focus: rgba(0,210,255,0.5);
      --sub-text: var(--dash-text-primary, #f3f5f9);
      --sub-text-secondary: var(--dash-text-secondary, #94a3b8);
      --sub-text-muted: var(--dash-text-muted, #64748b);
      --sub-cyan: var(--dash-cyan, #00d2ff);
      --sub-purple: var(--dash-purple, #8a2be2);
      --sub-gradient: var(--dash-gradient, linear-gradient(135deg, #8a2be2, #00d2ff));
      --sub-radius: 12px;
      --sub-radius-lg: 18px;
      --sub-pill: 9999px;
    }

    .submit-container {
      width: 100%;
      max-width: 640px;
      margin: 0 auto;
      padding: 4px 0 60px;
    }

    /* ===== Topbar ===== */
    .submit-topbar {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
    }
    .submit-back-btn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: 1px solid var(--sub-border);
      background: var(--sub-surface);
      color: var(--sub-text);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 0.1s;
      flex-shrink: 0;
    }
    .submit-back-btn svg { width: 18px; height: 18px; }
    .submit-back-btn:hover {
      background: var(--sub-surface-elevated);
      border-color: rgba(255,255,255,0.18);
    }
    .submit-back-btn:active { transform: scale(0.95); }
    .submit-back-btn:focus-visible {
      outline: 2px solid var(--sub-cyan);
      outline-offset: 3px;
    }
    .submit-topbar h1 {
      font-size: 1.5rem;
      font-weight: 800;
      letter-spacing: -0.02em;
    }

    .submit-header p {
      color: var(--sub-text-secondary);
      font-size: 0.95rem;
      line-height: 1.5;
      margin-bottom: 22px;
    }

    /* ===== Form card ===== */
    .submit-form {
      background: var(--sub-surface);
      border: 1px solid var(--sub-border);
      border-radius: var(--sub-radius-lg);
      padding: 26px 22px;
    }
    .submit-form-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 20px;
    }
    .submit-form-label {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--sub-text-secondary);
    }
    .submit-form-input,
    .submit-form-select,
    .submit-form-textarea {
      width: 100%;
      padding: 13px 16px;
      background: var(--sub-surface-elevated);
      border: 1px solid var(--sub-border);
      border-radius: var(--sub-radius);
      color: var(--sub-text);
      font-size: 0.95rem;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
    }
    .submit-form-input::placeholder,
    .submit-form-textarea::placeholder { color: var(--sub-text-muted); }
    .submit-form-input:focus,
    .submit-form-select:focus,
    .submit-form-textarea:focus {
      border-color: var(--sub-border-focus);
      box-shadow: 0 0 0 3px rgba(0,210,255,0.12);
      background: #1a202e;
    }
    .submit-form-textarea {
      min-height: 140px;
      resize: vertical;
      line-height: 1.6;
    }

    /* ===== Upload box ===== */
    .upload-box {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px;
      border: 1px dashed rgba(0,210,255,0.35);
      border-radius: var(--sub-radius);
      background: var(--sub-surface-elevated);
    }
    .upload-preview {
      width: 80px;
      height: 100px;
      border-radius: 8px;
      background: var(--dash-bg, #07090e);
      border: 1px solid var(--sub-border);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      overflow: hidden;
    }
    .upload-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .upload-preview-placeholder { font-size: 1.5rem; color: var(--sub-text-muted); }
    .upload-controls {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1;
      min-width: 0;
    }
    .upload-btn {
      align-self: flex-start;
      padding: 9px 16px;
      border-radius: 8px;
      background: rgba(0,210,255,0.1);
      border: 1px solid rgba(0,210,255,0.3);
      color: var(--sub-cyan);
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s, border-color 0.15s;
    }
    .upload-btn:hover:not(:disabled) {
      background: rgba(0,210,255,0.18);
      border-color: rgba(0,210,255,0.5);
    }
    .upload-btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .upload-btn svg { width: 14px; height: 14px; }
    .upload-hint { font-size: 0.72rem; color: var(--sub-text-muted); }
    .upload-progress {
      height: 4px;
      background: rgba(255,255,255,0.05);
      border-radius: 2px;
      overflow: hidden;
    }
    .upload-progress-bar {
      height: 100%;
      background: var(--sub-gradient);
      width: 0%;
      transition: width 0.3s;
    }

    /* ===== Warning + consent ===== */
    .submit-warning {
      font-size: 0.85rem;
      color: var(--sub-text-secondary);
      line-height: 1.5;
      background: rgba(0,210,255,0.05);
      padding: 12px 16px;
      border-radius: var(--sub-radius);
      border: 1px solid rgba(0,210,255,0.2);
      margin-bottom: 16px;
    }
    .submit-warning a {
      color: var(--sub-cyan);
      text-decoration: none;
      font-weight: 600;
    }
    .submit-warning a:hover { text-decoration: underline; }

    .submit-consent {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      font-size: 0.85rem;
      color: var(--sub-text-secondary);
      line-height: 1.5;
      margin-bottom: 22px;
      cursor: pointer;
    }
    .submit-consent input {
      margin-top: 3px;
      accent-color: var(--sub-cyan);
      width: 16px;
      height: 16px;
      cursor: pointer;
      flex-shrink: 0;
    }

    /* ===== Submit button ===== */
    .submit-btn {
      width: 100%;
      min-height: 52px;
      border: none;
      border-radius: var(--sub-pill);
      background: var(--sub-gradient);
      color: #fff;
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 20px rgba(138,43,226,0.35);
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .submit-btn:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 6px 24px rgba(138,43,226,0.45);
    }
    .submit-btn:active:not(:disabled) { transform: translateY(0); }
    .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* ===== Modal ===== */
    .submit-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.75);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      z-index: 2000;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
      animation: subFadeIn 0.2s ease-out;
    }
    .submit-modal-backdrop.open { display: flex; }
    @keyframes subFadeIn { from { opacity: 0; } to { opacity: 1; } }

    .submit-modal-card {
      background: var(--sub-surface);
      border: 1px solid var(--sub-border);
      border-radius: var(--sub-radius-lg);
      padding: 28px 24px 24px;
      max-width: 440px;
      width: 100%;
      animation: subPopIn 0.28s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes subPopIn {
      from { opacity: 0; transform: translateY(12px) scale(0.98); }
      to   { opacity: 1; transform: translateY(0)    scale(1); }
    }

    .submit-modal-icon {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
      margin: 0 auto 16px;
      background: linear-gradient(135deg, rgba(138,43,226,0.18), rgba(0,210,255,0.15));
      border: 1px solid rgba(138,43,226,0.35);
    }
    .submit-modal-card h2 {
      font-size: 1.3rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin-bottom: 10px;
      text-align: center;
    }
    .submit-modal-card p {
      font-size: 0.92rem;
      color: var(--sub-text-secondary);
      line-height: 1.55;
      margin-bottom: 16px;
      text-align: center;
    }
    .submit-modal-card ul {
      list-style: none;
      padding: 0;
      margin: 0 0 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .submit-modal-card ul li {
      font-size: 0.87rem;
      color: var(--sub-text-secondary);
      line-height: 1.5;
      padding-left: 22px;
      position: relative;
    }
    .submit-modal-card ul li::before {
      content: "✓";
      position: absolute;
      left: 0;
      top: 0;
      color: var(--sub-cyan);
      font-weight: 800;
    }
    .submit-modal-card ul li strong {
      color: var(--sub-text);
      font-weight: 700;
    }

    /* Modal consent checkbox */
    .submit-modal-consent {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 14px;
      background: var(--sub-surface-elevated);
      border: 1px solid var(--sub-border);
      border-radius: var(--sub-radius);
      font-size: 0.85rem;
      color: var(--sub-text-secondary);
      line-height: 1.5;
      cursor: pointer;
      margin-bottom: 20px;
      transition: border-color 0.15s;
    }
    .submit-modal-consent:hover { border-color: rgba(255,255,255,0.15); }
    .submit-modal-consent input {
      margin-top: 2px;
      accent-color: var(--sub-cyan);
      width: 16px;
      height: 16px;
      cursor: pointer;
      flex-shrink: 0;
    }

    .submit-modal-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    }
    .submit-btn-cancel {
      padding: 10px 20px;
      border-radius: var(--sub-pill);
      background: transparent;
      border: 1px solid var(--sub-border);
      color: var(--sub-text-secondary);
      font-weight: 600;
      font-size: 0.9rem;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .submit-btn-cancel:hover {
      background: rgba(255,255,255,0.04);
      border-color: rgba(255,255,255,0.18);
      color: var(--sub-text);
    }
    .submit-btn-primary {
      padding: 10px 24px;
      border-radius: var(--sub-pill);
      background: var(--sub-gradient);
      border: none;
      color: #fff;
      font-weight: 700;
      font-size: 0.9rem;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(138,43,226,0.35);
      transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
    }
    .submit-btn-primary:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(138,43,226,0.5);
    }
    .submit-btn-primary:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      box-shadow: none;
    }

    /* ===== Toast ===== */
    .submit-toast {
      position: fixed;
      bottom: calc(96px + env(safe-area-inset-bottom, 0px));
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: var(--sub-surface-elevated);
      border: 1px solid var(--sub-border);
      padding: 12px 22px;
      border-radius: var(--sub-pill);
      color: var(--sub-text);
      font-size: 0.88rem;
      font-weight: 600;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s, transform 0.3s;
      z-index: 2100;
      max-width: calc(100vw - 32px);
      text-align: center;
    }
    .submit-toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    .submit-toast.error {
      border-color: rgba(248,113,113,0.5);
      color: #f87171;
    }

    @media (prefers-reduced-motion: reduce) {
      .submit-modal-backdrop, .submit-modal-card { animation: none; }
    }
  `,

  async init() {
    if (controller) controller.abort();
    controller = new AbortController();

    els = {
      backBtn: document.getElementById("submitBackBtn"),
      form: document.getElementById("submit-form"),
      title: document.getElementById("sub-title"),
      category: document.getElementById("sub-category"),
      prompt: document.getElementById("sub-prompt"),
      consent: document.getElementById("consent-checkbox"),
      submitBtn: document.getElementById("submit-btn"),
      submitBtnText: document.getElementById("submit-btn-text"),
      uploadBtn: document.getElementById("upload-btn"),
      uploadBtnText: document.getElementById("upload-btn-text"),
      imageInput: document.getElementById("image-input"),
      uploadPreview: document.getElementById("upload-preview"),
      uploadProgress: document.getElementById("upload-progress"),
      uploadProgressBar: document.getElementById("upload-progress-bar"),
      modal: document.getElementById("submit-modal"),
      modalCancel: document.getElementById("modal-cancel"),
      modalAgree: document.getElementById("modal-agree"),
      modalCheckbox: document.getElementById("modal-consent-checkbox"),
      toast: document.getElementById("toast")
    };

    uploadedImageUrl = "";
    isUploading = false;
    isSubmitting = false;
    els.submitBtn.disabled = true;
    els.modalAgree.disabled = true;

    bindEvents();

    try {
      const snap = await get(ref(database, `users/${auth.currentUser.uid}/profile`));
      if (!snap.exists() || !snap.val().submissionConsent) {
        els.modal.classList.add("open");
      }
    } catch {}
  },

  dispose() {
    if (controller) { controller.abort(); controller = null; }
    uploadedImageUrl = "";
    isUploading = false;
    isSubmitting = false;
  }
};