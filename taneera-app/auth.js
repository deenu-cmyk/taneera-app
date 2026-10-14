// auth.js

import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInWithPopup,
    signOut,
    sendPasswordResetEmail,
    sendEmailVerification,
    onAuthStateChanged,
    updateProfile
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
    doc,
    setDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

import { auth, googleProvider, db, ADMIN_EMAIL } from "./firebase-config.js";

// Where to send a signed-in user, based on whether their email is the admin email.
function routeAfterLogin(user) {
    if (user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
        window.location.href = "admin.html";
    } else {
        window.location.href = "index.html";
    }
}

function isAdminEmail(email) {
    return !!email && email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

// Creates/updates a customers/{uid} Firestore doc — used so the Admin
// dashboard's Customers tab and KPI counts have real data to read.
// (Kept as "customers", not a separate "users" collection, so it stays
// compatible with the existing admin dashboard, which already reads from
// this collection.) Safe to call every login (merge:true), not just on
// register. Never stores a password — Firebase Authentication owns that.
async function upsertCustomerDoc(user, extra = {}) {
    try {
        await setDoc(doc(db, "customers", user.uid), {
            uid: user.uid,
            name: user.displayName || extra.name || "",
            email: user.email,
            emailVerified: !!user.emailVerified,
            lastLoginAt: serverTimestamp(),
            ...extra,
        }, { merge: true });
    } catch (err) {
        // Non-fatal — login/register should still succeed even if this write fails
        // (e.g. Firestore not yet enabled in the Firebase console).
        console.warn("Could not save customer profile to Firestore:", err);
    }
}

/* ============================================================
   REGISTER — creates the account, sends a verification email,
   and signs the user back out. Does NOT log them into the site.
   Returns a result object instead of alert()-ing + redirecting,
   so register.html can show the "check your email" panel.
   ============================================================ */
export async function registerUser(name, email, password) {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        await updateProfile(user, { displayName: name });
        await sendEmailVerification(user);
        await upsertCustomerDoc(user, { name, createdAt: serverTimestamp() });
        await signOut(auth);

        return { ok: true, email };
    } catch (error) {
        console.error(error);
        return { ok: false, message: getFirebaseError(error) };
    }
}

/* ============================================================
   LOGIN — email/password.
   - Admin email is exempt from the verification requirement
     (so this change can never lock out the existing admin
     account, even if it was never explicitly verified).
   - Everyone else must have emailVerified === true, checked
     from Firebase's own user object (the source of truth) —
     never from localStorage or any client-only flag.
   Returns a result object; login.html decides what UI to show.
   ============================================================ */
export async function loginUser(email, password) {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        if (!isAdminEmail(user.email) && !user.emailVerified) {
            await signOut(auth);
            return { ok: false, reason: "unverified", email: user.email };
        }

        await upsertCustomerDoc(user);
        routeAfterLogin(user);
        return { ok: true };
    } catch (error) {
        console.error(error);
        return { ok: false, reason: "error", message: getFirebaseError(error) };
    }
}

/* ============================================================
   RESEND VERIFICATION EMAIL
   Firebase only allows sendEmailVerification() on an
   authenticated user object, so this signs in temporarily,
   sends the email if still unverified, then signs back out.
   ============================================================ */
export async function resendVerificationEmail(email, password) {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        if (user.emailVerified) {
            await signOut(auth);
            return { ok: false, message: "This email is already verified — you can log in normally." };
        }

        await sendEmailVerification(user);
        await signOut(auth);
        return { ok: true };
    } catch (error) {
        console.error(error);
        return { ok: false, message: getFirebaseError(error) };
    }
}

// Google accounts are already verified by Google — the email/password
// verification requirement does not apply here, per spec.
export async function googleLogin() {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        await upsertCustomerDoc(result.user);
        routeAfterLogin(result.user);
    } catch (error) {
        console.error(error);
        alert(getFirebaseError(error));
    }
}

export async function logoutUser() {
    try {
        await signOut(auth);
        window.location.href = "login.html";
    } catch (error) {
        console.error(error);
        alert("Logout failed.");
    }
}

export async function resetPassword(email) {
    try {
        await sendPasswordResetEmail(auth, email);
        alert("Password reset email has been sent. Please check your inbox.");
    } catch (error) {
        console.error(error);
        alert(getFirebaseError(error));
    }
}

export function checkUser(callback) {
    onAuthStateChanged(auth, callback);
}

function getFirebaseError(error) {
    switch (error.code) {
        case "auth/email-already-in-use": return "This email address is already registered. Please login instead.";
        case "auth/invalid-email": return "Please enter a valid email address.";
        case "auth/weak-password": return "Password must contain at least 8 characters.";
        case "auth/invalid-credential": return "Incorrect email or password.";
        case "auth/wrong-password": return "Incorrect email or password.";
        case "auth/user-not-found": return "Account not found. Please register first.";
        case "auth/popup-closed-by-user": return "Google login window was closed.";
        case "auth/too-many-requests": return "Too many attempts — please wait a moment and try again.";
        default: return error.message || "Something went wrong.";
    }
}
