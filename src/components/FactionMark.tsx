import type { Faction } from '../domain/types';

// Geometric faction marks from the wireframe: ▲ Gods, ■ Titans, ◆ Demigods.
export const FACTION_GLYPH: Record<Faction, string> = {
  Gods: '▲',
  Titans: '■',
  Demigods: '◆',
};

export const FACTION_CLASS: Record<Faction, string> = {
  Gods: 'gods',
  Titans: 'titans',
  Demigods: 'demigods',
};

export function FactionMark({ faction, className = '' }: { faction: Faction; className?: string }) {
  return (
    <span className={`mark ${FACTION_CLASS[faction]} ${className}`} aria-label={faction}>
      {FACTION_GLYPH[faction]}
    </span>
  );
}
