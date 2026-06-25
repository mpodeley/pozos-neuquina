import { useMemo, useState } from 'react'
import { useWells } from '../hooks/useData'
import { colors, selectStyle, space } from '../theme'
import { fmt, fmtInt, ventanaColor } from '../utils/format'
import { ErrorMsg, Field, Loading, Panel } from './ui'
import type { WellRow } from '../types'

type Col = { key: keyof WellRow; label: string; num?: boolean; fmt?: (v: any) => string }

const COLS: Col[] = [
  { key: 'sigla', label: 'Sigla' },
  { key: 'empresa', label: 'Empresa' },
  { key: 'area', label: 'Bloque' },
  { key: 'formacion', label: 'Formación' },
  { key: 'ventana', label: 'Ventana' },
  { key: 'vintage', label: 'Añada', num: true, fmt: (v) => fmtInt(v) },
  { key: 'rama_m', label: 'Rama (m)', num: true, fmt: (v) => fmtInt(v) },
  { key: 'fracturas', label: 'Frac.', num: true, fmt: (v) => fmtInt(v) },
  { key: 'peak_gas_mmm3d', label: 'Pico gas (MMm³/d)', num: true, fmt: (v) => fmt(v, 2) },
  { key: 'peak_oil_m3d', label: 'Pico oil (m³/d)', num: true, fmt: (v) => fmt(v, 0) },
  { key: 'eur_gas_mmm3', label: 'EUR gas (MMm³)', num: true, fmt: (v) => fmt(v, 0) },
  { key: 'eur_oil_mm3', label: 'EUR oil (Mm³)', num: true, fmt: (v) => fmt(v, 0) },
  { key: 'eur_gas_por_km', label: 'EUR gas/1000m', num: true, fmt: (v) => fmt(v, 0) },
]

const PAGE = 250

export default function PozosTabla() {
  const wellsS = useWells()
  const [q, setQ] = useState('')
  const [form, setForm] = useState('__all__')
  const [vent, setVent] = useState('__all__')
  const [sortKey, setSortKey] = useState<keyof WellRow>('eur_gas_mmm3')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)

  const wells = wellsS.data ?? []
  const formaciones = useMemo(() => [...new Set(wells.map((w) => w.formacion).filter(Boolean))].sort(), [wells])
  const ventanas = useMemo(() => [...new Set(wells.map((w) => w.ventana).filter(Boolean))].sort(), [wells])

  const rows = useMemo(() => {
    const f = q.trim().toLowerCase()
    let r = wells.filter((w) =>
      (form === '__all__' || w.formacion === form) &&
      (vent === '__all__' || w.ventana === vent) &&
      (!f || w.sigla.toLowerCase().includes(f) || w.empresa.toLowerCase().includes(f) || w.area.toLowerCase().includes(f)),
    )
    r = [...r].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir
      return String(av).localeCompare(String(bv)) * sortDir
    })
    return r
  }, [wells, q, form, vent, sortKey, sortDir])

  if (wellsS.loading) return <Loading what="pozos" />
  if (wellsS.error) return <ErrorMsg error={wellsS.error} />

  const setSort = (k: keyof WellRow) => {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(-1) }
  }

  return (
    <Panel
      title={`Pozos — ${fmtInt(rows.length)} de ${fmtInt(wells.length)}`}
      right={<a href="./data/wells.csv" download style={{ fontSize: 13 }}>⬇ Descargar CSV completo</a>}
    >
      <div style={{ display: 'flex', gap: space.lg, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: space.md }}>
        <Field label="Buscar">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="sigla / empresa / bloque" style={{ ...selectStyle, minWidth: 220 }} />
        </Field>
        <Field label="Formación">
          <select value={form} onChange={(e) => setForm(e.target.value)} style={selectStyle}>
            <option value="__all__">Todas</option>
            {formaciones.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="Ventana">
          <select value={vent} onChange={(e) => setVent(e.target.value)} style={selectStyle}>
            <option value="__all__">Todas</option>
            {ventanas.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              {COLS.map((c) => (
                <th
                  key={String(c.key)}
                  onClick={() => setSort(c.key)}
                  style={{
                    textAlign: c.num ? 'right' : 'left', padding: '6px 8px', cursor: 'pointer',
                    color: c.key === sortKey ? colors.textPrimary : colors.textMuted,
                    fontSize: 12, borderBottom: `1px solid ${colors.border}`, whiteSpace: 'nowrap',
                    position: 'sticky', top: 0, background: colors.surface,
                  }}
                >
                  {c.label}{c.key === sortKey ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, PAGE).map((w) => (
              <tr key={w.id} style={{ borderBottom: `1px solid ${colors.surfaceAlt}` }}>
                {COLS.map((c) => {
                  const v = w[c.key]
                  if (c.key === 'ventana') {
                    return <td key={String(c.key)} style={{ padding: '5px 8px' }}>
                      <span style={{ color: ventanaColor(w.ventana), fontSize: 12 }}>{w.ventana}</span>
                    </td>
                  }
                  return (
                    <td key={String(c.key)} style={{ padding: '5px 8px', textAlign: c.num ? 'right' : 'left', whiteSpace: 'nowrap', color: colors.textSecondary }}>
                      {c.fmt ? c.fmt(v) : (v ?? '—')}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > PAGE && (
        <div style={{ color: colors.textDim, fontSize: 12, marginTop: 8 }}>
          Mostrando los primeros {PAGE}. Refiná con los filtros o descargá el CSV completo.
        </div>
      )}
    </Panel>
  )
}
