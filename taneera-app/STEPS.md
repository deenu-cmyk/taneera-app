# Taneera's App: GitHub + Deployment Steps

A step-by-step guide to put this project on GitHub and make it live.
The site is plain static HTML/JS using Firebase, so there is no build step.

---

## Step 1: Install Git and create a GitHub account

- Download Git: https://git-scm.com/downloads
- Sign up: https://github.com

Check Git is installed:

```bash
git --version
```

## Step 2: Tell Git who you are (one time only)

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

## Step 3: Open a terminal inside the project folder

- **Windows:** open the project folder, click the address bar, type `cmd`, press Enter.
- **Mac:** open Terminal, type `cd ` (with a space), drag the folder into the window, press Enter.
- **VS Code:** File -> Open Folder, then Terminal -> New Terminal.

Check you are in the right place. You should see `index.html`, `admin.js`, `firebase.json`:

```bash
dir     # Windows
ls      # Mac / Linux
```

## Step 4: Create an empty repository on GitHub

1. Go to https://github.com/new
2. Repository name: `taneera-app`
3. Choose **Private** (recommended).
4. Leave "Add README", ".gitignore" and "license" **unchecked**.
5. Click **Create repository**.

## Step 5: Push the code

Replace `YOUR-USERNAME` with your GitHub username. Run these one at a time:

```bash
git init
git add .
git commit -m "Initial commit: Taneera's marketplace"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/taneera-app.git
git push -u origin main
```

If the terminal asks for a password, paste a **Personal Access Token**
(GitHub -> Settings -> Developer settings -> Personal access tokens).
Your normal GitHub password will not work.

## Step 6: Check it on GitHub

Refresh the repository page. All files should be there, including
`index.html`, `admin.js` and the `assets` folder.

## Step 7: Deploy the website

### Option A: Firebase Hosting (recommended)

`firebase.json` is already set up.

```bash
npm install -g firebase-tools
firebase login
firebase deploy
```

You get a live URL like `https://artisan-market-b4da3.web.app`.
This also deploys the Firestore security rules.

### Option B: GitHub Pages

1. Repo -> Settings -> Pages
2. Source: **Deploy from branch** -> `main` / `(root)` -> Save
3. Your site: `https://YOUR-USERNAME.github.io/taneera-app/`

Free GitHub Pages needs a **public** repo.

If you use GitHub Pages, also add the domain to Firebase or login will fail:
Firebase Console -> Authentication -> Settings -> **Authorized domains**
-> Add `YOUR-USERNAME.github.io`

## Step 8: Fill in the EmailJS keys

Open `emailjs-config.js` and replace the placeholders with your real values:

```js
SERVICE_ID: "YOUR_EMAILJS_SERVICE_ID",
PUBLIC_KEY: "YOUR_EMAILJS_PUBLIC_KEY",
```

Find them in the EmailJS dashboard. The public key is safe to commit.
Never put the EmailJS **private** key in this project.

## Step 9: Deploy the Firestore rules

Without this, orders and product writes can fail or be insecure:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

## Step 10: Create the admin account

1. Open `register.html` on your live site.
2. Sign up with the admin email set in `firebase-config.js` (`ADMIN_EMAIL`).
3. Use a **strong, unique password**. Do not write it in any file in this repo.

## Step 11: Push changes later

After editing any file:

```bash
git add .
git commit -m "Describe what you changed"
git push
```

Then run `firebase deploy` again if you host on Firebase.

---

## Security checklist

- [ ] Repo is **Private** (or contains no passwords)
- [ ] Admin password is strong and not stored in any file
- [ ] `firestore.rules` deployed
- [ ] EmailJS private key is not in the code
- [ ] Your domain is in Firebase Authorized domains (if using GitHub Pages)

## Common problems

| Problem | Fix |
|---|---|
| `git: command not found` | Install Git (Step 1) and reopen the terminal |
| `remote origin already exists` | Run `git remote set-url origin https://github.com/YOUR-USERNAME/taneera-app.git` |
| Push asks for password and fails | Use a Personal Access Token, not your password |
| "Missing or insufficient permissions" | Deploy rules: `firebase deploy --only firestore:rules` |
| Login fails on GitHub Pages | Add `YOUR-USERNAME.github.io` to Firebase Authorized domains |
