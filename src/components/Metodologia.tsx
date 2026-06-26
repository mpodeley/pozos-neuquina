import type { ReactNode } from 'react'
import { useBlocks, useWells } from '../hooks/useData'
import { card, colors, space } from '../theme'
import { GIP_TOTAL_MMM3, OIP_TOTAL_Mm3, PLAY, RF_ULT_GAS, RF_ULT_OIL } from '../utils/play'
import { fmtInt } from '../utils/format'

export default function Metodologia() {
  const wells = useWells()
  const blocks = useBlocks()
  const nWells = wells.data?.length ?? null
  const eurGas = (blocks.data ?? []).reduce((s, b) => s + b.eur_gas_total, 0)
  const eurOil = (blocks.data ?? []).reduce((s, b) => s + b.eur_oil_total, 0)
  const rfGas = eurGas / GIP_TOTAL_MMM3
  const rfOil = eurOil / OIP_TOTAL_Mm3

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.lg, maxWidth: 920 }}>
      <Sec title="1 · Fuentes de datos y alcance">
        <P>
          Toda la información proviene de datos públicos de la <B>Secretaría de Energía</B> (datos.energia.gob.ar):
          el <B>Capítulo IV</B> (producción mensual por pozo, una fila por pozo-mes-formación) y el
          <B> Adjunto IV / Datos de Fractura</B> (largo de rama horizontal, etapas, arena y agua por pozo).
        </P>
        <P>
          El alcance es <B>no convencional de la Cuenca Neuquina</B>: se filtra <C>cuenca = NEUQUINA</C> y
          <C> tipo_de_recurso ≠ CONVENCIONAL</C> (Vaca Muerta, Mulichinco, Lajas, Los Molles y demás reservorios
          shale/tight). {nWells != null && <>Hoy el set tiene <B>{fmtInt(nWells)} pozos</B> con producción registrada.</>}
          {' '}El Adjunto IV se une por <C>idpozo</C>; no todos los pozos declaran fractura, así que las vistas
          normalizadas por rama operan sobre el subconjunto con metadata.
        </P>
      </Sec>

      <Sec title="2 · Serie de producción por pozo">
        <P>
          Para cada pozo se reconstruye la serie mensual de caudal. El <B>caudal diario</B> de cada mes es el
          volumen del Capítulo IV dividido por el <C>tef</C> (días efectivos de producción) cuando está disponible,
          o por los días calendario en su defecto. Gas en <C>dam³/d</C> (= mil m³/d), petróleo y agua en <C>m³/d</C>.
          Las series se <B>alinean al primer mes de producción</B> (mes 0), de modo que todos los pozos se comparan
          por "meses en producción" y no por fecha de calendario.
        </P>
      </Sec>

      <Sec title="3 · Declinación (Arps hiperbólica)">
        <P>
          Cada pozo se ajusta con la ecuación de Arps:&nbsp;
          <C>q(t) = qi / (1 + b·Di·t)^(1/b)</C>, ajustando <C>qi, Di, b</C> por mínimos cuadrados desde el
          <B> pico</B> (buscado en los primeros 12 meses) en adelante. Restricciones: <C>b ∈ [0, 1.2]</C> (cap tipo
          shale para evitar EUR inflados), <C>Di ∈ [0.001, 0.6]</C> por mes, y mínimo <B>6 meses productivos</B>.
        </P>
        <P>
          Los ajustes <B>de baja calidad se rechazan</B>: si el R² &lt; 0.30 o los parámetros quedan pegados a un
          límite, no se proyecta cola — el EUR se toma igual al acumulado real (conservador). Cada pozo lleva una
          <B> bandera de confianza</B>: <Tag c={colors.oil}>alta</Tag> (R²≥0.6 y ≥18 meses),
          <Tag c={colors.accent.orange}>media</Tag> y <Tag c={colors.textDim}>baja</Tag> (sin ajuste utilizable).
          El pronóstico se <B>ancla a la mediana de los últimos 3 caudales reales</B> (no a un pico aislado), lo que
          evita que un mes espurio dispare el EUR.
        </P>
      </Sec>

      <Sec title="4 · EUR e IP">
        <P>
          El <B>EUR</B> (recurso último estimado) = acumulado real + pronóstico de la cola, con un
          <B> switch de declinación terminal mínima</B>: cuando la declinación instantánea del ajuste cae por debajo
          de <C>Dmin = 8 %/año</C>, se continúa en exponencial a esa tasa. Horizonte de 30 años o límite económico
          (gas 2 dam³/d, petróleo 0.5 m³/d). El EUR hiperbólico sin restricción sobre-predice fuerte en pozos de poca
          historia; estas dos defensas (cap de <C>b</C> y declinación terminal) lo acotan.
        </P>
        <P>
          El <B>IP</B> (producción inicial acumulada) se mide a 180 y 365 días <B>productivos</B> (sumando <C>tef</C>),
          no de calendario, para comparar pozos con interrupciones de manera justa.
        </P>
      </Sec>

      <Sec title="5 · Pozos tipo (cohortes)">
        <P>
          Los pozos se agrupan en cohortes por <B>formación, añada (año del primer mes), operador y ventana de fluido</B>.
          Para cada cohorte con ≥8 pozos se alinean las series por mes en producción y se calculan los percentiles
          <C> P10 (caso alto), P50 (mediana) y P90 (caso bajo)</C> del caudal mes a mes (convención petrolera, P10
          optimista). Se ofrecen en absoluto y <B>normalizados por 1000 m de rama</B>. El "EUR del pozo tipo" surge de
          ajustar Arps a la curva P50.
        </P>
      </Sec>

      <Sec title="6 · Ventana de fluido (GOR)">
        <P>
          Cada pozo/área se clasifica por su <B>relación gas-petróleo</B> (GOR, m³/m³) acumulada:
          <C> petróleo</C> (&lt;250), <C>petróleo volátil</C> (250–1500), <C>gas húmedo/condensado</C> (1500–10000)
          y <C>gas seco</C> (&gt;10000 o sin petróleo). Es una aproximación por GOR de producción, no por PVT de fondo.
        </P>
      </Sec>

      <Sec title="7 · Agregación por bloque">
        <P>
          Los pozos se agregan por <B>área de permiso/concesión</B>. El EUR total del bloque es la suma de los EUR de
          sus pozos; el "EUR/1000m" es la mediana del EUR por 1000 m de rama de los pozos con ajuste confiable (el
          "típico productivo" del bloque). El área del bloque (km²) se calcula del polígono de concesión por proyección
          equirectangular local.
        </P>
      </Sec>

      <Sec title="8 · Madurez de desarrollo y factor de recobro">
        <P>
          Por área se calculan métricas robustas (sin supuestos externos): <B>densidad</B> (pozos/km²),
          <B> % agotado</B> = Σcum/ΣEUR de los pozos perforados, e <B>intensidad recuperable</B> (EUR/km²).
        </P>
        <P>
          El <B>factor de recobro a la fecha</B> = EUR de pozos perforados / hidrocarburos in-situ. El in-situ se toma
          <B> uniforme</B> a partir de las estimaciones de EIA: <C>GIP {PLAY.GIP_TCF} Tcf</C> y
          <C> OIP {PLAY.OIP_BBBL} Bbbl</C> sobre ~30.000 km² de Vaca Muerta, lo que da el <B>RF último de play</B> de
          referencia: <Tag c={colors.gas}>~{(RF_ULT_GAS * 100).toFixed(0)}% gas</Tag>
          <Tag c={colors.oil}>~{(RF_ULT_OIL * 100).toFixed(0)}% petróleo</Tag>.
          A nivel de cuenca, los pozos perforados hoy recuperan
          {blocks.data && <> <B>~{(rfGas * 100).toFixed(2)}%</B> del gas in-situ y <B>~{(rfOil * 100).toFixed(2)}%</B> del
            petróleo in-situ</>} — Vaca Muerta está en etapa temprana de desarrollo.
        </P>
        <P>
          El <B>% desarrollado areal</B> = densidad / <C>3 pozos·km⁻²</C> (supuesto de pleno desarrollo: 2 benches
          apilados, laterales ~3000 m). El <B>índice de madurez (0-100)</B> combina:&nbsp;
          <C>0.55·%desarrollado + 0.30·%agotado + 0.15·antigüedad</C>. Las <B>etapas</B> (piloto → desarrollo temprano
          → activo → maduro → declinación) surgen de reglas sobre esas mismas variables más la actividad reciente.
        </P>
      </Sec>

      <Sec title="9 · Limitaciones" accent={colors.accent.orange}>
        <Ul>
          <Li><B>EUR de pozos jóvenes</B>: con poca historia el ajuste es incierto (de ahí la bandera de confianza y el
            énfasis en pozos tipo como agregado robusto).</Li>
          <Li><B>In-situ uniforme</B>: el RF por área no captura heterogeneidad geológica; su patrón espacial es
            esencialmente el EUR/km² reescalado y su valor absoluto depende del supuesto de EIA. Valores de RF por
            encima del RF último de play indican que el in-situ local supera el promedio uniforme.</Li>
          <Li><B>Área de concesión bruta</B>: la densidad y el RF se calculan sobre toda la concesión, no sobre el
            fairway productivo (menor) — subestiman el desarrollo y el RF dentro del área efectivamente perforada.</Li>
          <Li><B>Cobertura parcial del Adjunto IV</B>: no todos los pozos declaran rama/fractura; la normalización por
            metro opera sobre el subconjunto con metadata.</Li>
          <Li><B>Sesgo de supervivencia</B> en pozos tipo: los pozos que dejan de reportar salen del promedio a tiempos
            largos, lo que puede sesgar la cola hacia arriba.</Li>
          <Li><B>Sin PVT ni presión</B>: la ventana de fluido es por GOR de producción; no hay corrección por choke,
            flowback ni interferencia entre pozos.</Li>
          <Li><B>Calidad del dato</B>: el Capítulo IV puede traer rectificaciones o faltantes; se suman las filas por
            pozo-mes (varias formaciones) para obtener el total del pozo.</Li>
        </Ul>
      </Sec>

      <Sec title="10 · Mejoras posibles" accent={colors.accent.green}>
        <Ul>
          <Li>Incorporar <B>coordenadas y profundidad</B> de pozos (dataset georreferenciado) para espaciamiento real,
            asignación al fairway y mapas de calor por pozo en vez de por concesión.</Li>
          <Li><B>In-situ heterogéneo por área</B> (espesor, TOC, presión, madurez térmica) para un RF por área más
            realista que el supuesto uniforme.</Li>
          <Li><B>Validar EUR</B> contra declaraciones de operadores (IR days, reservas) y proveedores (Rystad/Enverus).</Li>
          <Li><B>Outlook agregado de cuenca</B>: combinar pozos tipo con escenarios de programa de perforación para
            proyectar la producción futura de cada área/cuenca.</Li>
          <Li>Ventana de fluido por <B>PVT</B> real; corrección de <B>survivorship</B>; intervalos de confianza del EUR.</Li>
          <Li>Pozos tipo por <B>geología/ML</B> y normalización adicional por arena/etapa además de la rama.</Li>
        </Ul>
      </Sec>

      <p style={{ color: colors.textDim, fontSize: 11.5, lineHeight: 1.5 }}>
        Los EUR, pozos tipo y factores de recobro son estimaciones con fines analíticos a partir de datos públicos,
        <B> no</B> certificaciones de reservas.
      </p>
    </div>
  )
}

