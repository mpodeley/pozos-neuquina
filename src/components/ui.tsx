import type { ReactNode } from 'react'
import { card, colors, radius, sectionTitle, space } from '../theme'

export function Panel({
  title,
  right,
  children,
  style,
}: {
  title?: string
  right?: ReactNode
  children: ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div style={{ ...card, ...style }}>
      {(title || right) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          {title && <div style={sectionTitle}>{title}</div>}
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

export function Kpi({
  label,
  value,
  sub,
  color = colors.textPrimary,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  color?: string
}) {
  return (
    <div style={{ ...card, padding: space.lg, minWidth: 150 }}>
      <div style={{ color: colors.textMuted, fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div style={{ color, fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ color: colors.textDim, fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

export function Loading({ what = 'datos' }: { what?: string }) {
  return <div style={{ color: colors.textMuted, padding: space.xl }}>Cargando {what}…</div>
}

export function ErrorMsg({ error }: { error: Error }) {
  return (
    <div style={{ color: colors.gas, padding: space.xl }}>
      Error: {error.message}
    </div>
  )
}

/** Segmented control. */
export function Seg<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'inline-flex', border: `1px solid ${colors.border}`, borderRadius: radius.sm, overflow: 'hidden' }}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          style={{
            background: o.value === value ? colors.accent.blue : 'transparent',
            color: o.value === value ? '#fff' : colors.textMuted,
            border: 'none',
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: colors.textMuted }}>
      {label}
      {children}
    </label>
  )
}
