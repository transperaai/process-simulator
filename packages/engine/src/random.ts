// Seeded random helpers ported from the Northbeam prototype. `mulberry32` gives
// a deterministic stream per seed, which is what makes runs reproducible.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample via Box–Muller. */
export function randn(rng: Rng): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Lognormal sample with the given mean and coefficient of variation. */
export function lognormal(rng: Rng, mean: number, cv: number): number {
  if (mean <= 0) return 0;
  const s2 = Math.log(1 + cv * cv);
  const mu = Math.log(mean) - s2 / 2;
  return Math.exp(mu + Math.sqrt(s2) * randn(rng));
}

/** Exponential sample with the given mean. */
export function expo(rng: Rng, mean: number): number {
  return -Math.log(1 - rng()) * mean;
}
