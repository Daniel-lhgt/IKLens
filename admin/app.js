/* =====================================================
   IKLens Admin — Shared Admin Logic
   Realtime Database + Cloudinary (unsigned upload)
   ===================================================== */

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";

import {
  ref,
  get,
  set,
  remove,
  push
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js";

import { auth, database } from "../js/firebase-config.js";

/* =========================================
   CONFIG
   ========================================= */
const CLOUDINARY = {
  cloudName: "ejuli8vw",
  uploadPreset: "o13hipx3",
  folder: "iklens-template"
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VALID_CATEGORIES = ["male", "female", "kids", "couple", "flyer"];

/* =========================================
   DOM REFS
   ========================================= */
const tabs = document.querySelectorAll(".tab");
const panels = {
  templates: document.getElementById("panel-templates"),
  feedback: document.getElementById("panel-feedback")
};
const signOutBtn = document.getElementById("signOutBtn");

const templatesWrap = document.getElementById("templatesWrap");
const templateCount = document.getElementById("templateCount");
const newTemplateBtn = document.getElementById("newTemplateBtn");

const feedbackWrap = document.getElementById("feedbackWrap");
const feedbackCount = document.getElementById("feedbackCount");

const modal = document.getElementById("templateModal");
const modalTitle = document.getElementById("modalTitle");
const modalClose = document.getElementById("modalClose");
const cancelBtn = document.getElementById("cancelBtn");
const templateForm = document.getElementById("templateForm");
const templateIdInput = document.getElementById("templateIdInput");
const tplName = document.getElementById("tplName");
const tplCategory = document.getElementById("tplCategory");
const tplPrompt = document.getElementById("tplPrompt");
const uploadBtn = document.getElementById("uploadBtn");
const uploadBtnText = document.getElementById("uploadBtnText");
const imageInput = document.getElementById("imageInput");
const uploadPreview = document.getElementById("uploadPreview");
const uploadProgress = document.getElementById("uploadProgress");
const uploadProgressBar = document.getElementById("uploadProgressBar");
const saveBtn = document.getElementById("saveBtn");
const saveBtnText = document.getElementById("saveBtnText");
const toast = document.getElementById("toast");

/* =========================================
   RUNTIME STATE
   ========================================= */
let currentAdmin = null;
let editingTemplateId = null;
let uploadedImageUrl = "";
let uploadInProgress = false;
let savingInProgress = false;
let templatesCache = {};

/* =========================================
   HELPERS
   ========================================= */
function showToast(message, type = "success") {
  toast.textContent = "";
  const icon = document.createElement("i");
  icon.className = type === "error"
    ? "fa-solid fa-circle-exclamation"
    : "fa-solid fa-circle-check";
  toast.appendChild(icon);
  toast.appendChild(document.createTextNode(" " + message));

  toast.className = "toast " + type;
  void toast.offsetWidth;
  toast.classList.add("show");

  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}

function safeImageUrl(url) {
  if (typeof url !== "string") return "";
  const t = url.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  return "";
}

function formatDate(ts) {
  if (!ts || typeof ts !== "number") return "";
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

/* =========================================
   AUTH GUARD
   ========================================= */
async function isAdmin(uid) {
  try {
    const snap = await get(ref(database, `admins/${uid}`));
    return snap.exists() && snap.val() === true;
  } catch (err) {
    console.error("[Admin] Admin check failed:", err);
    return false;
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("index.html");
    return;
  }

  const admin = await isAdmin(user.uid);
  if (!admin) {
    await signOut(auth);
    window.location.replace("index.html");
    return;
  }

  currentAdmin = user;
  loadTemplates();
  loadFeedback();
});

signOutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.replace("index.html");
  } catch (err) {
    console.error("[Admin] Sign out failed:", err);
    showToast("Could not sign out.", "error");
  }
});

/* =========================================
   TABS
   ========================================= */
tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    tabs.forEach(t => t.classList.toggle("active", t === tab));
    Object.entries(panels).forEach(([key, panel]) => {
      panel.classList.toggle("active", key === target);
    });
  });
});

/* =========================================
   TEMPLATES — LOAD
   ========================================= */
