import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

// Firebase web config comes from environment variables (Vite exposes VITE_* to the
// client). These values are NOT secret — they identify the project and are safe to
// ship in the bundle; access is gated by Firestore Security Rules, not by hiding keys.
// Copy .env.example to .env.local and fill in your project's values.

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let app: FirebaseApp | undefined;
let authInstance: Auth | undefined;
let dbInstance: Firestore | undefined;
let storageInstance: FirebaseStorage | undefined;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  authInstance = getAuth(app);
  dbInstance = getFirestore(app);
  storageInstance = getStorage(app);
}

/** Throws a clear error if accessed before .env is configured. */
function require<T>(value: T | undefined, name: string): T {
  if (!value) {
    throw new Error(
      `Firebase is not configured (${name}). Copy .env.example to .env.local and fill in your project's web config.`,
    );
  }
  return value;
}

export const auth = () => require(authInstance, 'auth');
export const db = () => require(dbInstance, 'db');
export const storage = () => require(storageInstance, 'storage');
export { app };
