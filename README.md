# Taneera's — Firestore-backed Marketplace + Secure Admin Dashboard

This project now runs on **Firebase Firestore** for real, persistent data (products, orders, customers) instead of any client-only storage. There is exactly one admin, verified by **Firebase Authentication** — not a password hidden in JavaScript.

## Files

```
index.html          Customer storefront — reads products live from Firestore, manual UPI/PhonePe checkout
login.html           routes to admin.html or index.html based on email
register.html
auth.js              Login/register/Google logic — also creates a customers/{uid} doc, routes admin vs customer
firebase-config.js   Firebase app init — exports Firestore (db) and ADMIN_EMAIL. No Cloud Functions (removed — see below)
invoice.js            Shared invoice builder — HTML layout, PDF download (html2canvas + jsPDF), and print — imported by both admin.js and index.html
admin.html           Admin dashboard shell (sidebar, KPI cards, product table, add/edit form, orders table)
admin.js             All admin logic: auth guard, product/order/customer/coupon CRUD, image upload, payment status verification, invoice generation
firestore.rules      Server-side security rules — admin-only writes for products/coupons; orders can be created by their
                      own customer (paymentStatus must start "Pending" — never self-declared "Paid"), admin-only to update
firebase.json / firestore.indexes.json   Deployment config
terms.html / privacy-policy.html / refund-policy.html   Standalone policy pages
assets/               Logo, favicon, and the PhonePe QR image (assets/phonepe-qr.jpeg)
```

## 🔑 How admin access works (and why it's actually secure)

1. `firebase-config.js` exports one constant: `ADMIN_EMAIL = "tanirascollection@gmail.com"`. This is the **single source of truth** — change it here only, and both `auth.js` and `admin.js` pick it up.
2. There's no separate admin login form. Admin and customers use the **same** `login.html`. After a successful Firebase sign-in, `auth.js` checks the signed-in email:
   - matches `ADMIN_EMAIL` → redirect to `admin.html`
   - anything else → redirect to `index.html`
3. `admin.html` shows **nothing** until `admin.js`'s auth guard runs `onAuthStateChanged` and confirms the current Firebase user's email matches `ADMIN_EMAIL`. If it doesn't match (or nobody's signed in), it immediately `window.location.replace('index.html')`s away — a customer directly typing `/admin.html` in the URL bar never sees the dashboard, not even for a flash of a second (the page starts on a "Checking admin access…" spinner, not the dashboard).
4. **The real enforcement is server-side**, in `firestore.rules` and `storage.rules` — only requests carrying a Firebase auth token whose email matches `ADMIN_EMAIL` are allowed to create/update/delete documents in `products`, or upload/delete files under `products/` in Storage. Even if someone bypassed the UI entirely and called the Firestore API directly, they still couldn't write product data without being signed in as the admin. This is what the prompt asked for explicitly: verification happens via Firebase Authentication, not `localStorage.setItem('admin', true)` or a hidden password.

## ⚙️ One-time setup (do this before anything works)