async function loadTemplates() {
  try {
    const snap = await get(ref(database, "templates"));
    templatesCache = snap.exists() ? (snap.val() || {}) : {};
    renderTemplates();
  } catch (err) {
    console.error("[Admin] Load templates failed:", err);
    templatesWrap.innerHTML = `
      <div class="empty">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Could not load templates</div>
        <div class="empty-text">Check your connection and try again.</div>
      </div>
    `;
    templateCount.textContent = "—";
  }
}

function renderTemplates() {
  const entries = Object.entries(templatesCache);
  templateCount.textContent = entries.length
    ? `${entries.length} total`
    : "";

  if (!entries.length) {
    templatesWrap.innerHTML = `
      <div class="empty">
        <div class="empty-icon">✨</div>
        <div class="empty-title">No templates yet</div>
        <div class="empty-text">Click "New Template" to add your first one.</div>
      </div>
    `;
    return;
  }

  const sorted = entries
    .map(([id, data]) => ({ id, ...(data || {}) }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const grid = document.createElement("div");
  grid.className = "template-grid";

  for (const tpl of sorted) {
    const card = document.createElement("div");
    card.className = "tpl-card";

    const imgWrap = document.createElement("div");
    imgWrap.className = "tpl-image-wrap";

    const imgUrl = safeImageUrl(tpl.image);
    if (imgUrl) {
      const img = document.createElement("img");
      img.className = "tpl-image";
      img.src = imgUrl;
      img.alt = tpl.name || "";
      img.loading = "lazy";
      img.onerror = () => {
        img.remove();
        const fb = document.createElement("div");
        fb.className = "tpl-image-fallback";
        fb.textContent = "🖼️";
        imgWrap.appendChild(fb);
      };
      imgWrap.appendChild(img);
    } else {
      const fb = document.createElement("div");
      fb.className = "tpl-image-fallback";
      fb.textContent = "🖼️";
      imgWrap.appendChild(fb);
    }

    if (tpl.category) {
      const badge = document.createElement("span");
      badge.className = "tpl-category";
      badge.textContent = tpl.category;
      imgWrap.appendChild(badge);
    }

    const meta = document.createElement("div");
    meta.className = "tpl-meta";

    const nameEl = document.createElement("div");
    nameEl.className = "tpl-name";
    nameEl.textContent = tpl.name || "(Untitled)";

    const actions = document.createElement("div");
    actions.className = "tpl-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "btn-sm";
    editBtn.innerHTML = '<i class="fa-solid fa-pen"></i> Edit';
    editBtn.addEventListener("click", () => openEditModal(tpl.id));

    const delBtn = document.createElement("button");
    delBtn.className = "btn-sm danger";
    delBtn.innerHTML = '<i class="fa-solid fa-trash"></i> Delete';
    delBtn.addEventListener("click", () => deleteTemplate(tpl.id, tpl.name));

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    meta.appendChild(nameEl);
    meta.appendChild(actions);

    card.appendChild(imgWrap);
    card.appendChild(meta);
    grid.appendChild(card);
  }

  templatesWrap.innerHTML = "";
  templatesWrap.appendChild(grid);
}

/* =========================================
   MODAL — OPEN/CREATE
   ========================================= */
function resetModal() {
  templateIdInput.value = "";
  tplName.value = "";
  tplCategory.value = "";
  tplPrompt.value = "";
  imageInput.value = "";
  uploadedImageUrl = "";
  uploadInProgress = false;
  savingInProgress = false;
  saveBtn.disabled = false;
  saveBtnText.textContent = "Save Template";
  uploadBtnText.textContent = "Choose Image";
  uploadProgress.hidden = true;
  uploadProgressBar.style.width = "0%";
  uploadPreview.innerHTML =
    '<span class="upload-preview-placeholder">🖼️</span>';
}

function openCreateModal() {
  resetModal();
  editingTemplateId = null;
  modalTitle.textContent = "New Template";
  modal.classList.add("open");
  setTimeout(() => tplName.focus(), 100);
}

function openEditModal(id) {
  const tpl = templatesCache[id];
  if (!tpl) return;

  resetModal();
  editingTemplateId = id;
  modalTitle.textContent = "Edit Template";

  tplName.value = tpl.name || "";
  tplCategory.value = tpl.category || "";
  tplPrompt.value = tpl.prompt || "";

  const existingUrl = safeImageUrl(tpl.image);
  if (existingUrl) {
    uploadedImageUrl = existingUrl;
    uploadPreview.innerHTML = "";
    const img = document.createElement("img");
    img.src = existingUrl;
    img.alt = "";
    uploadPreview.appendChild(img);
    uploadBtnText.textContent = "Replace Image";
  }

  modal.classList.add("open");
  setTimeout(() => tplName.focus(), 100);
}

function closeModal() {
  if (uploadInProgress || savingInProgress) return;
  modal.classList.remove("open");
  resetModal();
  editingTemplateId = null;
}

newTemplateBtn.addEventListener("click", openCreateModal);
modalClose.addEventListener("click", closeModal);
cancelBtn.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal.classList.contains("open")) closeModal();
});

