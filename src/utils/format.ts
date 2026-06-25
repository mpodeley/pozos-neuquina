import { OPERATOR_COLORS, palette, colors } from '../theme'

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** "2024-03" → "mar 24". */
export function formatMes(mes: string | null | undefined): string {
  if (!mes || mes.length < 7) return mes ?? ''
  const [y, m] = mes.split('-').map(Number)
  return `${MESES[m - 1]} ${String(y).slice(2)}`
}

/** Compact number formatter with Spanish thousands sep. */
export function fmt(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return n.toLocaleString('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return Math.round(n).toLocaleString('es-AR')
}

let hashCounter = 0
const hashCache = new Map<string, string>()
function hashColor(key: string): string {
  const cached = hashCache.get(key)
  if (cached) return cached
  const color = palette[hashCounter % palette.length]
  hashCounter++
  hashCache.set(key, color)
  return color
}

export function operatorColor(empresa: string): string {
  return OPERATOR_COLORS[empresa] ?? hashColor(empresa)
}

export const VENTANA_COLORS: Record<string, string> = {
  petróleo: colors.oil,
  'petróleo volátil': colors.accent.lime,
  'gas húmedo / condensado': colors.accent.orange,
  'gas seco': colors.gas,
  'sin producción': colors.textDim,
}
export function ventanaColor(v: string): string {
  return VENTANA_COLORS[v] ?? colors.accent.gray
}

/** Shorten "YPF S.A." style names for tight axis labels. */
export function shortEmpresa(empresa: string): string {
  return empresa
    .replace(/\s+S\.?A\.?(\.?U\.?)?$/i, '')
    .replace(/\s+S\.?R\.?L\.?$/i, '')
    .replace(/\s+ARGENTINA$/i, '')
    .replace(/\s+ENERGY?$/i, '')
    .replace(/\s+ENERGIA$/i, '')
    .trim()
}

export function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1))
}
