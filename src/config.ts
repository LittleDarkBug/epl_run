// Reglages globaux du gameplay et du rendu.

export const LANE_WIDTH = 2.5;
export const LANES = [-1, 0, 1] as const;

export const PLAYER = {
  height: 1.8,
  slideHeight: 0.85,
  halfWidth: 0.34,
  halfDepth: 0.35,
  gravity: 58,
  jumpVelocity: 17,
  superJumpVelocity: 24,
  laneChangeTime: 0.16,
  slideTime: 0.72,
};

export const SPEED = {
  start: 15,
  max: 34,
  // Nombre de metres pour atteindre ~63% de la vitesse max.
  rampDistance: 2600,
};

export const WORLD = {
  blockLength: 36,
  visibleAhead: 260,
  keepBehind: 40,
  spawnAhead: 190,
  bend: { x: 0.0, y: 0.00075 },
};

export const CHASER = {
  farDistance: 26,
  nearDistance: 2.8,
  warnTime: 6,
};

export const POWERUP_TIME = {
  magnet: 11,
  sneakers: 11,
  double: 13,
};

export const BUS_HEIGHT = 2.9;

export function laneX(lane: number): number {
  return lane * LANE_WIDTH;
}

// Course contre les autres etudiants (regle du top 2, elan des cahiers).
export const RACE = {
  runners: 5,
  top: 2,
  outLimit: 10, // secondes cumulees hors du top 2 avant la capture
  grace: 8, // secondes de depart sans penalite
  momentumPerCoin: 0.006,
  momentumMax: 0.12,
  momentumDecay: 0.025,
  stumbleSlow: 0.72,
  stumbleSlowTime: 1.3,
};
