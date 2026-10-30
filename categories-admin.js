// categories-admin.js
// Lets the admin add, rename, re-order, change the picture of, and delete product
// categories. Categories are stored in the Firestore "categories" collection and are
// used by BOTH the Add/Edit Product dropdown and the storefront "Shop by Category" cards.
//
// Used by admin.js:
//   initCategoryAdmin({ getProducts: () => PRODUCTS, onChange: populateCategoryDropdown, toast: showToast });
// No changes are needed in admin.html (the sidebar link and page are added from here).

import { db } from "./firebase-config.js";
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy,
  serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

// Same Cloudinary account that admin.js uses for product photos
const CLOUDINARY_UPLOAD_URL = "https://api.cloudinary.com/v1_1/ib6ntpub/image/upload";
const CLOUDINARY_UPLOAD_PRESET = "taneera_products";

// Your original six categories. They are copied into Firestore the first time the admin opens this page.
const DEFAULTS = [
  { name: "Handmade Earring",               tag: "Bestseller",   imageUrl: "https://images.unsplash.com/photo-1620656798579-1984d9e87df7?w=700&q=80" },
  { name: "Handmade Necklace",              tag: "Handcrafted",  imageUrl: "https://images.unsplash.com/photo-1599643477877-530eb83abc8e?w=700&q=80" },
  { name: "Handpicked Earrings",            tag: "Curated",      imageUrl: "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=700&q=80" },
  { name: "Traditional Wears",              tag: "Festive",      imageUrl: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=700&q=80" },
  { name: "Jewellery Jars",                 tag: "Gift Idea",    imageUrl: "https://images.unsplash.com/photo-1602173574767-37ac01994b2a?w=700&q=80" },
  { name: "Anti Tarnish & Diamond Replica", tag: "Long-lasting", imageUrl: "https://images.unsplash.com/photo-1611652022419-a9419f74343d?w=700&q=80" },
];

let CATS = [];
let getProducts = () => [];
let onChange = () => {};
let toast = (m) => alert(m);
let editingId = null;
let imageFile = null;
let imagePreview = "";
let seeded = false;
let loadError = "";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || ("cat-" + Date.now());
const $ = (id) => document.getElementById(id);

// Names used by the product form dropdown
export function getCategoryNames() {
  return (CATS.length ? CATS : DEFAULTS).map((c) => c.name);
}

export function initCategoryAdmin(opts = {}) {
  if (typeof opts.getProducts === "function") getProducts = opts.getProducts;
  if (typeof opts.onChange === "function") onChange = opts.onChange;
  if (typeof opts.toast === "function") toast = opts.toast;
  if ($("section-categories")) return; // already set up
  injectUi();
  listen();
  window.refreshCategoryTable = render; // admin.js calls this when products change
}

/* ---------- UI ---------- */
function goToCategories() {
  const nav = document.querySelector('.nav-link[data-section="categories"]');
  if (nav) nav.click();
}

function injectUi() {
  // Sidebar link (must exist before admin.js runs initNav())
  const link = document.createElement("a");
  link.className = "nav-link";
  link.setAttribute("data-section", "categories");
  link.textContent = "🗂️ Categories";
  const after = document.querySelector('.nav-link[data-section="add-product"]') || document.querySelector('.nav-link[data-section="products"]');
  if (after) after.after(link);
  else document.querySelector(".sidebar").appendChild(link);

  const section = document.createElement("section");
  section.className = "dash-section";
  section.id = "section-categories";
  section.style.display = "none";
  section.innerHTML = `
    <div class="toolbar">
      <div><h2>Categories</h2><p>Add, rename or remove categories. Changes appear in the product form and on the storefront straight away.</p></div>
      <button class="btn btn-primary" id="catAddBtn">+ Add Category</button>
    </div>

    <form class="form-card" id="catForm" style="display:none;margin-bottom:24px">
      <h3 id="catFormTitle" style="font-size:16px;margin-bottom:14px">Add a Category</h3>
      <div class="ap-field">
        <label>Category picture (shown on the storefront)</label>
        <img class="ap-preview" id="catPreview" alt="Preview">
        <label class="ap-upload"><span id="catImageLabel">📷 Click to upload an image</span><input type="file" accept="image/*" id="catImage"></label>
      </div>
      <div class="ap-field"><label>Category name *</label><input type="text" id="catName" placeholder="e.g. Bangles" required></div>
      <div class="ap-row">
        <div class="ap-field"><label>Small label on the card (optional)</label><input type="text" id="catTag" placeholder="e.g. New, Bestseller"></div>
        <div class="ap-field"><label>Display order (1 = first)</label><input type="number" id="catOrder" min="1" step="1" value="1"></div>
      </div>
      <p id="catRenameNote" style="display:none;font-size:12.5px;color:var(--text-2);margin-bottom:12px">If you change the name, all products in this category are moved to the new name automatically.</p>
      <div style="display:flex;gap:10px">
        <button type="submit" class="btn btn-primary" id="catSaveBtn" style="flex:1;justify-content:center">Save Category</button>
        <button type="button" class="btn btn-outline" id="catCancelBtn" style="flex:1;justify-content:center">Cancel</button>
      </div>
    </form>

    <div class="table-wrap">
      <table>
        <thead><tr><th>Picture</th><th>Name</th><th>Label</th><th>Products</th><th>Order</th><th></th></tr></thead>
        <tbody id="catTableBody"></tbody>
      </table>
    </div>
  `;
  document.querySelector("main.main").appendChild(section);

  $("catAddBtn").addEventListener("click", () => openForm());
  $("catCancelBtn").addEventListener("click", closeForm);
  $("catForm").addEventListener("submit", save);
  $("catImage").addEventListener("change", onImagePicked);
  $("catTableBody").addEventListener("click", (e) => {
    const edit = e.target.closest("[data-cat-edit]");
    if (edit) { openForm(edit.getAttribute("data-cat-edit")); return; }
    const del = e.target.closest("[data-cat-del]");
    if (del) remove(del.getAttribute("data-cat-del"));
  });

  // Shortcut next to the Category dropdown on the Add Product page
  const select = $("pCategory");
  if (select) {
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = "➕ Add or edit categories";
    a.style.cssText = "display:inline-block;margin-top:6px;font-size:12.5px;font-weight:600;color:var(--royal)";
    a.addEventListener("click", (e) => { e.preventDefault(); goToCategories(); });
    select.after(a);
  }
}

/* ---------- data ---------- */
function listen() {
  const q = query(collection(db, "categories"), orderBy("order"));
  onSnapshot(q, (snap) => {
    CATS = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    loadError = "";
    if (snap.empty && !seeded) seed();
    render();
    onChange();
  }, (err) => {
    console.error("Categories listener error:", err);
    loadError = "Could not load categories. Publish the updated Firestore rules (categories) and check you are signed in as admin.";
    render();
    onChange();
  });
}

// First time only: copy your original six categories into Firestore
async function seed() {
  seeded = true;
  try {
    await Promise.all(DEFAULTS.map((c, i) =>
      setDoc(doc(db, "categories", slug(c.name)), { ...c, order: i + 1, createdAt: serverTimestamp() })
    ));
  } catch (err) {
    console.error("Could not seed categories:", err);
  }
}

function productCount(name) {
  return getProducts().filter((p) => (p.category || "") === name).length;
}

/* ---------- render ---------- */
function render() {
  const body = $("catTableBody");
  if (!body) return;
  if (loadError) { body.innerHTML = `<tr class="empty-row"><td colspan="6">${esc(loadError)}</td></tr>`; return; }
  if (!CATS.length) { body.innerHTML = `<tr class="empty-row"><td colspan="6">Loading categories…</td></tr>`; return; }
  body.innerHTML = CATS.map((c) => `
    <tr>
      <td>${c.imageUrl ? `<img class="row-thumb" src="${esc(c.imageUrl)}" alt="" onerror="this.style.display='none'">` : `<span style="color:var(--text-2)">—</span>`}</td>
      <td><div class="row-name">${esc(c.name)}</div></td>
      <td>${c.tag ? `<span class="tag-pill">${esc(c.tag)}</span>` : "—"}</td>
      <td>${productCount(c.name)}</td>
      <td>${esc(c.order ?? "")}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-outline btn-sm" data-cat-edit="${esc(c.id)}">Edit</button>
          <button class="btn btn-danger-outline btn-sm" data-cat-del="${esc(c.id)}">Delete</button>
        </div>
      </td>
    </tr>`).join("");
}

/* ---------- form ---------- */
function openForm(id) {
  editingId = id || null;
  imageFile = null;
  imagePreview = "";
  $("catForm").reset();
  $("catPreview").classList.remove("show");
  $("catImageLabel").textContent = "📷 Click to upload an image";
  $("catRenameNote").style.display = editingId ? "block" : "none";

  if (editingId) {
    const c = CATS.find((x) => x.id === editingId);
    if (c) {
      $("catFormTitle").textContent = "Edit Category";
      $("catName").value = c.name || "";
      $("catTag").value = c.tag || "";
      $("catOrder").value = c.order || 1;
      if (c.imageUrl) {
        imagePreview = c.imageUrl;
        $("catPreview").src = c.imageUrl;
        $("catPreview").classList.add("show");
        $("catImageLabel").textContent = "📷 Change image";
      }
    }
  } else {
    $("catFormTitle").textContent = "Add a Category";
    $("catOrder").value = CATS.length + 1;
  }
  $("catForm").style.display = "block";
  $("catForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeForm() {
  $("catForm").style.display = "none";
  editingId = null;
  imageFile = null;
  imagePreview = "";
}

function onImagePicked(e) {
  const file = e.target.files[0];
  if (!file) return;
  imageFile = file;
  const reader = new FileReader();
  reader.onload = (ev) => {
    $("catPreview").src = ev.target.result;
    $("catPreview").classList.add("show");
    $("catImageLabel").textContent = "📷 Change image";
  };
  reader.readAsDataURL(file);
}

async function uploadImage(file) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(CLOUDINARY_UPLOAD_URL, { method: "POST", body: fd });
  if (!res.ok) throw new Error("Image upload failed. Please try again.");
  const data = await res.json();
  if (!data.secure_url) throw new Error("Image upload failed — no image URL was returned.");
  return data.secure_url;
}

function uniqueId(name) {
  const base = slug(name);
  let id = base, n = 2;
  while (CATS.some((c) => c.id === id)) { id = base + "-" + n; n++; }
  return id;
}

// Moves every product from the old category name to the new one
async function renameInProducts(oldName, newName) {
  const ids = getProducts().filter((p) => (p.category || "") === oldName).map((p) => p.id);
  for (let i = 0; i < ids.length; i += 400) {
    const batch = writeBatch(db);
    ids.slice(i, i + 400).forEach((id) => batch.update(doc(db, "products", id), { category: newName }));
    await batch.commit();
  }
  return ids.length;
}

async function save(e) {
  e.preventDefault();
  const name = $("catName").value.trim();
  const tag = $("catTag").value.trim();
  const order = Math.max(1, parseInt($("catOrder").value, 10) || 1);
  if (!name) { toast("Please enter a category name."); return; }
  if (CATS.some((c) => c.id !== editingId && c.name.toLowerCase() === name.toLowerCase())) {
    toast(`"${name}" already exists.`);
    return;
  }

  const btn = $("catSaveBtn");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    let imageUrl = imagePreview && !imageFile ? imagePreview : "";
    if (imageFile) imageUrl = await uploadImage(imageFile);

    if (editingId) {
      const old = CATS.find((c) => c.id === editingId);
      await updateDoc(doc(db, "categories", editingId), { name, tag, imageUrl, order, updatedAt: serverTimestamp() });
      let moved = 0;
      if (old && old.name !== name) moved = await renameInProducts(old.name, name);
      toast(moved ? `Category renamed — ${moved} product(s) updated` : "Category updated");
    } else {
      await setDoc(doc(db, "categories", uniqueId(name)), { name, tag, imageUrl, order, createdAt: serverTimestamp() });
      toast(`Category "${name}" added`);
    }
    closeForm();
  } catch (err) {
    console.error(err);
    toast(err.message || "Could not save the category — check the Firestore rules.");
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

async function remove(id) {
  const c = CATS.find((x) => x.id === id);
  if (!c) return;
  const n = productCount(c.name);
  if (n > 0) {
    toast(`"${c.name}" still has ${n} product(s). Move them to another category first (Products → Edit).`);
    return;
  }
  if (!confirm(`Delete the category "${c.name}"? This removes it from the storefront.`)) return;
  try {
    await deleteDoc(doc(db, "categories", id));
    toast(`Category "${c.name}" deleted`);
  } catch (err) {
    console.error(err);
    toast("Could not delete the category.");
  }
}
