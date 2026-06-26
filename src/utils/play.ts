// Vaca Muerta play constants (EIA) + maturity helpers, mirroring scripts/build_blocks.py.
// EIA: 308 Tcf / 16 Bbbl technically recoverable; 1202 Tcf / 270 Bbbl in-place.

export const PLAY = {
  REC_GAS_TCF: 308,
  REC_OIL_BBBL: 16,
  GIP_TCF: 1202,
  OIP_BBBL: 270,
  TCF_TO_MMM3: 28320,
  BBL_TO_M3: 1 / 6.2898,
  FULL_DEV_DENSITY: 3.0,
  KBOE_GAS: 6.07, // per MMm³ gas
  KBOE_OIL: 6.29, // per Mm³ oil
}
export const RF_ULT_GAS = PLAY.REC_GAS_TCF / PLAY.GIP_TCF // ≈ 0.256
export const RF_ULT_OIL = PLAY.REC_OIL_BBBL / PLAY.OIP_BBBL // ≈ 0.059
export const GIP_TOTAL_MMM3 = PLAY.GIP_TCF * PLAY.TCF_TO_MMM3
export const OIP_TOTAL_Mm3 = (PLAY.OIP_BBBL * 1e9 * PLAY.BBL_TO_M3) / 1000

/** EUR total in kBOE from gas (MMm³) + oil (Mm³). */
export function eurBoe(eurGasMMm3: number, eurOilMm3: number): number {
  return eurGasMMm3 * PLAY.KBOE_GAS + eurOilMm3 * PLAY.KBOE_OIL
}

export const STAGE_ORDER = [
  'Piloto/exploratorio',
  'Desarrollo temprano',
  'Desarrollo activo',
  'Maduro',
  'Declinación',
]
const STAGE_COLORS: Record<string, string> = {
  'Piloto/exploratorio': '#64748b',
  'Desarrollo temprano': '#3b82f6',
  'Desarrollo activo': '#10b981',
  Maduro: '#f59e0b',
  Declinación: '#ef4444',
}
export function stageColor(s: string): string {
  return STAGE_COLORS[s] ?? '#64748b'
}
