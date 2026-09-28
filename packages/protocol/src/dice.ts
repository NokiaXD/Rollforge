export type DiceRoll = {
  sign: 1 | -1;
  count: number;
  sides: number;
  kept?: number;
  fudge?: true;
};

export type DiceTermResult = {
  roll: DiceRoll;
  rolls: number[];
  kept: number[];
  dropped: number[];
  subtotal: number;
};

export type DiceResult = {
  notation: string;
  terms: DiceTermResult[];
  modifier: number;
  total: number;
};

export type RollActorRef =
  | { type: "user" }
  | { type: "character"; characterId: string };

export type RollActor =
  | { type: "user"; userId: string; name: string }
  | { type: "character"; characterId: string; name: string };
