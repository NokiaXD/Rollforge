//  The Cyberpunk RED character model: pure data + pure logic, no Preact.
//  Everything the sheet and the panel display is derived here on read; nothing
//  but the raw stat values is ever stored.

export const CHAR_TYPE = "cpr-character";

// Ten Characteristics in book order (Mental · Combate · Físico).
// [key, abbreviation, full name]
export const STATS = [
  ["int", "INT", "Inteligencia"],
  ["vol", "VOL", "Voluntad"],
  ["fri", "FRI", "Frialdad"],
  ["emp", "EMP", "Empatía"],
  ["tec", "TEC", "Técnica"],
  ["ref", "REF", "Reflejos"],
  ["sue", "SUE", "Suerte"],
  ["tco", "TCO", "Tipo corporal"],
  ["des", "DES", "Destreza"],
  ["mov", "MOV", "Movimiento"],
] as const;

export const STAT_KEYS = STATS.map(([key]) => key);

export const STAT_MIN = 1;
export const STAT_START = 2;
export const STAT_MAX = 15;
// Each stat's full value is subtracted from the pool — the base 2 counts too.
// 62 leaves a character noticeably short of maxing all ten (costs 150).
export const POINT_POOL = 62;

export interface CombatState {
  hp?: number;
  headArmor?: number;
  bodyArmor?: number;
  humanity?: number;
  deathSaveFails?: number;
}

export interface CombatDerived {
  maxHp: number;
  seriouslyWounded: number;
  deathSave: number;
  maxHumanity: number;
}

/**
 * Derives maximum hit points, seriously wounded threshold, death save, and max humanity
 * from the character's characteristics according to Cyberpunk RED core rules.
 * - Max HP: 10 + 5 * ceil((TCO + VOL) / 2)
 * - Seriously Wounded: ceil(Max HP / 2)
 * - Death Save: TCO
 * - Max Humanity: EMP * 10
 */
export function derivedCombat(stats: Record<string, number> | undefined): CombatDerived {
  const tco = Math.max(STAT_MIN, stats?.["tco"] ?? STAT_MIN);
  const vol = Math.max(STAT_MIN, stats?.["vol"] ?? STAT_MIN);
  const emp = Math.max(STAT_MIN, stats?.["emp"] ?? STAT_MIN);
  const maxHp = 10 + 5 * Math.ceil((tco + vol) / 2);
  return {
    maxHp,
    seriouslyWounded: Math.ceil(maxHp / 2),
    deathSave: tco,
    maxHumanity: emp * 10,
  };
}

/**
 * Total Base for a skill check (1d10 + Base).
 * Base = Linked Statistic Value + Skill Level.
 */
export function skillBase(statValue: number | undefined, skillLevel: number | undefined): number {
  const stat = Number.isFinite(statValue) ? Math.max(0, statValue!) : 0;
  const level = Number.isFinite(skillLevel) ? Math.max(0, skillLevel!) : 0;
  return stat + level;
}

export function publishPatch(): Record<string, string> {
  return { "flags.cpr.status": "published" };
}

/** Minimum `flags.cpr` for a character that only its author (and the GM) may see. */
export const DRAFT_STATUS = "draft";

export function cprFlags(doc: { flags?: Record<string, unknown> | null } | null | undefined): {
  status?: string;
  owner?: string;
} {
  const ns = doc?.flags?.["cpr"];
  return typeof ns === "object" && ns !== null ? (ns as { status?: string; owner?: string }) : {};
}

//  Draft visibility is one predicate so the panel can never disagree with
//  itself. A published character is public; a draft belongs to its owner.
//  ponytail: client-side filter — the host prefetches every CHAR_TYPE document
//  for every client, so this hides rows in the UI, not in the wire. Move it into
//  the host's prefetch when a player must not be able to read a draft at all.
export function isDraft(doc: { flags?: Record<string, unknown> | null }): boolean {
  return cprFlags(doc).status !== "published";
}

export function canSeeDraft(
  doc: { flags?: Record<string, unknown> | null },
  userId: string,
  isGm: boolean,
): boolean {
  return !isDraft(doc) || isGm || cprFlags(doc).owner === userId;
}

/**
 * Official roles. The role ability is fixed by the role, so the wizard asks for
 * the role and shows the ability it grants — never the other way around.
 */
