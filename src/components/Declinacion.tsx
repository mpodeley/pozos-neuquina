import { useMemo, useState } from 'react'
import {
  CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useWellSeries, useWells } from '../hooks/useData'
import { colors, selectStyle, space } from '../theme'
import { arpsQ } from '../utils/arps'
import { fmt, fmtInt, formatMes, ventanaColor } from '../utils/format'
import { ErrorMsg, Field, Loading, Panel, Seg } from './ui'
import type { WellRow, WellSeries } from '../types'

type Fluid = 'gas' | 'oil'

export default function Declinacion() {
  const wellsS = useWells()
  const seriesS = useWellSeries()
  const [fluid, setFluid] = useState<Fluid>('gas')
  const [logY, setLogY] = useState(false)
  const [filter, setFilter] = useState('')
  const [selId, setSelId] = useState<number | null>(null)

  const wells = wellsS.data ?? []
  const seriesById = useMemo(() => {
    const m = new Map<number, WellSeries>()
    for (const s of seriesS.data?.wells ?? []) m.set(s.id, s)
    return m
  }, [seriesS.data])

  const matches = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const base = f
      ? wells.filter((w) => w.sigla.toLowerCase().includes(f) || w.empresa.toLowerCase().includes(f) || w.area.toLowerCase().includes(f))
      : wells
    const key = fluid === 'gas' ? 'eur_gas_mmm3' : 'eur_oil_mm3'
    return [...base].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0)).slice(0, 300)
  }, [wells, filter, fluid])

  const selected: WellRow | undefined = useMemo(() => {
    if (selId != null) return wells.find((w) => w.id === selId)
    return matches[0]
  }, [wells, selId, matches])

  const chart = useMemo(() => {
    if (!selected) return []
    const s = seriesById.get(selected.id)
    if (!s) return []
    const scale = fluid === 'gas' ? 1 / 1000 : 1
    const tPeak = (fluid === 'gas' ? selected.t_peak_gas : selected.t_peak_oil) ?? 0
    const qi = fluid === 'gas' ? selected.qi_gas : selected.qi_oil
    const di = fluid === 'gas' ? selected.di_gas : selected.di_oil
    const b = fluid === 'gas' ? selected.b_gas : selected.b_oil
    const arr = fluid === 'gas' ? s.gas : s.oil
    const tEnd = Math.min(s.n + 36, s.n + 120)
    const rows: { t: number; actual: number | null; fit: number | null }[] = []
    for (let t = 0; t < tEnd; t++) {
      let actual = t < s.n ? arr[t] * scale : null
      if (actual !== null && (actual <= 0 || (logY && actual <= 0))) actual = logY ? null : actual
      let fit: number | null = null
      if (qi != null && di != null && b != null && t >= tPeak) {
        const q = arpsQ(t - tPeak, qi, di, b) * scale
        fit = q > 0 ? q : null
      }
      rows.push({ t, actual, fit })
    }
    return rows
  }, [selected, seriesById, fluid, logY])

  if (wellsS.loading || seriesS.loading) return <Loading what="series por pozo" />
  if (wellsS.error) return <ErrorMsg error={wellsS.error} />
  if (seriesS.error) return <ErrorMsg error={seriesS.error} />

  const unit = fluid === 'gas' ? 'MMm³/d' : 'm³/d'

  return (
    <>
      <Panel>
        <div style={{ display: 'flex', gap: space.lg, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Buscar pozo (sigla / empresa / bloque)">
            <input
              value={filter}
              onChange={(e) => { setFilter(e.target.value); setSelId(null) }}
              placeholder="ej. Loma Campana, YPF, FDP…"
              style={{ ...selectStyle, minWidth: 240 }}
            />
          </Field>
          <Field label={`Pozo (top ${matches.length} por EUR ${fluid})`}>
            <select
              value={selected?.id ?? ''}
              onChange={(e) => setSelId(Number(e.target.value))}
              style={{ ...selectStyle, minWidth: 320 }}
            >
              {matches.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.sigla} — {w.empresa} ({w.area})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fluido">
            <Seg value={fluid} onChange={setFluid} options={[{ value: 'gas', label: 'Gas' }, { value: 'oil', label: 'Petróleo' }]} />
          </Field>
          <Field label="Eje Y">
            <Seg value={logY ? 'log' : 'lin'} onChange={(v) => setLogY(v === 'log')} options={[{ value: 'lin', label: 'Lineal' }, { value: 'log', label: 'Log' }]} />
          </Field>
        </div>
      </Panel>

      {selected && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: space.lg }}>
          <Panel title={`Declinación — ${selected.sigla} (${unit})`}>
            <ResponsiveContainer width="100%" height={380}>
              <ComposedChart data={chart} margin={{ top: 8, right: 16, bottom: 18, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
                <XAxis
                  dataKey="t" type="number"
                  tick={{ fill: colors.textMuted, fontSize: 12 }}
                  label={{ value: 'meses en producción', position: 'insideBottom', offset: -8, fill: colors.textDim, fontSize: 12 }}
                />
                <YAxis
                  scale={logY ? 'log' : 'auto'}
                  domain={logY ? ['auto', 'auto'] : [0, 'auto']}
                  allowDataOverflow
                  tick={{ fill: colors.textMuted, fontSize: 12 }}
                  width={56}
                />
                <Tooltip
                  contentStyle={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 12 }}
                  labelFormatter={(t) => `mes ${t}`}
                  formatter={(v: number, n) => [v == null ? '—' : fmt(v, fluid === 'gas' ? 3 : 1), n === 'actual' ? 'real' : 'ajuste Arps']}
                />
                <Line type="monotone" dataKey="actual" stroke={fluid === 'gas' ? colors.gas : colors.oil} strokeWidth={1.5} dot={{ r: 1.8 }} isAnimationActive={false} connectNulls />
                <Line type="monotone" dataKey="fit" stroke={colors.accent.orange} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
            <div style={{ color: colors.textDim, fontSize: 12, marginTop: 4 }}>
              Línea punteada: ajuste hiperbólico de Arps (con declinación terminal mínima para el EUR).
            </div>
          </Panel>

          <WellCard w={selected} fluid={fluid} />
        </div>
      )}
    </>
  )
}

