// admin.js
// Handles: admin-only auth guard, product CRUD (Firestore + Cloudinary image
// uploads), dashboard KPIs, orders/customers views, sidebar navigation.

import { auth, db, ADMIN_EMAIL } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp, Timestamp, arrayUnion, runTransaction, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { buildInvoiceHTML, downloadInvoicePDF, printInvoice } from "./invoice.js";
import { initRazorpayAdmin } from "./razorpay-admin.js";
import { initCategoryAdmin, getCategoryNames } from "./categories-admin.js";

// ============================================================
// CLOUDINARY — product image hosting.
// Replaces Firebase Storage for product images only (Firestore itself
// is untouched — products/orders/customers/coupons all still live there).
// Unsigned upload preset, so no API secret is ever needed or exposed
// in this browser-side code.
// ============================================================
const CLOUDINARY_CLOUD_NAME = "ib6ntpub";
const CLOUDINARY_UPLOAD_PRESET = "taneera_products";
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

/* ============================================================
   AUTH GUARD — the real security boundary.
   No page content is shown until Firebase confirms the signed-in
   user's email matches ADMIN_EMAIL. Anyone else (including no
   user at all) is redirected to index.html immediately. This
   check happens every time admin.html loads, on every device —
   it is NOT based on localStorage or any client-only flag.
   ============================================================ */
onAuthStateChanged(auth, (user) => {
  if (!user || (user.email || "").toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    window.location.replace("index.html");
    return;
  }
  document.getElementById("adminRoot").style.display = "block";
  document.getElementById("adminEmailLabel").textContent = user.email;
  currentAdminEmail = user.email;
  initDashboard();
});

window.logout = function logout() {
  signOut(auth).then(() => window.location.href = "login.html");
};

/* ============================================================
   STATE
   ============================================================ */
let PRODUCTS = [];
let ORDERS = [];
let CUSTOMERS = [];
let COUPONS = [];
let editingProductId = null;
let deleteTarget = null;
let editingCouponId = null;
let deleteCouponTarget = null;
let currentAdminEmail = "";
let uploadedImageFile = null;
let uploadedImagePreviewUrl = "";
let dashboardInitialized = false;

// Categories now live in Firestore and are managed from Admin -> Categories
// (see categories-admin.js). The product form dropdown reads them from there.

function initDashboard() {
  if (dashboardInitialized) return;
  dashboardInitialized = true;

  populateCategoryDropdown();
  listenToProducts();
  listenToOrders();
  listenToCustomers();
  listenToCoupons();
  loadShippingSettings();
  // These two add their own sidebar links, so they must run BEFORE initNav()
  initRazorpayAdmin(() => ORDERS);
  initCategoryAdmin({ getProducts: () => PRODUCTS, onChange: populateCategoryDropdown, toast: showToast });
  initNav();
  initProductForm();
  initCouponForm();
}

/* ============================================================
   SHIPPING CHARGES — stored in Firestore doc settings/shipping
   (read by the checkout page and by the payment backend)
   ============================================================ */
async function loadShippingSettings() {
  try {
    const snap = await getDoc(doc(db, "settings", "shipping"));
    const d = snap.exists() ? snap.data() : {};
    document.getElementById("shipFee").value = d.fee ?? 100;
    document.getElementById("shipFreeAbove").value = d.freeAbove ?? 999;
  } catch (err) {
    console.error("Could not load shipping settings:", err);
  }
}

window.saveShippingSettings = async function saveShippingSettings() {
  const fee = Number(document.getElementById("shipFee").value);
  const freeAbove = Number(document.getElementById("shipFreeAbove").value);
  if (!Number.isFinite(fee) || fee < 0 || !Number.isFinite(freeAbove) || freeAbove < 0) {
    showToast("Enter valid amounts (0 or more).");
    return;
  }
  const btn = document.getElementById("shipSaveBtn");
  btn.disabled = true;
  try {
    await setDoc(doc(db, "settings", "shipping"), {
      fee: Math.round(fee), freeAbove: Math.round(freeAbove),
      updatedAt: serverTimestamp(), updatedBy: currentAdminEmail,
    }, { merge: true });
    showToast("Shipping charges saved");
  } catch (err) {
    console.error(err);
    showToast("Could not save — check the Firestore rules for the settings collection.");
  } finally {
    btn.disabled = false;
  }
};

/* ============================================================
   SIDEBAR NAVIGATION
   ============================================================ */
function initNav() {
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const section = link.getAttribute("data-section");
      showSection(section);
      if (section === "add-product") openProductForm();
      if (section === "coupons") { /* table already live via listener */ }
    });
  });
}

/* ============================================================
   PRODUCTS — real-time Firestore listener
   ============================================================ */
