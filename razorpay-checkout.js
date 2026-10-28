/* Taneeraa — Razorpay checkout helper
   Upload this file to the root of your taneera-app repo (next to index.html)
   and add  <script src="razorpay-checkout.js"></script>  to checkout.html.

   It does three things:
   1. asks your backend to create a Razorpay order (price calculated on the server)
   2. opens the Razorpay payment window
   3. asks your backend to verify the payment signature, then calls your onSuccess
*/
(function () {
  // Your Vercel backend address (check it in Vercel -> Overview -> Domains)
  var API_BASE = "https://taneera-backend.vercel.app/api";

  function loadRazorpayScript() {
    return new Promise(function (resolve, reject) {
      if (window.Razorpay) return resolve();
      var s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Could not load Razorpay. Check your internet connection.")); };
      document.head.appendChild(s);
    });
  }

  function post(path, body) {
    return fetch(API_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data.error || "Request failed");
        return data;
      });
    });
  }

  // Turns your cart ({productId: qty}) into the list the backend expects
  window.cartToItems = function (cartObj) {
    var cart = cartObj || JSON.parse(localStorage.getItem("tan_cart") || "{}");
    return Object.keys(cart).map(function (id) { return { id: id, qty: cart[id] }; });
  };

  /* Usage:
     payWithRazorpay({
       items: [{ id: "firestoreProductId", qty: 1 }],   // or cartToItems()
       couponCode: "HANDMADE10",                         // optional
       prefill: { name: "...", contact: "9999999999", email: "..." },
       onSuccess: function (result) { ... },             // payment paid AND verified
       onFailure: function (message) { ... },
       onDismiss: function () { ... }                    // customer closed the window
     });
  */
  window.payWithRazorpay = async function (opts) {
    opts = opts || {};
    try {
      await loadRazorpayScript();
      var order = await post("/create-order", { items: opts.items, couponCode: opts.couponCode || undefined });

      var rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: "INR",
        name: "Taneeraa",
        description: "Handmade jewellery order",
        order_id: order.orderId,
        prefill: opts.prefill || {},
        theme: { color: "#B08D57" },
        handler: async function (resp) {
          try {
            var v = await post("/verify", resp);
            if (v.verified) {
              if (opts.onSuccess) opts.onSuccess({
                razorpayOrderId: resp.razorpay_order_id,
                razorpayPaymentId: resp.razorpay_payment_id,
                razorpaySignature: resp.razorpay_signature,
                subtotal: order.subtotal,
                discount: order.discount,
                total: order.total,
              });
            } else if (opts.onFailure) {
              opts.onFailure("Payment could not be verified. If money was deducted, please contact us with your payment ID: " + resp.razorpay_payment_id);
            }
          } catch (e) {
            if (opts.onFailure) opts.onFailure(e.message);
          }
        },
        modal: { ondismiss: function () { if (opts.onDismiss) opts.onDismiss(); } },
      });

      rzp.on("payment.failed", function (r) {
        if (opts.onFailure) opts.onFailure((r.error && r.error.description) || "Payment failed. Please try again.");
      });
      rzp.open();
    } catch (e) {
      if (opts.onFailure) opts.onFailure(e.message || "Could not start payment.");
    }
  };
})();
