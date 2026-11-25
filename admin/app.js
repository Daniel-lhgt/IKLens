/* =====================================================
   IKLens Admin — Content Manager
   Tabs: Templates · Approvals · Feedback · Users
   Features:
     · Template CRUD + broadcast notify
     · Submission review/edit + publish + notify
     · Feedback edit/delete
     · Announcements (all users or specific users)
   ===================================================== */

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";

import {
  ref,
  get,
  set,
  update,
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
const navItems = document.querySelectorAll(".nav-item");
const panels = {
  templates: document.getElementById("panel-templates"),
  approvals: document.getElementById("panel-approvals"),
  feedback:  document.getElementById("panel-feedback"),
  users:     document.getElementById("panel-users")
};
const signOutBtn = document.getElementById("signOutBtn");

/* Templates */
const templatesWrap  = document.getElementById("templatesWrap");
const templateCount  = document.getElementById("templateCount");
const newTemplateBtn = document.getElementById("newTemplateBtn");

/* Approvals */
const submissionsWrap    = document.getElementById("submissionsWrap");
const submissionCount    = document.getElementById("submissionCount");
const submissionsFilters = document.getElementById("submissionFilters");
const approvalsBadge     = document.getElementById("approvalsBadge");

/* Feedback */
const feedbackWrap  = document.getElementById("feedbackWrap");
const feedbackCount = document.getElementById("feedbackCount");

/* Users */
const usersWrap      = document.getElementById("usersWrap");
const userCount      = document.getElementById("userCount");
const announceForm   = document.getElementById("announceForm");
const annTitle       = document.getElementById("annTitle");
const annMessage     = document.getElementById("annMessage");
const annType        = document.getElementById("annType");
const annIcon        = document.getElementById("annIcon");
const annSendBtn     = document.getElementById("annSendBtn");
const annSendBtnText = document.getElementById("annSendBtnText");

/* Recipient picker */
const recipientModeBtns = document.querySelectorAll(".recipient-mode");
const recipientPanel    = document.getElementById("recipientPanel");
const recipientSearch   = document.getElementById("recipientSearch");
const recipientCount    = document.getElementById("recipientCount");
const recipientSelectAll = document.getElementById("recipientSelectAll");
const recipientClear    = document.getElementById("recipientClear");
const recipientList     = document.getElementById("recipientList");

/* Template modal */
const modal             = document.getElementById("templateModal");
const modalTitle        = document.getElementById("modalTitle");
const modalClose        = document.getElementById("modalClose");
const cancelBtn         = document.getElementById("cancelBtn");
const templateForm      = document.getElementById("templateForm");
const templateIdInput   = document.getElementById("templateIdInput");
const tplName           = document.getElementById("tplName");
const tplCategory       = document.getElementById("tplCategory");
const tplPrompt         = document.getElementById("tplPrompt");
const uploadBtn         = document.getElementById("uploadBtn");
const uploadBtnText     = document.getElementById("uploadBtnText");
const imageInput        = document.getElementById("imageInput");
const uploadPreview     = document.getElementById("uploadPreview");
const uploadProgress    = document.getElementById("uploadProgress");
const uploadProgressBar = document.getElementById("uploadProgressBar");
const saveBtn           = document.getElementById("saveBtn");
const saveBtnText       = document.getElementById("saveBtnText");
const notifyUsersCheckbox = document.getElementById("notifyUsersCheckbox");

/* Submission review modal */
const submissionModal      = document.getElementById("submissionModal");
const submissionModalClose = document.getElementById("submissionModalClose");
const submissionForm       = document.getElementById("submissionForm");
const submissionIdInput    = document.getElementById("submissionIdInput");
const subReviewAuthor      = document.getElementById("subReviewAuthor");
const subTitle             = document.getElementById("subTitle");
const subCategory          = document.getElementById("subCategory");
const subPrompt            = document.getElementById("subPrompt");
const subUploadPreview     = document.getElementById("subUploadPreview");
const subUploadBtn         = document.getElementById("subUploadBtn");
const subUploadBtnText     = document.getElementById("subUploadBtnText");
const subImageInput        = document.getElementById("subImageInput");
const subUploadProgress    = document.getElementById("subUploadProgress");
const subUploadProgressBar = document.getElementById("subUploadProgressBar");
const subNotifyUsers       = document.getElementById("subNotifyUsers");
const subApproveBtn        = document.getElementById("subApproveBtn");
const subApproveBtnText    = document.getElementById("subApproveBtnText");
const subRejectBtn         = document.getElementById("subRejectBtn");

/* Feedback edit modal */
const feedbackModal      = document.getElementById("feedbackModal");
const feedbackModalClose = document.getElementById("feedbackModalClose");
const feedbackForm       = document.getElementById("feedbackForm");
const feedbackIdInput    = document.getElementById("feedbackIdInput");
const feedbackAuthor     = document.getElementById("feedbackAuthor");
const fbEditType         = document.getElementById("fbEditType");
const fbEditStatus       = document.getElementById("fbEditStatus");
const fbEditMessage      = document.getElementById("fbEditMessage");
const fbCancelBtn        = document.getElementById("fbCancelBtn");
const fbSaveBtn          = document.getElementById("fbSaveBtn");
const fbSaveBtnText      = document.getElementById("fbSaveBtnText");
const fbDeleteBtn        = document.getElementById("fbDeleteBtn");

const toast = document.getElementById("toast");

/* =========================================
   STATE
   ========================================= */
let currentAdmin = null;

/* Templates */
let editingTemplateId  = null;
let uploadedImageUrl   = "";
let uploadInProgress   = false;
let savingInProgress   = false;
let templatesCache     = {};

/* Submissions */
let submissionsCache    = {};
let submissionFilter    = "pending";
let editingSubmissionId = null;
let submissionImageUrl  = "";
let subUploadInProgress = false;
let subSavingInProgress = false;

/* Feedback */
let feedbackCache = {};
let editingFeedbackId = null;
let feedbackSaving    = false;

/* Users + recipients */
let usersCache            = {};
let recipientMode         = "all";     // "all" | "specific"
let selectedRecipientUids = new Set();
let recipientSearchTerm   = "";
let announceSending       = false;

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
  showToast._t = setTimeout(() => toast.classList.remove("show"), 2800);
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
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

async function uploadImageToCloudinary(file, { onProgress } = {}) {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return { error: "Only JPG, PNG, or WEBP allowed." };
  if (file.size > MAX_IMAGE_BYTES) return { error: "Image must be 5 MB or smaller." };

  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/image/upload`;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", CLOUDINARY.uploadPreset);
  if (CLOUDINARY.folder) fd.append("folder", CLOUDINARY.folder);

  onProgress?.(30);
  try {
    onProgress?.(60);
    const res = await fetch(url, { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) return { error: data?.error?.message || "Upload failed." };
    if (!data?.secure_url) return { error: "Cloudinary did not return an image URL." };
    onProgress?.(100);
    return { url: data.secure_url };
  } catch (err) {
    return { error: err.message || "Upload failed." };
  }
}

/* Send notifications to `targetUids` (or every user if omitted). */
async function sendNotifications(targetUids, payload, opts = {}) {
  try {
    let uids = targetUids;
    if (!uids) {
      const snap = await get(ref(database, "users"));
      if (!snap.exists()) return 0;
      const all = snap.val() || {};
      // If a category is given, skip users who turned that category off.
      // Users who never chose (older accounts) still get everything.
      uids = Object.keys(all).filter(uid => {
        if (!opts.category) return true;
        const follow = all[uid] && all[uid].profile && all[uid].profile.followedCategories;
        return !follow || typeof follow !== "object" || follow[opts.category] !== false;
      });
    }
    if (!uids.length) return 0;

    const updates = {};
    const now = Date.now();
    for (const uid of uids) {
      const notifRef = push(ref(database, `notifications/${uid}`));
      updates[`notifications/${uid}/${notifRef.key}`] = {
        type:     payload.type,
        title:    payload.title,
        message:  payload.message,
        icon:     payload.icon || null,
        route:    payload.route || null,
        read:     false,
        createdAt: now
      };
    }
    await update(ref(database), updates);
    return uids.length;
  } catch (err) {
    console.error("[Admin] sendNotifications failed:", err);
    return -1;
  }
}

/* =========================================
   AUTH GUARD
   ========================================= */
async function isAdmin(uid) {
  try {
    const snap = await get(ref(database, `admins/${uid}`));
    return snap.exists() && snap.val() === true;
  } catch {
    return false;
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.replace("index.html"); return; }
  if (!(await isAdmin(user.uid))) {
    await signOut(auth);
    window.location.replace("index.html");
    return;
  }
  currentAdmin = user;
  loadTemplates();
  loadSubmissions();
  loadFeedback();
  loadUsers();
});

signOutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.replace("index.html");
  } catch {
    showToast("Could not sign out.", "error");
  }
});

/* =========================================
   NAV
   ========================================= */
navItems.forEach(item => {
  item.addEventListener("click", () => {
    const target = item.dataset.tab;
    navItems.forEach(n => n.classList.toggle("active", n === item));
    Object.entries(panels).forEach(([key, panel]) => {
      panel.classList.toggle("active", key === target);
    });
    window.scrollTo({ top: 0, behavior: "instant" });
  });
});

/* =========================================
   TEMPLATES
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
      </div>`;
    templateCount.textContent = "—";
  }
}

