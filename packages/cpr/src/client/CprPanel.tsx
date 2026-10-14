//  CPR sidebar panel: campaign roster + the Night City archetype compendium.

import type { JSX } from "preact";
import type { ClientContextMenuItem } from "@rollforge/extension-api";

import { ARCHETYPES, type Archetype } from "./archetypes";
import { BudgetBar, StatTile } from "./CharacterSheet";
import { api, h, useEffect, useMemo, useRef, useState } from "./host";
import {
  CHAR_TYPE,
  DRAFT_STATUS,
  EMPTY_ENEMY,
  ENEMY_FIELDS,
  POINT_POOL,
  PROFILE_FIELDS,
  ROLES,
  SKILL_CATEGORIES,
  SKILL_CATEGORY_NAMES,
  SKILL_POOL,
  SKILLS,
  STATS,
  STAT_GROUPS,
  STAT_START,
  canSeeDraft,
  cprFlags,
  derived,
  derivedCombat,
  derivedSkills,
  initialSkills,
  isDraft,
  publishPatch,
  skillBase,
  type CombatDerived,
  type Profile,
  type ProfileEnemy,
  type RawStats,
  type SkillDef,
  type SkillInstance,
  type SkillValue,
  type Skills,
} from "./rules";

interface CprDoc {
  id: string;
  name: string;
  flags?: Record<string, unknown>;
  ownership?: Record<string, string>;
  system?: { stats?: RawStats; skills?: Skills };
}

/**
 * Right-click on the row, same as the core ScenesView rows: no kebab button.
 * ponytail: the affordance is invisible until used — if the panel ever needs a
 * discoverable entry point, a single hint line beats a button per row.
 */
function RowMenu({
  items,
  children,
}: {
  items: ClientContextMenuItem[];
  children: JSX.Element;
}) {
  return (
    <div
      class="cpr-flex cpr-items-center cpr-gap-1"
      onContextMenu={(e) => {
        e.preventDefault();
        api.ui.openContextMenu({ x: e.clientX, y: e.clientY }, items);
      }}
    >
      {children}
    </div>
  );
}

function CharacterRow({
  doc,
  onOpen,
  onPublish,
}: {
  doc: CprDoc;
  onOpen: () => void;
  onPublish?: (() => void) | undefined;
}) {
  const d = derived(doc.system?.stats);
  const draft = isDraft(doc);
  const items: ClientContextMenuItem[] = [
    { label: "Abrir ficha", onClick: onOpen },
  ];
  if (draft) {
    items.push({
      label: "Publicar",
      onClick: () => onPublish?.(),
      disabled: d.left > 0 || !onPublish,
      // exactOptionalPropertyTypes: no `hint: undefined`, omit the key.
      ...(d.left > 0 ? { hint: `${d.left} pts sin repartir` } : {}),
    });
  }
  return (
    <RowMenu items={items}>
      <button
        type="button"
        onClick={onOpen}
        class="cpr-character-row"
      >
        <div class="cpr-min-w-0">
          <p class="cpr-truncate cpr-font-medium cpr-text-white">{doc.name}</p>
          <p class="cpr-font-mono cpr-text-nano cpr-text-muted">
            REF {d.stats["ref"]} · MOV {d.stats["mov"]} · {d.left} pts
          </p>
        </div>
        {draft && (
          <span class="cpr-shrink-0 cpr-badge cpr-badge-amber">
            borrador
          </span>
        )}
      </button>
    </RowMenu>
  );
}

