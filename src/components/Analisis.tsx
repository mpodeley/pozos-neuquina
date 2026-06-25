import { useMemo, useState } from 'react'
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Scatter,
  ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts'
import { useWells } from '../hooks/useData'
import { colors, selectStyle, space } from '../theme'
import { fmt, fmtInt, ventanaColor } from '../utils/format'
import { ErrorMsg, Field, Loading, Panel, Seg } from './ui'
import type { WellRow } from '../types'

type Fluid = 'gas' | 'oil'

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export default function Analisis() {
  const wellsS = useWells()
  const [fluid, setFluid] = useState<Fluid>('gas')
  const [form, setForm] = useState('vaca muerta')

  const wells = wellsS.data ?? []
  const formaciones = useMemo(() => {
    const c = new Map<string, number>()
    for (const w of wells) c.set(w.formacion, (c.get(w.formacion) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f).filter(Boolean)
  }, [wells])

  const eurKey = fluid === 'gas' ? 'eur_gas_mmm3' : 'eur_oil_mm3'
  const eurKmKey = fluid === 'gas' ? 'eur_gas_por_km' : 'eur_oil_por_km'
  const eurUnit = fluid === 'gas' ? 'MMm³' : 'Mm³'

  const filtered = useMemo(
    () => wells.filter((w) => (form === '__all__' || w.formacion === form)),
    [wells, form],
  )

  // scatter EUR vs rama, grouped by ventana
  const byVentana = useMemo(() => {
    const groups = new Map<string, { x: number; y: number; sigla: string }[]>()
    for (const w of filtered) {
      const x = w.rama_m
      const y = w[eurKey]
      if (!x || x <= 0 || y == null || y <= 0) continue
      const g = groups.get(w.ventana) ?? []
      g.push({ x, y, sigla: w.sigla })
      groups.set(w.ventana, g)
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [filtered, eurKey])

  // productivity by vintage: median EUR/1000m and median lateral
  const byVintage = useMemo(() => {
    const m = new Map<number, { eurkm: number[]; rama: number[] }>()
    for (const w of filtered) {
      const e = m.get(w.vintage) ?? { eurkm: [], rama: [] }
      const v = w[eurKmKey]
      if (v != null && v > 0) e.eurkm.push(v)
      if (w.rama_m && w.rama_m > 0) e.rama.push(w.rama_m)
      m.set(w.vintage, e)
    }
    return [...m.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([anio, v]) => ({
        anio,
        eur_km: median(v.eurkm),
        rama: median(v.rama),
        n: v.eurkm.length,
      }))
      .filter((r) => r.n >= 3)
  }, [filtered, eurKmKey])

  if (wellsS.loading) return <Loading what="pozos" />
  if (wellsS.error) return <ErrorMsg error={wellsS.error} />

  const tt = { background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 12 }

  return (
    <>
      <Panel>
        <div style={{ display: 'flex', gap: space.lg, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Fluido">
            <Seg value={fluid} onChange={setFluid} options={[{ value: 'gas', label: 'Gas' }, { value: 'oil', label: 'Petróleo' }]} />
          </Field>
          <Field label="Formación">
            <select value={form} onChange={(e) => setForm(e.target.value)} style={selectStyle}>
              <option value="__all__">Todas</option>
              {formaciones.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
        </div>
      </Panel>

      <Panel title={`EUR ${fluid} (${eurUnit}) vs largo de rama horizontal — color por ventana`}>
        <ResponsiveContainer width="100%" height={380}>
          <ScatterChart margin={{ top: 8, right: 16, bottom: 20, left: 8 }}>
            <CartesianGrid stroke={colors.border} />
            <XAxis type="number" dataKey="x" name="rama" unit=" m" tick={{ fill: colors.textMuted, fontSize: 12 }}
              domain={['auto', 'auto']}
              label={{ value: 'largo de rama (m)', position: 'insideBottom', offset: -10, fill: colors.textDim, fontSize: 12 }} />
            <YAxis type="number" dataKey="y" name="EUR" tick={{ fill: colors.textMuted, fontSize: 12 }} width={64}
              label={{ value: `EUR (${eurUnit})`, angle: -90, position: 'insideLeft', fill: colors.textDim, fontSize: 12 }} />
            <ZAxis range={[18, 18]} />
            <Tooltip contentStyle={tt} cursor={{ strokeDasharray: '3 3' }}
              formatter={(v: number, n) => [n === 'EUR' ? fmt(v, 1) : fmtInt(v), n]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {byVentana.map(([ventana, pts]) => (
              <Scatter key={ventana} name={`${ventana} (${pts.length})`} data={pts} fill={ventanaColor(ventana)} fillOpacity={0.6} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
        <div style={{ color: colors.textDim, fontSize: 12, marginTop: 4 }}>
          Cada punto es un pozo con largo de rama declarado (Adjunto IV). Útil para ver el efecto del largo lateral y la dispersión por ventana de fluido.
        </div>
      </Panel>

      <Panel title={`Productividad por añada — EUR ${fluid} por 1000m de rama (mediana) y largo de rama mediano`}>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={byVintage} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
            <XAxis dataKey="anio" tick={{ fill: colors.textMuted, fontSize: 12 }} />
            <YAxis yAxisId="l" tick={{ fill: colors.textMuted, fontSize: 12 }} width={56}
              label={{ value: `EUR/1000m (${eurUnit})`, angle: -90, position: 'insideLeft', fill: colors.textDim, fontSize: 11 }} />
            <YAxis yAxisId="r" orientation="right" tick={{ fill: colors.textMuted, fontSize: 12 }} width={48} />
            <Tooltip contentStyle={tt} cursor={{ fill: colors.surfaceAlt }}
              formatter={(v: number, n) => [v == null ? '—' : fmt(v, 1), n]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="l" dataKey="eur_km" name={`EUR/1000m (${eurUnit})`} fill={fluid === 'gas' ? colors.gas : colors.oil} isAnimationActive={false} />
            <Line yAxisId="r" type="monotone" dataKey="rama" name="Rama mediana (m)" stroke={colors.accent.blue} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ color: colors.textDim, fontSize: 12, marginTop: 4 }}>
          Permite ver si los pozos más nuevos son más productivos por metro de rama, y cómo evolucionó el largo lateral típico.
        </div>
      </Panel>
    </>
  )
}

export type { WellRow }
