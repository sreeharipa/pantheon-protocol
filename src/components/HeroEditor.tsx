import { useEffect, useRef, useState } from 'react';
import type { Faction, Hero, HeroImages, HeroLevelKey } from '../domain/types';
import { FACTIONS, HERO_LEVEL_KEYS } from '../domain/types';
import { rarityTier, statSum } from '../domain/stats';
import { subscribeHeroImages, uploadHeroImage, upsertHero } from '../firebase/catalog';

interface Props {
  hero: Hero | null;     // null = creating a new hero
  onClose: () => void;
}

function slugify(name: string): string {
  return (
    'hero_' +
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '')
  );
}

const BLANK: Hero = {
  heroId: '',
  name: '',
  faction: 'Gods',
  gender: 'M',
  origin: '',
  baseStats: { attack: 10, defense: 10, resilience: 10 },
  status: 'active',
};

export default function HeroEditor({ hero, onClose }: Props) {
  const isNew = hero === null;
  const [draft, setDraft] = useState<Hero>(hero ?? BLANK);
  const [images, setImages] = useState<HeroImages>({});
  const [savingImg, setSavingImg] = useState<HeroLevelKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // For a new hero, derive the id from the name as the user types.
  const heroId = isNew ? slugify(draft.name) : draft.heroId;

  useEffect(() => {
    if (!heroId) return;
    return subscribeHeroImages(heroId, setImages);
  }, [heroId]);

  function set<K extends keyof Hero>(key: K, value: Hero[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }
  function setStat(key: keyof Hero['baseStats'], value: number) {
    setDraft((d) => ({ ...d, baseStats: { ...d.baseStats, [key]: value } }));
  }

  async function handleImage(level: HeroLevelKey, file: File | undefined) {
    if (!file) return;
    if (!heroId) {
      setErr('Enter a name first so the hero has an id.');
      return;
    }
    setSavingImg(level);
    setErr(null);
    try {
      await uploadHeroImage(heroId, level, file);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Image upload failed.');
    } finally {
      setSavingImg(null);
    }
  }

  async function save() {
    if (!draft.name.trim()) {
      setErr('Name is required.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await upsertHero({ ...draft, heroId });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  const sum = statSum(draft.baseStats);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="between" style={{ marginBottom: 14 }}>
          <div className="h2">{isNew ? 'New Hero' : draft.name}</div>
          <button className="btn ghost sm" onClick={onClose}>Close</button>
        </div>

        <div className="stack" style={{ gap: 12 }}>
          <div className="field">
            <label>Name</label>
            <input
              className="input"
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Achilles"
            />
            {isNew && heroId && <div className="faint" style={{ fontSize: 11 }}>id: {heroId}</div>}
          </div>

          <div className="grid-2">
            <div className="field">
              <label>Faction</label>
              <select className="input" value={draft.faction}
                onChange={(e) => set('faction', e.target.value as Faction)}>
                {FACTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Gender</label>
              <select className="input" value={draft.gender}
                onChange={(e) => set('gender', e.target.value as Hero['gender'])}>
                <option value="M">M</option>
                <option value="F">F</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label>Origin</label>
            <input className="input" value={draft.origin}
              onChange={(e) => set('origin', e.target.value)} placeholder="e.g. Greek" />
          </div>

          <div className="grid-3">
            <StatInput label="⚔️ Attack" value={draft.baseStats.attack} onChange={(v) => setStat('attack', v)} />
            <StatInput label="🛡️ Defense" value={draft.baseStats.defense} onChange={(v) => setStat('defense', v)} />
            <StatInput label="💀 Resil." value={draft.baseStats.resilience} onChange={(v) => setStat('resilience', v)} />
          </div>
          <div className="between">
            <span className="tag">Sum {sum}</span>
            <span className="tag">{rarityTier(draft)}</span>
          </div>

          <div className="field">
            <label>Draft base price (floor — bids stack on top)</label>
            <input
              className="input"
              type="number"
              min={0}
              value={draft.basePrice ?? sum}
              onChange={(e) => set('basePrice', Math.max(0, Number(e.target.value) || 0))}
            />
            <div className="faint" style={{ fontSize: 11 }}>Defaults to the stat sum ({sum}) unless you set it.</div>
          </div>

          <div className="field" style={{ marginTop: 4 }}>
            <label>Images — one per level (auto-downscaled)</label>
            <div className="img-slots">
              {HERO_LEVEL_KEYS.map((lvl, i) => (
                <ImageSlot
                  key={lvl}
                  level={i}
                  src={images[lvl]}
                  busy={savingImg === lvl}
                  onPick={(file) => handleImage(lvl, file)}
                />
              ))}
            </div>
          </div>

          {err && <div className="notice warn">{err}</div>}

          <button className="btn" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : isNew ? 'Create hero' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatInput({ label, value, onChange }: {
  label: string; value: number; onChange: (v: number) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        className="input" type="number" min={0} max={50} value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      />
    </div>
  );
}

function ImageSlot({ level, src, busy, onPick }: {
  level: number; src?: string; busy: boolean; onPick: (file: File | undefined) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="img-slot" onClick={() => ref.current?.click()}>
      <span className="lvl">L{level}</span>
      {busy ? <div className="spinner" /> : src ? <img src={src} alt={`Level ${level}`} /> : <span>+ upload</span>}
      <input
        ref={ref} type="file" accept="image/*" hidden
        onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }}
      />
    </div>
  );
}
