import { useMemo, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useWells } from '../hooks/useData'
import { colors, selectStyle, space } from '../theme'
import { fmt, fmtInt } from '../utils/format'
import { stageColor } from '../utils/play'
import { ErrorMsg, Field, Loading, Panel, Seg } from './ui'
import type { WellRow } from '../types'

type Fluid = 'gas' | 'oil'
type Split = 'none' | 'pc' | 'zona'
const BUCKETS = ['SSD', 'SD', 'HD', 'HD+', 'UHD+']
const BUCKET_COLORS: Record<string, string> = {
  SSD: '#94a3b8', SD: '#3b82f6', HD: '#10b981', 'HD+': '#f59e0b', 'UHD+': '#ef4444',
}
const PC_COLORS: Record<string, string> = {
  parent: '#3b82f6', child: '#ef4444', confined: '#8b5cf6', standalone: '#10b981',
}
const PC_ORDER = ['standalone', 'parent', 'confined', 'child']

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export default function Completion() {
  const wellsS = useWells()
  const [fluid, setFluid] = useState<Fluid>('gas')
  const [split, setSplit] = useState<Split>('pc')
  const [landing, setLanding] = useState('__all__')
  const [area, setArea] = useState('__all__')
  const [vent, setVent] = useState('__all__')

  const wells = wellsS.data ?? []
  const metricKey = fluid === 'gas' ? 'cum5y_gas_norm' : 'cum5y_oil_norm'
  const unit = fluid === 'gas' ? 'BCF' : 'kbbl'

  const landings = useMemo(
    () => [...new Set(wells.map((w) => w.landing).filter(Boolean))].sort() as string[],
    [wells],
  )
  const areas = useMemo(
    () => [...new Set(wells.filter((w) => w[metricKey] != null).map((w) => w.area).filter(Boolean))]
      .sort() as string[],
    [wells, metricKey],
  )
  const ventanas = useMemo(
    () => [...new Set(wells.map((w) => w.ventana).filter(Boolean))].sort() as string[],
    [wells],
  )

  const base = useMemo(
    () => wells.filter((w) => w[metricKey] != null && w.completion_bucket &&
      (landing === '__all__' || w.landing === landing) &&
      (area === '__all__' || w.area === area) &&
      (vent === '__all__' || w.ventana === vent)),
    [wells, metricKey, landing, area, vent],
  )

  const splitVals = useMemo(() => {
    if (split === 'none') return ['Todos']
    if (split === 'pc') return PC_ORDER.filter((p) => base.some((w) => w.tipo_pc === p))
    return [...new Set(base.map((w) => w.landing_zona).filter(Boolean))].sort() as string[]
  }, [base, split])

  const splitKey = (w: WellRow): string =>
    split === 'none' ? 'Todos' : split === 'pc' ? (w.tipo_pc ?? '—') : (w.landing_zona ?? '—')

  const data = useMemo(() => {
    return BUCKETS.map((bucket) => {
      const row: Record<string, number | string | null> = { bucket }
      for (const sv of splitVals) {
        const vals = base.filter((w) => w.completion_bucket === bucket && splitKey(w) === sv)
          .map((w) => w[metricKey] as number)
        row[sv] = vals.length >= 3 ? median(vals) : null
        row[`${sv}__n`] = vals.length
      }
      return row
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, splitVals, split, metricKey])

  // increments vs SD per split group
  const increments = useMemo(() => {
    return splitVals.map((sv) => {
      const med = (b: string) => {
        const vals = base.filter((w) => w.completion_bucket === b && splitKey(w) === sv).map((w) => w[metricKey] as number)
        return vals.length >= 3 ? median(vals) : null
      }
      const sd = med('SD')
      const out: Record<string, number | null | string> = { sv }
      for (const b of BUCKETS) {
        const m = med(b)
        out[b] = m
        out[`${b}_pct`] = m != null && sd != null && sd > 0 ? (m / sd - 1) * 100 : null
      }
      return out
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, splitVals, split, metricKey])

  if (wellsS.loading) return <Loading what="completion" />
  if (wellsS.error) return <ErrorMsg error={wellsS.error} />

  const color = (sv: string) => split === 'pc' ? (PC_COLORS[sv] ?? colors.accent.gray)
    : split === 'none' ? colors.accent.blue : stageColor(sv)
  const tt = { background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 12 }

  return (
    <>
      <Panel>
        <div style={{ display: 'flex', gap: space.lg, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Fluido">
            <Seg value={fluid} onChange={setFluid} options={[{ value: 'gas', label: 'Gas' }, { value: 'oil', label: 'Petróleo' }]} />
          </Field>
          <Field label="Separar por">
            <Seg value={split} onChange={setSplit} options={[
              { value: 'pc', label: 'Parent/Child' }, { value: 'zona', label: 'Zona VM' }, { value: 'none', label: 'Nada' }]} />
          </Field>
          <Field label="Landing">
            <select value={landing} onChange={(e) => setLanding(e.target.value)} style={selectStyle}>
              <option value="__all__">Todos</option>
              {landings.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="Bloque">
            <select value={area} onChange={(e) => setArea(e.target.value)} style={{ ...selectStyle, maxWidth: 200 }}>
              <option value="__all__">Todos</option>
              {areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="Ventana">
            <select value={vent} onChange={(e) => setVent(e.target.value)} style={selectStyle}>
              <option value="__all__">Todas</option>
              {ventanas.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
          <div style={{ color: colors.textDim, fontSize: 12 }}>{fmtInt(base.length)} pozos con métrica</div>
        </div>
        <div style={{ color: colors.accent.orange, fontSize: 12, marginTop: space.sm }}>
          ⚠ Basin-wide la intensidad de completion correlaciona con el reservorio (los UHD+ se concentran en áreas
          ricas). Para aislar el efecto de la completion, filtrá por <strong>bloque + ventana + landing</strong>
          (como el estudio, que analiza un bloque) o usá el mapa IDW (normaliza por posición).
        </div>
      </Panel>

      <Panel title={`Productividad (cum 5 años ${fluid}, ${unit} norm. a 3000 m) por intensidad de completion`}>
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
            <XAxis dataKey="bucket" tick={{ fill: colors.textMuted, fontSize: 13 }} />
            <YAxis tick={{ fill: colors.textMuted, fontSize: 12 }} width={48}
              label={{ value: unit, angle: -90, position: 'insideLeft', fill: colors.textDim, fontSize: 12 }} />
            <Tooltip contentStyle={tt} cursor={{ fill: colors.surfaceAlt }}
              formatter={(v: number, n) => [v == null ? '—' : fmt(v, 2), n]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {splitVals.map((sv) => (
              <Bar key={sv} dataKey={sv} name={sv} fill={color(sv)} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
        <div style={{ color: colors.textDim, fontSize: 12, marginTop: 4 }}>
          Cum 5 años por curva de declinación, normalizada a 3000 m de rama. SSD&lt;1500 · SD 1500-2500 · HD 2500-3000 ·
          HD+ 3000-3500 · UHD+ &gt;3500 lbs/ft. El efecto de la completion se ve más claro en parent/standalone que en child.
        </div>
      </Panel>

      <Panel title="Incremental de productividad vs SD (mediana por grupo)">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={th(false)}>Grupo</th>
              {BUCKETS.map((b) => <th key={b} style={th(true)}>{b}</th>)}
            </tr>
          </thead>
          <tbody>
            {increments.map((r) => (
              <tr key={String(r.sv)}>
                <td style={td(false)}><span style={{ color: color(String(r.sv)), fontWeight: 600 }}>{String(r.sv)}</span></td>
                {BUCKETS.map((b) => {
                  const m = r[b] as number | null
                  const pct = r[`${b}_pct`] as number | null
                  return (
                    <td key={b} style={td(true)}>
                      {m != null ? fmt(m, 1) : '—'}
                      {pct != null && b !== 'SD' && (
                        <span style={{ color: pct >= 0 ? colors.oil : colors.gas, fontSize: 11 }}> {pct >= 0 ? '+' : ''}{pct.toFixed(0)}%</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ color: colors.textDim, fontSize: 12, marginTop: 8 }}>
          % vs SD del mismo grupo. En el estudio de Fortín de Piedra: HD ~+18-22%, HD+ ~+23-33%, UHD+ ~+37-57% en
          pozos standalone/parent (separar reservorio de completion requiere normalización por posición — ver Mapa IDW).
        </div>
      </Panel>
    </>
  )
}

const th = (num: boolean): React.CSSProperties => ({
  textAlign: num ? 'right' : 'left', padding: '6px 10px', color: colors.textMuted, fontSize: 12,
  borderBottom: `1px solid ${colors.border}`,
})
const td = (num: boolean): React.CSSProperties => ({ textAlign: num ? 'right' : 'left', padding: '5px 10px' })
