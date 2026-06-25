// Design tokens. Mirrors estado_del_sistema so the two dashboards feel related.

export const colors = {
  bg: '#0f172a',
  surface: '#1e293b',
  surfaceAlt: '#172033',
  border: '#334155',
  textPrimary: '#f1f5f9',
  textSecondary: '#e2e8f0',
  textMuted: '#94a3b8',
  textDim: '#64748b',
  gas: '#ef4444',     // gas → red
  oil: '#10b981',     // petróleo → green
  water: '#3b82f6',
  band: '#3b82f6',
  accent: {
    blue: '#3b82f6',
    green: '#10b981',
    orange: '#f59e0b',
    red: '#ef4444',
    purple: '#8b5cf6',
    cyan: '#06b6d4',
    pink: '#ec4899',
    lime: '#84cc16',
    gray: '#6b7280',
  },
} as const

// Distinct categorical palette for cohorts / series overlays.
export const palette = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#a855f7',
  '#14b8a6', '#eab308',
] as const

// Operator brand-ish colors (fallback to palette by hash for the rest).
export const OPERATOR_COLORS: Record<string, string> = {
  'YPF S.A.': '#3b82f6',
  'PLUSPETROL S.A.': '#10b981',
  'TECPETROL S.A.': '#f59e0b',
  'VISTA ENERGY ARGENTINA S.A.U.': '#ef4444',
  'SHELL ARGENTINA S.A.': '#eab308',
  'PAMPA ENERGIA S.A.': '#8b5cf6',
  'TOTAL AUSTRAL S.A.': '#06b6d4',
  'PAN AMERICAN ENERGY S.L.': '#f97316',
  'PHOENIX GLOBAL RESOURCES S.A.': '#ec4899',
  'CAPEX S.A.': '#84cc16',
}

export const radius = { sm: 6, md: 8, lg: 12, pill: 20 } as const
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 32 } as const

export const card: React.CSSProperties = {
  background: colors.surface,
  borderRadius: radius.lg,
  padding: space.xl,
  border: `1px solid ${colors.border}`,
}

export const sectionTitle: React.CSSProperties = {
  marginBottom: space.md,
  color: colors.textMuted,
  fontSize: 13,
  textTransform: 'uppercase',
  letterSpacing: 1,
}

export const badge = (color: string): React.CSSProperties => ({
  background: color + '22',
  color,
  padding: '2px 10px',
  borderRadius: radius.pill,
  fontSize: 11,
  fontWeight: 700,
})

export const selectStyle: React.CSSProperties = {
  background: colors.surfaceAlt,
  color: colors.textPrimary,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
  padding: '6px 10px',
  fontSize: 13,
}
