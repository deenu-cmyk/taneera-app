// firebase-config.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
    getAuth,
    GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDI-JZz98AE_0-KIMTeJoQ9vN7WomOtsNk",
    authDomain: "artisan-market-b4da3.firebaseapp.com",
    projectId: "artisan-market-b4da3",
    storageBucket: "artisan-market-b4da3.firebasestorage.app",
    messagingSenderId: "619207820538",
    appId: "1:619207820538:web:7de40c5a403dfd039b7543",
    measurementId: "G-HEZLV22K4Z"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const db = getFirestore(app);
// Note: Firebase Storage (getStorage) was removed — product images upload
// directly to Cloudinary from admin.js. Cloud Functions (getFunctions)
// were also removed — there's no payment gateway anymore, so orders are
// created directly from the browser (see firestore.rules for how that's
// still kept safe) and nothing else in this app calls a Cloud Function.

// ============================================================
// SINGLE SOURCE OF TRUTH for who the admin is.
// This is the ONLY place you need to change it — auth.js and
// admin.js both import ADMIN_EMAIL from here.
// ============================================================
const ADMIN_EMAIL = "tanirascollection@gmail.com";

export { app, auth, googleProvider, db, ADMIN_EMAIL };