export const ROLES = [
  ["rockerboy", "Rockerboy", "Charismatic Impact"],
  ["solo", "Solo", "Combat Awareness"],
  ["netrunner", "Netrunner", "Interface"],
  ["tech", "Tech", "Maker"],
  ["medtech", "Medtech", "Medicine"],
  ["media", "Media", "Credibility"],
  ["exec", "Exec", "Teamwork"],
  ["lawman", "Lawman", "Backup"],
  ["fixer", "Fixer", "Operator"],
  ["nomad", "Nomad", "Moto"],
] as const;

export type ProfileEnemy = {
  who: string;
  cause: string;
  threat: string;
  future: string;
};

export type Profile = Record<string, string | ProfileEnemy[]>;

/**
 * Wizard step 1 ("¿Quién es?"): [key, label, multiline]. Enemies are NOT in
 * this list — they are a repeated block of the same four questions, rendered
 * as its own mini-list and stored under `profile.enemies`.
 * ponytail: free text everywhere except the role. The book's lifepath tables
 * (cultural origin, role lifepath) are a step of their own — swap the input for
 * a select only when the sheet actually reads that key.
 */
export const PROFILE_FIELDS: readonly (readonly [string, string, boolean])[] = [
  ["alias", "Alias", false],
  ["culturalOrigin", "Origen cultural", false],
  ["personality", "Personalidad", true],
  ["clothing", "Clothing", false],
  ["hairStyle", "Hair Style", false],
  ["values", "¿Qué valoras más?", true],
  ["feelingsAboutPeople", "¿Qué sientes por la gente?", true],
  ["valuedPerson", "Persona más valiosa", false],
  ["valuedPossession", "Posesión más valiosa", false],
  ["familyBackground", "Transfondo familiar", true],
  ["childhoodEnvironment", "Entorno de la infancia", true],
  ["familyCrisis", "Crisis familiar", true],
  ["lifeGoals", "Metas de vida", true],
  ["friends", "Amigos", true],
  ["loveAffairs", "Amores trágicos", true],
  ["housing", "Vivienda", false],
  ["rent", "Alquiler", false],
  ["lifestyle", "Estilo de vida", true],
  ["roleLifepath", "Lifepath del rol", true],
];

export const ENEMY_FIELDS: readonly (readonly [keyof ProfileEnemy, string, boolean])[] = [
  ["who", "¿Quién?", false],
  ["cause", "¿Qué lo causó?", true],
  ["threat", "¿Qué puede lanzarme?", true],
  ["future", "¿Qué va a pasar?", true],
];

export const EMPTY_ENEMY = (): ProfileEnemy => ({ who: "", cause: "", threat: "", future: "" });

// Stat groups matching the book's layout.
export const STAT_GROUPS: [string, string[]][] = [
  ["Mental",  ["int", "vol", "fri", "emp"]],
  ["Combate", ["tec", "ref"]],
  ["Fortuna", ["sue"]],
  ["Físico",  ["tco", "des", "mov"]],
];

export type RawStats = Record<string, unknown>;

export type DerivedStats = {
  stats: Record<string, number>;
  spent: number;
  left: number;
};

/**
 * Clamps raw system.stats into the ten Characteristics (in range) and
 * computes the point budget. Nothing is stored except the raw values — spent
 * and left are always derived on read.
 */
export function derived(stats: RawStats | undefined): DerivedStats {
  const clean: Record<string, number> = {};
  for (const [key] of STATS) {
    const raw = Number(stats?.[key]);
    const value = Number.isFinite(raw) ? Math.round(raw) : STAT_MIN;
    clean[key] = Math.min(STAT_MAX, Math.max(STAT_MIN, value));
  }
  const spent = STATS.reduce((total, [key]) => total + clean[key]!, 0);
  return { stats: clean, spent, left: POINT_POOL - spent };
}

// ponytail: the nine CPR skill categories in book order. The skill's
// `category` field is one of these — no string-typed free-for-all.
export const SKILL_CATEGORIES = [
  "awareness", "body", "control", "education",
  "fighting", "performance", "ranged", "social", "technique",
] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const SKILL_CATEGORY_NAMES: Record<SkillCategory, string> = {
  awareness: "Conciencia",
  body: "Corporales",
  control: "Control",
  education: "Educación",
  fighting: "Pelea",
  performance: "Interpretación",
  ranged: "Armas a Distancia",
  social: "Sociales",
  technique: "Técnicas",
};

