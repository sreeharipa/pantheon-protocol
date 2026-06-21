import type { Hero } from '../domain/types';

// The full hero catalog from the PRD (7.6) — all 31 heroes across the three factions.
// Stats are transcribed exactly as written in the PRD; the admin can edit any of these
// (and upload the 6 per-level images) in-app. `status: 'active'` means it's in rotation
// for new matches. Images are intentionally empty — added via Admin Mode.

type SeedHero = Omit<Hero, 'images' | 'createdAt' | 'updatedAt'>;

const def = (
  heroId: string,
  name: string,
  faction: Hero['faction'],
  gender: Hero['gender'],
  origin: string,
  attack: number,
  defense: number,
  resilience: number,
): SeedHero => ({
  heroId,
  name,
  faction,
  gender,
  origin,
  baseStats: { attack, defense, resilience },
  // Default draft floor = stat sum (admin-tunable per hero).
  basePrice: attack + defense + resilience,
  status: 'active',
});

export const SEED_HEROES: SeedHero[] = [
  // ⚔️ Gods (Attack-primary)
  def('hero_zeus', 'Zeus', 'Gods', 'M', 'Greek', 48, 12, 10),
  def('hero_odin', 'Odin', 'Gods', 'M', 'Norse', 45, 14, 12),
  def('hero_ra', 'Ra', 'Gods', 'M', 'Egyptian', 50, 8, 8),
  def('hero_ares', 'Ares', 'Gods', 'M', 'Greek', 47, 10, 8),
  def('hero_tyr', 'Tyr', 'Gods', 'M', 'Norse', 38, 18, 14),
  def('hero_sekhmet', 'Sekhmet', 'Gods', 'F', 'Egyptian', 49, 8, 8),
  def('hero_morrigan', 'Morrigan', 'Gods', 'F', 'Celtic', 42, 12, 12),
  def('hero_ixchel', 'Ix Chel', 'Gods', 'F', 'Mayan', 35, 16, 16),
  def('hero_freya', 'Freya', 'Gods', 'F', 'Norse', 40, 14, 14),
  def('hero_athena', 'Athena', 'Gods', 'F', 'Greek', 42, 38, 32),
  def('hero_aphrodite', 'Aphrodite', 'Gods', 'F', 'Greek', 44, 8, 8),

  // 🛡️ Titans (Defense-primary)
  def('hero_atlas', 'Atlas', 'Titans', 'M', 'Greek', 10, 48, 14),
  def('hero_kronos', 'Kronos', 'Titans', 'M', 'Greek', 16, 45, 14),
  def('hero_jormungandr', 'Jörmungandr', 'Titans', 'M', 'Norse', 12, 42, 16),
  def('hero_sobek', 'Sobek', 'Titans', 'M', 'Egyptian', 18, 40, 10),
  def('hero_typhon', 'Typhon', 'Titans', 'M', 'Greek', 20, 48, 10),
  def('hero_gaia', 'Gaia', 'Titans', 'F', 'Greek', 20, 50, 42),
  def('hero_rhea', 'Rhea', 'Titans', 'F', 'Greek', 10, 44, 14),
  def('hero_nut', 'Nüt', 'Titans', 'F', 'Egyptian', 12, 42, 12),
  def('hero_skadi', 'Skadi', 'Titans', 'F', 'Norse', 16, 38, 14),
  def('hero_aditi', 'Aditi', 'Titans', 'F', 'Hindu', 8, 44, 16),

  // 💀 Demigods (Resilience-primary)
  def('hero_hercules', 'Hercules', 'Demigods', 'M', 'Greek', 22, 18, 42),
  def('hero_achilles', 'Achilles', 'Demigods', 'M', 'Greek', 26, 14, 45),
  def('hero_gilgamesh', 'Gilgamesh', 'Demigods', 'M', 'Mesopotamian', 20, 20, 40),
  def('hero_maui', 'Maui', 'Demigods', 'M', 'Polynesian', 16, 20, 36),
  def('hero_cuchulainn', 'Cu Chulainn', 'Demigods', 'M', 'Celtic', 24, 14, 44),
  def('hero_atalanta', 'Atalanta', 'Demigods', 'F', 'Greek', 22, 16, 38),
  def('hero_scathach', 'Scáthach', 'Demigods', 'F', 'Celtic', 32, 30, 50),
  def('hero_izanami', 'Izanami', 'Demigods', 'F', 'Japanese', 14, 20, 44),
  def('hero_arachne', 'Arachne', 'Demigods', 'F', 'Greek', 12, 18, 36),
  def('hero_pele', 'Pele', 'Demigods', 'F', 'Hawaiian', 26, 12, 40),
];

export const SEED_HERO_COUNT = SEED_HEROES.length; // 31