function WellCard({ w, fluid }: { w: WellRow; fluid: Fluid }) {
  const di = fluid === 'gas' ? w.di_gas : w.di_oil
  const b = fluid === 'gas' ? w.b_gas : w.b_oil
  const r2 = fluid === 'gas' ? w.r2_gas : w.r2_oil
  const eur = fluid === 'gas' ? w.eur_gas_mmm3 : w.eur_oil_mm3
  const eurKm = fluid === 'gas' ? w.eur_gas_por_km : w.eur_oil_por_km
  const conf = fluid === 'gas' ? w.eur_conf_gas : w.eur_conf_oil
  const eurUnit = fluid === 'gas' ? 'MMm³' : 'Mm³'
  const confColor = conf === 'alta' ? colors.oil : conf === 'media' ? colors.accent.orange : colors.textDim
  const row = (k: string, v: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 13 }}>
      <span style={{ color: colors.textMuted }}>{k}</span>
      <span style={{ color: colors.textPrimary, textAlign: 'right' }}>{v}</span>
    </div>
  )
  return (
    <Panel title="Ficha del pozo">
      {row('Empresa', w.empresa)}
      {row('Bloque', w.area)}
      {row('Formación', w.formacion || '—')}
      {row('Reservorio', w.recurso || w.reservorio || '—')}
      <div style={{ padding: '3px 0' }}>
        <span style={{ background: ventanaColor(w.ventana) + '22', color: ventanaColor(w.ventana), padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
          {w.ventana}{w.gor != null ? ` · GOR ${fmtInt(w.gor)}` : ''}
        </span>
      </div>
      <hr style={{ border: 'none', borderTop: `1px solid ${colors.border}`, margin: '8px 0' }} />
      {row('Primer mes', formatMes(w.m0))}
      {row('Meses prod.', w.n_meses)}
      {row('Rama horiz.', w.rama_m ? `${fmtInt(w.rama_m)} m` : '—')}
      {row('Fracturas', w.fracturas || '—')}
      {row('Etapas/1000m', w.etapas_km != null ? fmt(w.etapas_km, 1) : '—')}
      <hr style={{ border: 'none', borderTop: `1px solid ${colors.border}`, margin: '8px 0' }} />
      {row(`EUR ${fluid}`, eur != null ? `${fmt(eur, 1)} ${eurUnit}` : '—')}
      {row('Confianza EUR', <span style={{ color: confColor, fontWeight: 600 }}>{conf ?? '—'}</span>)}
      {row('EUR / 1000m', eurKm != null ? `${fmt(eurKm, 1)} ${eurUnit}` : '—')}
      {row('Arps b', b != null ? fmt(b, 2) : '—')}
      {row('Di (1/mes)', di != null ? fmt(di, 3) : '—')}
      {row('R² ajuste', r2 != null ? fmt(r2, 2) : '—')}
    </Panel>
  )
}
