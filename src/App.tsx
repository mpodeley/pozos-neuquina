import { useState } from 'react'
import { colors, space } from './theme'
import { useWells } from './hooks/useData'
import { formatMes } from './utils/format'
import Resumen from './components/Resumen'
import Declinacion from './components/Declinacion'
import PozoTipo from './components/PozoTipo'
import Analisis from './components/Analisis'
import Mapa from './components/Mapa'
import PozosTabla from './components/PozosTabla'

type Tab = 'resumen' | 'declinacion' | 'tipo' | 'analisis' | 'mapa' | 'pozos'

const TABS: { id: Tab; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'declinacion', label: 'Declinación' },
  { id: 'tipo', label: 'Pozos tipo' },
  { id: 'analisis', label: 'Análisis' },
  { id: 'mapa', label: 'Mapa' },
  { id: 'pozos', label: 'Pozos' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('resumen')
  const wells = useWells()
  const ultimo = wells.meta.source_date

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: space.xl }}>
      <header style={{ marginBottom: space.lg }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: space.md, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 24, color: colors.textPrimary }}>
            Pozos Neuquina
          </h1>
          <span style={{ color: colors.textMuted, fontSize: 14 }}>
            producción por pozo · declinación · pozos tipo — no convencional (Vaca Muerta + tight)
          </span>
        </div>
        <div style={{ color: colors.textDim, fontSize: 12, marginTop: 4 }}>
          Fuente: Secretaría de Energía — Capítulo IV + Adjunto IV (datos.energia.gob.ar)
          {ultimo && ` · últimos datos: ${formatMes(ultimo)}`}
        </div>
      </header>

      <nav style={{ display: 'flex', gap: 4, marginBottom: space.lg, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: tab === t.id ? colors.surface : 'transparent',
              color: tab === t.id ? colors.textPrimary : colors.textMuted,
              border: `1px solid ${tab === t.id ? colors.border : 'transparent'}`,
              borderBottom: tab === t.id ? `2px solid ${colors.accent.blue}` : '2px solid transparent',
              borderRadius: '8px 8px 0 0',
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main style={{ display: 'flex', flexDirection: 'column', gap: space.lg }}>
        {tab === 'resumen' && <Resumen />}
        {tab === 'declinacion' && <Declinacion />}
        {tab === 'tipo' && <PozoTipo />}
        {tab === 'analisis' && <Analisis />}
        {tab === 'mapa' && <Mapa />}
        {tab === 'pozos' && <PozosTabla />}
      </main>

      <footer style={{ color: colors.textDim, fontSize: 11, marginTop: space.xxl, paddingTop: space.lg, borderTop: `1px solid ${colors.border}` }}>
        Datos públicos de la Secretaría de Energía de la Nación (Capítulo IV — producción por pozo;
        Adjunto IV — datos de fractura). Curvas de declinación Arps con declinación terminal mínima;
        EUR y pozos tipo son estimaciones con fines analíticos, no certificaciones de reservas.
      </footer>
    </div>
  )
}