function Sec({ title, accent, children }: { title: string; accent?: string; children: ReactNode }) {
  return (
    <div style={{ ...card, borderLeft: `3px solid ${accent ?? colors.accent.blue}` }}>
      <h3 style={{ margin: `0 0 ${space.sm}px`, fontSize: 16, color: colors.textPrimary }}>{title}</h3>
      {children}
    </div>
  )
}
function P({ children }: { children: ReactNode }) {
  return <p style={{ margin: `0 0 ${space.sm}px`, color: colors.textSecondary, fontSize: 14, lineHeight: 1.65 }}>{children}</p>
}
function Ul({ children }: { children: ReactNode }) {
  return <ul style={{ margin: 0, paddingLeft: 20, color: colors.textSecondary, fontSize: 14, lineHeight: 1.6 }}>{children}</ul>
}
function Li({ children }: { children: ReactNode }) {
  return <li style={{ marginBottom: 6 }}>{children}</li>
}
function B({ children }: { children: ReactNode }) {
  return <strong style={{ color: colors.textPrimary }}>{children}</strong>
}
function C({ children }: { children: ReactNode }) {
  return <code style={{ background: colors.surfaceAlt, color: colors.accent.cyan, padding: '1px 5px', borderRadius: 4, fontSize: 12.5 }}>{children}</code>
}
function Tag({ c, children }: { c: string; children: ReactNode }) {
  return <span style={{ background: c + '22', color: c, padding: '1px 8px', borderRadius: 10, fontSize: 12, fontWeight: 700, margin: '0 2px' }}>{children}</span>
}
