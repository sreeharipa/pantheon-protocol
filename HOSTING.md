# Hosting Pantheon Protocol on Firebase (free / Spark plan)

This walks you from zero to a live URL. Everything here stays on the **free Spark plan** —
no credit card. (Hero images are stored in Firestore, so we don't use paid Cloud Storage.)

You already have the Firebase CLI installed and are logged in as
`sreeharipa1999@gmail.com`. Commands below are run from the `pantheon_game/` folder.

---

## 1. Create a Firebase project

**Option A — Console (easiest):** go to <https://console.firebase.google.com> → *Add
project* → name it `Pantheon Protocol`. You can skip Google Analytics.

**Option B — CLI:**
```bash
firebase projects:create pantheon-protocol --display-name "Pantheon Protocol"
```
(Project IDs are globally unique and permanent — if `pantheon-protocol` is taken, try
`pantheon-protocol-pa` or similar.)

## 2. Register a Web app & grab the config

In the Console: *Project settings* (gear icon) → *Your apps* → **Web** (`</>`) → register
the app (nickname "web"). Copy the `firebaseConfig` values into **`.env.local`**:

```
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=pantheon-protocol.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=pantheon-protocol
VITE_FIREBASE_STORAGE_BUCKET=pantheon-protocol.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
VITE_FIREBASE_APP_ID=1:1234567890:web:abc123
```
(These are public identifiers, not secrets — access is controlled by Security Rules.)

## 3. Enable Google Sign-In

Console → *Authentication* → *Get started* → *Sign-in method* → enable **Google** → pick a
support email → Save.

## 4. Create the Firestore database

Console → *Firestore Database* → *Create database* → **Start in production mode** (our
`firestore.rules` already secures it) → choose a location (e.g. `asia-south1` for India) →
Enable.

## 5. Link the project to this folder

```bash
firebase use --add        # pick your project, give it the alias "default"
```
This creates `.firebaserc`.

## 6. Deploy the security rules

```bash
firebase deploy --only firestore:rules
```

## 7. Build and deploy the app

```bash
npm run build
firebase deploy --only hosting
```

Your game is now live at `https://<project-id>.web.app`. 🎉

## 8. First-run: become admin & seed heroes

1. Open the live URL, sign in with `sreeharipa1999@gmail.com` (auto-granted admin).
2. Home → **Admin / Game-Master** → **Heroes** tab → **Seed 31 heroes**.
3. Tap any hero to edit stats or upload its 6 per-level images.

---

## Redeploying after changes
```bash
npm run build && firebase deploy --only hosting
# rules changed too? add: firebase deploy --only firestore:rules
```

## Notes
- **Authorized domains:** `*.web.app`, `*.firebaseapp.com`, and `localhost` are
  auto-authorized for Google sign-in. If you later add a custom domain, add it under
  *Authentication → Settings → Authorized domains*.
- **Plan:** the project is on **Blaze** so hero art can use **Cloud Storage** (1024px,
  CDN-served). The Storage bucket is in a *no-cost* US region (US-EAST1), and Firestore /
  Auth / Hosting stay within the free tier — so real cost for 4–5 players is ~$0 (a budget
  alert is set as a safety net). Cloud Functions (server-authoritative anti-cheat) is still
  deferred by design; the game logic is written as portable modules so adding Functions
  later is a small change, not a rewrite.
- **Storage rules:** `storage.rules` (admin-only writes, public reads). Deploy with
  `firebase deploy --only storage`.
