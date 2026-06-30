import { useMemo, useState } from 'react'
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useWellSeries, useWellTags } from '../hooks/useData'
import { colors, space } from '../theme'
import { fmt, fmtInt } from '../utils/format'
import { ErrorMsg, Field, Loading, Panel, Seg } from './ui'
import type { WellSeries, WellTag } from '../types'

type Fluid = 'gas' | 'oil'
const TMAX = 120
const MIN_AT_T = 4

// Filter dimensions, in display order.
const DIMS: { key: keyof WellTag; label: string; sort?: 'desc' }[] = [
  { key: 'formacion', label: 'Formación' },
  { key: 'landing', label: 'Landing' },
  { key: 'tipo_pc', label: 'Parent/Child' },
  { key: 'completion_bucket', label: 'Completion' },
  { key: 'dist_bucket', label: 'Distanciam.' },
  { key: 'ventana', label: 'Ventana' },
  { key: 'vintage', label: 'Añada', sort: 'desc' },
]
const BUCKET_ORDER = ['SSD', 'SD', 'HD', 'HD+', 'UHD+']

function pct(arr: number[], q: number): number {
  const s = [...arr].sort((a, b) => a - b)
  const i = (q / 100) * (s.length - 1)
  const lo = Math.floor(i), hi = Math.ceil(i)
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo)
}

export default function PozoTipoMulti() {
  const seriesS = useWellSeries()
  const tagsS = useWellTags()
  const [fluid, setFluid] = useState<Fluid>('gas')
  const [norm, setNorm] = useState(false)
  const [sel, setSel] = useState<Record<string, Set<string>>>({})

  const tags = tagsS.data ?? []
  const seriesById = useMemo(() => {
    const m = new Map<number, WellSeries>()
    for (const s of seriesS.data?.wells ?? []) m.set(s.id, s)
    return m
  }, [seriesS.data])

  const options = useMemo(() => {
    const o: Record<string, string[]> = {}
    for (const d of DIMS) {
      const vals = [...new Set(tags.map((t) => t[d.key]).filter((v) => v != null).map(String))]
      vals.sort((a, b) => {
        if (d.key === 'completion_bucket') return BUCKET_ORDER.indexOf(a) - BUCKET_ORDER.indexOf(b)
        if (d.sort === 'desc') return Number(b) - Number(a)
        return a.localeCompare(b)
      })
      o[String(d.key)] = vals
    }
    return o
  }, [tags])

  const toggle = (dim: string, val: string) => setSel((prev) => {
    const s = new Set(prev[dim] ?? [])
    s.has(val) ? s.delete(val) : s.add(val)
    return { ...prev, [dim]: s }
  })

  const filtered = useMemo(() => {
    return tags.filter((t) => DIMS.every((d) => {
      const s = sel[String(d.key)]
      if (!s || s.size === 0) return true
      const v = t[d.key]
      return v != null && s.has(String(v))
    }))
  }, [tags, sel])

  const data = useMemo(() => {
    const scale = fluid === 'gas' ? 1 / 1000 : 1
    const rows: { t: number; band: [number, number] | null; p50: number | null }[] = []
    const ids = filtered.map((t) => ({ id: t.id, rama: t.rama }))
    for (let t = 0; t < TMAX; t++) {
      const vals: number[] = []
      for (const { id, rama } of ids) {
        const s = seriesById.get(id)
        if (!s || t >= s.n) continue
        let r = (fluid === 'gas' ? s.gas[t] : s.oil[t]) * scale
        if (norm) { if (!rama || rama <= 0) continue; r *= 3000 / rama }
        vals.push(r)
      }
      if (vals.length < MIN_AT_T) break
      rows.push({ t, band: [pct(vals, 10), pct(vals, 90)], p50: pct(vals, 50) })
    }
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, seriesById, fluid, norm])

  if (seriesS.loading || tagsS.loading) return <Loading what="pozos" />
  if (seriesS.error) return <ErrorMsg error={seriesS.error} />
  if (tagsS.error) return <ErrorMsg error={tagsS.error} />

  const unit = fluid === 'gas' ? (norm ? 'MMm³/d ·3000m' : 'MMm³/d') : (norm ? 'm³/d ·3000m' : 'm³/d')

  return (
    <>
      <Panel title="Filtros — combiná etiquetas (vacío = todas; dentro de una dimensión, suma)">
        <div style={{ display: 'flex', gap: space.lg, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: space.md }}>
          <Field label="Fluido">
            <Seg value={fluid} onChange={setFluid} options={[{ value: 'gas', label: 'Gas' }, { value: 'oil', label: 'Petróleo' }]} />
          </Field>
          <Field label="Normalización">
            <Seg value={norm ? 'km' : 'abs'} onChange={(v) => setNorm(v === 'km')} options={[{ value: 'abs', label: 'Absoluto' }, { value: 'km', label: '/3000m rama' }]} />
          </Field>
          <div style={{ color: colors.textPrimary, fontSize: 14, fontWeight: 700 }}>{fmtInt(filtered.length)} pozos</div>
          {Object.values(sel).some((s) => s && s.size > 0) && (
            <button onClick={() => setSel({})} style={{ background: 'transparent', color: colors.accent.blue, border: 'none', cursor: 'pointer', fontSize: 12 }}>limpiar filtros</button>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {DIMS.map((d) => (
            <div key={String(d.key)} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ color: colors.textMuted, fontSize: 12, width: 96, flexShrink: 0 }}>{d.label}</span>
              {options[String(d.key)].map((v) => {
                const on = sel[String(d.key)]?.has(v)
                return (
                  <button key={v} onClick={() => toggle(String(d.key), v)}
                    style={{
                      background: on ? colors.accent.blue + '33' : 'transparent',
                      color: on ? colors.textPrimary : colors.textDim,
                      border: `1px solid ${on ? colors.accent.blue : colors.border}`,
                      borderRadius: 12, padding: '2px 9px', fontSize: 11.5, cursor: 'pointer',
                    }}>{v}</button>
                )
              })}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title={`Pozo tipo del subconjunto filtrado — ${fluid} (${unit})`}>
        {data.length < 3 ? (
          <div style={{ color: colors.textMuted, padding: space.xl }}>
            Pocos pozos para una curva tipo con los filtros actuales (mínimo {MIN_AT_T} por mes).
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 18, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
              <XAxis dataKey="t" type="number" tick={{ fill: colors.textMuted, fontSize: 12 }}
                label={{ value: 'meses en producción', position: 'insideBottom', offset: -8, fill: colors.textDim, fontSize: 12 }} />
              <YAxis tick={{ fill: colors.textMuted, fontSize: 12 }} width={64} domain={[0, 'auto']} />
              <Tooltip contentStyle={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 12 }}
                labelFormatter={(t) => `mes ${t}`} formatter={(v: number, n) => [v == null ? '—' : fmt(v, fluid === 'gas' ? 3 : 1), n === 'band' ? 'P10–P90' : 'P50']} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area dataKey="band" name="P10–P90" stroke="none" fill={colors.accent.blue} fillOpacity={0.14} isAnimationActive={false} />
              <Line dataKey="p50" name="P50 (mediana)" stroke={fluid === 'gas' ? colors.gas : colors.oil} strokeWidth={2.4} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
        <div style={{ color: colors.textDim, fontSize: 12, marginTop: 4 }}>
          Curva tipo P10/P50/P90 calculada en vivo sobre los pozos que cumplen TODOS los filtros (yacimiento, landing,
          parent/child, completion, etc.). Normalizá a 3000 m de rama para comparar diseños de desarrollo.
        </div>
      </Panel>
    </>
  )
}