function listenToProducts() {
  const q = query(collection(db, "products"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    PRODUCTS = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderProductTable();
    renderKPIs();
    populateCouponProductList();
    if (window.refreshCategoryTable) window.refreshCategoryTable(); // keeps the "Products" count per category live
  }, (err) => {
    console.error("Products listener error:", err);
    showToast("Could not load products — check Firestore is enabled and rules are deployed.");
  });
}

function renderProductTable() {
  const body = document.getElementById("productTableBody");
  if (!PRODUCTS.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="9">No products yet — click "+ Add Product" to create one.</td></tr>`;
    return;
  }
  body.innerHTML = PRODUCTS.map((p) => `
    <tr>
      <td><img class="row-thumb" src="${p.imageUrl || placeholderImg(p.name)}" alt="${escapeHtml(p.name)}" onerror="this.src='${placeholderImg(p.name)}'"></td>
      <td>
        <div class="row-name">${escapeHtml(p.name)}</div>
        <div class="row-desc">SKU: ${escapeHtml(p.sku || "—")}${p.tag ? ` · <span class="tag-pill">${escapeHtml(p.tag)}</span>` : ""}</div>
      </td>
      <td>${escapeHtml(p.category || "—")}</td>
      <td>₹${num(p.mrp)}</td>
      <td>₹${num(p.sellingPrice)}</td>
      <td>${num(p.discount)}%</td>
      <td>${num(p.stock)}</td>
      <td><span class="badge ${p.status === "Active" ? "in" : "out"}">${escapeHtml(p.status || "Active")}</span></td>
      <td>
        <div class="row-actions">
          <button class="btn btn-outline btn-sm" onclick="editProduct('${p.id}')">Edit</button>
          <button class="btn btn-outline btn-sm" onclick="quickStock('${p.id}')">Stock</button>
          <button class="btn btn-danger-outline btn-sm" onclick="askDelete('${p.id}')">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderKPIs() {
  const total = PRODUCTS.length;
  const active = PRODUCTS.filter((p) => p.status === "Active").length;
  const outOfStock = PRODUCTS.filter((p) => p.status === "Out of Stock" || Number(p.stock) === 0).length;
  document.getElementById("kpiTotalProducts").textContent = total;
  document.getElementById("kpiActiveProducts").textContent = active;
  document.getElementById("kpiOutOfStock").textContent = outOfStock;
}

/* ============================================================
   ORDERS — real-time Firestore listener
   ============================================================ */
function listenToOrders() {
  const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    ORDERS = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderOrdersTable();
    renderOrderKPIs();
    renderInvoicesTable();
    if (window.refreshRazorpayTable) window.refreshRazorpayTable(); // re-checks which Razorpay payments have an order
  }, (err) => {
    console.error("Orders listener error:", err);
    // Non-fatal for the Products tab — just leave Orders empty.
  });
}