function renderTemplates() {
  const entries = Object.entries(templatesCache);
  templateCount.textContent = entries.length ? `${entries.length} total` : "";

  if (!entries.length) {
    templatesWrap.innerHTML = `
      <div class="empty">
        <div class="empty-icon">✨</div>
        <div class="empty-title">No templates yet</div>
        <div class="empty-text">Click "New Template" to add your first one.</div>
      </div>`;
    return;
  }

  const sorted = entries
    .map(([id, d]) => ({ id, ...(d || {}) }))
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
    editBtn.addEventListener("click", () => openEditTemplate(tpl.id));

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

/* Template modal */
function resetTemplateModal() {
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
  uploadPreview.innerHTML = '<span class="upload-preview-placeholder">🖼️</span>';
  notifyUsersCheckbox.checked = true;
}

function openCreateTemplate() {
  resetTemplateModal();
  editingTemplateId = null;
  modalTitle.textContent = "New Template";
  modal.classList.add("open");
  setTimeout(() => tplName.focus(), 100);
}

function openEditTemplate(id) {
  const tpl = templatesCache[id];
  if (!tpl) return;

  resetTemplateModal();
  editingTemplateId = id;
  modalTitle.textContent = "Edit Template";

  tplName.value = tpl.name || "";
  tplCategory.value = tpl.category || "";
  tplPrompt.value = tpl.prompt || "";
  notifyUsersCheckbox.checked = false;

  const url = safeImageUrl(tpl.image);
  if (url) {
    uploadedImageUrl = url;
    uploadPreview.innerHTML = "";
    const img = document.createElement("img");
    img.src = url; img.alt = "";
    uploadPreview.appendChild(img);
    uploadBtnText.textContent = "Replace Image";
  }

  modal.classList.add("open");
  setTimeout(() => tplName.focus(), 100);
}

function closeTemplateModal() {
  if (uploadInProgress || savingInProgress) return;
  modal.classList.remove("open");
  resetTemplateModal();
  editingTemplateId = null;
}

newTemplateBtn.addEventListener("click", openCreateTemplate);
modalClose.addEventListener("click", closeTemplateModal);
cancelBtn.addEventListener("click", closeTemplateModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeTemplateModal(); });

