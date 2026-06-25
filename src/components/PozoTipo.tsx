import { useMemo, useState } from 'react'
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useTypeWells } from '../hooks/useData'
import { colors, palette, selectStyle, space } from '../theme'
import { fmt, fmtInt, operatorColor, ventanaColor } from '../utils/format'
import { ErrorMsg, Field, Loading, Panel, Seg } from './ui'
import type { Cohort } from '../types'

type Fluid = 'gas' | 'oil'
const GROUPS = [
  { value: 'formacion', label: 'Formación' },
  { value: 'vintage', label: 'Añada (VM)' },
  { value: 'empresa', label: 'Operador (VM)' },
  { value: 'ventana', label: 'Ventana (VM)' },
]

function cohortColor(group: string, key: string, i: number): string {
  if (group === 'empresa') return operatorColor(key)
  if (group === 'ventana') return ventanaColor(key)
  return palette[i % palette.length]
}

export default function PozoTipo() {
  const tw = useTypeWells()
  const [group, setGroup] = useState('vintage')
  const [fluid, setFluid] = useState<Fluid>('gas')
  const [norm, setNorm] = useState(false)
  const [selected, setSelected] = useState<string[]>([])

  const cohorts = useMemo(
    () => (tw.data?.cohorts ?? []).filter((c) => c.group === group),
    [tw.data, group],
  )

  // default selection: largest cohort in the group
  const sel = useMemo(() => {
    const valid = selected.filter((k) => cohorts.some((c) => c.key === k))
    if (valid.length) return valid
    const biggest = [...cohorts].sort((a, b) => b.n_wells - a.n_wells)[0]
    return biggest ? [biggest.key] : []
  }, [selected, cohorts])

  const selCohorts = useMemo(() => cohorts.filter((c) => sel.includes(c.key)), [cohorts, sel])

  const arrs = (c: Cohort) => {
    if (fluid === 'gas') return norm
      ? { p10: c.gas_p10_km, p50: c.gas_p50_km, p90: c.gas_p90_km }
      : { p10: c.gas_p10, p50: c.gas_p50, p90: c.gas_p90 }
    return norm
      ? { p10: c.oil_p10_km, p50: c.oil_p50_km, p90: c.oil_p90_km }
      : { p10: c.oil_p10, p50: c.oil_p50, p90: c.oil_p90 }
  }

  const data = useMemo(() => {
    const single = selCohorts.length === 1 ? selCohorts[0] : null
    const tmax = Math.max(0, ...selCohorts.map((c) => arrs(c).p50.length))
    const rows: Record<string, number | number[] | null>[] = []
    for (let t = 0; t < tmax; t++) {
      const row: Record<string, number | number[] | null> = { t }
      for (const c of selCohorts) {
        const a = arrs(c)
        row[c.key] = t < a.p50.length ? a.p50[t] : null
      }
      if (single) {
        const a = arrs(single)
        row.band = t < a.p10.length ? [a.p90[t], a.p10[t]] : null
      }
      rows.push(row)
    }
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selCohorts, fluid, norm])

  if (tw.loading) return <Loading what="pozos tipo" />
  if (tw.error) return <ErrorMsg error={tw.error} />

  const single = selCohorts.length === 1 ? selCohorts[0] : null
  const unit = fluid === 'gas'
    ? (norm ? 'MMm³/d por 1000m' : 'MMm³/d')
    : (norm ? 'm³/d por 1000m' : 'm³/d')

  return (
    <>
      <Panel>
        <div style={{ display: 'flex', gap: space.lg, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Agrupar por">
            <select value={group} onChange={(e) => { setGroup(e.target.value); setSelected([]) }} style={selectStyle}>
              {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </Field>
          <Field label="Fluido">
            <Seg value={fluid} onChange={setFluid} options={[{ value: 'gas', label: 'Gas' }, { value: 'oil', label: 'Petróleo' }]} />
          </Field>
          <Field label="Normalización">
            <Seg value={norm ? 'km' : 'abs'} onChange={(v) => setNorm(v === 'km')} options={[{ value: 'abs', label: 'Absoluto' }, { value: 'km', label: '/ 1000m rama' }]} />
          </Field>
        </div>
        <div style={{ marginTop: space.md, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {cohorts.map((c, i) => {
            const on = sel.includes(c.key)
            const col = cohortColor(group, c.key, cohorts.indexOf(c))
            return (
              <button
                key={c.key}
                onClick={() => {
                  setSelected((prev) => {
                    const base = prev.filter((k) => cohorts.some((cc) => cc.key === k))
                    const cur = base.length ? base : sel
                    return cur.includes(c.key) ? cur.filter((k) => k !== c.key) : [...cur, c.key]
                  })
                }}
                style={{
                  background: on ? col + '33' : 'transparent',
                  color: on ? colors.textPrimary : colors.textMuted,
                  border: `1px solid ${on ? col : colors.border}`,
                  borderRadius: 16, padding: '4px 12px', fontSize: 12, cursor: 'pointer',
                }}
              >
                {c.label} · {c.n_wells}
              </button>
            )
          })}
        </div>
      </Panel>

      <Panel title={`Pozo tipo — ${fluid === 'gas' ? 'gas' : 'petróleo'} (${unit})`}>
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 18, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
            <XAxis dataKey="t" type="number" tick={{ fill: colors.textMuted, fontSize: 12 }}
              label={{ value: 'meses en producción', position: 'insideBottom', offset: -8, fill: colors.textDim, fontSize: 12 }} />
            <YAxis tick={{ fill: colors.textMuted, fontSize: 12 }} width={64} domain={[0, 'auto']} />
            <Tooltip contentStyle={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 12 }}
              labelFormatter={(t) => `mes ${t}`} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {single && (
              <Area dataKey="band" name="P10–P90" stroke="none" fill={cohortColor(group, single.key, cohorts.indexOf(single))} fillOpacity={0.14} isAnimationActive={false} />
            )}
            {selCohorts.map((c) => (
              <Line key={c.key} type="monotone" dataKey={c.key} name={`${c.label} (P50)`}
                stroke={cohortColor(group, c.key, cohorts.indexOf(c))} strokeWidth={2.2} dot={false} isAnimationActive={false} connectNulls />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="EUR del pozo tipo (P50) por cohorte seleccionada">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Cohorte', 'Pozos', 'Con rama', 'Rama mediana (m)', 'EUR gas (MMm³)', 'EUR petróleo (Mm³)', 'Arps b (gas)'].map((h, i) => (
                <th key={h} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '6px 10px', color: colors.textMuted, fontSize: 12, borderBottom: `1px solid ${colors.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {selCohorts.map((c) => (
              <tr key={c.key}>
                <td style={{ textAlign: 'left', padding: '6px 10px', fontSize: 13 }}>
                  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: cohortColor(group, c.key, cohorts.indexOf(c)), marginRight: 8 }} />
                  {c.label}
                </td>
                <td style={td}>{fmtInt(c.n_wells)}</td>
                <td style={td}>{fmtInt(c.n_wells_rama)}</td>
                <td style={td}>{c.rama_mediana != null ? fmtInt(c.rama_mediana) : '—'}</td>
                <td style={td}>{fmt(c.type_eur_gas_mmm3, 1)}</td>
                <td style={td}>{fmt(c.type_eur_oil_mm3, 1)}</td>
                <td style={td}>{c.type_b_gas != null ? fmt(c.type_b_gas, 2) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ color: colors.textDim, fontSize: 12, marginTop: 8 }}>
          P10 = caso alto, P50 = mediana, P90 = caso bajo (convención petrolera). Tocá los chips para comparar cohortes.
        </div>
      </Panel>
    </>
  )
}

const td: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', fontSize: 13 }