// 8 IP to spend at character creation (Quickstart). x2 skills cost double;
// the first instance of a basic+repeatable starts at 2 for free.
export const SKILL_BASIC_START = 2;
export const SKILL_POOL = 8;
export const SKILL_MAX = 10;

export type SkillInstance = { name: string; level: number };
export type SkillValue = number | SkillInstance[];
export type Skills = Record<string, SkillValue>;
export type DerivedSkills = { skills: Skills; spent: number; left: number };

// [key, name, category, linkedStat, basic, x2, repeatable]
export const SKILLS = [
  // AWARENESS
  ["concentration", "Concentración", "awareness", "vol", true, false, false],
  ["concealReveal", "Ocultar/Revelar Objeto", "awareness", "int", false, false, false],
  ["lipReading", "Lectura de Labios", "awareness", "int", false, false, false],
  ["perception", "Percepción", "awareness", "int", true, false, false],
  ["tracking", "Rastreo", "awareness", "int", false, false, false],
  // BODY
  ["athletics", "Atletismo", "body", "des", true, false, false],
  ["contortionist", "Contorsionista", "body", "des", false, false, false],
  ["dance", "Baile", "body", "des", false, false, false],
  ["endurance", "Resistencia", "body", "vol", false, false, false],
  ["resistTorture", "Resistir Tortura/Drogas", "body", "vol", false, false, false],
  ["stealth", "Sigilo", "body", "des", true, false, false],
  // CONTROL
  ["driveLand", "Conducir Vehículo Terrestre", "control", "ref", false, false, false],
  ["pilotAir", "Pilotar Vehículo Aéreo", "control", "ref", false, true, false],
  ["pilotSea", "Pilotar Vehículo Marítimo", "control", "ref", false, false, false],
  ["riding", "Montar", "control", "ref", false, false, false],
  // EDUCATION
  ["accounting", "Contabilidad", "education", "int", false, false, false],
  ["animalHandling", "Manejo de Animales", "education", "int", false, false, false],
  ["bureaucracy", "Burocracia", "education", "int", false, false, false],
  ["business", "Negocios", "education", "int", false, false, false],
  ["composition", "Composición", "education", "int", false, false, false],
  ["criminology", "Criminología", "education", "int", false, false, false],
  ["cryptography", "Criptografía", "education", "int", false, false, false],
  ["deduction", "Deducción", "education", "int", false, false, false],
  ["education", "Educación", "education", "int", true, false, false],
  ["gamble", "Juego", "education", "int", false, false, false],
  ["language", "Idioma", "education", "int", true, false, true],
  ["librarySearch", "Búsqueda en Biblioteca", "education", "int", false, false, false],
  ["localExpert", "Experto Local", "education", "int", true, false, true],
  ["science", "Ciencia", "education", "int", false, false, true],
  ["tactics", "Táctica", "education", "int", false, false, false],
  ["wilderness", "Supervivencia", "education", "int", false, false, false],
  // FIGHTING
  ["brawling", "Pelea", "fighting", "des", true, false, false],
  ["evasion", "Evasión", "fighting", "des", true, false, false],
  ["martialArts", "Artes Marciales", "fighting", "des", false, true, false],
  ["meleeWeapon", "Arma Cuerpo a Cuerpo", "fighting", "des", false, false, false],
  // PERFORMANCE
  ["acting", "Actuación", "performance", "fri", false, false, false],
  ["playInstrument", "Tocar Instrumento", "performance", "tec", false, false, true],
  // RANGED
  ["archery", "Tiro con Arco", "ranged", "ref", false, false, false],
  ["autofire", "Disparo Automático", "ranged", "ref", false, true, false],
  ["handgun", "Pistola", "ranged", "ref", false, false, false],
  ["heavyWeapons", "Armas Pesadas", "ranged", "ref", false, true, false],
  ["shoulderArms", "Armas de Hombro", "ranged", "ref", false, false, false],
  // SOCIAL
  ["bribery", "Soborno", "social", "fri", false, false, false],
  ["conversation", "Conversación", "social", "emp", true, false, false],
  ["humanPerception", "Percepción Humana", "social", "emp", true, false, false],
  ["interrogation", "Interrogatorio", "social", "fri", false, false, false],
  ["persuasion", "Persuasión", "social", "fri", true, false, false],
  ["grooming", "Aseo Personal", "social", "fri", false, false, false],
  ["streetwise", "Callejeo", "social", "fri", false, false, false],
  ["trading", "Comercio", "social", "fri", false, false, false],
  ["wardrobe", "Vestuario y Estilo", "social", "fri", false, false, false],
  // TECHNIQUE
  ["airVehicleTech", "Tecnología de Vehículos Aéreos", "technique", "tec", false, false, false],
  ["basicTech", "Tecnología Básica", "technique", "tec", false, false, false],
  ["cybertech", "Cibernética", "technique", "tec", false, false, false],
  ["demolitions", "Demoliciones", "technique", "tec", false, true, false],
  ["electronicsSecurity", "Electrónica/Seguridad", "technique", "tec", false, true, false],
  ["firstAid", "Primeros Auxilios", "technique", "tec", true, false, false],
  ["forgery", "Falsificación", "technique", "tec", false, false, false],
  ["landVehicleTech", "Tecnología de Vehículos Terrestres", "technique", "tec", false, false, false],
  ["paintDraw", "Pintura/Dibujo/Escultura", "technique", "tec", false, false, false],
  ["paramedic", "Paramédico", "technique", "tec", false, true, false],
  ["photoFilm", "Fotografía/Cine", "technique", "tec", false, false, false],
  ["pickLock", "Forzar Cerraduras", "technique", "tec", false, false, false],
  ["pickPocket", "Carterismo", "technique", "tec", false, false, false],
  ["seaVehicleTech", "Tecnología de Vehículos Marítimos", "technique", "tec", false, false, false],
  ["weaponech", "Tecnología de Armas", "technique", "tec", false, false, false],
] as const satisfies readonly (readonly [string, string, SkillCategory, string, boolean, boolean, boolean])[];