uploadBtn.addEventListener("click", () => {
  if (uploadInProgress || savingInProgress) return;
  imageInput.click();
});

imageInput.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  if (!file) return;

  const localUrl = URL.createObjectURL(file);
  uploadPreview.innerHTML = "";
  const img = document.createElement("img");
  img.src = localUrl; img.alt = "";
  uploadPreview.appendChild(img);

  uploadInProgress = true;
  uploadBtn.disabled = true;
  uploadBtnText.textContent = "Uploading…";
  uploadProgress.hidden = false;

  const { url, error } = await uploadImageToCloudinary(file, {
    onProgress: p => { uploadProgressBar.style.width = p + "%"; }
  });

  if (error) {
    showToast(error, "error");
    uploadPreview.innerHTML = '<span class="upload-preview-placeholder">🖼️</span>';
    uploadedImageUrl = "";
    imageInput.value = "";
    uploadProgressBar.style.width = "0%";
  } else {
    uploadedImageUrl = url;
    uploadBtnText.textContent = "Replace Image";
    showToast("Image uploaded successfully.");
  }

  uploadInProgress = false;
  uploadBtn.disabled = false;
  setTimeout(() => {
    uploadProgress.hidden = true;
    uploadProgressBar.style.width = "0%";
    if (!uploadedImageUrl) uploadBtnText.textContent = "Choose Image";
  }, 700);
  setTimeout(() => URL.revokeObjectURL(localUrl), 1500);
});

templateForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (uploadInProgress) { showToast("Wait for the image upload to finish.", "error"); return; }
  if (savingInProgress) return;

  const name = tplName.value.trim();
  const category = tplCategory.value;
  const prompt = tplPrompt.value.trim();
  const shouldNotify = !editingTemplateId && notifyUsersCheckbox.checked;

  if (!name) { showToast("Template name is required.", "error"); tplName.focus(); return; }
  if (!VALID_CATEGORIES.includes(category)) { showToast("Please select a category.", "error"); tplCategory.focus(); return; }
  if (!prompt) { showToast("Prompt text is required.", "error"); tplPrompt.focus(); return; }
  if (!uploadedImageUrl) { showToast("Please upload an image.", "error"); return; }

  savingInProgress = true;
  saveBtn.disabled = true;
  saveBtnText.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span> Saving…';

  try {
    const payload = { name, category, image: uploadedImageUrl, prompt };

    if (editingTemplateId) {
      const existing = templatesCache[editingTemplateId] || {};
      if (existing.createdAt) payload.createdAt = existing.createdAt;
      await set(ref(database, `templates/${editingTemplateId}`), payload);
      showToast("Template updated.");
    } else {
      const newRef = push(ref(database, "templates"));
      payload.createdAt = Date.now();
      await set(newRef, payload);

      if (shouldNotify) {
        const sent = await sendNotifications(null, {
          type: "system", icon: "✨",
          title: "New template added",
          message: `"${name}" is now available in the gallery.`,
          route: "gallery"
        }, { category });
        showToast(sent > 0
          ? `Template created · notified ${sent} user${sent === 1 ? "" : "s"}.`
          : "Template created.");
      } else {
        showToast("Template created.");
      }
    }

    closeTemplateModal();
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

async function deleteTemplate(id, name) {
  if (!window.confirm(`Delete "${name || "this template"}"? This cannot be undone.`)) return;
  try {
    await remove(ref(database, `templates/${id}`));
    showToast("Template deleted.");
    await loadTemplates();
  } catch {
    showToast("Could not delete template.", "error");
  }
}

/* =========================================
   SUBMISSIONS — load + render
   ========================================= */
async function loadSubmissions() {
  try {
    const snap = await get(ref(database, "submissions"));
    submissionsCache = snap.exists() ? (snap.val() || {}) : {};
    renderSubmissions();
    updateApprovalsBadge();
  } catch (err) {
    console.error("[Admin] Load submissions failed:", err);
    submissionsWrap.innerHTML = `
      <div class="empty">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Could not load submissions</div>
        <div class="empty-text">Check your connection and try again.</div>
      </div>`;
    submissionCount.textContent = "—";
  }
}

function updateApprovalsBadge() {
  const pending = Object.values(submissionsCache)
    .filter(s => s && s.status === "pending").length;
  if (pending > 0) {
    approvalsBadge.textContent = pending > 9 ? "9+" : String(pending);
    approvalsBadge.style.display = "";
  } else {
    approvalsBadge.style.display = "none";
  }
}

submissionsFilters.addEventListener("click", (e) => {
  const chip = e.target.closest(".filter-chip");
  if (!chip) return;
  submissionFilter = chip.dataset.filter;
  submissionsFilters.querySelectorAll(".filter-chip")
    .forEach(c => c.classList.toggle("active", c === chip));
  renderSubmissions();
});

function renderSubmissions() {
  const all = Object.entries(submissionsCache)
    .map(([id, v]) => ({ id, ...(v || {}) }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const filtered = submissionFilter === "all"
    ? all
    : all.filter(s => (s.status || "pending") === submissionFilter);

  submissionCount.textContent = all.length ? `${all.length} total` : "";

  if (!filtered.length) {
    submissionsWrap.innerHTML = `
      <div class="empty">
        <div class="empty-icon">${submissionFilter === "pending" ? "✅" : "📭"}</div>
        <div class="empty-title">${submissionFilter === "pending" ? "All caught up" : "No submissions here"}</div>
        <div class="empty-text">${submissionFilter === "pending" ? "No pending submissions to review." : "Nothing in this filter yet."}</div>
      </div>`;
    return;
  }

  const list = document.createElement("div");
  list.className = "submission-list";
  for (const sub of filtered) list.appendChild(buildSubmissionCard(sub));

  submissionsWrap.innerHTML = "";
  submissionsWrap.appendChild(list);
}

function buildSubmissionCard(sub) {
  const card = document.createElement("div");
  card.className = "sub-card";

  const imgUrl = safeImageUrl(sub.image);
  if (imgUrl) {
    const img = document.createElement("img");
    img.className = "sub-img";
    img.src = imgUrl;
    img.alt = sub.title || "";
    img.loading = "lazy";
    img.onerror = () => {
      const fb = document.createElement("div");
      fb.className = "sub-img-fallback";
      fb.textContent = "🖼️";
      img.replaceWith(fb);
    };
    card.appendChild(img);
  } else {
    const fb = document.createElement("div");
    fb.className = "sub-img-fallback";
    fb.textContent = "🖼️";
    card.appendChild(fb);
  }

  const body = document.createElement("div");
  body.className = "sub-body";

  const title = document.createElement("div");
  title.className = "sub-title";
  title.textContent = sub.title || "(Untitled)";
  body.appendChild(title);

  if (sub.authorName) {
    const author = document.createElement("div");
    author.className = "sub-author";
    author.textContent = `by ${sub.authorName}`;
    body.appendChild(author);
  }

  const metaRow = document.createElement("div");
  metaRow.className = "sub-meta-row";

  const status = sub.status || "pending";
  const statusBadge = document.createElement("span");
  statusBadge.className = `sub-badge ${status}`;
  statusBadge.textContent = status;
  metaRow.appendChild(statusBadge);

  if (sub.category) {
    const catBadge = document.createElement("span");
    catBadge.className = "sub-badge cat";
    catBadge.textContent = sub.category;
    metaRow.appendChild(catBadge);
  }
  if (sub.createdAt) {
    const dateEl = document.createElement("span");
    dateEl.className = "sub-date";
    dateEl.textContent = formatDate(sub.createdAt);
    metaRow.appendChild(dateEl);
  }
  body.appendChild(metaRow);

  if (sub.prompt) {
    const promptEl = document.createElement("div");
    promptEl.className = "sub-prompt";
    promptEl.textContent = sub.prompt;
    body.appendChild(promptEl);

    requestAnimationFrame(() => {
      if (promptEl.scrollHeight > promptEl.clientHeight + 4) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "sub-toggle";
        toggle.textContent = "Show full prompt";
        toggle.addEventListener("click", () => {
          const expanded = promptEl.classList.toggle("expanded");
          toggle.textContent = expanded ? "Show less" : "Show full prompt";
        });
        body.insertBefore(toggle, promptEl.nextSibling);
      }
    });
  }

  const actions = document.createElement("div");
  actions.className = "sub-actions";

  if (status === "pending") {
    const reviewBtn = document.createElement("button");
    reviewBtn.className = "btn-sm primary";
    reviewBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Review &amp; Publish';
    reviewBtn.addEventListener("click", () => openSubmissionReview(sub.id));

    const rejectBtn = document.createElement("button");
    rejectBtn.className = "btn-sm danger";
    rejectBtn.innerHTML = '<i class="fa-solid fa-xmark"></i> Reject';
    rejectBtn.addEventListener("click", () => rejectSubmissionDirect(sub.id));

    actions.appendChild(reviewBtn);
    actions.appendChild(rejectBtn);
  } else {
    const delBtn = document.createElement("button");
    delBtn.className = "btn-sm danger";
    delBtn.innerHTML = '<i class="fa-solid fa-trash"></i> Delete';
    delBtn.addEventListener("click", () => deleteSubmission(sub.id, sub.title));
    actions.appendChild(delBtn);
  }

  if (actions.children.length) body.appendChild(actions);
  card.appendChild(body);
  return card;
}

/* Submission review modal */
function resetSubmissionModal() {
  submissionIdInput.value = "";
  subReviewAuthor.textContent = "";
  subTitle.value = "";
  subCategory.value = "";
  subPrompt.value = "";
  subImageInput.value = "";
  submissionImageUrl = "";
  subUploadInProgress = false;
  subSavingInProgress = false;
  subApproveBtn.disabled = false;
  subApproveBtnText.textContent = "Approve & Publish";
  subUploadBtnText.textContent = "Replace Image";
  subUploadProgress.hidden = true;
  subUploadProgressBar.style.width = "0%";
  subUploadPreview.innerHTML = '<span class="upload-preview-placeholder">🖼️</span>';
  subNotifyUsers.checked = false;
}

function openSubmissionReview(id) {
  const sub = submissionsCache[id];
  if (!sub) return;

  resetSubmissionModal();
  editingSubmissionId = id;

  subReviewAuthor.innerHTML = "";
  const strong = document.createElement("strong");
  strong.textContent = sub.authorName || "Anonymous";
  subReviewAuthor.appendChild(strong);
  subReviewAuthor.appendChild(document.createTextNode(
    sub.createdAt ? ` · submitted ${formatDate(sub.createdAt)}` : ""
  ));

  subTitle.value = sub.title || "";
  subCategory.value = sub.category || "";
  subPrompt.value = sub.prompt || "";

  const url = safeImageUrl(sub.image);
  if (url) {
    submissionImageUrl = url;
    subUploadPreview.innerHTML = "";
    const img = document.createElement("img");
    img.src = url; img.alt = "";
    subUploadPreview.appendChild(img);
    subUploadBtnText.textContent = "Replace Image";
  }

  submissionModal.classList.add("open");
  setTimeout(() => subTitle.focus(), 100);
}

function closeSubmissionModal() {
  if (subUploadInProgress || subSavingInProgress) return;
  submissionModal.classList.remove("open");
  resetSubmissionModal();
  editingSubmissionId = null;
}

submissionModalClose.addEventListener("click", closeSubmissionModal);
submissionModal.addEventListener("click", (e) => {
  if (e.target === submissionModal) closeSubmissionModal();
});

subUploadBtn.addEventListener("click", () => {
  if (subUploadInProgress || subSavingInProgress) return;
  subImageInput.click();
});

subImageInput.addEventListener("change", async () => {
  const file = subImageInput.files?.[0];
  if (!file) return;

  const localUrl = URL.createObjectURL(file);
  subUploadPreview.innerHTML = "";
  const img = document.createElement("img");
  img.src = localUrl; img.alt = "";
  subUploadPreview.appendChild(img);

  subUploadInProgress = true;
  subUploadBtn.disabled = true;
  subUploadBtnText.textContent = "Uploading…";
  subUploadProgress.hidden = false;

  const { url, error } = await uploadImageToCloudinary(file, {
    onProgress: p => { subUploadProgressBar.style.width = p + "%"; }
  });

  if (error) {
    showToast(error, "error");
    subUploadPreview.innerHTML = '<span class="upload-preview-placeholder">🖼️</span>';
    submissionImageUrl = "";
    subImageInput.value = "";
    subUploadProgressBar.style.width = "0%";
  } else {
    submissionImageUrl = url;
    subUploadBtnText.textContent = "Replace Image";
    showToast("Image replaced.");
  }

  subUploadInProgress = false;
  subUploadBtn.disabled = false;
  setTimeout(() => {
    subUploadProgress.hidden = true;
    subUploadProgressBar.style.width = "0%";
  }, 700);
  setTimeout(() => URL.revokeObjectURL(localUrl), 1500);
});

submissionForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (subUploadInProgress) { showToast("Wait for the image upload to finish.", "error"); return; }
  if (subSavingInProgress) return;

  const id = editingSubmissionId;
  const sub = submissionsCache[id];
  if (!sub) { showToast("Submission not found.", "error"); return; }

  const title = subTitle.value.trim();
  const category = subCategory.value;
  const prompt = subPrompt.value.trim();
  const shouldNotifyAll = subNotifyUsers.checked;

  if (!title) { showToast("Title is required.", "error"); subTitle.focus(); return; }
  if (!VALID_CATEGORIES.includes(category)) { showToast("Please select a category.", "error"); subCategory.focus(); return; }
  if (!prompt) { showToast("Prompt is required.", "error"); subPrompt.focus(); return; }
  if (!submissionImageUrl) { showToast("Image is missing.", "error"); return; }

  subSavingInProgress = true;
  subApproveBtn.disabled = true;
  subApproveBtnText.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span> Publishing…';

  try {
    /* 1. Publish as template */
    const tplRef = push(ref(database, "templates"));
    await set(tplRef, {
      name: title,
      category,
      image: submissionImageUrl,
      prompt,
      createdAt: Date.now(),
      sourceSubmission: id,
      authorUid: sub.uid || null,
      authorName: sub.authorName || null
    });

    /* 2. Update submission with your edits */
    await update(ref(database, `submissions/${id}`), {
      title, category, prompt,
      image: submissionImageUrl,
      status: "approved",
      reviewedAt: Date.now(),
      reviewedBy: currentAdmin.uid,
      templateId: tplRef.key
    });

    /* 3. Notify the author */
    if (sub.uid) {
      await sendNotifications([sub.uid], {
        type: "submission_approved",
        icon: "✅",
        title: "Your prompt was approved!",
        message: `"${title}" is now live in the gallery.`,
        route: "gallery"
      });
    }

    /* 4. Optional broadcast to every user */
    let broadcastCount = 0;
    if (shouldNotifyAll) {
      broadcastCount = await sendNotifications(null, {
        type: "system",
        icon: "✨",
        title: "New template added",
        message: `"${title}" is now available in the gallery.`,
        route: "gallery"
      }, { category });
    }

    closeSubmissionModal();
    showToast(
      shouldNotifyAll && broadcastCount > 0
        ? `Published · notified ${broadcastCount} user${broadcastCount === 1 ? "" : "s"}.`
        : "Submission approved and published."
    );

    await Promise.all([loadSubmissions(), loadTemplates()]);
  } catch (err) {
    console.error("[Admin] Approve failed:", err);
    showToast("Could not approve. Try again.", "error");
    subSavingInProgress = false;
    subApproveBtn.disabled = false;
    subApproveBtnText.textContent = "Approve & Publish";
  }
});