function renderOrdersTable() {
  const body = document.getElementById("orderTableBody");
  if (!ORDERS.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="9">No orders yet.</td></tr>`;
    return;
  }
  const ORDER_STATUS_OPTIONS = ["Placed", "Processing", "Shipped", "Delivered", "Cancelled"];
  const PAYMENT_STATUS_OPTIONS = ["Pending Verification", "Paid", "Failed"];

  body.innerHTML = ORDERS.map((o) => {
    // Defensive: if an order has a status value from before this list was
    // set (e.g. old "Confirmed"/"Packed"/"Pending"), still show it as a
    // selectable option instead of silently hiding it from the dropdown.
    const orderStatusOpts = ORDER_STATUS_OPTIONS.includes(o.status) || !o.status
      ? ORDER_STATUS_OPTIONS
      : [o.status, ...ORDER_STATUS_OPTIONS];
    const paymentStatusOpts = PAYMENT_STATUS_OPTIONS.includes(o.paymentStatus) || !o.paymentStatus
      ? PAYMENT_STATUS_OPTIONS
      : [o.paymentStatus, ...PAYMENT_STATUS_OPTIONS];

    return `
    <tr>
      <td>${escapeHtml(o.orderNumber || (o.id || "").slice(0, 8).toUpperCase())}</td>
      <td>${escapeHtml(o.customerEmail || o.customerName || "—")}</td>
      <td>${(o.items || []).length} item(s)</td>
      <td>₹${num(o.total)}${o.couponCode ? `<div style="font-size:11px;color:var(--success);font-weight:600">🏷️ ${escapeHtml(o.couponCode)}</div>` : ""}</td>
      <td style="font-family:monospace;font-size:11.5px">${escapeHtml(o.utr || "—")}</td>
      <td>
        <select class="status-select" onchange="updateOrderStatus('${o.id}', this.value)">
          ${orderStatusOpts.map((s) =>
            `<option value="${s}" ${o.status === s ? "selected" : ""}>${s === "Placed" ? "Order Placed" : s}</option>`).join("")}
        </select>
        <div style="font-size:10.5px;color:var(--text-2);margin-top:4px">${deliveryLabel(o)}</div>
      </td>
      <td>
        <div style="font-size:10.5px;color:var(--text-2);margin-bottom:4px">${escapeHtml(o.paymentMethod || "—")}</div>
        <select class="status-select" onchange="updatePaymentStatus('${o.id}', this.value)">
          ${paymentStatusOpts.map((s) =>
            `<option value="${s}" ${(o.paymentStatus || "Pending Verification") === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </td>
      <td>${invoiceCellHtml(o)}</td>
      <td>${formatDate(o.createdAt)}</td>
    </tr>
  `;
  }).join("");
}

/* ============================================================
   INVOICE — cell rendering for the Orders table
   ============================================================ */
function invoiceCellHtml(o) {
  if ((o.paymentStatus || "Pending Verification") !== "Paid") {
    return `<span class="invoice-unavailable">Invoice Unavailable</span>`;
  }
  if (!o.invoiceNumber) {
    // Payment is Paid but no invoice exists yet (e.g. an order marked
    // Paid before this feature existed) — let the admin generate one
    // on demand instead of it happening silently.
    return `<button class="btn btn-outline btn-sm" onclick="generateInvoiceForOrder('${o.id}')">Generate Invoice</button>`;
  }
  return `
    <div class="invoice-actions">
      <div style="font-size:11px;font-weight:600;color:var(--navy)">${escapeHtml(o.invoiceNumber)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-outline btn-sm" onclick="viewInvoice('${o.id}')">View</button>
        <button class="btn btn-outline btn-sm" onclick="downloadInvoice('${o.id}')">Download</button>
        <button class="btn btn-outline btn-sm" onclick="printInvoiceForOrder('${o.id}')">Print</button>
      </div>
    </div>
  `;
}

function renderOrderKPIs() {
  document.getElementById("kpiTotalOrders").textContent = ORDERS.length;
  const revenue = ORDERS.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
  document.getElementById("kpiTotalRevenue").textContent = "₹" + revenue.toLocaleString("en-IN");
}

/* ============================================================
   INVOICES — its own page, separate from the Orders table.
   Only orders that actually have an invoiceNumber (i.e. Paid, with an
   invoice already generated) ever show up here. Sourced from the same
   ORDERS array as the Orders tab, so it stays live automatically.
   ============================================================ */
let invoiceSearchTerm = "";
window.filterInvoices = function filterInvoices(term) {
  invoiceSearchTerm = (term || "").trim().toLowerCase();
  renderInvoicesTable();
};

function renderInvoicesTable() {
  const body = document.getElementById("invoiceTableBody");
  if (!body) return; // section not in DOM yet on first paint — fine, listener re-renders on next snapshot

  let invoices = ORDERS.filter((o) => !!o.invoiceNumber);

  if (invoiceSearchTerm) {
    invoices = invoices.filter((o) => {
      const haystack = [
        o.invoiceNumber, o.orderNumber, o.customerName, o.customerEmail,
      ].map((v) => String(v || "").toLowerCase());
      return haystack.some((v) => v.includes(invoiceSearchTerm));
    });
  }

  if (!invoices.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="7">${invoiceSearchTerm ? "No invoices match your search." : "No invoices yet — invoices appear here once an order's Payment Status is set to Paid."}</td></tr>`;
    return;
  }

  body.innerHTML = invoices.map((o) => `
    <tr>
      <td style="font-weight:600;color:var(--navy)">${escapeHtml(o.invoiceNumber)}</td>
      <td>${escapeHtml(o.orderNumber || (o.id || "").slice(0, 8).toUpperCase())}</td>
      <td>${escapeHtml(o.customerName || o.customerEmail || "—")}</td>
      <td>${(o.items || []).length} item(s)</td>
      <td>₹${num(o.total)}</td>
      <td>${formatDate(o.invoiceDate)}</td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-outline btn-sm" onclick="viewInvoice('${o.id}')">View</button>
          <button class="btn btn-outline btn-sm" onclick="downloadInvoice('${o.id}')">Download</button>
          <button class="btn btn-outline btn-sm" onclick="printInvoiceForOrder('${o.id}')">Print</button>
        </div>
      </td>
    </tr>
  `).join("");
}

window.updateOrderStatus = async function updateOrderStatus(orderId, status) {
  const existing = ORDERS.find((o) => o.id === orderId);

  // Don't add a duplicate history entry if the admin re-selects the
  // status the order is already at (e.g. accidental re-select).
  if (existing && existing.status === status) return;

  try {
    const update = {
      status,
      // Array elements can't hold the serverTimestamp() sentinel, so this
      // entry uses a regular client-generated Timestamp instead.
      statusHistory: arrayUnion({ status, timestamp: Timestamp.now() }),
    };
    if (status === "Delivered") {
      update.deliveredAt = serverTimestamp();
    }
    await updateDoc(doc(db, "orders", orderId), update);
    showToast("Order status updated");
  } catch (err) {
    console.error(err);
    showToast("Could not update order status");
  }
};

window.updatePaymentStatus = async function updatePaymentStatus(orderId, paymentStatus) {
  const existing = ORDERS.find((o) => o.id === orderId);

  // No-op re-select (e.g. accidental re-pick of "Paid" on an order
  // that's already Paid) — never re-run the invoice transaction for it.
  if (existing && (existing.paymentStatus || "Pending Verification") === paymentStatus) return;

  try {
    if (paymentStatus === "Paid") {
      // Marking Paid and generating the invoice happen inside ONE
      // Firestore transaction, so a double-click or a flaky connection
      // can never produce two invoice numbers for the same order, and
      // the order is never left "Paid" without its invoice fields.
      await markOrderPaidAndInvoice(orderId);
    } else {
      await updateDoc(doc(db, "orders", orderId), { paymentStatus });
    }
    showToast("Payment status updated");
  } catch (err) {
    console.error(err);
    showToast(err.message || "Could not update payment status");
  }
};

/* ============================================================
   INVOICE GENERATION — atomic, admin-only, never duplicated
   ------------------------------------------------------------
   Runs entirely on the client against Firestore's transaction API —
   no Cloud Functions, no Blaze plan. Invoice numbers come from a
   single counters/invoices doc: {year, seq}, reset each calendar
   year, formatted as INV-{year}-{seq padded to 6 digits}.
   ============================================================ */
async function allocateInvoiceNumber(tx) {
  const counterRef = doc(db, "counters", "invoices");
  const counterSnap = await tx.get(counterRef);
  const year = new Date().getFullYear();
  const counterData = counterSnap.exists() ? counterSnap.data() : {};
  const seq = counterSnap.exists() && counterData.year === year ? (counterData.seq || 0) + 1 : 1;
  tx.set(counterRef, { year, seq }, { merge: true });
  return `INV-${year}-${String(seq).padStart(6, "0")}`;
}

// Called when the admin flips Payment Status: Pending Verification -> Paid.
// Only ever assigns invoiceNumber/invoiceDate/paymentVerifiedAt if the
// order doesn't already have one (guards against duplicate invoices if
// the admin somehow triggers this twice, e.g. two tabs open).
async function markOrderPaidAndInvoice(orderId) {
  const orderRef = doc(db, "orders", orderId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) throw new Error("Order not found.");
    const data = snap.data();
    const update = { paymentStatus: "Paid" };
    if (!data.invoiceNumber) {
      const now = Timestamp.now();
      update.invoiceNumber = await allocateInvoiceNumber(tx);
      update.invoiceDate = now;
      update.paymentVerifiedAt = now;
    }
    tx.update(orderRef, update);
  });
}

// Manual "Generate Invoice" button, for orders that were already Paid
// before invoicing existed (or any other edge case where Paid has no
// invoice yet). Refuses to touch anything that isn't already Paid, and
// never regenerates an invoice number that already exists.
window.generateInvoiceForOrder = async function generateInvoiceForOrder(orderId) {
  const o = ORDERS.find((x) => x.id === orderId);
  if (!o) return;
  if ((o.paymentStatus || "Pending Verification") !== "Paid") {
    showToast("Mark the payment as Paid before generating an invoice.");
    return;
  }
  if (o.invoiceNumber) { window.viewInvoice(orderId); return; }

  try {
    const orderRef = doc(db, "orders", orderId);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists()) throw new Error("Order not found.");
      const data = snap.data();
      if (data.invoiceNumber) return; // race guard — already generated elsewhere
      const now = Timestamp.now();
      const invoiceNumber = await allocateInvoiceNumber(tx);
      tx.update(orderRef, {
        invoiceNumber,
        invoiceDate: now,
        paymentVerifiedAt: data.paymentVerifiedAt || now,
      });
    });
    showToast("Invoice generated");
  } catch (err) {
    console.error(err);
    showToast(err.message || "Could not generate invoice");
  }
};

/* ============================================================
   INVOICE — View / Download / Print (admin)
   ============================================================ */
window.viewInvoice = function viewInvoice(orderId) {
  const o = ORDERS.find((x) => x.id === orderId);
  if (!o || !o.invoiceNumber) { showToast("Invoice not available yet."); return; }
  document.getElementById("invoiceModalBody").innerHTML = buildInvoiceHTML(o);
  document.getElementById("invoiceModalOverlay").classList.add("open");
  window.__activeInvoiceOrderId = orderId;
};

window.closeInvoiceModal = function closeInvoiceModal() {
  document.getElementById("invoiceModalOverlay").classList.remove("open");
  window.__activeInvoiceOrderId = null;
};

window.downloadInvoice = async function downloadInvoice(orderId) {
  const o = ORDERS.find((x) => x.id === orderId);
  if (!o || !o.invoiceNumber) { showToast("Invoice not available yet."); return; }
  await downloadInvoicePDF(o);
};

window.printInvoiceForOrder = function printInvoiceForOrder(orderId) {
  const o = ORDERS.find((x) => x.id === orderId);
  if (!o || !o.invoiceNumber) { showToast("Invoice not available yet."); return; }
  printInvoice(o);
};

window.downloadInvoiceFromModal = function downloadInvoiceFromModal() {
  if (window.__activeInvoiceOrderId) window.downloadInvoice(window.__activeInvoiceOrderId);
};

window.printInvoiceFromModal = function printInvoiceFromModal() {
  if (window.__activeInvoiceOrderId) window.printInvoiceForOrder(window.__activeInvoiceOrderId);
};

/* ============================================================
   CUSTOMERS — real-time Firestore listener
   ============================================================ */
function listenToCustomers() {
  const q = query(collection(db, "customers"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    CUSTOMERS = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCustomersTable();
    document.getElementById("kpiTotalCustomers").textContent = CUSTOMERS.length;
  }, (err) => {
    console.error("Customers listener error:", err);
  });
}

function renderCustomersTable() {
  const body = document.getElementById("customerTableBody");
  if (!CUSTOMERS.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="3">No registered customers yet.</td></tr>`;
    return;
  }
  body.innerHTML = CUSTOMERS.map((c) => `
    <tr>
      <td>${escapeHtml(c.name || "—")}</td>
      <td>${escapeHtml(c.email || "—")}</td>
      <td>${formatDate(c.createdAt)}</td>
    </tr>
  `).join("");
}

/* ============================================================
   COUPON CODES — real-time Firestore listener + CRUD
   ============================================================ */
function listenToCoupons() {
  const q = query(collection(db, "coupons"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    COUPONS = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCouponTable();
  }, (err) => {
    console.error("Coupons listener error:", err);
    showToast("Could not load coupons — check Firestore is enabled and rules are deployed.");
  });
}

function renderCouponTable() {
  const body = document.getElementById("couponTableBody");
  if (!COUPONS.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="6">No coupon codes yet — click "+ Add Coupon Code" to create one.</td></tr>`;
    return;
  }
  body.innerHTML = COUPONS.map((c) => {
    const productsLabel = c.appliesToAllProducts
      ? "All Products"
      : `${(c.productIds || []).length} Product${(c.productIds || []).length === 1 ? "" : "s"}`;
    return `
      <tr>
        <td><strong>${escapeHtml(c.code)}</strong></td>
        <td>${num(c.discountPercentage)}%</td>
        <td>${productsLabel}</td>
        <td><span class="badge ${c.active ? "in" : "out"}">${c.active ? "Active" : "Inactive"}</span></td>
        <td>${formatDate(c.createdAt)}</td>
        <td>
          <div class="row-actions">
            <button class="btn btn-outline btn-sm" onclick="editCoupon('${c.id}')">Edit</button>
            <button class="btn btn-outline btn-sm" onclick="toggleCouponActive('${c.id}', ${!c.active})">${c.active ? "Deactivate" : "Activate"}</button>
            <button class="btn btn-danger-outline btn-sm" onclick="askDeleteCoupon('${c.id}')">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function populateCouponProductList() {
  const wrap = document.getElementById("cProductList");
  if (!wrap) return;
  const checkedIds = editingCouponId
    ? new Set((COUPONS.find((c) => c.id === editingCouponId)?.productIds) || [])
    : new Set();
  wrap.innerHTML = PRODUCTS.map((p) => `
    <label class="cproduct-row">
      <input type="checkbox" class="cproduct-checkbox" value="${p.id}" data-name="${escapeHtml(p.name)}" ${checkedIds.has(p.id) ? "checked" : ""}>
      ${escapeHtml(p.name)}
    </label>
  `).join("") || `<p style="color:var(--text-2);font-size:13px">Add a product first before creating a coupon.</p>`;
}

window.toggleSelectAllProducts = function toggleSelectAllProducts(checked) {
  document.getElementById("cProductListWrap").style.opacity = checked ? "0.4" : "1";
  document.getElementById("cProductListWrap").style.pointerEvents = checked ? "none" : "auto";
  if (checked) {
    document.querySelectorAll(".cproduct-checkbox").forEach((cb) => (cb.checked = false));
  }
};

function initCouponForm() {
  document.getElementById("couponForm").addEventListener("submit", submitCouponForm);
  document.getElementById("cCode").addEventListener("input", (e) => {
    const start = e.target.selectionStart;
    e.target.value = e.target.value.toUpperCase();
    e.target.setSelectionRange(start, start);
  });
}

window.openCouponForm = function openCouponForm(couponId) {
  editingCouponId = couponId || null;
  const form = document.getElementById("couponForm");
  form.reset();
  document.getElementById("cSelectAll").checked = false;
  toggleSelectAllProducts(false);
  populateCouponProductList();

  if (editingCouponId) {
    const c = COUPONS.find((x) => x.id === editingCouponId);
    if (c) {
      document.getElementById("couponFormTitle").textContent = "Edit Coupon";
      document.getElementById("couponSubmitBtn").textContent = "Save Changes";
      document.getElementById("cCode").value = c.code || "";
      document.getElementById("cDiscount").value = c.discountPercentage || "";
      document.getElementById("cStatus").value = c.active ? "Active" : "Inactive";
      if (c.appliesToAllProducts) {
        document.getElementById("cSelectAll").checked = true;
        toggleSelectAllProducts(true);
      }
    }
  } else {
    document.getElementById("couponFormTitle").textContent = "Add a New Coupon";
    document.getElementById("couponSubmitBtn").textContent = "Save Coupon Code";
  }
  showSection("add-coupon");
};

window.editCoupon = function editCoupon(id) {
  openCouponForm(id);
};

async function submitCouponForm(event) {
  event.preventDefault();
  const submitBtn = document.getElementById("couponSubmitBtn");
  submitBtn.disabled = true;
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = "Saving...";

  try {
    const code = document.getElementById("cCode").value.trim().toUpperCase().replace(/\s+/g, "");
    const discountPercentage = parseInt(document.getElementById("cDiscount").value, 10);
    const active = document.getElementById("cStatus").value === "Active";
    const appliesToAllProducts = document.getElementById("cSelectAll").checked;

    if (!code) { showToast("Please enter a coupon code."); return; }
    if (!discountPercentage || discountPercentage < 1 || discountPercentage > 100) {
      showToast("Discount must be between 1% and 100%.");
      return;
    }

    let productIds = [];
    let productNames = [];
    if (!appliesToAllProducts) {
      document.querySelectorAll(".cproduct-checkbox:checked").forEach((cb) => {
        productIds.push(cb.value);
        productNames.push(cb.getAttribute("data-name"));
      });
      if (!productIds.length) {
        showToast("Select at least one product, or check \"Applies to All Products\".");
        return;
      }
    }

    // Enforce: no duplicate ACTIVE coupon codes.
    const duplicate = COUPONS.find((c) =>
      c.id !== editingCouponId && c.code === code && c.active && active
    );
    if (duplicate) {
      showToast(`An active coupon "${code}" already exists.`);
      return;
    }

    const couponData = {
      code, discountPercentage, appliesToAllProducts,
      productIds: appliesToAllProducts ? [] : productIds,
      productNames: appliesToAllProducts ? [] : productNames,
      active,
      updatedAt: serverTimestamp(),
    };

    if (editingCouponId) {
      await updateDoc(doc(db, "coupons", editingCouponId), couponData);
      showToast(`Coupon "${code}" updated`);
    } else {
      couponData.createdAt = serverTimestamp();
      couponData.createdBy = currentAdminEmail;
      await addDoc(collection(db, "coupons"), couponData);
      showToast(`Coupon "${code}" created`);
    }

    editingCouponId = null;
    showSection("coupons");
  } catch (err) {
    console.error(err);
    showToast("Could not save coupon — see console for details.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
}

window.toggleCouponActive = async function toggleCouponActive(id, nextActive) {
  try {
    await updateDoc(doc(db, "coupons", id), { active: nextActive, updatedAt: serverTimestamp() });
    showToast(nextActive ? "Coupon activated" : "Coupon deactivated");
  } catch (err) {
    console.error(err);
    showToast("Could not update coupon status");
  }
};

window.askDeleteCoupon = function askDeleteCoupon(id) {
  deleteCouponTarget = id;
  const c = COUPONS.find((x) => x.id === id);
  document.getElementById("delCouponCode").textContent = c ? c.code : "this coupon";
  document.getElementById("couponDelOverlay").classList.add("open");
};

window.closeCouponDeleteConfirm = function closeCouponDeleteConfirm() {
  document.getElementById("couponDelOverlay").classList.remove("open");
  deleteCouponTarget = null;
};

window.confirmDeleteCoupon = async function confirmDeleteCoupon() {
  if (!deleteCouponTarget) return;
  const c = COUPONS.find((x) => x.id === deleteCouponTarget);
  try {
    await deleteDoc(doc(db, "coupons", deleteCouponTarget));
    showToast(`Coupon "${c ? c.code : ""}" deleted`);
  } catch (err) {
    console.error(err);
    showToast("Could not delete coupon");
  } finally {
    window.closeCouponDeleteConfirm();
  }
};

/* ============================================================
   ADD / EDIT PRODUCT FORM
   ============================================================ */
// The category list comes from Admin -> Categories (Firestore), so you can add / rename categories yourself.
function populateCategoryDropdown() {
  const select = document.getElementById("pCategory");
  const keep = select.value; // don't lose the choice if the list refreshes while the form is open
  select.innerHTML = `<option value="" disabled selected>Select category</option>` +
    getCategoryNames().map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  if (keep) select.value = keep;
}

function initProductForm() {
  document.getElementById("productForm").addEventListener("submit", submitProductForm);
  document.getElementById("pMrp").addEventListener("input", recalcDiscount);
  document.getElementById("pSellingPrice").addEventListener("input", recalcDiscount);
  document.getElementById("pImage").addEventListener("change", handleImageSelect);
}

function recalcDiscount() {
  const mrp = parseFloat(document.getElementById("pMrp").value) || 0;
  const sp = parseFloat(document.getElementById("pSellingPrice").value) || 0;
  const discount = mrp > 0 && sp > 0 && sp <= mrp ? Math.round(100 - (sp / mrp) * 100) : 0;
  document.getElementById("pDiscountDisplay").textContent = discount + "% OFF";
}

function handleImageSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  uploadedImageFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    uploadedImagePreviewUrl = e.target.result;
    const preview = document.getElementById("pImagePreview");
    preview.src = uploadedImagePreviewUrl;
    preview.classList.add("show");
    document.getElementById("pImageUploadLabel").textContent = "📷 Change image";
  };
  reader.readAsDataURL(file);
}

window.openProductForm = function openProductForm(productId) {
  editingProductId = productId || null;
  const form = document.getElementById("productForm");
  form.reset();
  uploadedImageFile = null;
  uploadedImagePreviewUrl = "";
  document.getElementById("pImagePreview").classList.remove("show");
  document.getElementById("pImageUploadLabel").textContent = "📷 Click to upload an image";
  document.getElementById("pDiscountDisplay").textContent = "0% OFF";

  if (editingProductId) {
    const p = PRODUCTS.find((x) => x.id === editingProductId);
    if (p) {
      document.getElementById("productFormTitle").textContent = "Edit Product";
      document.getElementById("productSubmitBtn").textContent = "Save Changes";
      document.getElementById("pName").value = p.name || "";
      document.getElementById("pCategory").value = p.category || "";
      document.getElementById("pDescription").value = p.description || "";
      document.getElementById("pMrp").value = p.mrp || "";
      document.getElementById("pSellingPrice").value = p.sellingPrice || "";
      document.getElementById("pStock").value = p.stock ?? "";
      document.getElementById("pRating").value = p.rating ?? 5;
      document.getElementById("pStatus").value = p.status || "Active";
      document.getElementById("pTag").value = p.tag || "";
      document.getElementById("pArtisan").value = p.artisan || "";
      document.getElementById("pSku").value = p.sku || "";
      if (p.imageUrl) {
        uploadedImagePreviewUrl = p.imageUrl;
        const preview = document.getElementById("pImagePreview");
        preview.src = p.imageUrl;
        preview.classList.add("show");
        document.getElementById("pImageUploadLabel").textContent = "📷 Change image";
      }
      recalcDiscount();
    }
  } else {
    document.getElementById("productFormTitle").textContent = "Add a New Product";
    document.getElementById("productSubmitBtn").textContent = "Add Product";
    document.getElementById("pSku").value = generateSku();
  }
  showSection("add-product");
};

window.editProduct = function editProduct(id) {
  openProductForm(id);
};

function generateSku() {
  return "AM-" + Math.random().toString(36).slice(2, 7).toUpperCase();
}

async function submitProductForm(event) {
  event.preventDefault();
  const submitBtn = document.getElementById("productSubmitBtn");
  submitBtn.disabled = true;
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = "Saving...";

  try {
    const mrp = parseFloat(document.getElementById("pMrp").value) || 0;
    const sellingPrice = parseFloat(document.getElementById("pSellingPrice").value) || 0;
    const discount = mrp > 0 && sellingPrice > 0 && sellingPrice <= mrp
      ? Math.round(100 - (sellingPrice / mrp) * 100) : 0;

    let imageUrl = uploadedImagePreviewUrl && !uploadedImageFile ? uploadedImagePreviewUrl : "";

    if (uploadedImageFile) {
      try {
        imageUrl = await uploadProductImage(uploadedImageFile);
      } catch (uploadErr) {
        console.error(uploadErr);
        showToast(uploadErr.message || "Image upload failed. Please try again.");
        return;
      }
    }

    const productData = {
      name: document.getElementById("pName").value.trim(),
      category: document.getElementById("pCategory").value,
      description: document.getElementById("pDescription").value.trim(),
      mrp, sellingPrice, discount,
      stock: parseInt(document.getElementById("pStock").value) || 0,
      rating: parseFloat(document.getElementById("pRating").value) || 5,
      status: document.getElementById("pStatus").value,
      tag: document.getElementById("pTag").value,
      artisan: document.getElementById("pArtisan").value.trim(),
      sku: document.getElementById("pSku").value.trim(),
      updatedAt: serverTimestamp(),
    };
    if (imageUrl) productData.imageUrl = imageUrl;

    if (!productData.name || !mrp || !sellingPrice) {
      showToast("Please fill in name, MRP, and selling price.");
      return;
    }

    if (editingProductId) {
      await updateDoc(doc(db, "products", editingProductId), productData);
      showToast(`"${productData.name}" updated`);
    } else {
      productData.createdAt = serverTimestamp();
      await addDoc(collection(db, "products"), productData);
      showToast(`"${productData.name}" added to the shop`);
    }

    editingProductId = null;
    showSection("products");
  } catch (err) {
    console.error(err);
    showToast("Could not save product — see console for details.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
}

async function uploadProductImage(file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  const response = await fetch(CLOUDINARY_UPLOAD_URL, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    console.error("Cloudinary upload failed:", response.status, errText);
    throw new Error("Image upload failed. Please check your connection and try again.");
  }

  const data = await response.json();
  if (!data.secure_url) {
    console.error("Cloudinary response missing secure_url:", data);
    throw new Error("Image upload failed — no image URL was returned.");
  }

  return data.secure_url;
}

/* ============================================================
   QUICK STOCK UPDATE
   ============================================================ */
window.quickStock = async function quickStock(id) {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) return;
  const next = prompt(`Update stock for "${p.name}"`, p.stock ?? 0);
  if (next === null) return;
  const stock = parseInt(next);
  if (isNaN(stock) || stock < 0) { showToast("Please enter a valid stock number."); return; }
  try {
    await updateDoc(doc(db, "products", id), {
      stock,
      status: stock === 0 ? "Out of Stock" : (p.status === "Out of Stock" ? "Active" : p.status),
    });
    showToast("Stock updated");
  } catch (err) {
    console.error(err);
    showToast("Could not update stock");
  }
};

/* ============================================================
   DELETE PRODUCT
   ============================================================ */
window.askDelete = function askDelete(id) {
  deleteTarget = id;
  const p = PRODUCTS.find((x) => x.id === id);
  document.getElementById("delProductName").textContent = p ? p.name : "this product";
  document.getElementById("delOverlay").classList.add("open");
};

window.closeDeleteConfirm = function closeDeleteConfirm() {
  document.getElementById("delOverlay").classList.remove("open");
  deleteTarget = null;
};

window.confirmDelete = async function confirmDelete() {
  if (!deleteTarget) return;
  const p = PRODUCTS.find((x) => x.id === deleteTarget);
  try {
    await deleteDoc(doc(db, "products", deleteTarget));
    // Note: this doesn't delete the image from Cloudinary. Unsigned upload
    // presets can't delete assets from the browser without exposing your
    // API secret — that requires a signed request, normally done from a
    // small backend/Cloud Function. Leftover images just sit unused in
    // your Cloudinary media library; delete them there manually if needed.
    showToast(`"${p ? p.name : "Product"}" deleted`);
  } catch (err) {
    console.error(err);
    showToast("Could not delete product");
  } finally {
    window.closeDeleteConfirm();
  }
};

/* ============================================================
   SECTION SWITCHING (shared with sidebar clicks)
   ============================================================ */
function showSection(name) {
  document.querySelectorAll(".nav-link").forEach((l) => l.classList.toggle("active", l.dataset.section === name));
  document.querySelectorAll(".dash-section").forEach((s) => s.style.display = "none");
  document.getElementById("section-" + name).style.display = "block";
}

/* ============================================================
   HELPERS
   ============================================================ */
function num(v) { return v === undefined || v === null || v === "" ? 0 : v; }
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function placeholderImg(name) { return `https://placehold.co/100x100?text=${encodeURIComponent(name || "Product")}`; }
function formatDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function deliveryLabel(o) {
  if (o.status === "Delivered" && o.deliveredAt) return "Delivered " + formatDate(o.deliveredAt);
  if (o.estimatedDeliveryAt) return "Est. delivery " + formatDate(o.estimatedDeliveryAt);
  return "";
}

let toastTimer;
function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { window.closeDeleteConfirm(); window.closeCouponDeleteConfirm(); window.closeInvoiceModal(); }
});