function Block({
  title,
  docs,
  onOpen,
  onPublish,
}: {
  title: string;
  docs: CprDoc[];
  onOpen: (id: string) => void;
  onPublish?: ((id: string) => void) | undefined;
}) {
  return (
    <div class="cpr-space-y-15">
      <span class="cpr-font-bold cpr-uppercase cpr-tracking-wider cpr-text-muted cpr-text-nano">
        {title} ({docs.length})
      </span>
      {docs.length === 0 ? (
        <p class="cpr-px-2 cpr-text-nano cpr-text-dim">—</p>
      ) : (
        <div class="cpr-space-y-15">
          {docs.map((doc) => (
            <CharacterRow
              key={doc.id}
              doc={doc}
              onOpen={() => onOpen(doc.id)}
              onPublish={onPublish ? () => onPublish(doc.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

async function create(
  name: string,
  stats: Record<string, number>,
  skills: Skills,
  profile: Profile,
): Promise<boolean> {
  try {
    // Empty string answers are dropped, so the sheet cannot tell "not asked"
    // apart from "asked and left blank". Arrays (enemies) are kept as-is: the
    // wizard already filters out empty rows before calling create().
    const clean: Record<string, string | ProfileEnemy[]> = {};
    for (const [key, value] of Object.entries(profile)) {
      if (typeof value === "string") {
        if (value.trim() !== "") clean[key] = value;
      } else {
        clean[key] = value;
      }
    }
    const combat = derivedCombat(stats);
    const doc = await api.documents.create({
      id: `cpr-${crypto.randomUUID().slice(0, 8)}`,
      type: CHAR_TYPE,
      name,
      system: {
        stats,
        skills,
        profile: clean,
        combat: {
          hp: combat.maxHp,
          humanity: combat.maxHumanity,
          headArmor: 0,
          bodyArmor: 0,
        },
      },
      flags: { cpr: { status: DRAFT_STATUS, owner: api.context.userId } },
      migrationStatus: "ok",
      ownership: { default: "LIMITED" },
    });
    api.ui.openDocument(doc.id);
    return true;
  } catch (err: unknown) {
    window.alert(`No se pudo crear el personaje: ${(err as { reason?: string })?.reason ?? "network-error"}`);
    return false;
  }
}
const INPUT_CLS = "cpr-input";
const CARD_CLS = "cpr-card";


const ROLE_INFO: Record<string, { tag: string; desc: string; icon: string }> = {
  rockerboy: {
    tag: "Líder Rebelde",
    desc: "Músicos y poetas de la calle que mueven a las masas usando Impacto Carismático.",
    icon: "🎸",
  },
  solo: {
    tag: "Asesino a Sueldo",
    desc: "Especialistas militares en combate letal con Percepción Táctica y reflejos sobrehumanos.",
    icon: "🎯",
  },
  netrunner: {
    tag: "Hacker Cibernético",
    desc: "Navegantes de la Red que asaltan nodos de datos, ciberimplantes y drones mediante Interfaz.",
    icon: "💾",
  },
  tech: {
    tag: "Ingeniero Callejero",
    desc: "Inventores y manitas de garaje capaces de fabricar, modificar y trucar cualquier tecnología.",
    icon: "🔧",
  },
  medtech: {
    tag: "Médico de Combate",
    desc: "Especialistas en trauma de choque, criónica y cibercirugía de emergencia bajo fuego hostil.",
    icon: "💉",
  },
  media: {
    tag: "Voz de la Calle",
    desc: "Periodistas armados con la verdad y su Credibilidad para exponer abusos corporativos.",
    icon: "📡",
  },
  exec: {
    tag: "Corporativo",
    desc: "Poder financiero, trajes blindados y guardaespaldas privados en la despiadada jerarquía corpa.",
    icon: "💼",
  },
  lawman: {
    tag: "Agente de la Ley",
    desc: "Autoridad armada que patrulla las zonas de combate de Night City y solicita Refuerzos tácticos.",
    icon: "🛡️",
  },
  fixer: {
    tag: "Intermediario",
    desc: "Traficantes de contactos, deudas y contratos clandestinos: mueven cualquier mercancía en el mercado negro.",
    icon: "🤝",
  },
  nomad: {
    tag: "Guerrero Nómada",
    desc: "Familias motorizadas de las Badlands con convoyes blindados, mecánicos de ruta y lealtad total.",
    icon: "🚗",
  },
};

function Field({
  label,
  long,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  long: boolean;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label class="cpr-field">
      <span class="cpr-label">
        {label}
      </span>
      {long ? (
        <textarea
          rows={3}
          class={`cpr-textarea ${INPUT_CLS}`}
          value={value}
          placeholder={placeholder}
          onInput={(e) => onChange(e.currentTarget.value)}
        />
      ) : (
        <input
          class={INPUT_CLS}
          value={value}
          placeholder={placeholder}
          onInput={(e) => onChange(e.currentTarget.value)}
        />
      )}
    </label>
  );
}

const skillBtnCls = "cpr-btn-icon";

function SkillLevelControl({
  level,
  baseline,
  busy,
  poolEmpty,
  onBump,
}: {
  level: number;
  baseline: number;
  busy: boolean;
  poolEmpty: boolean;
  onBump: (delta: number) => void;
}) {
  return (
    <div class="cpr-flex cpr-items-center cpr-gap-15">
      <button
        type="button"
        class={skillBtnCls}
        disabled={busy || level <= baseline}
        onClick={() => onBump(-1)}
        title="Reducir nivel"
      >
        −
      </button>
      <span class="cpr-w-6 cpr-text-center cpr-font-mono cpr-text-sm cpr-font-black cpr-text-white">{level}</span>
      <button
        type="button"
        class={skillBtnCls}
        disabled={busy || poolEmpty || level >= 10}
        onClick={() => onBump(1)}
        title="Aumentar nivel"
      >
        +
      </button>
    </div>
  );
}

function SingleSkillRow({
  skill,
  level,
  statValue,
  busy,
  poolEmpty,
  onBump,
}: {
  skill: SkillDef;
  level: number;
  statValue: number;
  busy: boolean;
  poolEmpty: boolean;
  onBump: (delta: number) => void;
}) {
  const [, name, , linkedStat, basic, x2] = skill;
  const baseline = basic ? 2 : 0;
  const totalBase = skillBase(statValue, level);

  return (
    <div class="cpr-skill-row">
      <div class="cpr-skill-info">
        <span class="cpr-skill-name cpr-truncate">{name}</span>
        {basic && (
          <span class="cpr-tactical-badge cpr-tactical-badge-cyan">
            BÁSICA
          </span>
        )}
        {x2 && (
          <span class="cpr-tactical-badge cpr-tactical-badge-amber">
            x2
          </span>
        )}
      </div>

      <div class="cpr-skill-meta">
        <div
          class="cpr-skill-base"
          title={`Base de tirada: 1d10 + ${totalBase} (${linkedStat.toUpperCase()} ${statValue} + Nivel ${level})`}
        >
          <span class="cpr-text-dim cpr-text-nano cpr-uppercase cpr-tracking-wider">{linkedStat}</span>
          <span class="cpr-base-badge">
            Base {totalBase}
          </span>
        </div>

        <SkillLevelControl
          level={level}
          baseline={baseline}
          busy={busy}
          poolEmpty={poolEmpty}
          onBump={onBump}
        />
      </div>
    </div>
  );
}

function RepeatableSkillRow({
  skill,
  instances,
  statValue,
  busy,
  poolEmpty,
  onChange,
}: {
  skill: SkillDef;
  instances: readonly SkillInstance[];
  statValue: number;
  busy: boolean;
  poolEmpty: boolean;
  onChange: (next: SkillInstance[]) => void;
}) {
  const [, name, , linkedStat, basic, x2] = skill;
  const firstBaseline = basic ? 2 : 0;
  const updateAt = (i: number, patch: Partial<SkillInstance>) =>
    onChange(instances.map((inst, idx) => (idx === i ? { ...inst, ...patch } : inst)));
  const removeAt = (i: number) =>
    onChange(instances.filter((_, idx) => idx !== i));
  const add = () => onChange([...instances, { name: "", level: 0 }]);

  return (
    <div class="cpr-repeatable-card cpr-space-y-25">
      <div class="cpr-flex cpr-items-center cpr-justify-between cpr-gap-2">
        <div class="cpr-flex cpr-items-center cpr-gap-2">
          <span class="cpr-text-xs cpr-font-bold cpr-text-white">{name}</span>
          {basic && (
            <span class="cpr-tactical-badge cpr-tactical-badge-cyan">
              BÁSICA
            </span>
          )}
          {x2 && (
            <span class="cpr-tactical-badge cpr-tactical-badge-amber">
              x2
            </span>
          )}
        </div>
        <span class="cpr-font-mono cpr-text-nano cpr-uppercase cpr-tracking-wider cpr-text-dim">{linkedStat}</span>
      </div>

      {instances.length === 0 ? (
        <p class="cpr-text-xs cpr-text-dim cpr-italic cpr-pl-1">Sin instancias registradas.</p>
      ) : (
        <div class="cpr-space-y-2">
          {instances.map((inst, i) => {
            const isLockedFirst = i === 0 && basic;
            const baseline = isLockedFirst ? firstBaseline : 0;
            const totalBase = skillBase(statValue, inst.level);
            return (
              <div key={i} class="cpr-repeatable-row">
                <input
                  type="text"
                  class={`cpr-flex-1 ${INPUT_CLS}`}
                  value={inst.name}
                  placeholder={isLockedFirst ? "Streetslang (Lengua común)" : "Especificar (ej. Japonés, Distrito Zero...)"}
                  onInput={(e) => updateAt(i, { name: e.currentTarget.value })}
                />
                <div
                  class="cpr-skill-base"
                  title={`Base = ${linkedStat.toUpperCase()} (${statValue}) + Nivel (${inst.level})`}
                >
                  <span class="cpr-base-badge">
                    Base {totalBase}
                  </span>
                </div>
                <SkillLevelControl
                  level={inst.level}
                  baseline={baseline}
                  busy={busy}
                  poolEmpty={poolEmpty}
                  onBump={(delta) => updateAt(i, { level: inst.level + delta })}
                />
                <button
                  type="button"
                  class="cpr-btn-danger"
                  disabled={isLockedFirst || busy}
                  onClick={() => removeAt(i)}
                  title={isLockedFirst ? "Instancia obligatoria del sistema" : "Quitar instancia"}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        class="cpr-btn-secondary cpr-w-full cpr-justify-center"
        onClick={add}
        disabled={busy}
      >
        + Añadir especialización / idioma
      </button>
    </div>
  );
}

function SkillRow({
  skill,
  value,
  statValue,
  busy,
  poolEmpty,
  onChange,
  onBump,
}: {
  skill: SkillDef;
  value: SkillValue;
  statValue: number;
  busy: boolean;
  poolEmpty: boolean;
  onChange: (next: SkillValue) => void;
  onBump: (delta: number) => void;
}) {
  const [, , , , , , repeatable] = skill;
  if (repeatable) {
    const list = Array.isArray(value) ? value : [];
    return (
      <RepeatableSkillRow
        skill={skill}
        instances={list}
        statValue={statValue}
        busy={busy}
        poolEmpty={poolEmpty}
        onChange={(next) => onChange(next)}
      />
    );
  }
  const level = typeof value === "number" ? value : 0;
  return (
    <SingleSkillRow
      skill={skill}
      level={level}
      statValue={statValue}
      busy={busy}
      poolEmpty={poolEmpty}
      onBump={onBump}
    />
  );
}

function BioMonitorHud({
  combat,
  stats,
  effectiveEmp,
  compact = false,
}: {
  combat: CombatDerived;
  stats: Record<string, number>;
  effectiveEmp: number;
  compact?: boolean;
}) {
  const movVal = stats["mov"] ?? STAT_START;
  const tcoVal = stats["tco"] ?? STAT_START;

  if (compact) {
    return (
      <div class="cpr-biomonitor-compact">
        <div class="cpr-biomonitor-tile">
          <span class="cpr-biomonitor-tile-label">HP Máx</span>
          <span class="cpr-biomonitor-tile-num">{combat.maxHp} HP</span>
          <span class="cpr-biomonitor-tile-sub cpr-text-red">Grave ≤ {combat.seriouslyWounded}</span>
        </div>
        <div class="cpr-biomonitor-tile">
          <span class="cpr-biomonitor-tile-label">Humanidad</span>
          <span class="cpr-biomonitor-tile-num">{combat.maxHumanity}</span>
          <span class="cpr-biomonitor-tile-sub cpr-text-cyan">EMP: {effectiveEmp}</span>
        </div>
        <div class="cpr-biomonitor-tile">
          <span class="cpr-biomonitor-tile-label">Muerte</span>
          <span class="cpr-biomonitor-tile-num">{combat.deathSave}</span>
          <span class="cpr-biomonitor-tile-sub cpr-text-amber">TCO {tcoVal}</span>
        </div>
        <div class="cpr-biomonitor-tile">
          <span class="cpr-biomonitor-tile-label">Movilidad</span>
          <span class="cpr-biomonitor-tile-num">{movVal * 2}m</span>
          <span class="cpr-biomonitor-tile-sub cpr-text-dim">Salto: {movVal}m</span>
        </div>
      </div>
    );
  }

  return (
    <div class="cpr-biomonitor">
      <div class="cpr-flex cpr-items-center cpr-justify-between cpr-border-b cpr-pb-2">
        <div class="cpr-flex cpr-items-center cpr-gap-2">
          <div class="cpr-pulse-dot" />
          <span class="cpr-font-mono cpr-text-nano cpr-font-bold cpr-uppercase cpr-tracking-wider cpr-text-cyan">
            BIO-MONITOR // TELEMETRÍA
          </span>
        </div>
        <span class="cpr-font-mono cpr-text-nano cpr-text-dim">AUTOCALCULADO</span>
      </div>

      <div class="cpr-grid-2">
        {/* HP */}
        <div class="cpr-biomonitor-tile">
          <span class="cpr-biomonitor-tile-label">Puntos de Golpe</span>
          <div class="cpr-biomonitor-tile-value">
            <span class="cpr-biomonitor-tile-num">{combat.maxHp}</span>
            <span class="cpr-biomonitor-tile-unit">HP</span>
          </div>
          <span class="cpr-biomonitor-tile-sub cpr-text-red">Grave: ≤ {combat.seriouslyWounded} HP</span>
        </div>

        {/* Humanidad */}
        <div class="cpr-biomonitor-tile">
          <span class="cpr-biomonitor-tile-label">Humanidad Máx</span>
          <div class="cpr-biomonitor-tile-value">
            <span class="cpr-biomonitor-tile-num">{combat.maxHumanity}</span>
            <span class="cpr-biomonitor-tile-unit">HUM</span>
          </div>
          <span class="cpr-biomonitor-tile-sub cpr-text-cyan">EMP Efectiva: {effectiveEmp}</span>
        </div>

        {/* Salvaguarda de Muerte */}
        <div class="cpr-biomonitor-tile">
          <span class="cpr-biomonitor-tile-label">Salvaguarda Muerte</span>
          <div class="cpr-biomonitor-tile-value">
            <span class="cpr-biomonitor-tile-num">{combat.deathSave}</span>
            <span class="cpr-biomonitor-tile-unit">TCO</span>
          </div>
          <span class="cpr-biomonitor-tile-sub cpr-text-amber">Base: TCO {tcoVal}</span>
        </div>

        {/* Movilidad */}
        <div class="cpr-biomonitor-tile">
          <span class="cpr-biomonitor-tile-label">Movilidad Urbana</span>
          <div class="cpr-biomonitor-tile-value">
            <span class="cpr-biomonitor-tile-num">{movVal * 2}m</span>
            <span class="cpr-biomonitor-tile-unit">carrera</span>
          </div>
          <span class="cpr-biomonitor-tile-sub cpr-text-dim">Salto: {movVal}m</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Character builder — the BODY of a host modal (`api.ui.openModal`), so the
 * overlay, framing, resize and Esc are the core's. A wizard: step 1 is who the
 * character is, step 2 the Características, step 3 the Habilidades. State is
 * local because the document does not exist yet, so there is nothing to PATCH —
 * `create()` writes stats, skills and profile at once. The window is resizable,
 * so the layout dynamically adapts via ResizeObserver to compact, medium, and
 * ultra-wide maximized display sizes.
 */
export function BuildModal({ close }: { close: () => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [modalWidth, setModalWidth] = useState<number>(() =>
    typeof window !== "undefined" ? Math.min(window.innerWidth, 980) : 980,
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setModalWidth(Math.round(entry.contentRect.width));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isWide = modalWidth >= 1050; // Maximized or large widescreen desktop
  const isCompact = modalWidth < 740; // Narrow floating window or small display

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [profile, setProfile] = useState<Profile>({});
  const [enemies, setEnemies] = useState<ProfileEnemy[]>([]);
  const [stats, setStats] = useState<Record<string, number>>(() =>
    Object.fromEntries(STATS.map(([key]) => [key, STAT_START])),
  );
  const [skills, setSkills] = useState<Skills>(() => initialSkills());
  const [busy, setBusy] = useState(false);
  const [skillSearch, setSkillSearch] = useState("");
  const [skillCategory, setSkillCategory] = useState("all");

  const d = derived(stats);
  const ds = derivedSkills(skills);
  const combat = derivedCombat(stats);
  const roleDef = ROLES.find(([id]) => id === role);
  const ability = roleDef?.[2] ?? "";
  const roleInfo = role ? ROLE_INFO[role] : undefined;

  const bump = (key: string, delta: number) =>
    setStats((prev) => ({ ...prev, [key]: d.stats[key]! + delta }));

  const resetStatsToStandard = () => {
    setStats(Object.fromEntries(STATS.map(([key]) => [key, STAT_START])));
  };

  const setSkill = (key: string, value: SkillValue) =>
    setSkills((prev) => ({ ...prev, [key]: value }));

  const bumpSkill = (key: string, delta: number) => {
    setSkills((prev) => {
      const cur = prev[key];
      if (typeof cur !== "number") return prev;
      return { ...prev, [key]: cur + delta };
    });
  };

  const setField = (key: string, value: string) =>
    setProfile((prev) => ({ ...prev, [key]: value }));

  const setEnemy = (i: number, key: keyof ProfileEnemy, value: string) =>
    setEnemies((prev) => prev.map((e, idx) => (idx === i ? { ...e, [key]: value } : e)));

  const addEnemy = () => setEnemies((prev) => [...prev, EMPTY_ENEMY()]);
  const removeEnemy = (i: number) =>
    setEnemies((prev) => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    setBusy(true);
    const liveEnemies = enemies.filter((e) =>
      Object.values(e).some((v) => v.trim() !== ""),
    );
    const next: Profile = { ...profile, role };
    if (liveEnemies.length > 0) next.enemies = liveEnemies;
    if (await create(name.trim(), stats, skills, next)) close();
    setBusy(false);
  };

  const photo = typeof profile["photo"] === "string" ? profile["photo"] : null;

  // Filter skills by query and category
  const filteredSkills = useMemo(() => {
    const q = skillSearch.trim().toLowerCase();
    return SKILLS.filter(([key, skillName, cat, linkedStat]) => {
      if (skillCategory !== "all" && cat !== skillCategory) return false;
      if (!q) return true;
      return (
        skillName.toLowerCase().includes(q) ||
        key.toLowerCase().includes(q) ||
        linkedStat.toLowerCase().includes(q) ||
        (SKILL_CATEGORY_NAMES[cat] ?? "").toLowerCase().includes(q)
      );
    });
  }, [skillSearch, skillCategory]);

  const skillsByCategory = useMemo(() => {
    const map = new Map<string, SkillDef[]>();
    for (const skill of filteredSkills) {
      const cat = skill[2];
      const arr = map.get(cat) ?? [];
      arr.push(skill);
      map.set(cat, arr);
    }
    return map;
  }, [filteredSkills]);

  const effectiveEmp = Math.floor(combat.maxHumanity / 10);
  const movVal = stats["mov"] ?? STAT_START;

  // Categorize profile fields into thematic groups
  const STYLE_KEYS = ["culturalOrigin", "clothing", "hairStyle", "alias"];
  const styleFields = PROFILE_FIELDS.filter(([k]) => STYLE_KEYS.includes(k));
  const psychFields = PROFILE_FIELDS.filter(([k]) => !STYLE_KEYS.includes(k));

  const STEP_CONFIG = [
    { num: "01", label: "Identidad", sub: "Dossier & Camino de la Vida" },
    { num: "02", label: "Características", sub: "10 Atributos Biológicos" },
    { num: "03", label: "Habilidades", sub: "Software Operativo" },
  ] as const;

  return (
    <div ref={containerRef} class="cpr-root">
      {/* Sleek Tactical Stepper & Telemetry Bar */}
      <header class="cpr-header">
        {/* Left: Quick System & Status Badge */}
        <div class="cpr-header-brand">
          <span class="cpr-pulse-dot" />
          <span class="cpr-tracking-widest cpr-text-white">NET.CP-RED</span>
          <span class="cpr-header-telemetry">
            {step === 0 && (name.trim() ? `AGENTE: ${name.trim().toUpperCase()}` : "CREANDO NUEVO EXPEDIENTE")}
            {step === 1 && `${d.left} PTS DE ATRIBUTO DISPONIBLES`}
            {step === 2 && `${ds.left} PTS DE HABILIDAD DISPONIBLES`}
          </span>
        </div>

        {/* Center / Right: Interactive Stepper Pills */}
        <nav class="cpr-stepper-nav">
          {STEP_CONFIG.map((st, i) => {
            const active = i === step;
            const done = i < step;
            return (
              <button
                key={st.num}
                type="button"
                disabled={!done && !active}
                onClick={() => done && setStep(i)}
                class={`cpr-stepper-btn ${active ? "active" : done ? "done" : ""}`}
              >
                <span class="cpr-text-nano cpr-opacity-75">{done ? "✓" : st.num}</span>
                <span class="cpr-uppercase cpr-tracking-wider">{st.label}</span>
              </button>
            );
          })}
        </nav>
      </header>

      {/* Main Responsive Workbench Area */}
      <div class="cpr-workbench">
        <div
          class={`cpr-w-full cpr-mx-auto ${
            step === 0
              ? "cpr-max-w-4xl cpr-space-y-4"
              : isCompact
                ? "cpr-max-w-2xl cpr-flex cpr-flex-col cpr-gap-4"
                : "cpr-flex cpr-gap-6 cpr-items-start"
          }`}
        >
          {/* LEFT COLUMN: Telemetry & Budget Dossier (Only when not compact and during Stats/Skills steps) */}
          {!isCompact && step > 0 && (
            <aside
              class="cpr-flex cpr-flex-col cpr-gap-4 cpr-shrink-0 cpr-sticky cpr-top-0"
              style={{ width: isWide ? "320px" : "280px" }}
            >
              {/* Agent mini badge */}
              <div class="cpr-card cpr-space-y-2">
                <div class="cpr-flex cpr-items-center cpr-gap-3">
                  <div class="cpr-avatar-sm cpr-shrink-0">
                    {photo ? (
                      <img
                        src={photo}
                        alt={name || "Agente"}
                        class="cpr-img-cover"
                      />
                    ) : (
                      <div class="cpr-flex cpr-h-full cpr-w-full cpr-items-center cpr-justify-center cpr-font-mono cpr-text-nano cpr-text-dim">
                        SIN FOTO
                      </div>
                    )}
                  </div>
                  <div class="cpr-min-w-0 cpr-flex-1">
                    <span class="cpr-font-mono cpr-text-nano cpr-font-bold cpr-uppercase cpr-tracking-wider cpr-text-accent">
                      EXPEDIENTE // NC
                    </span>
                    <h3 class="cpr-truncate cpr-text-sm cpr-font-black cpr-text-white">
                      {name.trim() || "Sin Identificar"}
                    </h3>
                    <span class="cpr-inline-block cpr-badge cpr-badge-muted">
                      {roleDef ? roleDef[1] : "Sin Rol Asignado"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Live Bio-Monitor HUD */}
              <BioMonitorHud combat={combat} stats={stats} effectiveEmp={effectiveEmp} />

              {/* Real-time Budget Status */}
              <div class="cpr-card cpr-space-y-3">
                <div class="cpr-card-header">
                  <span class="cpr-card-title">
                    PRESUPUESTO DE PUNTOS
                  </span>
                  <span class="cpr-card-tag">REGLAS OFICIALES</span>
                </div>

                <div class="cpr-space-y-3">
                  <BudgetBar left={d.left} total={POINT_POOL} label="Características" />
                  <BudgetBar left={ds.left} total={SKILL_POOL} label="Habilidades" />
                </div>
              </div>
            </aside>
          )}

          {/* RIGHT COLUMN / MAIN WORKSPACE */}
          <main class="cpr-min-w-0 cpr-flex-1 cpr-space-y-4">
            {/* Compact mode top telemetry and budget banners */}
            {isCompact && (
              <div class="cpr-space-y-3">
                {step === 0 && role && roleInfo && (
                  <div class="cpr-card cpr-space-y-1">
                    <div class="cpr-flex cpr-items-center cpr-justify-between">
                      <span class="cpr-font-mono cpr-text-xs cpr-font-bold cpr-text-white">
                        {roleInfo.icon} {roleDef?.[1]}
                      </span>
                      <span class="cpr-font-mono cpr-text-nano cpr-font-bold cpr-text-amber">
                        {ability}
                      </span>
                    </div>
                    <p class="cpr-text-xs cpr-text-muted">{roleInfo.desc}</p>
                  </div>
                )}
                {step === 1 && (
                  <>
                    <div class="cpr-card">
                      <BudgetBar left={d.left} total={POINT_POOL} label="Puntos de Características Libres" />
                    </div>
                    <BioMonitorHud combat={combat} stats={stats} effectiveEmp={effectiveEmp} compact={true} />
                  </>
                )}
                {step === 2 && (
                  <div class="cpr-card">
                    <BudgetBar left={ds.left} total={SKILL_POOL} label="Puntos de Habilidad Libres" />
                  </div>
                )}
              </div>
            )}

            {/* STEP 0: IDENTITY & LIFEPATH */}
            {step === 0 && (
              <div class="cpr-space-y-4">
                {/* Hero: Handle & Role */}
                <div class={CARD_CLS}>
                  <div class="cpr-card-header">
                    <span class="cpr-card-title cpr-card-title-accent">
                      // 01 IDENTIDAD BÁSICA DEL AGENTE
                    </span>
                    <span class="cpr-card-tag">REQUERIDO</span>
                  </div>

                  <div class="cpr-flex cpr-flex-col cpr-gap-4">
                    <div class="cpr-flex cpr-gap-4 cpr-flex-wrap">
                      <div class="cpr-avatar-lg cpr-shrink-0">
                        <api.ui.imagePicker
                          value={photo}
                          label="Retrato"
                          compact={true}
                          onChange={(url) => setField("photo", url ?? "")}
                        />
                      </div>

                      <div class="cpr-flex-1 cpr-min-w-0 cpr-flex cpr-flex-col cpr-gap-3">
                        <div class="cpr-grid-2">
                          <label class="cpr-field">
                            <span class="cpr-label">
                              Handle // Nombre en la calle <span class="cpr-required">*</span>
                            </span>
                            <input
                              class={INPUT_CLS}
                              value={name}
                              onInput={(e) => setName(e.currentTarget.value)}
                              placeholder="Ej. Morgan Blackhand, V, Spider Murphy..."
                              autoFocus
                            />
                          </label>

                          <label class="cpr-field">
                            <span class="cpr-label">
                              Rol // Ocupación Principal
                            </span>
                            <select
                              class={`custom-select ${INPUT_CLS}`}
                              value={role}
                              onChange={(e) => setRole((e.currentTarget as HTMLSelectElement).value)}
                            >
                              <option value="">— Elegir Rol —</option>
                              {ROLES.map(([id, label]) => (
                                <option key={id} value={id}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        {/* Tactical Role Preview */}
                        {role && roleInfo && (
                          <div class="cpr-card-subtle cpr-space-y-1">
                            <div class="cpr-flex cpr-items-center cpr-justify-between">
                              <span class="cpr-font-mono cpr-text-xs cpr-font-bold cpr-text-white cpr-flex cpr-items-center cpr-gap-15">
                                <span>{roleInfo.icon}</span> <span>{roleDef?.[1]}</span>
                                <span class="cpr-badge cpr-badge-red">
                                  {roleInfo.tag}
                                </span>
                              </span>
                              <span class="cpr-font-mono cpr-text-nano cpr-font-bold cpr-text-amber">
                                Habilidad: {ability}
                              </span>
                            </div>
                            <p class="cpr-text-xs cpr-text-muted">
                              {roleInfo.desc}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Lifepath Section: Appearance & Style + Psychology */}
                <div class="cpr-grid-2">
                  {/* Lifepath Section 1: Appearance & Style */}
                  <div class={CARD_CLS}>
                    <div class="cpr-card-header">
                      <span class="cpr-card-title">
                        // 02 APARIENCIA Y ESTILO CALLEJERO
                      </span>
                      <span class="cpr-card-tag">CAMINO DE LA VIDA</span>
                    </div>

                    <div class="cpr-grid-2">
                      {styleFields.map(([key, label, long]) => (
                        <div key={key}>
                          <Field
                            label={label}
                            long={long}
                            value={typeof profile[key] === "string" ? (profile[key] as string) : ""}
                            onChange={(v) => setField(key, v)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Lifepath Section 2: Psychology & Code */}
                  <div class={CARD_CLS}>
                    <div class="cpr-card-header">
                      <span class="cpr-card-title">
                        // 03 PSICOLOGÍA Y CÓDIGO MORAL
                      </span>
                      <span class="cpr-card-tag">VALORES Y RELACIONES</span>
                    </div>

                    <div class="cpr-grid-2">
                      {psychFields.map(([key, label, long]) => (
                        <div key={key}>
                          <Field
                            label={label}
                            long={long}
                            value={typeof profile[key] === "string" ? (profile[key] as string) : ""}
                            onChange={(v) => setField(key, v)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Enemies & Threat Dossier */}
                <div class={CARD_CLS}>
                  <div class="cpr-card-header">
                    <div class="cpr-flex cpr-items-center cpr-gap-2">
                      <span class="cpr-card-title cpr-card-title-accent">
                        // 04 ARCHIVO DE AMENAZAS ({enemies.length})
                      </span>
                      <span class="cpr-card-tag">OPCIONAL</span>
                    </div>
                    {enemies.length > 0 && (
                      <button
                        type="button"
                        class="cpr-btn-secondary cpr-text-nano"
                        onClick={addEnemy}
                      >
                        + Añadir Amenaza
                      </button>
                    )}
                  </div>

                  {enemies.length === 0 ? (
                    <div class="cpr-card-subtle cpr-text-center cpr-p-4">
                      <p class="cpr-text-xs cpr-text-dim cpr-italic cpr-mb-3">
                        Sin amenazas registradas. En Night City todos se ganan enemigos tarde o temprano.
                      </p>
                      <button
                        type="button"
                        class="cpr-btn-secondary"
                        onClick={addEnemy}
                      >
                        + Registrar Nueva Amenaza
                      </button>
                    </div>
                  ) : (
                    <div class="cpr-space-y-3">
                      {enemies.map((enemy, i) => (
                        <div
                          key={i}
                          class="cpr-tactical-tile cpr-space-y-3"
                        >
                          <div class="cpr-flex cpr-items-center cpr-justify-between cpr-border-b cpr-pb-2">
                            <span class="cpr-font-mono cpr-text-nano cpr-font-black cpr-uppercase cpr-tracking-wider cpr-text-red">
                              AMENAZA #{i + 1}
                            </span>
                            <button
                              type="button"
                              class="cpr-btn-danger"
                              onClick={() => removeEnemy(i)}
                            >
                              ✕ Eliminar
                            </button>
                          </div>
                          <div class="cpr-grid-2">
                            {ENEMY_FIELDS.map(([key, label, long]) => (
                              <div key={key}>
                                <Field
                                  label={label}
                                  long={long}
                                  value={enemy[key]}
                                  onChange={(value) => setEnemy(i, key, value)}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* STEP 1: CHARACTERISTICS */}
            {step === 1 && (
              <div class="cpr-space-y-4">
                {/* Quick Actions Bar */}
                <div class="cpr-flex cpr-flex-wrap cpr-items-center cpr-justify-between cpr-gap-2 cpr-card-subtle">
                  <div class="cpr-flex cpr-items-center cpr-gap-2">
                    <div class="cpr-pulse-dot" style={{ backgroundColor: "var(--cpr-cyan)", boxShadow: "0 0 8px var(--cpr-cyan)" }} />
                    <span class="cpr-font-mono cpr-text-nano cpr-font-bold cpr-uppercase cpr-tracking-wider cpr-text-white">
                      10 Atributos Biológicos
                    </span>
                    <span class="cpr-font-mono cpr-text-nano cpr-text-dim">
                      (Presupuesto: 62 pts // Min: 2, Max: 8)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={resetStatsToStandard}
                    class="cpr-btn-secondary cpr-text-nano"
                    title="Restablecer todas las características a 6 (60 pts base)"
                  >
                    ↺ Restablecer estándar (6 en todo)
                  </button>
                </div>

                {/* 3 Balanced Characteristic Groups */}
                {STAT_GROUPS.map(([group, keys]) => {
                  return (
                    <div key={group} class={CARD_CLS}>
                      <div class="cpr-card-header">
                        <span class="cpr-card-title">
                          // CARACTERÍSTICAS: {group.toUpperCase()}
                        </span>
                        <span class="cpr-card-tag">{keys.length} ATRIBUTOS</span>
                      </div>

                      <div class="cpr-stat-grid">
                        {keys.map((key) => {
                          const [, abbr, full] = STATS.find(([k]) => k === key)!;
                          return (
                            <StatTile
                              key={key}
                              statKey={key}
                              abbr={abbr}
                              fullName={full}
                              value={d.stats[key]!}
                              busy={busy}
                              blocked={false}
                              budgetEmpty={d.left <= 0}
                              canEdit={true}
                              onBump={bump}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* STEP 2: SKILLS & SOFTWARE */}
            {step === 2 && (
              <div class="cpr-space-y-4">
                {/* Search & Horizontal Category Filter Pills */}
                <div class="cpr-card-subtle cpr-space-y-3">
                  <div class="cpr-relative">
                    <input
                      type="text"
                      class={INPUT_CLS}
                      placeholder="Buscar habilidad por nombre o característica (ej. Armas cortas, Sigilo, REF, Pelea)..."
                      value={skillSearch}
                      onInput={(e) => setSkillSearch(e.currentTarget.value)}
                    />
                    {skillSearch && (
                      <button
                        type="button"
                        onClick={() => setSkillSearch("")}
                        class="cpr-btn-danger cpr-absolute"
                        style={{ right: "0.5rem", top: "0.4rem" }}
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Horizontal Scrollable Pills */}
                  <div class="cpr-pill-list">
                    <button
                      type="button"
                      onClick={() => setSkillCategory("all")}
                      class={`cpr-pill ${skillCategory === "all" ? "active" : ""}`}
                    >
                      Todas ({SKILLS.length})
                    </button>
                    {SKILL_CATEGORIES.map((cat) => {
                      const count = SKILLS.filter(([, , c]) => c === cat).length;
                      const active = skillCategory === cat;
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setSkillCategory(cat)}
                          class={`cpr-pill ${active ? "active" : ""}`}
                        >
                          {SKILL_CATEGORY_NAMES[cat]} ({count})
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Filtered Skill List */}
                {filteredSkills.length === 0 ? (
                  <div class="cpr-card cpr-text-center cpr-p-4 cpr-text-xs cpr-text-muted">
                    No se encontraron habilidades que coincidan con "{skillSearch}".
                  </div>
                ) : (
                  <div class={isWide ? "cpr-grid-2" : "cpr-space-y-4"}>
                    {Array.from(skillsByCategory.entries()).map(([cat, list]) => (
                      <div key={cat} class={CARD_CLS}>
                        <div class="cpr-card-header">
                          <span class="cpr-card-title" style={{ color: "var(--cpr-cyan)" }}>
                            // {SKILL_CATEGORY_NAMES[cat as keyof typeof SKILL_CATEGORY_NAMES] ?? cat} ({list.length})
                          </span>
                        </div>
                        <div class="cpr-divide-y">
                          {list.map((skill) => {
                            const [key, , , linkedStat] = skill;
                            const statVal = stats[linkedStat.toLowerCase()] ?? STAT_START;
                            return (
                              <SkillRow
                                key={key}
                                skill={skill}
                                value={ds.skills[key]!}
                                statValue={statVal}
                                busy={busy}
                                poolEmpty={ds.left <= 0}
                                onChange={(next) => setSkill(key, next)}
                                onBump={(delta) => bumpSkill(key, delta)}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Sticky Action Footer */}
      <footer class="cpr-footer">
        <button
          type="button"
          class="cpr-btn-secondary"
          disabled={step === 0 || busy}
          onClick={() => setStep(step - 1)}
        >
          ← Anterior
        </button>

        <div class="cpr-footer-telemetry">
          {step === 0 && (
            <span class="cpr-font-mono cpr-text-xs cpr-text-dim">
              {name.trim() ? `Agente: ${name.trim()}` : "Introduce un nombre en la calle"}
              {roleDef ? ` • Rol: ${roleDef[1]}` : ""}
            </span>
          )}
          {step === 1 && (
            <span class={`cpr-font-mono cpr-text-xs cpr-font-bold ${d.left === 0 ? "cpr-text-emerald" : "cpr-text-amber"}`}>
              {d.left === 0 ? "✓ 62 puntos repartidos" : `${d.left} puntos de característica sin asignar`}
            </span>
          )}
          {step === 2 && (
            <span class={`cpr-font-mono cpr-text-xs cpr-font-bold ${ds.left === 0 ? "cpr-text-emerald" : "cpr-text-cyan"}`}>
              {ds.left === 0 ? "✓ 86 puntos de habilidad repartidos" : `${ds.left} puntos de habilidad sin asignar`}
            </span>
          )}
        </div>

        {step < 2 ? (
          <button
            type="button"
            class="cpr-btn-primary"
            disabled={step === 0 && name.trim() === ""}
            onClick={() => setStep(step + 1)}
          >
            Siguiente paso →
          </button>
        ) : (
          <button
            type="button"
            class="cpr-btn-primary"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? "Creando Personaje…" : "⚡ Inicializar Agente"}
          </button>
        )}
      </footer>
    </div>
  );
}

function ArchetypeCard({
  archetype,
  isGM,
  onImport,
}: {
  archetype: Archetype;
  isGM: boolean;
  onImport: (arch: Archetype) => Promise<void>;
}) {
  const d = derived(archetype.stats);

  const items: ClientContextMenuItem[] = isGM
    ? [{ label: "Importar a la campaña", onClick: () => void onImport(archetype) }]
    : [];

  return (
    <RowMenu items={items}>
      <div class="cpr-character-row cpr-flex-col cpr-items-start">
        <div class="cpr-flex cpr-items-center cpr-justify-between cpr-w-full">
          <p class="cpr-truncate cpr-font-bold cpr-text-white cpr-text-xs">{archetype.name}</p>
          <span class="cpr-badge cpr-badge-amber">
            {archetype.role}
          </span>
        </div>
        <p class="cpr-text-xs cpr-text-muted">{archetype.description}</p>
        <div class="cpr-flex cpr-items-center cpr-gap-2 cpr-border-t cpr-pt-1 cpr-font-mono cpr-text-nano cpr-text-dim cpr-w-full">
          <span>REF {d.stats["ref"]}</span>
          <span>·</span>
          <span>MOV {d.stats["mov"]}</span>
          <span>·</span>
          <span>TCO {d.stats["tco"]}</span>
          <span>·</span>
          <span>INT {d.stats["int"]}</span>
        </div>
      </div>
    </RowMenu>
  );
}

export function CprPanel({ entries }: { entries: readonly CprDoc[] }) {
  const [panelTab, setPanelTab] = useState<"characters" | "compendium">("characters");
  const [importNotice, setImportNotice] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const isGM = api.context.role === "GM";

  // A draft belongs to its author until published; players must not even see
  // the row. canSeeDraft is the same predicate the sheet could use later.
  const visible = entries.filter((d) => canSeeDraft(d, api.context.userId, isGM));

  // Player-controlled = somebody holds OWNER. The host's PATCH gate uses the
  // same test, so this split is not cosmetic: it's who can actually save.
  const owned = (doc: CprDoc) =>
    Object.entries(doc.ownership ?? {}).some(
      ([key, level]) => key !== "default" && level === "OWNER",
    );

  const filtered = searchQuery.trim()
    ? visible.filter((d) => d.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : visible;

  const gmDocs = filtered.filter((d) => !owned(d));
  const playerDocs = filtered.filter(owned);
  // Drafts are publishable by whoever can see them (author or GM).
  const publishable = filtered.filter(isDraft);

  const publish = async (id: string) => {
    try {
      await api.documents.update(id, publishPatch());
    } catch (err: unknown) {
      window.alert(`No se pudo publicar: ${(err as { reason?: string })?.reason ?? "network-error"}`);
    }
  };

  const handleImportArchetype = async (arch: Archetype) => {
    try {
      const combat = derivedCombat(arch.stats);
      const doc = await api.documents.create({
        id: `cpr-${crypto.randomUUID().slice(0, 8)}`,
        type: CHAR_TYPE,
        name: arch.name,
        system: {
          stats: { ...arch.stats },
          skills: initialSkills(),
          combat: {
            hp: combat.maxHp,
            humanity: combat.maxHumanity,
            headArmor: 0,
            bodyArmor: 0,
          },
        },
        // flags values are namespaces, so the archetype id goes inside one.
        flags: { cpr: { status: "published", archetypeId: arch.id } },
        migrationStatus: "ok",
        ownership: { default: "LIMITED" },
      });
      setImportNotice(`"${arch.name}" importado con éxito.`);
      setTimeout(() => setImportNotice(""), 3500);
      api.ui.openDocument(doc.id);
    } catch (err: unknown) {
      window.alert(`No se pudo importar el arquetipo: ${(err as { reason?: string })?.reason ?? "network-error"}`);
    }
  };

  return (
    <div class="cpr-root cpr-panel-root custom-scroll cpr-overflow-y-auto">
      {/* Sub-tabs header */}
      <div class="cpr-panel-tabs">
        <button
          type="button"
          onClick={() => setPanelTab("characters")}
          class={`cpr-panel-tab ${panelTab === "characters" ? "active" : ""}`}
        >
          Personajes ({visible.length})
        </button>
        <button
          type="button"
          onClick={() => setPanelTab("compendium")}
          class={`cpr-panel-tab ${panelTab === "compendium" ? "active" : ""}`}
        >
          Compendio ({ARCHETYPES.length})
        </button>
      </div>

      {panelTab === "characters" ? (
        <div class="cpr-space-y-3">
          <div class="cpr-flex cpr-items-center cpr-justify-between">
            <span class="cpr-font-bold cpr-uppercase cpr-tracking-wider cpr-text-muted cpr-text-nano">
              En Campaña ({visible.length})
            </span>
            <span class="cpr-text-nano cpr-font-mono cpr-text-dim">{CHAR_TYPE}</span>
          </div>

          {isGM && (
            <button
              type="button"
              onClick={() =>
                api.ui.openModal({
                  id: "cpr-build",
                  title: "Creación de Personaje // Cyberpunk RED",
                  component: BuildModal as never,
                  initialWidth: 980,
                })
              }
              class="cpr-btn-secondary cpr-w-full cpr-justify-center"
            >
              + Nuevo personaje
            </button>
          )}

          {visible.length > 3 && (
            <input
              type="text"
              class={INPUT_CLS}
              placeholder="Filtrar por nombre..."
              value={searchQuery}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
            />
          )}

          <Block title="Del GM" docs={gmDocs} onOpen={api.ui.openDocument} onPublish={publish} />
          <Block title="De jugadores" docs={playerDocs} onOpen={api.ui.openDocument} onPublish={publish} />

          <p class="cpr-text-nano cpr-text-dim">
            Click derecho sobre una fila para sus acciones.
            {publishable.length > 0 &&
              ` ${publishable.length} en borrador: invisibles para el resto hasta publicarlos.`}
          </p>
        </div>
      ) : (
        <div class="cpr-space-y-2">
          <div class="cpr-flex cpr-items-center cpr-justify-between">
            <span class="cpr-font-bold cpr-uppercase cpr-tracking-wider cpr-text-muted cpr-text-nano">
              Biblioteca de Night City
            </span>
            <span class="cpr-text-nano cpr-font-mono cpr-text-dim">arquetipos</span>
          </div>
          <p class="cpr-text-xs cpr-text-muted">
            Plantillas oficiales listas para importar a tu partida con estadísticas de Cyberpunk RED.
          </p>

          {importNotice && (
            <div class="cpr-badge cpr-badge-emerald cpr-p-2 cpr-w-full">
              {importNotice}
            </div>
          )}

          <div class="cpr-space-y-2 cpr-pt-1">
            {ARCHETYPES.map((arch) => (
              <ArchetypeCard
                key={arch.id}
                archetype={arch}
                isGM={isGM}
                onImport={handleImportArchetype}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}