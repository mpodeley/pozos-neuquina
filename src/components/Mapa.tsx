import { Fragment, useMemo, useState } from 'react'
import { useBlocks, useConcesiones } from '../hooks/useData'
import { useMapPanZoom } from '../hooks/useMapPanZoom'
import { colors, iconBtn, radius, space } from '../theme'
import { fmt, fmtInt, operatorColor, shortEmpresa, titleCase, ventanaColor } from '../utils/format'
import { stageColor } from '../utils/play'
import { ErrorMsg, Loading, Panel } from './ui'
import type { BlockRow, ConcesionFeature } from '../types'

// Cuenca Neuquina viewport (lon/lat), same crop as estado_del_sistema's map.
const VIEW = { lonMin: -71.0, lonMax: -67.2, latMin: -40.5, latMax: -34.0 }

const R = 6378137
function toMercator(lat: number, lon: number) {
  const rad = Math.PI / 180
  return { x: lon * rad * R, y: Math.log(Math.tan(Math.PI / 4 + (lat * rad) / 2)) * R }
}

const GAS_PALETTE = ['#450a0a', '#7f1d1d', '#991b1b', '#b91c1c', '#dc2626', '#ef4444', '#f87171']
const OIL_PALETTE = ['#052e16', '#14532d', '#166534', '#15803d', '#16a34a', '#22c55e', '#4ade80']
const POZOS_PALETTE = ['#172554', '#1e3a8a', '#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd']
const AMBER_PALETTE = ['#451a03', '#7c2d12', '#9a3412', '#c2410c', '#ea580c', '#f59e0b', '#fcd34d']
const PURPLE_PALETTE = ['#2e1065', '#4c1d95', '#5b21b6', '#6d28d9', '#7c3aed', '#8b5cf6', '#a78bfa']
const NO_DATA = '#1e293b'

type Mode =
  | 'eur_gas' | 'eur_gas_km' | 'eur_oil' | 'eur_oil_km' | 'pozos'
  | 'rf_gas' | 'rf_oil' | 'depletion' | 'pct_dev' | 'maturity'

const MODES: { id: Mode; label: string; unit: string; palette: string[]; group: string }[] = [
  { id: 'eur_gas', label: 'EUR gas (total)', unit: 'MMm³', palette: GAS_PALETTE, group: 'EUR' },
  { id: 'eur_gas_km', label: 'EUR gas / 1000m', unit: 'MMm³/1000m', palette: GAS_PALETTE, group: 'EUR' },
  { id: 'eur_oil', label: 'EUR petróleo (total)', unit: 'Mm³', palette: OIL_PALETTE, group: 'EUR' },
  { id: 'eur_oil_km', label: 'EUR petróleo / 1000m', unit: 'Mm³/1000m', palette: OIL_PALETTE, group: 'EUR' },
  { id: 'pozos', label: 'Pozos', unit: 'pozos', palette: POZOS_PALETTE, group: 'EUR' },
  { id: 'rf_gas', label: 'RF gas (hoy)', unit: '%', palette: GAS_PALETTE, group: 'Madurez' },
  { id: 'rf_oil', label: 'RF petróleo (hoy)', unit: '%', palette: OIL_PALETTE, group: 'Madurez' },
  { id: 'depletion', label: '% agotado', unit: '%', palette: AMBER_PALETTE, group: 'Madurez' },
  { id: 'pct_dev', label: '% desarrollado', unit: '%', palette: POZOS_PALETTE, group: 'Madurez' },
  { id: 'maturity', label: 'Índice de madurez', unit: '0-100', palette: PURPLE_PALETTE, group: 'Madurez' },
]

function valueForMode(b: BlockRow | undefined, mode: Mode): number {
  if (!b) return 0
  switch (mode) {
    case 'eur_gas': return b.eur_gas_total
    case 'eur_gas_km': return b.eur_gas_km_med ?? 0
    case 'eur_oil': return b.eur_oil_total
    case 'eur_oil_km': return b.eur_oil_km_med ?? 0
    case 'pozos': return b.n_wells
    case 'rf_gas': return (b.rf_gas_hoy ?? 0) * 100
    case 'rf_oil': return (b.rf_oil_hoy ?? 0) * 100
    case 'depletion': return b.depletion_boe * 100
    case 'pct_dev': return (b.pct_developed ?? 0) * 100
    case 'maturity': return b.maturity_index ?? 0
  }
}

