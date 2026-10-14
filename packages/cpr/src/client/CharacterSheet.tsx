//  Cyberpunk RED Character Sheet — stats, combat vitals, skills, and lifepath.

import type { JSX } from "preact";
import { api, h, useEffect, useMemo, useState } from "./host";
import {
  POINT_POOL,
  PROFILE_FIELDS,
  ROLES,
  SKILL_CATEGORIES,
  SKILL_CATEGORY_NAMES,
  SKILL_MAX,
  SKILL_POOL,
  SKILLS,
  STATS,
  STAT_GROUPS,
  STAT_MAX,
  STAT_MIN,
  cprFlags,
  derived,
  derivedCombat,
  derivedSkills,
  isDraft,
  publishPatch,
  skillBase,
  type CombatState,
  type Profile,
  type ProfileEnemy,
  type RawStats,
  type SkillDef,
  type SkillInstance,
  type SkillValue,
  type Skills,
} from "./rules";

// Budget bar: colour shifts green → amber → red as points drain.
export function BudgetBar({ left, total, label = "Puntos libres" }: { left: number; total: number; label?: string }) {
  const pct = Math.max(0, Math.min(1, left / total));
  const fillColor = pct > 0.5 ? "var(--cpr-emerald)" : pct > 0.2 ? "var(--cpr-amber)" : "var(--cpr-red)";
  const textColor = pct > 0.5 ? "cpr-text-emerald" : pct > 0.2 ? "cpr-text-amber" : "cpr-text-red";

  return (
    <div class="cpr-budget-bar">
      <div class="cpr-budget-header">
        <span class="cpr-budget-label">{label}</span>
        <span class={`cpr-budget-count ${textColor}`}>
          {left} / {total}
        </span>
      </div>
      <div class="cpr-budget-track">
        <div
          class="cpr-budget-fill"
          style={{ width: `${Math.round(pct * 100)}%`, backgroundColor: fillColor }}
        />
      </div>
    </div>
  );
}

// Single stat tile: big value in the center, label below, ± buttons flanking.
interface StatTileProps {
  statKey: string;
  abbr: string;
  fullName: string;
  value: number;
  busy?: boolean;
  blocked?: boolean;
  budgetEmpty?: boolean;
  canEdit?: boolean;
  onBump: (key: string, delta: number) => void;
}

export function StatTile({
  statKey,
  abbr,
  fullName,
  value,
  busy = false,
  blocked = false,
  budgetEmpty = false,
  canEdit = true,
  onBump,
}: StatTileProps) {
  const isLegendary = value >= 8;
  const isHigh = value >= 6;
  const tileClass = `cpr-stat-tile ${
    isLegendary ? "cpr-stat-tile-legendary" : isHigh ? "cpr-stat-tile-high" : ""
  }`;

  return (
    <div title={fullName} class={tileClass}>
      <span class="cpr-stat-abbr">{abbr}</span>
      <div class="cpr-stat-controls">
        {canEdit && (
          <button
            type="button"
            disabled={busy || blocked || value <= STAT_MIN}
            onClick={() => onBump(statKey, -1)}
            class="cpr-btn-icon"
            aria-label={`Reducir ${abbr}`}
          >
            −
          </button>
        )}
        <span class="cpr-stat-val">{value}</span>
        {canEdit && (
          <button
            type="button"
            disabled={busy || blocked || budgetEmpty || value >= STAT_MAX}
            onClick={() => onBump(statKey, 1)}
            class="cpr-btn-icon"
            aria-label={`Aumentar ${abbr}`}
          >
            +
          </button>
        )}
      </div>
      <span class="cpr-stat-name">{fullName}</span>
    </div>
  );
}

interface CprDocumentData {
  id: string;
  name: string;
  type: string;
  flags?: Record<string, unknown>;
  ownership?: Record<string, string>;
  migrationStatus?: string;
  schemaVersion?: number;
  system?: {
    stats?: RawStats;
    skills?: Skills;
    profile?: Profile;
    combat?: CombatState;
    roleRank?: number;
  };
}

const INPUT_CLS = "cpr-input";
const SECTION_CLS = "cpr-card cpr-flex-col cpr-gap-2";
const BTN_GHOST = "cpr-btn-secondary";
const BTN_ACCENT = "cpr-btn-primary";