### 1. Enable Firestore in the Firebase Console
Go to [console.firebase.google.com](https://console.firebase.google.com) → project `artisan-market-b4da3` → **Firestore Database** → Create database (start in production mode — the rules file below locks it down properly).

Product images no longer use Firebase Storage — they upload to Cloudinary instead (cloud name `ib6ntpub`, unsigned preset `taneera_products`). Make sure that preset exists and is set to **Unsigned** in your Cloudinary dashboard (Settings → Upload → Upload presets) — no setup needed on the Firebase side for images.

### 2. Deploy the security rules
```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules,firestore:indexes
```
Without this step, Firestore's default rules may block all reads/writes (or, if you chose "test mode," allow *anyone* to write — deploying `firestore.rules` is what actually enforces "only I can add/edit/delete products").

### 3. Create the admin account
Firebase can only authenticate an email/password that already exists as a user. Do **one**:

**Option A — via your Register page (easiest)**
1. Open `register.html`
2. Sign up with:
   - Email: `tanirascollection@gmail.com`
   - Password: `<choose-a-strong-password>`
3. Since this email matches `ADMIN_EMAIL`, `auth.js` will immediately redirect this account to `admin.html` — both on this signup and every future login.

**Option B — via Firebase Console**
Authentication → Users → Add user → same email/password.

### 4. Run it locally
Open this folder in VS Code, install the **Live Server** extension, right-click `index.html` → "Open with Live Server". (Module `import`s don't work over `file://`, so it must be served, even locally — Live Server handles that.)

## 💳 UPI Payments — manual, no payment gateway

Checkout accepts **UPI / PhonePe only** — no Cash on Delivery, no Razorpay, no Cashfree, no payment gateway of any kind. This is intentionally simple:

1. Customer scans the PhonePe QR (or pays to the UPI ID `9538162560@ybl` directly) using any UPI app, outside the website entirely.
2. Customer clicks **"I've Paid — Place Order."** This only records that the customer *says* they paid — the order is created with `paymentStatus: "Pending"`. Nothing in the browser can set it to `"Paid"`.
3. **You check your actual UPI/PhonePe account** for a matching payment.
4. In `admin.html` → Orders, you manually change that order's Payment Status dropdown from **Pending** to **Paid**.

The real PhonePe QR is already in place at `assets/phonepe-qr.jpeg` — replace that file directly if you ever need to swap in a different QR export.

### Why this is reasonably safe without a gateway
There's no automated payment verification step in this flow at all — that's the tradeoff of going gateway-free. The real security backstop is **you, manually checking the real UPI transaction** before marking an order Paid. `firestore.rules` still enforces that: only the order's own customer can create it, and only with `paymentStatus` starting at `"Pending"` — never `"Paid"` directly from the browser, even by someone editing the page's JavaScript.

## 🧭 Everyday use

**As admin:** Log in with `tanirascollection@gmail.com` → lands on `admin.html` automatically →
- **Dashboard**: live KPIs (products, active, out of stock, orders, revenue, customers)
- **Products**: table of everything, Edit / Update Stock / Delete per row
- **Add Product**: photo upload with preview, name, category, description, MRP + selling price (discount % auto-calculated), stock, rating, status (Active/Out of Stock), tag (New/Best Seller/Offer), artisan name, SKU
- **Orders**: every order placed by customers, with a status dropdown (Placed → Confirmed → Shipped → Delivered/Cancelled)
- **Customers**: everyone who's registered
- **Settings**: shows your admin email, logout

**As a customer:** Register/login (any other email) → lands on `index.html` →
- Browse, search, filter by category
- Add to Wishlist / Cart (both saved locally on that device)
- Buy Now (single item) or Cart → Checkout — either writes a real order to Firestore tied to your account (you must be logged in; if not, you're sent to `login.html` first)
- **My Orders** (link in the mobile menu, or add a button anywhere you like) shows your own order history — nobody else's

Customers never see prices they can edit, never see an Add/Edit/Delete button, and never see the admin dashboard, whether they click around, guess the URL, or read the page's source.

## 🏷️ Coupon Codes (new)

Admin can create discount coupons scoped to specific products or all products.

- **Admin** (`admin.html` → Coupon Codes): create/edit/activate-deactivate/delete coupons. Each has a code (auto-uppercased, must be unique among active coupons), a discount % (1–100), a product scope (pick specific products or "Applies to All Products"), and a status.
- **Storefront** (`index.html`): products with an active, applicable coupon show a "🏷️ X% OFF / Code: XXXX / Copy Code" badge on the card and in Quick View. In the cart, customers enter a code under "Have a coupon?" — it's validated against Firestore live, and the discount is calculated **only on eligible items** (not the whole cart) if the coupon is scoped to specific products.
- **Firestore**: new `coupons` collection. Rules mirror the products pattern — anyone can read (needed to display/validate coupons), only the admin (`tanirascollection@gmail.com`) can write. See `firestore.rules`.
- **Orders**: when a coupon is applied at checkout, the order document also stores `subtotal`, `discount`, and `couponCode` — visible on both the customer's My Orders view and the admin Orders tab.

No new files were added for this — it's built into the existing `admin.html`/`admin.js`/`index.html`/`firestore.rules`, consistent with the rest of the app's structure.

## 📦 Shipping Info & Track Order (new — now with live status history, timestamps, and delivery estimates)

- **Header**: added an "Orders" icon (📦) between Wishlist and Cart, matching the existing icon-button style/spacing — opens My Orders directly. (It was already reachable from the mobile hamburger menu; now it's on desktop too.)
- **My Orders** is now a full order detail view, not just a one-line summary: each card shows the order number, exact placed date/time, every item with its photo/name/qty/price, total, payment status, current status, and estimated delivery (or the actual delivered date/time once delivered) — plus a **Track Order** button that jumps straight to the live tracking section with that order pre-filled and searched automatically.

- **Shipping Information** (`#shipping`, linked from the footer): four static info cards — Processing Time, Delivery Time, Delivery Areas, Need Help.
- **Track Order** (`#track-order`, linked from the footer): customers enter an order number (e.g. `TAN-48213`) and it's tracked **live** via `onSnapshot` — if the admin changes the status while the customer is sitting on this page, it updates automatically, no refresh needed.
- **Status history with exact timestamps**: every status change made by the admin is appended to the order's `statusHistory` array — never overwritten. Each completed/current step in the 6-stage timeline (Order Placed → Confirmed → Packed → Shipped → Out for Delivery → Delivered) shows its own exact date/time underneath it, formatted in the visitor's local timezone via `Intl.DateTimeFormat` (no manual UTC math).
- **Delivery estimate**: `index.html` has one setting near the top of its script, `DELIVERY_DURATION_DAYS = 5`, applied the moment an order is placed (`estimatedDeliveryAt` gets set then). Shown as **Estimated Delivery** until the order is marked Delivered, at which point it's replaced with **Delivered On** + the exact `deliveredAt` timestamp and a "✓ Delivered successfully" message.
- **Order numbers**: assigned client-side the moment an order is placed (e.g. `TAN-48213`), shown in My Orders and used for tracking. Orders placed before the Track Order feature existed won't have one.
- **Security — unchanged, still customer-scoped**: tracking requires being logged in. A customer's lookup query is scoped to `orderNumber == X AND customerId == their uid` — Firestore's rules only allow that combination for their own orders (`Order not found` either way, never a permission error that reveals whether the order exists). Admin can look up any order number, same as before. **No `firestore.rules` changes were needed for any of this** — order history/timestamps are written either by the Cloud Function (which uses the Admin SDK and bypasses rules entirely) or by the admin's `updateOrderStatus`, which was already covered by the existing `allow update: if isAdmin()` rule on `orders`.
- **Admin**: selecting a new status appends a `statusHistory` entry (skips if you re-select the same status already active — no duplicate entries) and sets `deliveredAt` automatically when you choose "Delivered." The Orders table also shows the estimated/delivered date under each order's status dropdown.
- **A Firestore quirk worth knowing**: `serverTimestamp()` can't be used *inside* an array field (Firestore limitation) — so `statusHistory` entries use a regular `Timestamp.now()` (client- or Cloud-Function-clock-based) instead. Top-level timestamp fields (`createdAt`, `paidAt`, `deliveredAt`) still use the fully server-authoritative `serverTimestamp()`.

## ✉️ Email Verification (new)

New email/password registrations must verify their email before they can log in.

- **Register** (`register.html`): creates the Firebase account, sends a verification email, signs the user back out (doesn't auto-login), and shows a "Registration successful — check your email" panel with **Open Login** and **Resend Verification Email** buttons.
- **Login** (`login.html`): if `user.emailVerified === false`, the user is signed back out immediately and shown an "Email Not Verified" panel with **Resend Verification Email** and **Try Again** — they cannot get into the site. If verified, login proceeds normally.
- **Source of truth**: this is enforced by checking Firebase's own `user.emailVerified` (in `auth.js`, in `loginUser()`), never `localStorage` or any client-only flag.
- **Google Login**: unaffected — Google-authenticated accounts are already verified by Google, so this restriction doesn't apply to `googleLogin()`.
- **Admin login is exempt from this restriction.** The prompt asked to preserve the existing admin login above all else — since the admin account may never have gone through Firebase's email-link verification, adding a hard `emailVerified` gate to the shared login function could have locked you out of `admin.html` entirely. `loginUser()` checks the signed-in email against `ADMIN_EMAIL` *before* checking `emailVerified`, so `tanirascollection@gmail.com` always logs in normally, exactly like before.
- **Firestore profile**: the prompt asked for a `users/{uid}` collection, but this app already has a `customers/{uid}` collection that the admin dashboard's Customers tab depends on — I kept using that instead of creating a second, parallel collection. It now also stores `emailVerified` and `lastLoginAt`. No password is ever written to Firestore.

## 🖼️ Product Images: Cloudinary instead of Firebase Storage (new)

Firebase Storage was causing CORS errors on image upload, so product images now upload directly to **Cloudinary** (cloud name `ib6ntpub`, unsigned preset `taneera_products`) instead. Nothing else changed — Firestore (products, orders, customers, coupons), Firebase Authentication, and every other feature are untouched.

- **Where**: `admin.js` → `uploadProductImage(file)`. Add/Edit Product form calls this exactly like before; the image preview (before upload) is unchanged since that's separate `FileReader` logic that never touched Firebase Storage.
- **How it works**: the selected file is POSTed as `FormData` (`file` + `upload_preset`) to `https://api.cloudinary.com/v1_1/ib6ntpub/image/upload`. On success, Cloudinary's `secure_url` is saved into the exact same Firestore field (`imageUrl`) that used to hold the Firebase Storage download URL — so the storefront, product cards, Quick View, cart, and orders all keep working with zero changes there.
- **No API secret involved**: this uses an *unsigned* upload preset, which is designed to be called directly from browser JavaScript — nothing sensitive is ever exposed client-side.
- **Errors**: if the upload fails (bad connection, wrong preset, etc.), the admin sees a specific toast message instead of a generic failure, and the product isn't saved with a broken image URL.
- **Removed**: the `getStorage`/`ref`/`uploadBytes`/`getDownloadURL`/`deleteObject` imports and the `storage` export from `firebase-config.js` (nothing else in the app used Firebase Storage), plus `storage.rules` and its `firebase.json` entry.
- **One behavior change worth knowing**: deleting a product no longer tries to delete its image file (it used to attempt this for Firebase Storage). Cloudinary's unsigned presets can't delete assets from the browser without exposing your API secret — that requires a signed request, normally from a small backend. Deleted products just leave an unused image sitting in your Cloudinary media library; clean those up manually there if it matters to you.

### To test it
1. Make sure your Cloudinary upload preset `taneera_products` exists and is set to **Unsigned** (Cloudinary dashboard → Settings → Upload → Upload presets).
2. Log into `admin.html`, add or edit a product, pick an image, save.
3. Open browser dev tools → Network tab — you should see a POST to `api.cloudinary.com/v1_1/ib6ntpub/image/upload` returning a `secure_url`.
4. Check the product on the storefront (`index.html`) — the image should load from a `res.cloudinary.com` URL now instead of `firebasestorage.googleapis.com`.

## 🧾 Invoices (new)

Every order that's been marked **Paid** gets a proper invoice — Admin and the customer can both View / Download (PDF) / Print it. No payment gateway, no Cloud Functions, no Blaze plan involved.

- **New file:** `invoice.js` — one shared module that builds the invoice's HTML, the PDF download, and the print output, imported by both `admin.js` and `index.html` so the invoice looks identical no matter who opens it.
- **How it's triggered:** when the admin flips an order's Payment Status from `Pending Verification` → `Paid` in `admin.html` → Orders, `admin.js`'s `updatePaymentStatus()` runs a single Firestore **transaction** that (a) sets `paymentStatus: "Paid"` and (b) allocates the next invoice number, all atomically. Submitting a UTR never triggers this — only the admin's explicit Paid transition does. Re-selecting Paid on an order that's already Paid is a no-op (checked before the transaction even runs), so it's impossible to generate two invoices for the same order.
- **Invoice numbers:** sequential, per calendar year — `INV-2026-000001`, `INV-2026-000002`, etc. — from a single counter doc at `counters/invoices` (`{ year, seq }`), allocated inside the same transaction so two admins clicking at once still can't collide. That collection is admin-only in `firestore.rules` (customers have no read or write access to it).
- **What's on the invoice:** customer name/address/mobile/email, order ID/date, UTR, every product with qty/price/subtotal, Subtotal/Discount/Total (pulled straight from the order doc — never recalculated), payment method + status, invoice number + invoice date, and Taneera's support email/Instagram. All of it comes from fields the order already had (`customerName`, `address`, `customerEmail`, `items`, `subtotal`, `discount`, `total`, `utr`, `orderNumber`, `createdAt`) except one: there was no mobile number anywhere in the existing order/customer data, so a **Mobile Number** field was added to the delivery-address step at checkout and is now saved on the order as `customerPhone`.
- **Where to find it:**
  - **Admin** (`admin.html` → Orders): a new **Invoice** column shows `Invoice Unavailable` for anything not yet Paid; once Paid, it shows the invoice number plus **View / Download / Print**. If an order was already Paid before this feature existed (so it has no invoice yet), the column instead shows a one-click **Generate Invoice** button.
  - **Customer** (`index.html` → My Orders): each Paid order gets its own **View Invoice / Download / Print** buttons, rendered only from that customer's own fetched orders (`MY_ORDERS`, scoped server-side by `customerId == uid`) — there's no path in the UI for a customer to reach anyone else's invoice.
- **PDF & Print, no backend:** `invoice.js` renders the invoice off-screen and rasterizes it with **html2canvas**, then drops that into a PDF with **jsPDF** — both loaded from a CDN (`admin.html` / `index.html`), same pattern this project already uses for EmailJS. The download filename is `Taneera-Invoice-{invoiceNumber}.pdf`. **Print Invoice** uses the browser's native print dialog against a dedicated hidden container plus `@media print` rules that hide the rest of the page — no header, nav, or buttons show up in the printed/PDF output, just the invoice.
- **Security:** invoice fields (`invoiceNumber`, `invoiceDate`, `paymentVerifiedAt`) are only ever written by the admin transaction in `admin.js` — the existing `orders` rule (`allow update, delete: if isAdmin()`) already blocks customers from writing to their own order at all, so nothing new was needed there. The only rules change is the new admin-only `counters/{counterId}` match block.
- **Nothing removed:** order tracking, admin order status changes, EmailJS confirmation emails (the `{{utr}}` variable is untouched), coupons, and the manual UPI/PhonePe flow all work exactly as before.

## Notes on scope

- **Payments**: manual UPI/PhonePe only — see the section above. No payment gateway, no automated verification; the admin manually confirms payment before marking an order Paid.
- **Cart/Wishlist** persist per-browser via `localStorage`, not Firestore — so they don't follow a customer between devices. Orders, by contrast, are real Firestore documents tied to the customer's `uid`, so "My Orders" is consistent everywhere they log in.
- **Image uploads**: hosted on Cloudinary (see the section above) — no longer Firebase Storage.

## Deployment (one live URL)

**⚠️ This update changed `firestore.rules`** — redeploy it, or client-side order creation will fail with "Missing or insufficient permissions":
```bash
firebase deploy --only firestore:rules
```

This is a fully static site now — no Cloud Functions, no backend to deploy:
```bash
firebase deploy
```
This deploys hosting *and* the Firestore rules together. You'll get a URL like `https://artisan-market-b4da3.web.app`.

Netlify/GitHub Pages also still work for *hosting* the static files — but you'd need to run `firebase deploy --only firestore:rules,storage` separately from the Firebase CLI at least once, since rules aren't something Netlify can deploy for you.