export type SkillDef = (typeof SKILLS)[number];

// ponytail: only the two basic+repeatable skills get a seeded instance; the
// other two are empty so the user picks what they want. Hardcoded map beats
// adding an 8th field to the tuple just for two defaults.
const REPEATABLE_DEFAULT_NAME: Record<string, string> = {
  language: "Streetslang",
  localExpert: "Tu hogar",
};

export function initialSkills(): Skills {
  const out: Record<string, SkillValue> = {};
  for (const [key, , , , basic, , repeatable] of SKILLS) {
    if (!repeatable) {
      out[key] = basic ? SKILL_BASIC_START : 0;
    } else if (basic) {
      out[key] = [{ name: REPEATABLE_DEFAULT_NAME[key] ?? "", level: SKILL_BASIC_START }];
    } else {
      out[key] = [];
    }
  }
  return out;
}

export function derivedSkills(skills: Skills | undefined): DerivedSkills {
  const clean: Record<string, SkillValue> = {};
  let spent = 0;
  for (const [key, , , , basic, x2, repeatable] of SKILLS) {
    const mult = x2 ? 2 : 1;
    const candidate = skills?.[key];
    if (repeatable) {
      const list = Array.isArray(candidate) ? candidate : [];
      const instances: SkillInstance[] = list.map((entry) => {
        const v = Number(entry?.level);
        const level = Number.isFinite(v) ? Math.min(SKILL_MAX, Math.max(0, Math.round(v))) : 0;
        return { name: typeof entry?.name === "string" ? entry.name : "", level };
      });
      clean[key] = instances;
      instances.forEach((inst, i) => {
        // Only the first instance of a basic+repeatable inherits the free
        // baseline. Every other instance (and non-basic) starts at 0.
        const baseline = i === 0 && basic ? SKILL_BASIC_START : 0;
        spent += Math.max(0, inst.level - baseline) * mult;
      });
    } else {
      const v = typeof candidate === "number" ? candidate : Number(candidate);
      const level = Number.isFinite(v)
        ? Math.min(SKILL_MAX, Math.max(0, Math.round(v)))
        : (basic ? SKILL_BASIC_START : 0);
      clean[key] = level;
      const baseline = basic ? SKILL_BASIC_START : 0;
      spent += Math.max(0, level - baseline) * mult;
    }
  }
  return { skills: clean, spent, left: SKILL_POOL - spent };
}