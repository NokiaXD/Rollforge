//  Night City Compendium — official statline templates, importable by the GM.

export interface Archetype {
  id: string;
  name: string;
  role: string;
  description: string;
  stats: Record<string, number>;
}

export const ARCHETYPES: readonly Archetype[] = [
  {
    id: "boosterganger",
    name: "Boosterganger de Maelstrom",
    role: "Mook / Calle",
    description: "Cibergamberro agresivo, armado con filo o pistola media.",
    stats: { int: 2, vol: 4, fri: 4, emp: 1, tec: 3, ref: 7, sue: 2, tco: 6, des: 6, mov: 6 },
  },
  {
    id: "arasaka-guard",
    name: "Seguridad de Arasaka",
    role: "Táctico / Corp",
    description: "Guardia entrenado, armadura pesada y rifle de asalto.",
    stats: { int: 5, vol: 6, fri: 6, emp: 3, tec: 4, ref: 8, sue: 3, tco: 7, des: 7, mov: 5 },
  },
  {
    id: "solo",
    name: "Solo Callejero",
    role: "Combatiente / Mercenario",
    description: "Pistolero profesional con reflejos aumentados para misiones difíciles.",
    stats: { int: 4, vol: 6, fri: 6, emp: 3, tec: 3, ref: 8, sue: 4, tco: 8, des: 8, mov: 6 },
  },
  {
    id: "netrunner",
    name: "Netrunner Callejero",
    role: "Hacker / Ciberespacio",
    description: "Infiltrador de redes con ciberterminal y programas ofensivos.",
    stats: { int: 8, vol: 6, fri: 5, emp: 4, tec: 7, ref: 6, sue: 5, tco: 4, des: 6, mov: 5 },
  },
  {
    id: "trauma-team",
    name: "Paramédico de Trauma Team",
    role: "Soporte / Táctico",
    description: "Rescatista armado dispuesto a disparar primero y salvar vidas después.",
    stats: { int: 7, vol: 6, fri: 7, emp: 5, tec: 8, ref: 6, sue: 4, tco: 6, des: 6, mov: 6 },
  },
  {
    id: "fixer",
    name: "Fixer de los Bajos Fondos",
    role: "Negociador / Contactos",
    description: "Intermediario que mueve la economía negra de Night City.",
    stats: { int: 7, vol: 6, fri: 8, emp: 8, tec: 4, ref: 5, sue: 6, tco: 4, des: 5, mov: 5 },
  },
  {
    id: "rockerboy",
    name: "Rockerboy Rebelde",
    role: "Líder / Icono",
    description: "Artista y agitador de masas en guerra cultural contra las megacorporaciones.",
    stats: { int: 5, vol: 7, fri: 8, emp: 8, tec: 4, ref: 6, sue: 5, tco: 5, des: 6, mov: 6 },
  },
];