/* =========================================================================
   emailjs-config.js
   -------------------------------------------------------------------------
   EmailJS credentials for Taneera's order-confirmation emails.

   >>> REPLACE the two placeholder values below with your own. <<<

   Where to find them (https://dashboard.emailjs.com):
   1. "Email Services" (left sidebar) -> click your connected service ->
      copy its Service ID (looks like "service_abc1234").
   2. "Account" -> "General" -> copy your Public Key.
   3. Your Template ID is already filled in below: template_govxtjt

   ------------------------------------------------------------------------
   Why this file instead of a .env with VITE_EMAILJS_* variables:
   This project is a plain static site with no build step — firebase.json
   deploys the folder exactly as-is ("public": "."), so nothing exists to
   read a .env file or process import.meta.env at build time. A Vite-style
   .env would simply never be applied.

   This file plays the equivalent role, and follows the same pattern this
   codebase already uses for firebase-config.js (which exposes the Firebase
   apiKey the same way). EmailJS's Public Key is explicitly designed to be
   used client-side like this — same idea as a Stripe "publishable key".

   Never put your EmailJS *Private Key* here or anywhere in frontend code.
   This project doesn't use it anywhere.
   ========================================================================= */

window.EMAILJS_CONFIG = {
  SERVICE_ID: "service_kh9fyvg",
  TEMPLATE_ID: "template_xxxxxxx",
  PUBLIC_KEY: "xxxxxxxxxxxxxxxx"
};