subRejectBtn.addEventListener("click", async () => {
  if (!editingSubmissionId) return;
  const id = editingSubmissionId;
  const sub = submissionsCache[id];
  if (!sub) return;

  if (!window.confirm(`Reject "${sub.title || "this submission"}"?`)) return;

  try {
    await update(ref(database, `submissions/${id}`), {
      status: "rejected",
      reviewedAt: Date.now(),
      reviewedBy: currentAdmin.uid
    });

    if (sub.uid) {
      await sendNotifications([sub.uid], {
        type: "submission_rejected",
        icon: "❌",
        title: "Your prompt was not approved",
        message: `"${sub.title || "Your submission"}" didn't meet our guidelines this time.`
      });
    }

    closeSubmissionModal();
    showToast("Submission rejected.");
    await loadSubmissions();
  } catch (err) {
    console.error("[Admin] Reject failed:", err);
    showToast("Could not reject. Try again.", "error");
  }
});

async function rejectSubmissionDirect(id) {
  const sub = submissionsCache[id];
  if (!sub || sub.status !== "pending") return;
  if (!window.confirm(`Reject "${sub.title || "this submission"}"?`)) return;

  try {
    await update(ref(database, `submissions/${id}`), {
      status: "rejected",
      reviewedAt: Date.now(),
      reviewedBy: currentAdmin.uid
    });

    if (sub.uid) {
      await sendNotifications([sub.uid], {
        type: "submission_rejected",
        icon: "❌",
        title: "Your prompt was not approved",
        message: `"${sub.title || "Your submission"}" didn't meet our guidelines this time.`
      });
    }

    showToast("Submission rejected.");
    await loadSubmissions();
  } catch {
    showToast("Could not reject. Try again.", "error");
  }
}

