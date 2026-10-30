// razorpay-admin.js
// Adds a "Razorpay Orders" tab to the admin panel. It reads the
// razorpayPayments collection that api/razorpay-webhook.js fills in, and
// checks each payment against the orders list so you can see at a glance
// which paid payments have no order saved yet.
//
// Used by admin.js:   initRazorpayAdmin(() => ORDERS);
// No changes are needed in admin.html (the tab is added from here).

import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

let PAYMENTS = [];
let getOrders = () => [];
let statusFilter = "all";
let searchTerm = "";
let loadError = "";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rupees = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtDateTime(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function initRazorpayAdmin(ordersGetter) {
  if (typeof ordersGetter === "function") getOrders = ordersGetter;
  if (document.getElementById("section-razorpay")) return; // already set up
  injectUi();
  listen();
  window.refreshRazorpayTable = render; // admin.js calls this whenever orders change
}

/* ---------- UI (added from here, so admin.html stays unchanged) ---------- */
function injectUi() {
  // Sidebar link, right under "Payments". Must exist before admin.js runs initNav().
  const link = document.createElement("a");
  link.className = "nav-link";
  link.setAttribute("data-section", "razorpay");
  link.textContent = "⚡ Razorpay Orders";
  const after = document.querySelector('.nav-link[data-section="payments"]');
  if (after) after.after(link);
  else document.querySelector(".sidebar").appendChild(link);

  const section = document.createElement("section");
  section.className = "dash-section";
  section.id = "section-razorpay";
  section.style.display = "none";
  section.innerHTML = `
    <div class="toolbar">
      <div><h2>Razorpay Orders</h2><p>Every online payment recorded by Razorpay — live, even if the customer closed the page.</p></div>
    </div>

    <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr)">
      <div class="kpi-card"><div class="num" id="rzpKpiAmount">₹0</div><div class="label">Paid via Razorpay</div></div>
      <div class="kpi-card"><div class="num" id="rzpKpiCount">0</div><div class="label">Successful payments</div></div>
      <div class="kpi-card"><div class="num" id="rzpKpiFailed">0</div><div class="label">Failed payments</div></div>
      <div class="kpi-card"><div class="num" id="rzpKpiAttention" style="color:var(--danger)">0</div><div class="label">Paid, but no order saved</div></div>
    </div>

    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
      <input type="text" class="search-box" id="rzpSearch" placeholder="Search payment ID, order ID, phone, email, order #…" style="flex:1;min-width:220px">
      <select class="status-select" id="rzpStatusFilter" style="padding:10px 12px">
        <option value="all">All payments</option>
        <option value="captured">Paid</option>
        <option value="authorized">Authorized</option>
        <option value="failed">Failed</option>
        <option value="refunded">Refunded</option>
        <option value="attention">Needs attention (no order)</option>
      </select>
    </div>

    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Payment ID</th><th>Razorpay Order ID</th><th>Amount</th><th>Method</th><th>Customer</th><th>Status</th><th>Website Order</th></tr></thead>
        <tbody id="rzpTableBody"></tbody>
      </table>
    </div>
  `;
  document.querySelector("main.main").appendChild(section);

  document.getElementById("rzpSearch").addEventListener("input", (e) => { searchTerm = e.target.value.trim().toLowerCase(); render(); });
  document.getElementById("rzpStatusFilter").addEventListener("change", (e) => { statusFilter = e.target.value; render(); });

  // Copy payment ID / jump to the Orders tab
  section.addEventListener("click", (e) => {
    const copyBtn = e.target.closest("[data-copy]");
    if (copyBtn) {
      navigator.clipboard.writeText(copyBtn.getAttribute("data-copy")).then(() => {
        const old = copyBtn.textContent;
        copyBtn.textContent = "Copied";
        setTimeout(() => { copyBtn.textContent = old; }, 1400);
      }).catch(() => {});
      return;
    }
    if (e.target.closest("[data-goto-orders]")) {
      const nav = document.querySelector('.nav-link[data-section="orders"]');
      if (nav) nav.click();
    }
  });
}

/* ---------- data ---------- */
function listen() {
  const q = query(collection(db, "razorpayPayments"), orderBy("updatedAt", "desc"));
  onSnapshot(q, (snap) => {
    PAYMENTS = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    loadError = "";
    render();
  }, (err) => {
    console.error("Razorpay payments listener error:", err);
    loadError = "Could not load Razorpay payments. Publish the updated Firestore rules (razorpayPayments) and check you are signed in as admin.";
    render();
  });
}

// The website order that belongs to this payment (if one was saved)
function findOrder(p) {
  return getOrders().find((o) =>
    o.id === p.orderDocId ||
    o.id === p.paymentId ||
    o.utr === p.paymentId ||
    o.razorpayPaymentId === p.paymentId ||
    (p.razorpayOrderId && o.razorpayOrderId === p.razorpayOrderId)
  );
}

function statusOf(p) {
  if (p.refundStatus === "processed") return "refunded";
  return p.status || "";
}

function isPaid(p) { return p.status === "captured" && p.refundStatus !== "processed"; }
function needsAttention(p) { return (p.status === "captured" || p.status === "authorized") && !findOrder(p); }

function statusBadge(p) {
  const s = statusOf(p);
  const styles = {
    captured:   ["#DCFCE7", "#15803D", "Paid"],
    authorized: ["#FEF3C7", "#92400E", "Authorized"],
    failed:     ["#FEE2E2", "#B91C1C", "Failed"],
    refunded:   ["#DBEAFE", "#1D4ED8", "Refunded"],
  };
  const [bg, fg, label] = styles[s] || ["#F3F4F6", "#374151", s || "—"];
  return `<span class="badge" style="background:${bg};color:${fg}">${esc(label)}</span>`;
}

function methodLabel(p) {
  const m = p.method || "—";
  let detail = "";
  if (p.method === "upi" && p.vpa) detail = p.vpa;
  else if (p.method === "card") detail = [p.cardNetwork, p.cardLast4 ? "•••• " + p.cardLast4 : ""].filter(Boolean).join(" ");
  else if (p.method === "netbanking") detail = p.bank || "";
  else if (p.method === "wallet") detail = p.wallet || "";
  return `<div style="font-weight:600;text-transform:uppercase;font-size:11.5px">${esc(m)}</div>` +
         (detail ? `<div style="font-size:11.5px;color:var(--text-2)">${esc(detail)}</div>` : "");
}

/* ---------- render ---------- */
function render() {
  const body = document.getElementById("rzpTableBody");
  if (!body) return;

  // KPI cards (always over all payments, not the filtered list)
  const paid = PAYMENTS.filter(isPaid);
  document.getElementById("rzpKpiAmount").textContent = rupees(paid.reduce((n, p) => n + Number(p.amount || 0), 0));
  document.getElementById("rzpKpiCount").textContent = paid.length;
  document.getElementById("rzpKpiFailed").textContent = PAYMENTS.filter((p) => p.status === "failed").length;
  document.getElementById("rzpKpiAttention").textContent = PAYMENTS.filter(needsAttention).length;

  if (loadError) {
    body.innerHTML = `<tr class="empty-row"><td colspan="8">${esc(loadError)}</td></tr>`;
    return;
  }

  let list = PAYMENTS;
  if (statusFilter === "attention") list = list.filter(needsAttention);
  else if (statusFilter !== "all") list = list.filter((p) => statusOf(p) === statusFilter);

  if (searchTerm) {
    list = list.filter((p) => {
      const o = findOrder(p);
      return [p.paymentId, p.razorpayOrderId, p.email, p.contact, o && o.orderNumber]
        .some((v) => String(v || "").toLowerCase().includes(searchTerm));
    });
  }

  if (!list.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="8">${PAYMENTS.length ? "No payments match your filters." : "No Razorpay payments recorded yet — they appear here automatically after each payment."}</td></tr>`;
    return;
  }

  body.innerHTML = list.map((p) => {
    const o = findOrder(p);
    let orderCell;
    if (o) {
      orderCell = `<div style="font-weight:600">${esc(o.orderNumber || (o.id || "").slice(0, 8).toUpperCase())}</div>
                   <button class="btn btn-outline btn-sm" style="margin-top:4px" data-goto-orders>View in Orders</button>`;
    } else if (p.status === "captured" || p.status === "authorized") {
      orderCell = `<span class="badge" style="background:#FEE2E2;color:#B91C1C">Paid — no order saved</span>
                   <div style="font-size:11px;color:var(--text-2);margin-top:4px">Contact the customer and add the order manually.</div>`;
    } else {
      orderCell = `<span style="color:var(--text-2)">—</span>`;
    }

    const refundLine = p.refundStatus
      ? `<div style="font-size:11px;color:#1D4ED8;margin-top:3px">Refund ${esc(p.refundStatus)}: ${rupees(p.refundAmount)}</div>` : "";
    const errorLine = p.status === "failed" && p.errorDescription
      ? `<div style="font-size:11px;color:#B91C1C;margin-top:3px;max-width:200px">${esc(p.errorDescription)}</div>` : "";

    return `
      <tr>
        <td style="white-space:nowrap">${fmtDateTime(p.paidAt || p.updatedAt)}</td>
        <td>
          <div style="font-family:monospace;font-size:11.5px">${esc(p.paymentId || p.id)}</div>
          <button class="btn btn-outline btn-sm" style="margin-top:4px;padding:4px 10px;font-size:11px" data-copy="${esc(p.paymentId || p.id)}">Copy</button>
        </td>
        <td style="font-family:monospace;font-size:11.5px">${esc(p.razorpayOrderId || "—")}</td>
        <td style="font-weight:600">${rupees(p.amount)}${p.fee ? `<div style="font-size:11px;color:var(--text-2);font-weight:400">Fee ${rupees(p.fee)}</div>` : ""}</td>
        <td>${methodLabel(p)}</td>
        <td>
          <div>${esc(p.email || "—")}</div>
          <div style="font-size:11.5px;color:var(--text-2)">${esc(p.contact || "")}</div>
        </td>
        <td>${statusBadge(p)}${refundLine}${errorLine}</td>
        <td>${orderCell}</td>
      </tr>`;
  }).join("");
}
