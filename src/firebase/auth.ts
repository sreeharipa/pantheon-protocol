import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from './app';

// Bootstrap admin list. The very first admin can't be granted via the in-app admin
// panel (chicken-and-egg), so admin status is seeded from this allow-list when the
// user profile is first created. The same email is mirrored in firestore.rules so the
// security layer — not just the UI — enforces admin-only writes. Add more admins later
// from the Admin panel by flipping `isAdmin` on their /users doc.
export const ADMIN_EMAILS = ['sreeharipa1999@gmail.com'];

export interface UserProfile {
  userId: string;
  displayName: string;
  email: string;
  photoURL: string | null;
  isAdmin: boolean;
  createdAt?: unknown;
}

const provider = new GoogleAuthProvider();

export function signInWithGoogle() {
  return signInWithPopup(auth(), provider);
}

export function logout() {
  return signOut(auth());
}

export function watchAuth(cb: (user: User | null) => void) {
  return onAuthStateChanged(auth(), cb);
}

/**
 * Ensure a /users/{uid} profile doc exists, creating it on first sign-in.
 * Returns the profile. Admin status is granted from ADMIN_EMAILS on creation.
 */
export async function ensureUserProfile(user: User): Promise<UserProfile> {
  const ref = doc(db(), 'users', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return snap.data() as UserProfile;
  }
  const profile: UserProfile = {
    userId: user.uid,
    displayName: user.displayName ?? 'Player',
    email: user.email ?? '',
    photoURL: user.photoURL ?? null,
    isAdmin: ADMIN_EMAILS.includes((user.email ?? '').toLowerCase()),
  };
  await setDoc(ref, { ...profile, createdAt: serverTimestamp() });
  return profile;
}