export default function Mapa() {
  const blocksS = useBlocks()
  const conc = useConcesiones()
  const [mode, setMode] = useState<Mode>('eur_gas')
  const [hoverId, setHoverId] = useState<string | null>(null)

  const blockByName = useMemo(() => {
    const m = new Map<string, BlockRow>()
    for (const b of blocksS.data ?? []) m.set(b.bloque.trim().toUpperCase(), b)
    return m
  }, [blocksS.data])

  const baseVB = useMemo(() => {
    const tl = toMercator(VIEW.latMax, VIEW.lonMin)
    const br = toMercator(VIEW.latMin, VIEW.lonMax)
    const minX = tl.x, maxX = br.x, minY = -tl.y, maxY = -br.y
    const w = maxX - minX, h = maxY - minY
    return { minX, minY, w, h, cx: minX + w / 2, cy: minY + h / 2 }
  }, [])

  const { svgRef, viewBox, isDragging, handlers, zoomIn, zoomOut, reset } = useMapPanZoom(baseVB)

  const projected = useMemo(() => {
    const feats = conc.data?.features ?? []
    return feats.map((f) => {
      const ringStrings: string[] = []
      for (const polygon of f.geometry.coordinates) {
        const ring = polygon[0] ?? []
        if (ring.length < 3) continue
        ringStrings.push(ring.map(([lon, lat]) => {
          const m = toMercator(lat, lon)
          return `${m.x.toFixed(0)},${(-m.y).toFixed(0)}`
        }).join(' '))
      }
      const key = (f.properties.nombre || '').trim().toUpperCase()
      return { feature: f, ringStrings, block: blockByName.get(key) }
    })
  }, [conc.data, blockByName])

  const modeDef = MODES.find((m) => m.id === mode)!

  const bins = useMemo(() => {
    const vals = projected.map((p) => valueForMode(p.block, mode)).filter((v) => v > 0).sort((a, b) => a - b)
    if (!vals.length) return []
    const out: number[] = []
    for (let i = 1; i < modeDef.palette.length; i++) {
      out.push(vals[Math.min(Math.floor((i * vals.length) / modeDef.palette.length), vals.length - 1)])
    }
    return out
  }, [projected, mode, modeDef])

  function colorFor(v: number): string {
    if (v <= 0 || !bins.length) return NO_DATA
    let i = 0
    while (i < bins.length && v >= bins[i]) i++
    return modeDef.palette[i] ?? modeDef.palette[modeDef.palette.length - 1]
  }

  if (blocksS.loading || conc.loading) return <Loading what="mapa" />
  if (blocksS.error) return <ErrorMsg error={blocksS.error} />
  if (conc.error) return <ErrorMsg error={conc.error} />

  const hovered = projected.find((p) => p.feature.properties.id === hoverId)
  const matched = projected.filter((p) => p.block).length

  return (
    <Panel>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: space.sm, marginBottom: space.sm }}>
        <div style={{ color: colors.textMuted, fontSize: 12 }}>
          {projected.length} concesiones · {matched} con producción no-conv
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: colors.textDim, fontSize: 12, marginRight: 4 }}>colorear por:</span>
          {MODES.map((m, i) => (
            <Fragment key={m.id}>
              {i > 0 && MODES[i - 1].group !== m.group && (
                <span style={{ width: 1, height: 18, background: colors.border, margin: '0 4px' }} />
              )}
              <button onClick={() => setMode(m.id)} style={modeBtn(mode === m.id)}>{m.label}</button>
            </Fragment>
          ))}
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        <svg
          ref={svgRef}
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
          {...handlers}
          style={{
            width: '100%', height: 'auto', maxHeight: 560, background: '#0b1220',
            borderRadius: radius.md, display: 'block',
            cursor: isDragging ? 'grabbing' : 'grab', userSelect: 'none',
          }}
        >
          {projected.map((p) => {
            const val = valueForMode(p.block, mode)
            const fill = colorFor(val)
            const isHover = hoverId === p.feature.properties.id
            return (
              <g
                key={p.feature.properties.id || p.feature.properties.nombre}
                onMouseEnter={() => !isDragging && setHoverId(p.feature.properties.id)}
                onMouseLeave={() => setHoverId(null)}
                style={{ pointerEvents: isDragging ? 'none' : 'auto' }}
              >
                {p.ringStrings.map((pts, i) => (
                  <polygon
                    key={i} points={pts} fill={fill}
                    fillOpacity={isHover ? 0.95 : p.block ? 0.82 : 0.4}
                    stroke={isHover ? '#f1f5f9' : '#0b1220'}
                    strokeWidth={isHover ? 2 : 0.4}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            )
          })}
        </svg>

        <div style={{ position: 'absolute', top: space.sm, right: space.sm, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button onClick={zoomIn} style={iconBtn} title="Acercar">＋</button>
          <button onClick={zoomOut} style={iconBtn} title="Alejar">－</button>
          <button onClick={reset} style={iconBtn} title="Reset">⟲</button>
        </div>

        {hovered && <Tooltip feature={hovered.feature} block={hovered.block} />}
      </div>

      <HeatLegend bins={bins} palette={modeDef.palette} unit={modeDef.unit} />

      <p style={{ color: colors.textDim, fontSize: 11, marginTop: space.sm, lineHeight: 1.5 }}>
        Wheel para zoom, click + arrastrar para mover. EUR total = suma de los pozos del bloque;
        EUR/1000m = mediana del EUR por 1000 m de rama de los pozos con ajuste confiable (típico productivo del bloque).
      </p>
    </Panel>
  )
}

function Tooltip({ feature, block }: { feature: ConcesionFeature; block: BlockRow | undefined }) {
  const op = block?.operador ?? feature.properties.operador
  return (
    <div style={{
      position: 'absolute', top: space.md, left: space.md, background: colors.surface,
      border: `1px solid ${colors.border}`, borderRadius: radius.md, padding: `${space.sm}px ${space.md}px`,
      color: colors.textSecondary, fontSize: 12, maxWidth: 300, pointerEvents: 'none',
    }}>
      <div style={{ fontWeight: 700, color: colors.textPrimary, fontSize: 13 }}>
        {titleCase((feature.properties.nombre || '').toLowerCase())}
      </div>
      <div style={{ color: operatorColor(op), fontSize: 12, marginTop: 2 }}>{shortEmpresa(op)}</div>
      {block ? (
        <div style={{ marginTop: space.sm, lineHeight: 1.7 }}>
          {block.maturity_index != null && (
            <div style={{ marginBottom: 4 }}>
              <span style={{ background: stageColor(block.stage) + '22', color: stageColor(block.stage), padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>
                {block.stage} · índice {fmt(block.maturity_index, 0)}
              </span>
            </div>
          )}
          <Row k="Pozos no-conv" v={`${fmtInt(block.n_wells)}${block.n_vm ? ` · ${fmtInt(block.n_vm)} VM` : ''}`} />
          <Row k="Añadas" v={block.vintage_min === block.vintage_max ? `${block.vintage_min}` : `${block.vintage_min}–${block.vintage_max}`} />
          <Row k="% desarr. / agotado" v={`${block.pct_developed != null ? (block.pct_developed * 100).toFixed(0) : '—'}% / ${(block.depletion_boe * 100).toFixed(0)}%`} />
          <Row k="RF gas / oil (hoy)" v={`${block.rf_gas_hoy != null ? (block.rf_gas_hoy * 100).toFixed(1) : '—'}% / ${block.rf_oil_hoy != null ? (block.rf_oil_hoy * 100).toFixed(1) : '—'}%`} />
          <div style={{ borderTop: `1px solid ${colors.border}`, margin: '5px 0' }} />
          <Row k="EUR gas total" v={`${fmtInt(block.eur_gas_total)} MMm³`} color={colors.gas} />
          <Row k="EUR petróleo total" v={`${fmtInt(block.eur_oil_total)} Mm³`} color={colors.oil} />
          <Row k="EUR/km² (gas)" v={block.eur_gas_km2 != null ? `${fmtInt(block.eur_gas_km2)} MMm³` : '—'} color={colors.gas} />
          <div style={{ color: ventanaColor(block.ventana), fontSize: 11, marginTop: 4 }}>{block.ventana}</div>
        </div>
      ) : (
        <div style={{ marginTop: space.sm, color: colors.textDim }}>Sin producción no convencional registrada.</div>
      )}
    </div>
  )
}

function Row({ k, v, color }: { k: string; v: React.ReactNode; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: colors.textMuted }}>{k}</span>
      <span style={{ color: color ?? colors.textPrimary, fontWeight: 600 }}>{v}</span>
    </div>
  )
}

function HeatLegend({ bins, palette, unit }: { bins: number[]; palette: string[]; unit: string }) {
  if (!bins.length) return null
  const fmtv = (v: number) => (v < 1 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : fmtInt(v))
  const labels = [`< ${fmtv(bins[0])}`]
  for (let i = 1; i < bins.length; i++) labels.push(`${fmtv(bins[i - 1])}+`)
  labels.push(`≥ ${fmtv(bins[bins.length - 1])}`)
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: space.sm, alignItems: 'center' }}>
      <span style={{ color: colors.textDim, fontSize: 11, marginRight: 4 }}>{unit}</span>
      {palette.map((c, i) => (
        <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: colors.textMuted, fontSize: 11 }}>
          <span style={{ display: 'inline-block', width: 14, height: 10, background: c, borderRadius: 2 }} />
          {labels[i]}
        </span>
      ))}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: colors.textMuted, fontSize: 11 }}>
        <span style={{ display: 'inline-block', width: 14, height: 10, background: NO_DATA, borderRadius: 2 }} />
        sin datos
      </span>
    </div>
  )
}

const modeBtn = (active: boolean): React.CSSProperties => ({
  background: active ? colors.border : 'transparent',
  color: active ? colors.textPrimary : colors.textDim,
  border: 'none', borderRadius: radius.sm, padding: '4px 10px',
  cursor: 'pointer', fontSize: 12, fontWeight: 600,
})
