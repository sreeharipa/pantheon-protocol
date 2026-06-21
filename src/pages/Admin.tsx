import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './admin.css';
import type { Faction, Hero } from '../domain/types';
import { FACTIONS } from '../domain/types';
import { rarityTier } from '../domain/stats';
import {
  deleteHero,
  seedHeroes,
  setHeroStatus,
  subscribeHeroes,
  subscribeHeroImages,
} from '../firebase/catalog';
import { FactionMark, FACTION_GLYPH } from '../components/FactionMark';
import HeroEditor from '../components/HeroEditor';
import { SEED_HERO_COUNT } from '../data/heroes';

type Tab = 'heroes' | 'artifacts' | 'config';

export default function Admin() {
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('heroes');
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Hero | null | undefined>(undefined); // undefined = closed, null = new
  const [seeding, setSeeding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    return subscribeHeroes((h) => {
      setHeroes(h);
      setLoading(false);
    });
  }, []);

  const byFaction = useMemo(() => {
    const map: Record<Faction, Hero[]> = { Gods: [], Titans: [], Demigods: [] };
    for (const h of heroes) map[h.faction]?.push(h);
    return map;
  }, [heroes]);

  async function handleSeed() {
    setSeeding(true);
    setMsg(null);
    try {
      const added = await seedHeroes();
      setMsg(added === 0 ? 'Catalog already seeded — nothing to add.' : `Seeded ${added} heroes.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Seeding failed.');
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="app-frame">
      <div className="admin-header">
        <div className="between">
          <button className="btn ghost sm" onClick={() => nav('/')}>← Home</button>
          <div className="h2">Game-Master</div>
          <div style={{ width: 60 }} />
        </div>
        <div className="tabs">
          <div className={`tab ${tab === 'heroes' ? 'active' : ''}`} onClick={() => setTab('heroes')}>Heroes</div>
          <div className={`tab ${tab === 'artifacts' ? 'active' : ''}`} onClick={() => setTab('artifacts')}>Artifacts</div>
          <div className={`tab ${tab === 'config' ? 'active' : ''}`} onClick={() => setTab('config')}>Balance</div>
        </div>
      </div>

      <div className="screen" style={{ paddingTop: 14 }}>
        {tab === 'heroes' && (
          <>
            <div className="between" style={{ marginBottom: 4 }}>
              <div className="faint" style={{ fontSize: 13 }}>{heroes.length} heroes in catalog</div>
              <button className="btn sm" onClick={() => setEditing(null)}>+ Add</button>
            </div>

            {msg && <div className="notice" style={{ marginBottom: 8 }}>{msg}</div>}

            {loading ? (
              <div className="center-screen"><div className="spinner" /></div>
            ) : heroes.length === 0 ? (
              <div className="card" style={{ padding: 18, marginTop: 8 }}>
                <div className="stack" style={{ gap: 10 }}>
                  <div className="h2">Catalog is empty</div>
                  <div className="muted" style={{ fontSize: 14 }}>
                    Seed the {SEED_HERO_COUNT} heroes from the PRD to get started. This is
                    idempotent — it only adds heroes that are missing.
                  </div>
                  <button className="btn" onClick={handleSeed} disabled={seeding}>
                    {seeding ? 'Seeding…' : `Seed ${SEED_HERO_COUNT} heroes`}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {FACTIONS.map((f) => (
                  <div key={f}>
                    <div className="faction-head">
                      <FactionMark faction={f} /> {f} · {byFaction[f].length}
                    </div>
                    {byFaction[f].map((h) => (
                      <HeroRow key={h.heroId} hero={h} onEdit={() => setEditing(h)} />
                    ))}
                  </div>
                ))}
                <button className="btn ghost" style={{ marginTop: 14 }} onClick={handleSeed} disabled={seeding}>
                  {seeding ? 'Checking…' : 'Re-run seed (adds any missing)'}
                </button>
              </>
            )}
          </>
        )}

        {tab === 'artifacts' && (
          <div className="notice" style={{ marginTop: 10 }}>
            Artifact management arrives with the Duel milestone. The data model and balance
            defaults are already in place.
          </div>
        )}
        {tab === 'config' && (
          <div className="notice" style={{ marginTop: 10 }}>
            Balance-parameter editing (starting budget, bid increments, synergy, artifact
            supply & costs) arrives next. Defaults live in <code>src/domain/config.ts</code>.
          </div>
        )}
      </div>

      {editing !== undefined && (
        <HeroEditorWithActions
          hero={editing}
          onClose={() => setEditing(undefined)}
          onArchive={(h) => setHeroStatus(h.heroId, h.status === 'archived' ? 'active' : 'archived')}
          onDelete={(h) => deleteHero(h.heroId)}
        />
      )}
    </div>
  );
}

function HeroEditorWithActions({
  hero, onClose, onArchive, onDelete,
}: {
  hero: Hero | null;
  onClose: () => void;
  onArchive: (h: Hero) => void;
  onDelete: (h: Hero) => void;
}) {
  // Archive/delete only apply to existing heroes; render them above the editor form.
  return (
    <>
      {hero && (
        <div className="modal-backdrop" style={{ alignItems: 'flex-start', pointerEvents: 'none' }}>
          <div className="modal" style={{ borderRadius: 18, margin: '8px 8px 0', pointerEvents: 'auto', padding: '10px 12px', display: 'flex', gap: 8 }}>
            <button className="btn ghost sm" onClick={() => { onArchive(hero); onClose(); }}>
              {hero.status === 'archived' ? 'Restore' : 'Archive'}
            </button>
            <button className="btn danger sm" onClick={() => {
              if (confirm(`Permanently delete ${hero.name}? This cannot be undone.`)) { onDelete(hero); onClose(); }
            }}>Delete</button>
          </div>
        </div>
      )}
      <HeroEditor hero={hero} onClose={onClose} />
    </>
  );
}

function HeroRow({ hero, onEdit }: { hero: Hero; onEdit: () => void }) {
  const [thumb, setThumb] = useState<string | undefined>();
  useEffect(() => subscribeHeroImages(hero.heroId, (imgs) => setThumb(imgs.level0)), [hero.heroId]);
  const s = hero.baseStats;
  return (
    <div className={`hero-row ${hero.status === 'archived' ? 'archived' : ''}`} onClick={onEdit}>
      {thumb
        ? <img className="hero-thumb" src={thumb} alt={hero.name} />
        : <div className="hero-thumb">{FACTION_GLYPH[hero.faction]}</div>}
      <div className="grow stack" style={{ gap: 3 }}>
        <div className="row" style={{ gap: 7 }}>
          <b style={{ fontSize: 15 }}>{hero.name}</b>
          {hero.status === 'archived' && <span className="tag">Archived</span>}
        </div>
        <div className="statline">
          <span><b>{s.attack}</b> atk</span>
          <span><b>{s.defense}</b> def</span>
          <span><b>{s.resilience}</b> res</span>
          <span className="faint">{rarityTier(hero)}</span>
        </div>
      </div>
      <span className="faint" style={{ fontSize: 18 }}>→</span>
    </div>
  );
}
