import { useMemo, useState } from 'react'
import {
  CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts'
import { useBlocks } from '../hooks/useData'
import { colors, space } from '../theme'
import { fmt, fmtInt } from '../utils/format'
import {
  GIP_TOTAL_MMM3, OIP_TOTAL_Mm3, PLAY, RF_ULT_GAS, RF_ULT_OIL, STAGE_ORDER, eurBoe, stageColor,
} from '../utils/play'
import { ErrorMsg, Kpi, Loading, Panel } from './ui'
import type { BlockRow } from '../types'

const MIN_WELLS = 8

export default function Madurez() {
  const blocksS = useBlocks()
  const [sortKey, setSortKey] = useState<keyof BlockRow>('maturity_index')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)

  const blocks = blocksS.data ?? []

  const ctx = useMemo(() => {
    const eurGas = blocks.reduce((s, b) => s + b.eur_gas_total, 0)
    const eurOil = blocks.reduce((s, b) => s + b.eur_oil_total, 0)
    return {
      eurGas, eurOil,
      rfGas: eurGas / GIP_TOTAL_MMM3,
      rfOil: eurOil / OIP_TOTAL_Mm3,
      capturedGas: eurGas / PLAY.TCF_TO_MMM3 / PLAY.REC_GAS_TCF,
      capturedOil: (eurOil * 1000) / PLAY.BBL_TO_M3 / 1e9 / PLAY.REC_OIL_BBBL,
    }
  }, [blocks])

  const ranked = useMemo(() => {
    const r = blocks.filter((b) => b.area_km2 != null && b.n_wells >= MIN_WELLS)
    return [...r].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir
      return String(av).localeCompare(String(bv)) * sortDir
    })
  }, [blocks, sortKey, sortDir])

  const byStage = useMemo(() => {
    const groups = new Map<string, { x: number; y: number; z: number; bloque: string; op: string; n: number }[]>()
    for (const b of blocks) {
      if (b.area_km2 == null || b.n_wells < MIN_WELLS || b.pct_developed == null) continue
      const g = groups.get(b.stage) ?? []
      g.push({
        x: b.pct_developed * 100, y: b.depletion_boe * 100,
        z: eurBoe(b.eur_gas_total, b.eur_oil_total), bloque: b.bloque, op: b.operador, n: b.n_wells,
      })
      groups.set(b.stage, g)
    }
    return STAGE_ORDER.filter((s) => groups.has(s)).map((s) => ({ stage: s, pts: groups.get(s)! }))
  }, [blocks])

  if (blocksS.loading) return <Loading what="madurez" />
  if (blocksS.error) return <ErrorMsg error={blocksS.error} />

  const setSort = (k: keyof BlockRow) => {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(-1) }
  }
  const tt = { background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 12 }

  return (
    <>
      <div style={{ display: 'flex', gap: space.md, flexWrap: 'wrap' }}>
        <Kpi label="EUR gas perforado" value={`${(ctx.eurGas / PLAY.TCF_TO_MMM3).toFixed(1)}`} sub={`Tcf · ${(ctx.capturedGas * 100).toFixed(1)}% del recuperable EIA (308 Tcf)`} color={colors.gas} />
        <Kpi label="EUR petróleo perforado" value={`${(ctx.capturedOil * PLAY.REC_OIL_BBBL).toFixed(2)}`} sub={`Bbbl · ${(ctx.capturedOil * 100).toFixed(1)}% del recuperable EIA (16 Bbbl)`} color={colors.oil} />
        <Kpi label="RF gas de cuenca (hoy)" value={`${(ctx.rfGas * 100).toFixed(2)}%`} sub={`vs RF último ~${(RF_ULT_GAS * 100).toFixed(0)}%`} />
        <Kpi label="RF petróleo de cuenca (hoy)" value={`${(ctx.rfOil * 100).toFixed(2)}%`} sub={`vs RF último ~${(RF_ULT_OIL * 100).toFixed(0)}%`} />
      </div>

      <Panel title="Posicionamiento de áreas — desarrollo areal vs agotamiento (burbuja = EUR total BOE)">
        <ResponsiveContainer width="100%" height={420}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 22, left: 8 }}>
            <CartesianGrid stroke={colors.border} />
            <XAxis type="number" dataKey="x" name="% desarrollado" unit="%" domain={[0, 100]}
              tick={{ fill: colors.textMuted, fontSize: 12 }}
              label={{ value: '% desarrollado (densidad / 3 pozos·km⁻²)', position: 'insideBottom', offset: -10, fill: colors.textDim, fontSize: 12 }} />
            <YAxis type="number" dataKey="y" name="% agotado" unit="%" domain={[0, 100]}
              tick={{ fill: colors.textMuted, fontSize: 12 }} width={48}
              label={{ value: '% agotado (cum/EUR)', angle: -90, position: 'insideLeft', fill: colors.textDim, fontSize: 12 }} />
            <ZAxis type="number" dataKey="z" range={[40, 700]} />
            <ReferenceLine x={50} stroke={colors.border} strokeDasharray="4 4" />
            <ReferenceLine y={50} stroke={colors.border} strokeDasharray="4 4" />
            <Tooltip contentStyle={tt} cursor={{ strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0].payload as { bloque: string; op: string; n: number; x: number; y: number; z: number }
                return (
                  <div style={{ ...tt, padding: '6px 10px', color: colors.textSecondary }}>
                    <div style={{ fontWeight: 700, color: colors.textPrimary }}>{d.bloque}</div>
                    <div style={{ color: colors.textDim }}>{d.op}</div>
                    <div>{d.n} pozos · {d.x.toFixed(0)}% desarrollado · {d.y.toFixed(0)}% agotado</div>
                  </div>
                )
              }} />
            {byStage.map(({ stage, pts }) => (
              <Scatter key={stage} name={stage} data={pts} fill={stageColor(stage)} fillOpacity={0.75} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
          {byStage.map(({ stage, pts }) => (
            <span key={stage} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: colors.textMuted }}>
              <span style={{ width: 10, height: 10, borderRadius: 5, background: stageColor(stage) }} /> {stage} ({pts.length})
            </span>
          ))}
        </div>
        <div style={{ color: colors.textDim, fontSize: 12, marginTop: 6 }}>
          Abajo-izquierda = desarrollo temprano (poco perforado, poco agotado); arriba-derecha = maduro/declinación.
          Áreas con ≥{MIN_WELLS} pozos y geometría de concesión.
        </div>
      </Panel>

      <Panel
        title={`Ranking de madurez por área (${ranked.length} bloques)`}
        right={<a href="./data/blocks.csv" download style={{ fontSize: 13 }}>⬇ CSV</a>}
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr>
                {COLS.map((c) => (
                  <th key={String(c.key)} onClick={() => setSort(c.key)}
                    style={{ textAlign: c.num ? 'right' : 'left', padding: '6px 8px', cursor: 'pointer', whiteSpace: 'nowrap',
                      color: c.key === sortKey ? colors.textPrimary : colors.textMuted, fontSize: 12, borderBottom: `1px solid ${colors.border}` }}>
                    {c.label}{c.key === sortKey ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ranked.map((b) => (
                <tr key={b.bloque} style={{ borderBottom: `1px solid ${colors.surfaceAlt}` }}>
                  <td style={cell(false)}>{b.bloque}</td>
                  <td style={cell(false)}><span style={{ color: stageColor(b.stage) }}>{b.stage}</span></td>
                  <td style={cell(true)}>{fmtInt(b.n_wells)}</td>
                  <td style={cell(true)}>{fmtInt(b.area_km2)}</td>
                  <td style={cell(true)}>{fmt(b.well_density, 2)}</td>
                  <td style={cell(true)}>{b.pct_developed != null ? `${(b.pct_developed * 100).toFixed(0)}%` : '—'}</td>
                  <td style={cell(true)}>{`${(b.depletion_boe * 100).toFixed(0)}%`}</td>
                  <td style={cell(true)}>{b.rf_gas_hoy != null ? `${(b.rf_gas_hoy * 100).toFixed(1)}%` : '—'}</td>
                  <td style={cell(true)}>{b.rf_oil_hoy != null ? `${(b.rf_oil_hoy * 100).toFixed(1)}%` : '—'}</td>
                  <td style={cell(true)}>{fmt(b.maturity_index, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <p style={{ color: colors.textDim, fontSize: 11.5, lineHeight: 1.5 }}>
        El factor de recobro (RF) a la fecha = EUR de pozos perforados / hidrocarburos in-situ, con in-situ
        uniforme derivado de EIA (GIP 1202 Tcf, OIP 270 Bbbl sobre ~30.000 km²) y área de concesión bruta.
        Es una <strong>estimación con supuestos</strong> (ver pestaña Metodología), no una certificación de reservas.
        Valores de RF por encima del RF último de play indican que el in-situ local supera el promedio uniforme.
      </p>
    </>
  )
}

type Col = { key: keyof BlockRow; label: string; num?: boolean }
const COLS: Col[] = [
  { key: 'bloque', label: 'Bloque' },
  { key: 'stage', label: 'Etapa' },
  { key: 'n_wells', label: 'Pozos', num: true },
  { key: 'area_km2', label: 'Área km²', num: true },
  { key: 'well_density', label: 'Pozos/km²', num: true },
  { key: 'pct_developed', label: '% desarr.', num: true },
  { key: 'depletion_boe', label: '% agotado', num: true },
  { key: 'rf_gas_hoy', label: 'RF gas', num: true },
  { key: 'rf_oil_hoy', label: 'RF oil', num: true },
  { key: 'maturity_index', label: 'Índice', num: true },
]
const cell = (num: boolean): React.CSSProperties => ({
  padding: '5px 8px', textAlign: num ? 'right' : 'left', whiteSpace: 'nowrap', color: colors.textSecondary,
})
