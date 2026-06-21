import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, listAll, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from './app';
import { SEED_HEROES } from '../data/heroes';
import { fileToDownscaledBlob } from '../utils/image';
import type { Hero, HeroImages, HeroLevelKey } from '../domain/types';

const HEROES = 'heroes';
const HERO_IMAGES = 'heroImages';

// ---- Heroes catalog ----

/** Live subscription to the full hero catalog (admin + later match-start snapshot). */
export function subscribeHeroes(cb: (heroes: Hero[]) => void): () => void {
  const q = collection(db(), HEROES);
  return onSnapshot(q, (snap) => {
    const heroes = snap.docs.map((d) => d.data() as Hero);
    heroes.sort((a, b) => a.name.localeCompare(b.name));
    cb(heroes);
  });
}

/**
 * Seed any missing catalog heroes from SEED_HEROES. Idempotent — existing heroes
 * (by id) are left untouched so admin edits are never clobbered. Returns how many
 * were newly written.
 */
export async function seedHeroes(): Promise<number> {
  const existing = await getDocs(collection(db(), HEROES));
  const present = new Set(existing.docs.map((d) => d.id));
  const missing = SEED_HEROES.filter((h) => !present.has(h.heroId));
  if (missing.length === 0) return 0;

  const batch = writeBatch(db());
  for (const h of missing) {
    batch.set(doc(db(), HEROES, h.heroId), {
      ...h,
      images: {},
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
  return missing.length;
}

/** All non-archived heroes — the pool snapshotted into a new match (data_model §8). */
export async function getActiveHeroes(): Promise<Hero[]> {
  const snap = await getDocs(query(collection(db(), HEROES), where('status', '==', 'active')));
  return snap.docs.map((d) => d.data() as Hero);
}

export async function upsertHero(hero: Hero): Promise<void> {
  const { ...data } = hero;
  await setDoc(
    doc(db(), HEROES, hero.heroId),
    { ...data, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function setHeroStatus(heroId: string, status: Hero['status']): Promise<void> {
  await updateDoc(doc(db(), HEROES, heroId), { status, updatedAt: serverTimestamp() });
}

export async function deleteHero(heroId: string): Promise<void> {
  await deleteDoc(doc(db(), HEROES, heroId));
  await deleteDoc(doc(db(), HERO_IMAGES, heroId)).catch(() => undefined);
  // Best-effort cleanup of this hero's Storage folder.
  try {
    const folder = ref(storage(), `${HEROES}/${heroId}`);
    const listed = await listAll(folder);
    await Promise.all(listed.items.map((item) => deleteObject(item).catch(() => undefined)));
  } catch {
    // ignore — nothing to clean or Storage not reachable
  }
}

// ---- Hero images (Cloud Storage) ----
// Each level's art is downscaled to WebP and stored in Cloud Storage at
// heroes/{heroId}/{level}.webp; its download URL is recorded in /heroImages/{heroId}.
// Keeping the URL map in a separate doc keeps the lean /heroes docs cheap to read for
// lists and match snapshots, while images load on demand (and are CDN-cached).

export function subscribeHeroImages(
  heroId: string,
  cb: (images: HeroImages) => void,
): () => void {
  return onSnapshot(doc(db(), HERO_IMAGES, heroId), (snap) => {
    cb((snap.data() as HeroImages) ?? {});
  });
}

/**
 * Downscale and upload one level's image to Cloud Storage, then record its URL.
 * Returns the public download URL.
 */
export async function uploadHeroImage(
  heroId: string,
  level: HeroLevelKey,
  file: File,
): Promise<string> {
  const blob = await fileToDownscaledBlob(file);
  const objectRef = ref(storage(), `${HEROES}/${heroId}/${level}.webp`);
  await uploadBytes(objectRef, blob, { contentType: 'image/webp' });
  const url = await getDownloadURL(objectRef);
  await setDoc(doc(db(), HERO_IMAGES, heroId), { [level]: url }, { merge: true });
  return url;
}
