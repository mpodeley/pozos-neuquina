import { useMemo } from 'react'
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useActivity, useWells } from '../hooks/useData'
import { colors, space } from '../theme'
import { fmt, fmtInt, operatorColor, shortEmpresa } from '../utils/format'
import { ErrorMsg, Kpi, Loading, Panel } from './ui'
import type { WellRow } from '../types'

const tooltipStyle = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  fontSize: 12,
}

export default function Resumen() {
  const wells = useWells()
  const act = useActivity()

  const agg = useMemo(() => {
    const rows = wells.data ?? []
    const vm = rows.filter((r) => r.formacion === 'vaca muerta')
    const conRama = rows.filter((r) => (r.rama_m ?? 0) > 0)
    const ramas = conRama.map((r) => r.rama_m as number).sort((a, b) => a - b)
    const ramaMed = ramas.length ? ramas[Math.floor(ramas.length / 2)] : null
    const cumGas = rows.reduce((s, r) => s + (r.cum_gas_mmm3 ?? 0), 0)
    const cumOil = rows.reduce((s, r) => s + (r.cum_oil_mm3 ?? 0), 0)
    return { rows, vm, conRama, ramaMed, cumGas, cumOil }
  }, [wells.data])

  const newByYear = useMemo(() => {
    const m = new Map<number, { anio: number; vm: number; otras: number }>()
    for (const row of act.data?.by_month ?? []) {
      const y = Number(row.mes.slice(0, 4))
      const e = m.get(y) ?? { anio: y, vm: 0, otras: 0 }
      e.vm += row.vaca_muerta
      e.otras += row.nuevos - row.vaca_muerta
      m.set(y, e)
    }
    return [...m.values()].sort((a, b) => a.anio - b.anio)
  }, [act.data])

  const topOps = useMemo(() => {
    const m = new Map<string, { empresa: string; pozos: number; gas: number; oil: number }>()
    for (const r of agg.rows) {
      const e = m.get(r.empresa) ?? { empresa: r.empresa, pozos: 0, gas: 0, oil: 0 }
      e.pozos += 1
      e.gas += r.cum_gas_mmm3 ?? 0
      e.oil += r.cum_oil_mm3 ?? 0
      m.set(r.empresa, e)
    }
    return [...m.values()].sort((a, b) => b.pozos - a.pozos).slice(0, 12)
  }, [agg.rows])

  if (wells.loading) return <Loading what="pozos" />
  if (wells.error) return <ErrorMsg error={wells.error} />

  const operadores = act.data?.operadores ?? []

  return (
    <>
      <div style={{ display: 'flex', gap: space.md, flexWrap: 'wrap' }}>
        <Kpi label="Pozos no convencionales" value={fmtInt(agg.rows.length)} sub="con producción registrada" />
        <Kpi label="Pozos Vaca Muerta" value={fmtInt(agg.vm.length)} color={colors.accent.purple} />
        <Kpi label="Con rama horizontal" value={fmtInt(agg.conRama.length)} sub={`mediana ${fmtInt(agg.ramaMed)} m`} />
        <Kpi label="Acum. gas" value={`${fmtInt(agg.cumGas)}`} sub="MMm³" color={colors.gas} />
        <Kpi label="Acum. petróleo" value={`${fmtInt(agg.cumOil)}`} sub="Mm³ (miles m³)" color={colors.oil} />
      </div>

      <Panel title="Actividad — pozos nuevos por año (primer mes de producción)">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={newByYear} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
            <XAxis dataKey="anio" tick={{ fill: colors.textMuted, fontSize: 12 }} />
            <YAxis tick={{ fill: colors.textMuted, fontSize: 12 }} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: colors.surfaceAlt }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="vm" name="Vaca Muerta" stackId="a" fill={colors.accent.purple} isAnimationActive={false} />
            <Bar dataKey="otras" name="Otras no-conv (tight)" stackId="a" fill={colors.accent.gray} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Pozos nuevos por año y operador">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={act.data?.by_year_empresa ?? []} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
            <XAxis dataKey="anio" tick={{ fill: colors.textMuted, fontSize: 12 }} />
            <YAxis tick={{ fill: colors.textMuted, fontSize: 12 }} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: colors.surfaceAlt }} />
            <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => shortEmpresa(String(v))} />
            {operadores.map((emp) => (
              <Bar key={emp} dataKey={emp} name={emp} stackId="a" fill={operatorColor(emp)} isAnimationActive={false} />
            ))}
            <Bar dataKey="otras" name="Otras" stackId="a" fill={colors.accent.gray} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Operadores — ranking por cantidad de pozos no-conv">
        <TopOpsTable rows={topOps} />
      </Panel>
    </>
  )
}

function TopOpsTable({ rows }: { rows: { empresa: string; pozos: number; gas: number; oil: number }[] }) {
  const th: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', color: colors.textMuted, fontSize: 12, borderBottom: `1px solid ${colors.border}` }
  const td: React.CSSProperties = { textAlign: 'right', padding: '6px 10px', fontSize: 13 }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ ...th, textAlign: 'left' }}>Operador</th>
          <th style={th}>Pozos</th>
          <th style={th}>Acum. gas (MMm³)</th>
          <th style={th}>Acum. petróleo (Mm³)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.empresa}>
            <td style={{ ...td, textAlign: 'left' }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: operatorColor(r.empresa), marginRight: 8 }} />
              {r.empresa}
            </td>
            <td style={td}>{fmtInt(r.pozos)}</td>
            <td style={td}>{fmtInt(r.gas)}</td>
            <td style={td}>{fmtInt(r.oil)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// (kept for potential per-well drilldown re-use)
export type { WellRow }