async function deleteSubmission(id, title) {
  if (!window.confirm(`Delete "${title || "this submission"}"? This cannot be undone.`)) return;
  try {
    await remove(ref(database, `submissions/${id}`));
    showToast("Submission deleted.");
    await loadSubmissions();
  } catch {
    showToast("Could not delete.", "error");
  }
}

/* =========================================
   FEEDBACK — load, render, edit, delete
   ========================================= */
async function loadFeedback() {
  try {
    const snap = await get(ref(database, "feedback"));
    feedbackCache = snap.exists() ? (snap.val() || {}) : {};
    renderFeedback();
  } catch (err) {
    console.error("[Admin] Load feedback failed:", err);
    feedbackWrap.innerHTML = `
      <div class="empty">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Could not load feedback</div>
        <div class="empty-text">Check your connection and try again.</div>
      </div>`;
    feedbackCount.textContent = "—";
  }
}

function renderFeedback() {
  const entries = Object.entries(feedbackCache)
    .map(([id, v]) => ({ id, ...(v || {}) }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  feedbackCount.textContent = entries.length ? `${entries.length} total` : "";

  if (!entries.length) {
    feedbackWrap.innerHTML = `
      <div class="empty">
        <div class="empty-icon">💬</div>
        <div class="empty-title">No feedback yet</div>
        <div class="empty-text">User submissions will appear here.</div>
      </div>`;
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

    from.appendChild(nameEl);
    if (fb.email) {
      const emailEl = document.createElement("span");
      emailEl.className = "fb-email";
      emailEl.textContent = fb.email;
      from.appendChild(emailEl);
    }

    const badges = document.createElement("div");
    badges.className = "fb-badges";

    const typeEl = document.createElement("span");
    typeEl.className = "fb-type";
    typeEl.textContent = (fb.type || "other").replace(/_/g, " ");
    badges.appendChild(typeEl);

    if (fb.status) {
      const statusEl = document.createElement("span");
      statusEl.className = `fb-status ${fb.status}`;
      statusEl.textContent = fb.status;
      badges.appendChild(statusEl);
    }

    head.appendChild(from);
    head.appendChild(badges);

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

    /* Admin actions */
    const actions = document.createElement("div");
    actions.className = "fb-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "btn-sm";
    editBtn.innerHTML = '<i class="fa-solid fa-pen"></i> Edit';
    editBtn.addEventListener("click", () => openFeedbackEdit(fb.id));

    const delBtn = document.createElement("button");
    delBtn.className = "btn-sm danger";
    delBtn.innerHTML = '<i class="fa-solid fa-trash"></i> Delete';
    delBtn.addEventListener("click", () => deleteFeedback(fb.id));

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    card.appendChild(actions);

    list.appendChild(card);
  }

  feedbackWrap.innerHTML = "";
  feedbackWrap.appendChild(list);
}

/* Feedback edit modal */
function resetFeedbackModal() {
  feedbackIdInput.value = "";
  feedbackAuthor.textContent = "";
  fbEditType.value = "";
  fbEditStatus.value = "open";
  fbEditMessage.value = "";
  feedbackSaving = false;
  fbSaveBtn.disabled = false;
  fbSaveBtnText.textContent = "Save Changes";
}

function openFeedbackEdit(id) {
  const fb = feedbackCache[id];
  if (!fb) return;

  resetFeedbackModal();
  editingFeedbackId = id;

  feedbackAuthor.innerHTML = "";
  const strong = document.createElement("strong");
  strong.textContent = fb.name || "Anonymous";
  feedbackAuthor.appendChild(strong);
  if (fb.email) {
    feedbackAuthor.appendChild(document.createTextNode(` · ${fb.email}`));
  }
  if (fb.createdAt) {
    feedbackAuthor.appendChild(document.createTextNode(` · ${formatDate(fb.createdAt)}`));
  }

  fbEditType.value = fb.type || "general";
  fbEditStatus.value = fb.status || "open";
  fbEditMessage.value = fb.message || "";

  feedbackModal.classList.add("open");
  setTimeout(() => fbEditMessage.focus(), 100);
}

function closeFeedbackModal() {
  if (feedbackSaving) return;
  feedbackModal.classList.remove("open");
  resetFeedbackModal();
  editingFeedbackId = null;
}

feedbackModalClose.addEventListener("click", closeFeedbackModal);
fbCancelBtn.addEventListener("click", closeFeedbackModal);
feedbackModal.addEventListener("click", (e) => {
  if (e.target === feedbackModal) closeFeedbackModal();
});

feedbackForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (feedbackSaving) return;

  const id = editingFeedbackId;
  const fb = feedbackCache[id];
  if (!fb) { showToast("Feedback not found.", "error"); return; }

  const type = fbEditType.value.trim();
  const status = fbEditStatus.value;
  const message = fbEditMessage.value.trim();

  if (!type) { showToast("Type is required.", "error"); fbEditType.focus(); return; }
  if (!message) { showToast("Message is required.", "error"); fbEditMessage.focus(); return; }
  if (message.length < 10) { showToast("Message must be at least 10 characters.", "error"); fbEditMessage.focus(); return; }
  if (message.length > 2000) { showToast("Message is too long (max 2000).", "error"); fbEditMessage.focus(); return; }

  feedbackSaving = true;
  fbSaveBtn.disabled = true;
  fbSaveBtnText.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span> Saving…';

  try {
    await update(ref(database, `feedback/${id}`), { type, status, message });
    closeFeedbackModal();
    showToast("Feedback updated.");
    await loadFeedback();
  } catch (err) {
    console.error("[Admin] Save feedback failed:", err);
    showToast("Could not save feedback.", "error");
    feedbackSaving = false;
    fbSaveBtn.disabled = false;
    fbSaveBtnText.textContent = "Save Changes";
  }
});

