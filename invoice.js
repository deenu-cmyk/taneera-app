// invoice.js
// ============================================================
// Shared invoice rendering + client-side PDF/print logic for
// Taneera's — used by BOTH admin.js (Admin Dashboard) and the
// customer "My Orders" view in index.html, so the invoice looks
// identical no matter who opens it.
//
// No Firebase Cloud Functions / Blaze plan required anywhere in
// this file. PDF generation happens entirely in the visitor's
// browser using html2canvas + jsPDF (loaded from CDN — see the
// <script> tags added near the bottom of admin.html / index.html).
// Printing uses the browser's native window.print() against a
// dedicated hidden print container, styled with @media print
// rules also added to admin.html / index.html.
// ============================================================

const BUSINESS = {
  name: "Taneera",
  supportEmail: "Tanirascollection@gmail.com",
  instagramHandle: "@tanee.raa",
  instagramUrl: "https://www.instagram.com/tanee.raa?utm_source=qr",
};

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function num(v) { return v === undefined || v === null || v === "" ? 0 : v; }
function money(v) { return "₹" + Number(num(v)).toLocaleString("en-IN"); }
function fmtDateTime(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Builds the full invoice document as an HTML string. Works for the
 * on-screen "View Invoice" modal, the print container, and the PDF
 * capture — all three render this exact same markup so they always
 * match.
 *
 * Expects `order` to be a Firestore order doc (with `id`) that has
 * already been marked paymentStatus === "Paid" and has invoiceNumber /
 * invoiceDate set. Callers are responsible for that check — this
 * function does not enforce it, so it can also be used for a live
 * preview while an admin is generating one.
 */
export function buildInvoiceHTML(order) {
  const items = order.items || [];
  const rows = items.map((i) => {
    const qty = num(i.qty);
    const price = num(i.price);
    const sub = price * qty;
    return `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #E5E7EB;font-size:13px;color:#111827;text-align:left">${esc(i.name)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #E5E7EB;font-size:13px;color:#111827;text-align:center">${qty}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #E5E7EB;font-size:13px;color:#111827;text-align:right">${money(price)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #E5E7EB;font-size:13px;color:#111827;text-align:right;font-weight:600">${money(sub)}</td>
      </tr>`;
  }).join("");

  const subtotal = order.subtotal !== undefined ? num(order.subtotal) : items.reduce((s, i) => s + num(i.price) * num(i.qty), 0);
  const discount = num(order.discount);
  const total = order.total !== undefined ? num(order.total) : Math.max(0, subtotal - discount);

  return `
  <div style="width:100%;max-width:760px;margin:0 auto;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#111827;box-sizing:border-box;padding:36px;">

    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #B08D57;padding-bottom:18px;margin-bottom:24px;gap:16px;flex-wrap:wrap">
      <div>
        <img src="assets/logo-icon.png" alt="Taneera" style="height:44px;width:auto;margin-bottom:6px" onerror="this.style.display='none'">
        <div style="font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:22px;color:#3F4A38">Taneera</div>
        <div style="font-size:11px;color:#7A8571;margin-top:2px">Handmade &amp; Curated Jewellery</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:20px;font-weight:700;letter-spacing:.04em;color:#3F4A38;text-transform:uppercase">Invoice</div>
        <div style="font-size:12.5px;color:#374151;margin-top:8px"><strong>Invoice Number:</strong> ${esc(order.invoiceNumber || "—")}</div>
        <div style="font-size:12.5px;color:#374151"><strong>Invoice Date:</strong> ${esc(fmtDateTime(order.invoiceDate))}</div>
      </div>
    </div>

    <!-- Customer + Order details -->
    <div style="display:flex;gap:24px;margin-bottom:24px;flex-wrap:wrap">
      <div style="flex:1;min-width:240px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#B08D57;margin-bottom:8px">Customer Details</div>
        <div style="font-size:13px;line-height:1.9">
          <div><strong>Name:</strong> ${esc(order.customerName || "—")}</div>
          <div><strong>Address:</strong> ${esc(order.address || "—")}</div>
          <div><strong>Mobile:</strong> ${esc(order.customerPhone || "—")}</div>
          <div><strong>Email:</strong> ${esc(order.customerEmail || "—")}</div>
        </div>
      </div>
      <div style="flex:1;min-width:240px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#B08D57;margin-bottom:8px">Order Details</div>
        <div style="font-size:13px;line-height:1.9">
          <div><strong>Order ID:</strong> ${esc(order.orderNumber || order.id || "—")}</div>
          <div><strong>Order Date:</strong> ${esc(fmtDateTime(order.createdAt))}</div>
          <div><strong>UTR / Transaction Ref:</strong> ${esc(order.utr || "—")}</div>
        </div>
      </div>
    </div>

    <!-- Products -->
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#B08D57;margin-bottom:8px">Products</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
      <thead>
        <tr style="background:#F8F3E9">
          <th style="text-align:left;padding:9px 8px;font-size:11.5px;text-transform:uppercase;letter-spacing:.03em;color:#3F4A38">Product</th>
          <th style="text-align:center;padding:9px 8px;font-size:11.5px;text-transform:uppercase;letter-spacing:.03em;color:#3F4A38">Qty</th>
          <th style="text-align:right;padding:9px 8px;font-size:11.5px;text-transform:uppercase;letter-spacing:.03em;color:#3F4A38">Price</th>
          <th style="text-align:right;padding:9px 8px;font-size:11.5px;text-transform:uppercase;letter-spacing:.03em;color:#3F4A38">Subtotal</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="4" style="padding:14px 8px;font-size:13px;color:#6B7280">No items on this order.</td></tr>`}</tbody>
    </table>

    <!-- Totals -->
    <div style="display:flex;justify-content:flex-end;margin-bottom:24px">
      <div style="width:260px;max-width:100%">
        <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span style="color:#6B7280">Subtotal</span><span>${money(subtotal)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span style="color:#6B7280">Discount</span><span style="color:#B08D57">- ${money(discount)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:10px 0;margin-top:4px;border-top:2px solid #3F4A38;font-size:16px;font-weight:700"><span>Total</span><span>${money(total)}</span></div>
      </div>
    </div>

    <!-- Payment -->
    <div style="background:#F8F3E9;border-radius:10px;padding:14px 18px;margin-bottom:24px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div style="font-size:13px"><strong>Payment Method:</strong> ${esc(order.paymentMethod || "UPI / PhonePe")}</div>
      <div style="font-size:13px"><strong>Payment Status:</strong> <span style="color:#22C55E;font-weight:700">Paid</span></div>
    </div>

    <!-- Footer -->
    <div style="text-align:center;border-top:1px solid #E5E7EB;padding-top:18px;font-size:12.5px;color:#6B7280">
      <div style="margin-bottom:4px;color:#3F4A38;font-weight:600">Thank you for shopping with Taneera.</div>
      <div>Support: ${esc(BUSINESS.supportEmail)} &nbsp;·&nbsp; Instagram: ${esc(BUSINESS.instagramHandle)}</div>
    </div>
  </div>`;
}

/** Filename per spec: Taneera-Invoice-{invoiceNumber}.pdf */
export function invoiceFilename(order) {
  const safe = String(order.invoiceNumber || "UNKNOWN").replace(/[^A-Za-z0-9_-]/g, "");
  return `Taneera-Invoice-${safe}.pdf`;
}

/**
 * Prints the invoice using a dedicated hidden print container plus
 * @media print rules (added in admin.html / index.html) that hide
 * everything else on the page — no website header/nav/buttons show
 * up in the printed output, just the invoice itself.
 */
export function printInvoice(order) {
  let area = document.getElementById("invoicePrintArea");
  if (!area) {
    area = document.createElement("div");
    area.id = "invoicePrintArea";
    document.body.appendChild(area);
  }
  area.innerHTML = buildInvoiceHTML(order);
  document.body.classList.add("printing-invoice");
  const cleanup = () => {
    document.body.classList.remove("printing-invoice");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  // Small delay so the browser has a layout pass before print() opens
  // the dialog (avoids a blank first paint on some browsers).
  setTimeout(() => window.print(), 80);
}

/**
 * Renders the invoice off-screen and downloads it as a real PDF file,
 * entirely client-side (html2canvas + jsPDF, both loaded from CDN).
 * No server, no Cloud Function, no Blaze plan involved.
 */
export async function downloadInvoicePDF(order) {
  if (!window.html2canvas || !window.jspdf) {
    alert("PDF tools are still loading — please wait a moment and try again.");
    return;
  }
  const holder = document.createElement("div");
  holder.style.position = "fixed";
  holder.style.left = "-10000px";
  holder.style.top = "0";
  holder.style.width = "800px";
  holder.style.background = "#ffffff";
  holder.innerHTML = buildInvoiceHTML(order);
  document.body.appendChild(holder);

  try {
    const canvas = await window.html2canvas(holder, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const imgData = canvas.toDataURL("image/png");
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    pdf.save(invoiceFilename(order));
  } catch (err) {
    console.error("Invoice PDF generation failed:", err);
    alert("Could not generate the PDF. Please try again, or use Print Invoice instead.");
  } finally {
    document.body.removeChild(holder);
  }
}
