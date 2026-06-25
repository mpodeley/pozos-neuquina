// Client-side Arps evaluation, mirroring scripts/arps.py, so the decline page can
// draw a smooth fitted curve from (qi, di, b) without shipping dense arrays.

export function arpsQ(t: number, qi: number, di: number, b: number): number {
  if (b < 1e-4) return qi * Math.exp(-di * t)
  return qi / Math.pow(1 + b * di * t, 1 / b)
}

/** Smooth curve points for t = 0..tmax (months since peak). */
export function arpsCurve(
  qi: number,
  di: number,
  b: number,
  tmax: number,
  scale = 1,
): { t: number; q: number }[] {
  const out: { t: number; q: number }[] = []
  for (let t = 0; t <= tmax; t++) out.push({ t, q: arpsQ(t, qi, di, b) * scale })
  return out
}