fbDeleteBtn.addEventListener("click", async () => {
  if (!editingFeedbackId) return;
  const id = editingFeedbackId;
  const fb = feedbackCache[id];
  if (!fb) return;

  if (!window.confirm(`Delete this feedback from ${fb.name || "Anonymous"}? This cannot be undone.`)) return;

  try {
    await remove(ref(database, `feedback/${id}`));
    closeFeedbackModal();
    showToast("Feedback deleted.");
    await loadFeedback();
  } catch (err) {
    console.error("[Admin] Delete feedback failed:", err);
    showToast("Could not delete feedback.", "error");
  }
});

async function deleteFeedback(id) {
  const fb = feedbackCache[id];
  if (!fb) return;
  if (!window.confirm(`Delete this feedback from ${fb.name || "Anonymous"}?`)) return;
  try {
    await remove(ref(database, `feedback/${id}`));
    showToast("Feedback deleted.");
    await loadFeedback();
  } catch {
    showToast("Could not delete feedback.", "error");
  }
}

/* =========================================
   USERS
   ========================================= */
async function loadUsers() {
  try {
    const snap = await get(ref(database, "users"));
    usersCache = snap.exists() ? (snap.val() || {}) : {};
    renderUsers();
    renderRecipientPicker();
  } catch (err) {
    console.error("[Admin] Load users failed:", err);
    usersWrap.innerHTML = `
      <div class="empty">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Could not load users</div>
        <div class="empty-text">Check your connection and try again.</div>
      </div>`;
    userCount.textContent = "—";
  }
}

function normalizeUser(uid, raw) {
  const data = raw || {};
  const profile = data.profile || {};
  const name =
    profile.displayName || profile.name ||
    data.displayName || data.name ||
    (profile.email || data.email
      ? (profile.email || data.email).split("@")[0]
      : "User");
  const email = profile.email || data.email || "";
  const photo = profile.photoURL || profile.photo ||
                data.photoURL || data.photo || "";
  const createdAt = profile.createdAt || data.createdAt || data.joinedAt || 0;
  return { uid, name, email, photo, createdAt };
}

function renderUsers() {
  const entries = Object.entries(usersCache)
    .map(([uid, raw]) => normalizeUser(uid, raw))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  userCount.textContent = entries.length ? `${entries.length} total` : "";

  if (!entries.length) {
    usersWrap.innerHTML = `
      <div class="empty">
        <div class="empty-icon">👥</div>
        <div class="empty-title">No users yet</div>
        <div class="empty-text">Signed-up users will appear here.</div>
      </div>`;
    return;
  }

  const grid = document.createElement("div");
  grid.className = "user-grid";

  for (const u of entries) {
    const card = document.createElement("div");
    card.className = "user-card";

    const avatar = document.createElement("div");
    avatar.className = "user-avatar";
    const photoUrl = safeImageUrl(u.photo);
    if (photoUrl) {
      const img = document.createElement("img");
      img.src = photoUrl;
      img.alt = u.name;
      img.loading = "lazy";
      img.onerror = () => { avatar.textContent = (u.name || "U").charAt(0).toUpperCase(); };
      avatar.appendChild(img);
    } else {
      avatar.textContent = (u.name || "U").charAt(0).toUpperCase();
    }

    const info = document.createElement("div");
    info.className = "user-info";

    const nameEl = document.createElement("div");
    nameEl.className = "user-name";
    nameEl.textContent = u.name;

    const emailEl = document.createElement("div");
    emailEl.className = "user-email";
    emailEl.textContent = u.email || "—";

    info.appendChild(nameEl);
    info.appendChild(emailEl);

    if (u.createdAt) {
      const joined = document.createElement("div");
      joined.className = "user-joined";
      joined.textContent = `Joined ${formatDate(u.createdAt)}`;
      info.appendChild(joined);
    }

    card.appendChild(avatar);
    card.appendChild(info);
    grid.appendChild(card);
  }

  usersWrap.innerHTML = "";
  usersWrap.appendChild(grid);
}