export function CharacterSheet({ documentId }: { documentId: string }) {
  const [doc, setDoc] = useState<CprDocumentData | null>(() => api.documents.get(documentId) as CprDocumentData | null);
  const [activeTab, setActiveTab] = useState<"stats" | "skills" | "profile">("stats");
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [skillSearch, setSkillSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  // Keep character sheet reactive to live document updates from socket/other peers
  useEffect(() => {
    return api.documents.subscribe(documentId, (updated) => {
      setDoc(updated as CprDocumentData);
    });
  }, [documentId]);

  if (!doc) return <div class="cpr-root cpr-p-4 cpr-text-xs cpr-text-muted">Cargando personaje…</div>;

  const currentUserId = api.context.userId;
  const isGM = api.context.role === "GM";
  const userPerm = doc.ownership?.[currentUserId] ?? doc.ownership?.["default"];
  const canEdit = isGM || userPerm === "OWNER" || cprFlags(doc).owner === currentUserId;
  const draft = isDraft(doc);
  const blocked = doc.migrationStatus === "blocked";

  const statsDerived = derived(doc.system?.stats as RawStats);
  const skillsDerived = derivedSkills(doc.system?.skills);
  const combatDerived = derivedCombat(statsDerived.stats);

  const combat = doc.system?.combat ?? {};
  const currentHp = typeof combat.hp === "number" ? combat.hp : combatDerived.maxHp;
  const headArmor = typeof combat.headArmor === "number" ? combat.headArmor : 0;
  const bodyArmor = typeof combat.bodyArmor === "number" ? combat.bodyArmor : 0;
  const currentHumanity = typeof combat.humanity === "number" ? combat.humanity : combatDerived.maxHumanity;
  const effectiveEmp = Math.floor(currentHumanity / 10);

  const profile = (doc.system?.profile ?? {}) as Profile;
  const roleId = typeof profile.role === "string" ? profile.role : "";
  const roleDef = ROLES.find(([id]) => id === roleId);
  const roleName = roleDef ? roleDef[1] : (roleId || "Sin rol");
  const roleAbility = roleDef ? roleDef[2] : "";
  const photo = typeof profile.photo === "string" ? profile.photo : null;
  const enemies = Array.isArray(profile.enemies) ? (profile.enemies as ProfileEnemy[]) : [];

  // Update helper using dot notation patch
  const patch = async (fields: Record<string, unknown>) => {
    setStatusText("guardando…");
    setBusy(true);
    try {
      await api.documents.update(documentId, fields);
      setStatusText("guardado");
      setTimeout(() => setStatusText(""), 2000);
    } catch (err: unknown) {
      setStatusText((err as { reason?: string })?.reason ?? "error de red");
    } finally {
      setBusy(false);
    }
  };

  const handleStatBump = (key: string, delta: number) => {
    const cur = statsDerived.stats[key] ?? STAT_MIN;
    void patch({ [`system.stats.${key}`]: cur + delta });
  };

  const handlePublish = async () => {
    await patch(publishPatch());
  };

  const handleHpChange = (delta: number) => {
    const nextHp = Math.max(0, Math.min(combatDerived.maxHp, currentHp + delta));
    void patch({ "system.combat.hp": nextHp });
  };

  const handleArmorChange = (area: "headArmor" | "bodyArmor", delta: number) => {
    const cur = area === "headArmor" ? headArmor : bodyArmor;
    const next = Math.max(0, cur + delta);
    void patch({ [`system.combat.${area}`]: next });
  };

  const handleSkillLevelChange = (key: string, nextLevel: number) => {
    const clean = Math.min(SKILL_MAX, Math.max(0, nextLevel));
    void patch({ [`system.skills.${key}`]: clean });
  };

  const handleRepeatableChange = (key: string, nextInstances: SkillInstance[]) => {
    void patch({ [`system.skills.${key}`]: nextInstances });
  };

  const handleProfileField = (key: string, val: string) => {
    void patch({ [`system.profile.${key}`]: val });
  };

  const handleEnemyUpdate = (index: number, key: keyof ProfileEnemy, value: string) => {
    const nextEnemies = enemies.map((en, idx) => (idx === index ? { ...en, [key]: value } : en));
    void patch({ "system.profile.enemies": nextEnemies });
  };

  const handleAddEnemy = () => {
    const nextEnemies = [...enemies, { who: "", cause: "", threat: "", future: "" }];
    void patch({ "system.profile.enemies": nextEnemies });
  };

  const handleRemoveEnemy = (index: number) => {
    const nextEnemies = enemies.filter((_, idx) => idx !== index);
    void patch({ "system.profile.enemies": nextEnemies });
  };

  // Filter skills by search query and category
  const filteredSkills = useMemo(() => {
    const query = skillSearch.trim().toLowerCase();
    return SKILLS.filter(([key, name, cat, linkedStat]) => {
      if (selectedCategory !== "all" && cat !== selectedCategory) return false;
      if (!query) return true;
      return (
        name.toLowerCase().includes(query) ||
        key.toLowerCase().includes(query) ||
        linkedStat.toLowerCase().includes(query) ||
        SKILL_CATEGORY_NAMES[cat].toLowerCase().includes(query)
      );
    });
  }, [skillSearch, selectedCategory]);

  // HP state calculations
  const hpPct = Math.max(0, Math.min(1, currentHp / combatDerived.maxHp));
  const isSeriouslyWounded = currentHp > 0 && currentHp <= combatDerived.seriouslyWounded;
  const isMortallyWounded = currentHp === 0;

  return (
    <div class="cpr-root cpr-p-4 cpr-overflow-y-auto custom-scroll">
      {/* Top Banner: Status & Alerts */}
      {blocked && (
        <div class="cpr-card-subtle cpr-p-2 cpr-text-xs cpr-text-red">
          Migración bloqueada: esta ficha tiene datos incompatibles con la versión actual del sistema.
        </div>
      )}

      {/* Header: Photo, Name, Role, Draft/Publish */}
      <header class="cpr-flex cpr-flex-wrap cpr-items-center cpr-justify-between cpr-gap-3 cpr-border-b cpr-pb-3">
        <div class="cpr-avatar-sm">
          {canEdit ? (
            <api.ui.imagePicker
              value={photo}
              label="Retrato"
              compact={true}
              onChange={(url) => handleProfileField("photo", url ?? "")}
            />
          ) : photo ? (
            <img src={photo} alt={doc.name} class="cpr-img-cover" />
          ) : (
            <div class="cpr-flex cpr-h-full cpr-w-full cpr-items-center cpr-justify-center cpr-text-nano cpr-text-muted">
              Sin foto
            </div>
          )}
        </div>

        <div class="cpr-min-w-0 cpr-flex-1 cpr-flex-col cpr-gap-1">
          <div class="cpr-flex cpr-flex-wrap cpr-items-center cpr-gap-2">
            {canEdit ? (
              <input
                type="text"
                class="cpr-input cpr-text-lg cpr-font-black"
                value={doc.name}
                onBlur={(e) => {
                  const val = e.currentTarget.value.trim();
                  if (val && val !== doc.name) void patch({ name: val });
                }}
                title="Haz clic para editar el nombre"
              />
            ) : (
              <h1 class="cpr-text-lg cpr-font-black cpr-text-white">{doc.name}</h1>
            )}

            {draft ? (
              <span class="cpr-badge cpr-badge-amber">
                BORRADOR
              </span>
            ) : (
              <span class="cpr-badge cpr-badge-emerald">
                PUBLICADO
              </span>
            )}

            {statusText && (
              <span class="cpr-font-mono cpr-text-nano cpr-text-muted">
                {statusText}
              </span>
            )}
          </div>

          <div class="cpr-flex cpr-flex-wrap cpr-items-center cpr-gap-2 cpr-text-xs cpr-text-muted">
            <span class="cpr-badge cpr-badge-muted">
              {roleName}
            </span>
            {roleAbility && (
              <span>
                Habilidad: <strong class="cpr-text-amber cpr-font-bold">{roleAbility}</strong>
              </span>
            )}
          </div>
        </div>

        {draft && canEdit && (
          <div class="cpr-shrink-0 cpr-flex cpr-items-center cpr-gap-2">
            <button
              type="button"
              class={BTN_ACCENT}
              disabled={busy || statsDerived.left > 0}
              onClick={handlePublish}
              title={statsDerived.left > 0 ? `Quedan ${statsDerived.left} puntos de características sin repartir` : "Publicar ficha"}
            >
              Publicar
            </button>
          </div>
        )}
      </header>

      {/* Combat Vitals Strip */}
      <section class="cpr-card cpr-p-3 cpr-grid-4">
        {/* HP & Health Bar */}
        <div class="cpr-card-subtle cpr-p-2 cpr-flex-col cpr-gap-15">
          <div class="cpr-flex cpr-items-center cpr-justify-between cpr-text-xs">
            <span class="cpr-font-bold cpr-uppercase cpr-tracking-wider cpr-text-muted">
              Puntos de Vida (HP)
            </span>
            <div class="cpr-flex cpr-items-center cpr-gap-1 cpr-font-mono">
              <span class={`cpr-font-bold cpr-text-sm ${isMortallyWounded ? "cpr-text-red" : isSeriouslyWounded ? "cpr-text-amber" : "cpr-text-emerald"}`}>
                {currentHp}
              </span>
              <span class="cpr-text-muted">/ {combatDerived.maxHp}</span>
            </div>
          </div>

          {/* Health Bar */}
          <div class="cpr-budget-track">
            <div
              class="cpr-budget-fill"
              style={{
                width: `${Math.round(hpPct * 100)}%`,
                backgroundColor: isMortallyWounded ? "var(--cpr-red)" : isSeriouslyWounded ? "var(--cpr-amber)" : "var(--cpr-emerald)",
              }}
            />
          </div>

          {/* Status Alert */}
          {isMortallyWounded ? (
            <p class="cpr-font-mono cpr-text-micro cpr-font-bold cpr-text-red cpr-uppercase">
              ☠ Mortalmente Herido: Salvación contra muerte cada asalto
            </p>
          ) : isSeriouslyWounded ? (
            <p class="cpr-font-mono cpr-text-micro cpr-font-bold cpr-text-amber cpr-uppercase">
              ⚠ Herida Grave: -2 a todas las acciones
            </p>
          ) : (
            <p class="cpr-text-micro cpr-text-dim">
              Límite Herida Grave: ≤ {combatDerived.seriouslyWounded} HP
            </p>
          )}

          {canEdit && (
            <div class="cpr-flex cpr-items-center cpr-gap-1 cpr-pt-1">
              <button type="button" class={BTN_GHOST} onClick={() => handleHpChange(-5)}>
                -5
              </button>
              <button type="button" class={BTN_GHOST} onClick={() => handleHpChange(-1)}>
                -1
              </button>
              <button type="button" class={BTN_GHOST} onClick={() => handleHpChange(1)}>
                +1
              </button>
              <button type="button" class={BTN_GHOST} onClick={() => handleHpChange(5)}>
                +5
              </button>
            </div>
          )}
        </div>

        {/* Armor SP: Head & Body */}
        <div class="cpr-card-subtle cpr-p-2 cpr-flex-col cpr-gap-1">
          <span class="cpr-text-nano cpr-font-bold cpr-uppercase cpr-tracking-wider cpr-text-muted">
            Blindaje (SP)
          </span>
          <div class="cpr-flex cpr-items-center cpr-justify-between cpr-text-xs">
            <span class="cpr-text-muted">Cabeza:</span>
            <div class="cpr-flex cpr-items-center cpr-gap-1">
              <span class="cpr-font-mono cpr-font-bold cpr-text-white">{headArmor}</span>
              {canEdit && (
                <button
                  type="button"
                  class="cpr-btn-icon"
                  style={{ width: "24px", height: "24px", minWidth: "24px", minHeight: "24px" }}
                  onClick={() => handleArmorChange("headArmor", -1)}
                  title="Ablación (-1 SP)"
                >
                  −
                </button>
              )}
            </div>
          </div>
          <div class="cpr-flex cpr-items-center cpr-justify-between cpr-text-xs">
            <span class="cpr-text-muted">Cuerpo:</span>
            <div class="cpr-flex cpr-items-center cpr-gap-1">
              <span class="cpr-font-mono cpr-font-bold cpr-text-white">{bodyArmor}</span>
              {canEdit && (
                <button
                  type="button"
                  class="cpr-btn-icon"
                  style={{ width: "24px", height: "24px", minWidth: "24px", minHeight: "24px" }}
                  onClick={() => handleArmorChange("bodyArmor", -1)}
                  title="Ablación (-1 SP)"
                >
                  −
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Humanity & Death Save */}
        <div class="cpr-card-subtle cpr-p-2 cpr-flex-col cpr-gap-1">
          <div class="cpr-flex cpr-items-center cpr-justify-between">
            <span class="cpr-text-nano cpr-font-bold cpr-uppercase cpr-tracking-wider cpr-text-muted">
              Salv. Muerte
            </span>
            <span class="cpr-font-mono cpr-font-bold cpr-text-sm cpr-text-amber">
              {combatDerived.deathSave}
            </span>
          </div>
          <div class="cpr-border-t cpr-pt-1">
            <div class="cpr-flex cpr-items-center cpr-justify-between cpr-text-xs">
              <span class="cpr-text-muted">Humanidad:</span>
              <span class="cpr-font-mono cpr-font-bold cpr-text-white">
                {currentHumanity} <span class="cpr-text-muted cpr-text-nano">/ {combatDerived.maxHumanity}</span>
              </span>
            </div>
            <p class="cpr-text-nano cpr-text-dim">
              EMP Efectiva: <span class="cpr-font-bold cpr-text-white">{effectiveEmp}</span>
            </p>
          </div>
        </div>
      </section>

      {/* Tabs Header */}
      <nav class="cpr-panel-tabs">
        <button
          type="button"
          onClick={() => setActiveTab("stats")}
          class={`cpr-panel-tab ${activeTab === "stats" ? "active" : ""}`}
        >
          Características & Combate
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("skills")}
          class={`cpr-panel-tab ${activeTab === "skills" ? "active" : ""}`}
        >
          Habilidades ({SKILLS.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("profile")}
          class={`cpr-panel-tab ${activeTab === "profile" ? "active" : ""}`}
        >
          Biografía & Lifepath
        </button>
      </nav>

      {/* Tab 1: Characteristics & Movement */}
      {activeTab === "stats" && (
        <div class="cpr-space-y-3">
          {draft && <BudgetBar left={statsDerived.left} total={POINT_POOL} />}

          {STAT_GROUPS.map(([group, keys]) => (
            <div key={group} class={SECTION_CLS}>
              <span class="cpr-font-bold cpr-uppercase cpr-tracking-wider cpr-text-muted cpr-text-nano">
                {group}
              </span>
              <div class="cpr-stat-grid">
                {keys.map((key) => {
                  const [, abbr, full] = STATS.find(([k]) => k === key)!;
                  const val = statsDerived.stats[key] ?? STAT_MIN;
                  return (
                    <StatTile
                      key={key}
                      statKey={key}
                      abbr={abbr}
                      fullName={full}
                      value={val}
                      busy={busy}
                      blocked={blocked}
                      budgetEmpty={statsDerived.left <= 0}
                      canEdit={canEdit}
                      onBump={handleStatBump}
                    />
                  );
                })}
              </div>
            </div>
          ))}

          {/* Movement & Tactical Rates */}
          <div class={SECTION_CLS}>
            <span class="cpr-font-bold cpr-uppercase cpr-tracking-wider cpr-text-muted cpr-text-nano">
              Movimiento y Desplazamiento Táctico
            </span>
            <div class="cpr-grid-4 cpr-font-mono cpr-text-xs">
              <div class="cpr-tactical-tile">
                <span class="cpr-text-dim cpr-block cpr-text-nano cpr-uppercase">Caminar / Carrera (MOV)</span>
                <span class="cpr-text-sm cpr-font-bold cpr-text-white">{statsDerived.stats["mov"]} casillas</span>
                <span class="cpr-text-nano cpr-text-muted cpr-block">({statsDerived.stats["mov"]! * 2} m / asalto)</span>
              </div>
              <div class="cpr-tactical-tile">
                <span class="cpr-text-dim cpr-block cpr-text-nano cpr-uppercase">Iniciativa Base</span>
                <span class="cpr-text-sm cpr-font-bold cpr-text-amber">REF {statsDerived.stats["ref"]}</span>
                <span class="cpr-text-nano cpr-text-muted cpr-block">(1d10 + REF)</span>
              </div>
              <div class="cpr-tactical-tile">
                <span class="cpr-text-dim cpr-block cpr-text-nano cpr-uppercase">Salto en Carrera</span>
                <span class="cpr-text-sm cpr-font-bold cpr-text-white">{statsDerived.stats["mov"]} m</span>
              </div>
              <div class="cpr-tactical-tile">
                <span class="cpr-text-dim cpr-block cpr-text-nano cpr-uppercase">Salto Estático</span>
                <span class="cpr-text-sm cpr-font-bold cpr-text-white">{Math.floor(statsDerived.stats["mov"]! / 2)} m</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Skills */}
      {activeTab === "skills" && (
        <div class="cpr-space-y-3">
          {draft && <BudgetBar left={skillsDerived.left} total={SKILL_POOL} label="Puntos de habilidad (PI inicial)" />}

          {/* Filters & Search */}
          <div class="cpr-flex cpr-flex-wrap cpr-gap-2 cpr-items-center">
            <input
              type="text"
              class={`cpr-flex-1 ${INPUT_CLS}`}
              placeholder="Buscar habilidad por nombre o estadística..."
              value={skillSearch}
              onInput={(e) => setSkillSearch(e.currentTarget.value)}
            />
            <select
              class={`cpr-w-48 custom-select ${INPUT_CLS}`}
              value={selectedCategory}
              onChange={(e) => setSelectedCategory((e.currentTarget as HTMLSelectElement).value)}
            >
              <option value="all">Todas las categorías</option>
              {SKILL_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {SKILL_CATEGORY_NAMES[cat]}
                </option>
              ))}
            </select>
          </div>

          {/* Skills List */}
          <div class="cpr-space-y-2">
            {SKILL_CATEGORIES.filter((cat) => selectedCategory === "all" || selectedCategory === cat).map((cat) => {
              const categorySkills = filteredSkills.filter(([, , c]) => c === cat);
              if (categorySkills.length === 0) return null;

              return (
                <div key={cat} class={SECTION_CLS}>
                  <div class="cpr-flex cpr-items-center cpr-justify-between cpr-border-b cpr-pb-1">
                    <span class="cpr-font-bold cpr-uppercase cpr-tracking-wider cpr-text-muted cpr-text-nano">
                      {SKILL_CATEGORY_NAMES[cat]}
                    </span>
                    <span class="cpr-text-nano cpr-font-mono cpr-text-dim">{categorySkills.length}</span>
                  </div>

                  <div class="cpr-divide-y">
                    {categorySkills.map((skill) => {
                      const [key, name, , linkedStat, basic, x2, repeatable] = skill;
                      const statVal = statsDerived.stats[linkedStat] ?? STAT_MIN;
                      const skillVal = skillsDerived.skills[key];

                      if (repeatable) {
                        const instances = Array.isArray(skillVal) ? (skillVal as SkillInstance[]) : [];
                        return (
                          <div key={key} class="cpr-space-y-1 cpr-py-1">
                            <div class="cpr-flex cpr-items-center cpr-justify-between">
                              <div class="cpr-flex cpr-items-center cpr-gap-15">
                                <span class="cpr-font-medium cpr-text-white">{name}</span>
                                {x2 && (
                                  <span class="cpr-tactical-badge cpr-tactical-badge-amber">
                                    x2
                                  </span>
                                )}
                              </div>
                              <span class="cpr-font-mono cpr-text-nano cpr-text-muted">
                                {linkedStat.toUpperCase()} ({statVal})
                              </span>
                            </div>

                            {instances.map((inst, i) => {
                              const base = skillBase(statVal, inst.level);
                              return (
                                <div key={i} class="cpr-flex cpr-items-center cpr-gap-2 cpr-pl-2">
                                  {canEdit ? (
                                    <input
                                      type="text"
                                      class={`cpr-flex-1 ${INPUT_CLS}`}
                                      value={inst.name}
                                      placeholder="Especificar nombre"
                                      onBlur={(e) => {
                                        const next = instances.map((it, idx) =>
                                          idx === i ? { ...it, name: e.currentTarget.value } : it,
                                        );
                                        handleRepeatableChange(key, next);
                                      }}
                                    />
                                  ) : (
                                    <span class="cpr-flex-1 cpr-truncate cpr-text-muted">{inst.name || "—"}</span>
                                  )}

                                  <div class="cpr-flex cpr-items-center cpr-gap-1">
                                    {canEdit && (
                                      <button
                                        type="button"
                                        class="cpr-btn-icon cpr-w-5 cpr-h-5"
                                        disabled={busy || inst.level <= 0}
                                        onClick={() => {
                                          const next = instances.map((it, idx) =>
                                            idx === i ? { ...it, level: it.level - 1 } : it,
                                          );
                                          handleRepeatableChange(key, next);
                                        }}
                                      >
                                        −
                                      </button>
                                    )}
                                    <span class="cpr-w-6 cpr-text-center cpr-font-mono cpr-font-bold cpr-text-white">{inst.level}</span>
                                    {canEdit && (
                                      <button
                                        type="button"
                                        class="cpr-btn-icon cpr-w-5 cpr-h-5"
                                        disabled={busy || inst.level >= SKILL_MAX}
                                        onClick={() => {
                                          const next = instances.map((it, idx) =>
                                            idx === i ? { ...it, level: it.level + 1 } : it,
                                          );
                                          handleRepeatableChange(key, next);
                                        }}
                                      >
                                        +
                                      </button>
                                    )}
                                  </div>

                                  {/* Total Base Badge */}
                                  <div class="cpr-tactical-badge cpr-tactical-badge-amber" title={`1d10 + ${base}`}>
                                    <span class="cpr-text-nano cpr-uppercase cpr-font-bold">Base</span>
                                    <span class="cpr-font-mono cpr-text-xs cpr-font-black">{base}</span>
                                  </div>

                                  {canEdit && (
                                    <button
                                      type="button"
                                      class="cpr-btn-danger"
                                      onClick={() => {
                                        const next = instances.filter((_, idx) => idx !== i);
                                        handleRepeatableChange(key, next);
                                      }}
                                      title="Quitar instancia"
                                    >
                                      ×
                                    </button>
                                  )}
                                </div>
                              );
                            })}

                            {canEdit && (
                              <button
                                type="button"
                                class="cpr-btn-secondary cpr-text-nano cpr-pl-2 cpr-pt-05"
                                onClick={() => {
                                  const next = [...instances, { name: "", level: 0 }];
                                  handleRepeatableChange(key, next);
                                }}
                              >
                                + Añadir especialización
                              </button>
                            )}
                          </div>
                        );
                      }

                      const level = typeof skillVal === "number" ? skillVal : basic ? 2 : 0;
                      const base = skillBase(statVal, level);

                      return (
                        <div key={key} class="cpr-skill-row">
                          <div class="cpr-skill-info">
                            <span class="cpr-skill-name cpr-truncate">{name}</span>
                            {x2 && (
                              <span class="cpr-tactical-badge cpr-tactical-badge-amber">
                                x2
                              </span>
                            )}
                          </div>

                          <div class="cpr-skill-meta">
                            <span class="cpr-font-mono cpr-text-nano cpr-text-dim cpr-w-12 cpr-text-right">
                              {linkedStat.toUpperCase()} {statVal}
                            </span>

                            {/* Level Controls */}
                            <div class="cpr-flex cpr-items-center cpr-gap-1">
                              {canEdit && (
                                <button
                                  type="button"
                                  class="cpr-btn-icon cpr-w-5 cpr-h-5"
                                  disabled={busy || level <= 0}
                                  onClick={() => handleSkillLevelChange(key, level - 1)}
                                >
                                  −
                                </button>
                              )}
                              <span class="cpr-w-6 cpr-text-center cpr-font-mono cpr-font-bold cpr-text-white">{level}</span>
                              {canEdit && (
                                <button
                                  type="button"
                                  class="cpr-btn-icon cpr-w-5 cpr-h-5"
                                  disabled={busy || level >= SKILL_MAX}
                                  onClick={() => handleSkillLevelChange(key, level + 1)}
                                >
                                  +
                                </button>
                              )}
                            </div>

                            {/* Total Base Badge */}
                            <div
                              class="cpr-tactical-badge cpr-tactical-badge-amber cpr-w-16 cpr-justify-center"
                              title={`Tirada: 1d10 + ${base} (STAT ${statVal} + Habilidad ${level})`}
                            >
                              <span class="cpr-text-nano cpr-uppercase cpr-font-bold">Base</span>
                              <span class="cpr-font-mono cpr-text-xs cpr-font-black">{base}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 3: Biography, Lifepath & Enemies */}
      {activeTab === "profile" && (
        <div class="cpr-space-y-3">
          {/* Lifepath Fields */}
          <div class="cpr-grid-3">
            {PROFILE_FIELDS.map(([key, label, long]) => {
              const val = profile[key];
              const strVal = typeof val === "string" ? val : "";
              return (
                <div key={key}>
                  <label class="cpr-field">
                    <span class="cpr-label">{label}</span>
                    {long ? (
                      <textarea
                        rows={3}
                        class={`cpr-textarea ${INPUT_CLS}`}
                        disabled={!canEdit}
                        value={strVal}
                        onBlur={(e) => handleProfileField(key, e.currentTarget.value)}
                      />
                    ) : (
                      <input
                        type="text"
                        class={INPUT_CLS}
                        disabled={!canEdit}
                        value={strVal}
                        onBlur={(e) => handleProfileField(key, e.currentTarget.value)}
                      />
                    )}
                  </label>
                </div>
              );
            })}
          </div>

          {/* Enemies Block */}
          <div class={SECTION_CLS}>
            <div class="cpr-flex cpr-items-center cpr-justify-between">
              <span class="cpr-font-bold cpr-uppercase cpr-tracking-wider cpr-text-muted cpr-text-nano">
                Enemigos ({enemies.length})
              </span>
              {canEdit && (
                <button type="button" class={BTN_GHOST} onClick={handleAddEnemy}>
                  + Añadir enemigo
                </button>
              )}
            </div>

            {enemies.length === 0 ? (
              <p class="cpr-text-xs cpr-text-dim cpr-italic">No tienes enemigos registrados aún.</p>
            ) : (
              <div class="cpr-space-y-2">
                {enemies.map((enemy, idx) => (
                  <div key={idx} class="cpr-tactical-tile cpr-space-y-2">
                    <div class="cpr-flex cpr-items-center cpr-justify-between">
                      <span class="cpr-text-nano cpr-font-bold cpr-uppercase cpr-tracking-wider cpr-text-amber">
                        Enemigo #{idx + 1}
                      </span>
                      {canEdit && (
                        <button
                          type="button"
                          class="cpr-btn-danger"
                          onClick={() => handleRemoveEnemy(idx)}
                        >
                          Eliminar
                        </button>
                      )}
                    </div>

                    <div class="cpr-grid-2">
                      <label class="cpr-field">
                        <span class="cpr-label">¿Quién?</span>
                        <input
                          type="text"
                          class={INPUT_CLS}
                          disabled={!canEdit}
                          value={enemy.who}
                          onBlur={(e) => handleEnemyUpdate(idx, "who", e.currentTarget.value)}
                        />
                      </label>
                      <label class="cpr-field">
                        <span class="cpr-label">¿Qué lo causó?</span>
                        <input
                          type="text"
                          class={INPUT_CLS}
                          disabled={!canEdit}
                          value={enemy.cause}
                          onBlur={(e) => handleEnemyUpdate(idx, "cause", e.currentTarget.value)}
                        />
                      </label>
                      <label class="cpr-field">
                        <span class="cpr-label">¿Qué puede lanzarme?</span>
                        <input
                          type="text"
                          class={INPUT_CLS}
                          disabled={!canEdit}
                          value={enemy.threat}
                          onBlur={(e) => handleEnemyUpdate(idx, "threat", e.currentTarget.value)}
                        />
                      </label>
                      <label class="cpr-field">
                        <span class="cpr-label">¿Qué va a pasar?</span>
                        <input
                          type="text"
                          class={INPUT_CLS}
                          disabled={!canEdit}
                          value={enemy.future}
                          onBlur={(e) => handleEnemyUpdate(idx, "future", e.currentTarget.value)}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}