/* =========================================
   IMAGE UPLOAD → CLOUDINARY
   ========================================= */
uploadBtn.addEventListener("click", () => {
  if (uploadInProgress || savingInProgress) return;
  imageInput.click();
});

imageInput.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  if (!file) return;

  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    showToast("Only JPG, PNG, or WEBP allowed.", "error");
    imageInput.value = "";
    return;
  }

  if (file.size > MAX_IMAGE_BYTES) {
    showToast("Image must be 5 MB or smaller.", "error");
    imageInput.value = "";
    return;
  }

  const localUrl = URL.createObjectURL(file);
  uploadPreview.innerHTML = "";
  const prevImg = document.createElement("img");
  prevImg.src = localUrl;
  prevImg.alt = "";
  uploadPreview.appendChild(prevImg);

  await uploadToCloudinary(file);

  setTimeout(() => URL.revokeObjectURL(localUrl), 1500);
});

async function uploadToCloudinary(file) {
  uploadInProgress = true;
  uploadBtn.disabled = true;
  uploadBtnText.textContent = "Uploading…";
  uploadProgress.hidden = false;
  uploadProgressBar.style.width = "30%";

  const url =
    `https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/image/upload`;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY.uploadPreset);
  if (CLOUDINARY.folder) {
    formData.append("folder", CLOUDINARY.folder);
  }

  try {
    uploadProgressBar.style.width = "60%";

    const res = await fetch(url, {
      method: "POST",
      body: formData
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(
        data?.error?.message || "Cloudinary upload failed."
      );
    }

    if (!data?.secure_url) {
      throw new Error("Cloudinary did not return an image URL.");
    }

    uploadedImageUrl = data.secure_url;

    uploadProgressBar.style.width = "100%";
    uploadBtnText.textContent = "Replace Image";
    showToast("Image uploaded successfully.");

  } catch (err) {
    console.error("[Admin] Cloudinary upload error:", err);
    showToast(err.message || "Upload failed. Try again.", "error");

    uploadPreview.innerHTML =
      '<span class="upload-preview-placeholder">🖼️</span>';
    uploadedImageUrl = "";
    imageInput.value = "";
    uploadProgressBar.style.width = "0%";

  } finally {
    uploadInProgress = false;
    uploadBtn.disabled = false;

    setTimeout(() => {
      uploadProgress.hidden = true;
      uploadProgressBar.style.width = "0%";
      if (!uploadedImageUrl) {
        uploadBtnText.textContent = "Choose Image";
      }
    }, 700);
  }
}

/* =========================================
   SAVE TEMPLATE (CREATE / UPDATE)
   ========================================= */
templateForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (uploadInProgress) {
    showToast("Please wait for the image upload to finish.", "error");
    return;
  }
  if (savingInProgress) return;

  const name = tplName.value.trim();
  const category = tplCategory.value;
  const prompt = tplPrompt.value.trim();

  if (!name) { showToast("Template name is required.", "error"); tplName.focus(); return; }
  if (!VALID_CATEGORIES.includes(category)) {
    showToast("Please select a category.", "error"); tplCategory.focus(); return;
  }
  if (!prompt) { showToast("Prompt text is required.", "error"); tplPrompt.focus(); return; }
  if (!uploadedImageUrl) {
    showToast("Please upload an image.", "error"); return;
  }

  savingInProgress = true;
  saveBtn.disabled = true;
  saveBtnText.innerHTML =
    '<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span> Saving…';

  try {
    const payload = {
      name,
      category,
      image: uploadedImageUrl,
      prompt
    };

    if (editingTemplateId) {
      const existing = templatesCache[editingTemplateId] || {};
      if (existing.createdAt) {
        payload.createdAt = existing.createdAt;
      }
      await set(ref(database, `templates/${editingTemplateId}`), payload);
      showToast("Template updated.");
    } else {
      const newRef = push(ref(database, "templates"));
      payload.createdAt = Date.now();
      await set(newRef, payload);
      showToast("Template created.");
    }

    closeModal();
    await loadTemplates();

  } catch (err) {
    console.error("[Admin] Save template failed:", err);
    showToast("Could not save template. Try again.", "error");

  } finally {
    savingInProgress = false;
    saveBtn.disabled = false;
    saveBtnText.textContent = "Save Template";
  }
});

/* =========================================
   DELETE TEMPLATE
   ========================================= */
async function deleteTemplate(id, name) {
  const label = name ? `"${name}"` : "this template";
  if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;

  try {
    await remove(ref(database, `templates/${id}`));
    showToast("Template deleted.");
    await loadTemplates();
  } catch (err) {
    console.error("[Admin] Delete failed:", err);
    showToast("Could not delete template.", "error");
  }
}

/* =========================================
   FEEDBACK — LOAD
   ========================================= */
async function loadFeedback() {
  try {
    const snap = await get(ref(database, "feedback"));
    const data = snap.exists() ? (snap.val() || {}) : {};
    renderFeedback(data);
  } catch (err) {
    console.error("[Admin] Load feedback failed:", err);
    feedbackWrap.innerHTML = `
      <div class="empty">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Could not load feedback</div>
        <div class="empty-text">Check your connection and try again.</div>
      </div>
    `;
    feedbackCount.textContent = "—";
  }
}

function renderFeedback(data) {
  const entries = Object.entries(data)
    .map(([id, value]) => ({ id, ...(value || {}) }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  feedbackCount.textContent = entries.length
    ? `${entries.length} total`
    : "";

  if (!entries.length) {
    feedbackWrap.innerHTML = `
      <div class="empty">
        <div class="empty-icon">💬</div>
        <div class="empty-title">No feedback yet</div>
        <div class="empty-text">User submissions will appear here.</div>
      </div>
    `;
    return;
  }

  const list = document.createElement("div");
  list.className = "feedback-list";

  for (const fb of entries) {
    const card = document.createElement("div");
    card.className = "fb-card";

    const head = document.createElement("div");
    head.className = "fb-head";

    const from = document.createElement("div");
    from.className = "fb-from";

    const nameEl = document.createElement("span");
    nameEl.className = "fb-name";
    nameEl.textContent = fb.name || "Anonymous";

    const emailEl = document.createElement("span");
    emailEl.className = "fb-email";
    emailEl.textContent = fb.email || "";

    from.appendChild(nameEl);
    if (fb.email) from.appendChild(emailEl);

    const typeEl = document.createElement("span");
    typeEl.className = "fb-type";
    typeEl.textContent = (fb.type || "other").replace(/_/g, " ");

    head.appendChild(from);
    head.appendChild(typeEl);

    const msg = document.createElement("div");
    msg.className = "fb-message";
    msg.textContent = fb.message || "(empty)";

    card.appendChild(head);
    card.appendChild(msg);

    if (fb.createdAt) {
      const dateEl = document.createElement("div");
      dateEl.className = "fb-date";
      dateEl.textContent = formatDate(fb.createdAt);
      card.appendChild(dateEl);
    }

    list.appendChild(card);
  }

  feedbackWrap.innerHTML = "";
  feedbackWrap.appendChild(list);
}