/* =========================================
   RECIPIENT PICKER
   ========================================= */
recipientModeBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    recipientMode = btn.dataset.mode;
    recipientModeBtns.forEach(b => b.classList.toggle("active", b === btn));
    recipientPanel.hidden = recipientMode !== "specific";
    if (recipientMode === "specific") renderRecipientPicker();
  });
});

recipientSearch.addEventListener("input", () => {
  recipientSearchTerm = recipientSearch.value.trim().toLowerCase();
  renderRecipientPicker();
});

recipientSelectAll.addEventListener("click", () => {
  /* Select every currently visible (filtered) user */
  Object.keys(usersCache).forEach(uid => {
    const u = normalizeUser(uid, usersCache[uid]);
    if (!matchesRecipientSearch(u)) return;
    selectedRecipientUids.add(uid);
  });
  renderRecipientPicker();
});

recipientClear.addEventListener("click", () => {
  selectedRecipientUids.clear();
  renderRecipientPicker();
});

function matchesRecipientSearch(u) {
  if (!recipientSearchTerm) return true;
  return (
    (u.name || "").toLowerCase().includes(recipientSearchTerm) ||
    (u.email || "").toLowerCase().includes(recipientSearchTerm)
  );
}

function renderRecipientPicker() {
  /* Update counter */
  recipientCount.textContent =
    `${selectedRecipientUids.size} selected`;

  /* Nothing to show? */
  const entries = Object.entries(usersCache)
    .map(([uid, raw]) => normalizeUser(uid, raw))
    .filter(matchesRecipientSearch)
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  if (!entries.length) {
    recipientList.innerHTML = `
      <div class="recipient-empty">
        ${Object.keys(usersCache).length ? "No users match your search." : "No users yet."}
      </div>`;
    return;
  }

  recipientList.innerHTML = "";

  for (const u of entries) {
    const row = document.createElement("label");
    row.className = "recipient-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedRecipientUids.has(u.uid);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedRecipientUids.add(u.uid);
      else selectedRecipientUids.delete(u.uid);
      recipientCount.textContent = `${selectedRecipientUids.size} selected`;
    });

    const avatar = document.createElement("div");
    avatar.className = "recipient-avatar";
    const photoUrl = safeImageUrl(u.photo);
    if (photoUrl) {
      const img = document.createElement("img");
      img.src = photoUrl;
      img.alt = u.name;
      img.loading = "lazy";
      img.onerror = () => { avatar.textContent = (u.name || "U").charAt(0).toUpperCase(); };
      avatar.appendChild(img);
    } else {
      avatar.textContent = (u.name || "U").charAt(0).toUpperCase();
    }

    const info = document.createElement("div");
    info.className = "recipient-info";

    const nameEl = document.createElement("div");
    nameEl.className = "recipient-name";
    nameEl.textContent = u.name;

    const emailEl = document.createElement("div");
    emailEl.className = "recipient-email";
    emailEl.textContent = u.email || "—";

    info.appendChild(nameEl);
    info.appendChild(emailEl);

    row.appendChild(checkbox);
    row.appendChild(avatar);
    row.appendChild(info);
    recipientList.appendChild(row);
  }
}

/* =========================================
   ANNOUNCEMENT — send
   ========================================= */
announceForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (announceSending) return;

  const title = annTitle.value.trim();
  const message = annMessage.value.trim();
  const type = annType.value;
  const icon = annIcon.value.trim();

  if (!title)   { showToast("Title is required.", "error"); annTitle.focus(); return; }
  if (!message) { showToast("Message is required.", "error"); annMessage.focus(); return; }
  if (message.length < 5) { showToast("Message is too short.", "error"); annMessage.focus(); return; }

  let targetUids = null;
  if (recipientMode === "specific") {
    if (selectedRecipientUids.size === 0) {
      showToast("Select at least one user, or switch to All Users.", "error");
      return;
    }
    targetUids = Array.from(selectedRecipientUids);
  }

  const audienceLabel = targetUids
    ? `${targetUids.length} user${targetUids.length === 1 ? "" : "s"}`
    : "all users";

  if (!window.confirm(`Send "${title}" to ${audienceLabel}?`)) return;

  announceSending = true;
  annSendBtn.disabled = true;
  annSendBtnText.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span> Sending…';

  try {
    const sent = await sendNotifications(targetUids, { type, title, message, icon: icon || null });

    if (sent < 0) throw new Error("broadcast failed");

    if (sent === 0) {
      showToast("No users to notify yet.", "error");
    } else {
      showToast(`Sent to ${sent} user${sent === 1 ? "" : "s"}.`);
      announceForm.reset();
      annIcon.value = "";
      selectedRecipientUids.clear();
      recipientSearchTerm = "";
      recipientSearch.value = "";
      renderRecipientPicker();
    }
  } catch (err) {
    console.error("[Admin] Announcement failed:", err);
    showToast("Could not send announcement.", "error");
  } finally {
    announceSending = false;
    annSendBtn.disabled = false;
    annSendBtnText.textContent = "Send Notification";
  }
});

/* =========================================
   ESC closes any open modal
   ========================================= */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (modal.classList.contains("open")) closeTemplateModal();
  if (submissionModal.classList.contains("open")) closeSubmissionModal();
  if (feedbackModal.classList.contains("open")) closeFeedbackModal();
});