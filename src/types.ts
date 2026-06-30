export interface Envelope<T> {
  generated_at: string | null
  source: string | null
  source_date: string | null
  data: T
  [k: string]: unknown
}

export interface FetchState<T> {
  data: T | null
  loading: boolean
  error: Error | null
  meta: { generated_at: string | null; source: string | null; source_date: string | null }
}

/** Per-well monthly daily-rate arrays, aligned to first production month (m0). */
export interface WellSeries {
  id: number
  m0: string
  n: number
  gas: number[] // dam³/d  (÷1000 → MMm³/d)
  oil: number[] // m³/d
  wat: number[] // m³/d
  days: number[]
  sigla: string
  empresa: string
  area: string
  provincia: string
  formacion: string
  formprod: string
  recurso: string
  tipopozo: string
}

/** One row per well: features + GOR window + fitted Arps decline / EUR. */
export interface WellRow {
  id: number
  sigla: string
  empresa: string
  area: string
  provincia: string
  formacion: string
  recurso: string
  reservorio: string
  tipopozo: string
  m0: string
  ultimo_mes: string
  vintage: number
  n_meses: number
  rama_m: number | null
  fracturas: number
  etapas_km: number | null
  arena_tn: number | null
  arena_tn_m: number | null
  fecha_fractura: string
  gor: number | null
  ventana: string
  peak_gas_mmm3d: number | null
  peak_oil_m3d: number | null
  cum_gas_mmm3: number | null
  cum_oil_mm3: number | null
  ip180_gas_mmm3: number | null
  ip365_gas_mmm3: number | null
  ip180_oil_mm3: number | null
  ip365_oil_mm3: number | null
  qi_gas: number | null
  di_gas: number | null
  b_gas: number | null
  r2_gas: number | null
  t_peak_gas: number | null
  eur_gas_mmm3: number | null
  eur_gas_por_km: number | null
  vida_gas_meses: number | null
  eur_conf_gas: string | null
  qi_oil: number | null
  di_oil: number | null
  b_oil: number | null
  r2_oil: number | null
  t_peak_oil: number | null
  eur_oil_mm3: number | null
  eur_oil_por_km: number | null
  vida_oil_meses: number | null
  eur_conf_oil: string | null
  // completion / landing / trajectory
  lbs_ft: number | null
  fluid_bbl_ft: number | null
  completion_bucket: string | null
  landing: string | null
  landing_zona: string | null
  tvd: number | null
  // performance metric (cum 5yr normalised to 3000 m)
  cum5y_gas_bcf: number | null
  cum5y_gas_norm: number | null
  cum5y_oil_kbbl: number | null
  cum5y_oil_norm: number | null
  // parent/child
  tipo_pc: string | null
  parent_id: number | null
  dist_parent_m: number | null
  dist_bucket: number | null
}

export interface WellTag {
  id: number
  area: string | null
  formacion: string | null
  vintage: number | null
  ventana: string | null
  tipo_pc: string | null
  completion_bucket: string | null
  landing: string | null
  dist_bucket: number | null
  operador: string | null
  rama: number | null
}

export interface ParentChildPair {
  child: number
  parent: number
  perp_m: number
  dist_bucket: number
  meses_post_pem: number
  child_bucket: string | null
  parent_bucket: string | null
  arena_conjunta: number | null
  same_landing: boolean
}

export interface Cohort {
  group: string
  key: string
  label: string
  n_wells: number
  n_wells_rama: number
  rama_mediana: number | null
  tmax: number
  gas_p10: number[]
  gas_p50: number[]
  gas_p90: number[]
  oil_p10: number[]
  oil_p50: number[]
  oil_p90: number[]
  gas_p50_km: number[]
  gas_p10_km: number[]
  gas_p90_km: number[]
  oil_p50_km: number[]
  oil_p10_km: number[]
  oil_p90_km: number[]
  type_eur_gas_mmm3: number
  type_eur_oil_mm3: number
  type_qi_gas_mmm3d: number | null
  type_di_gas: number | null
  type_b_gas: number | null
}

export interface ActivityMonth {
  mes: string
  nuevos: number
  vaca_muerta: number
}
export interface ActivityYear {
  anio: number
  otras: number
  [emp: string]: number
}
export interface Activity {
  by_month: ActivityMonth[]
  by_year_empresa: ActivityYear[]
  operadores: string[]
}

export interface BlockRow {
  bloque: string
  operador: string
  formacion: string
  ventana: string
  n_wells: number
  n_vm: number
  n_gas: number
  n_oil: number
  vintage_min: number
  vintage_max: number
  pozos_ult3a: number
  share_ult3a: number
  anios_activo: number
  rama_mediana: number | null
  eur_gas_total: number
  eur_oil_total: number
  cum_gas: number
  cum_oil: number
  eur_gas_km_med: number | null
  eur_oil_km_med: number | null
  // maturity / recovery-factor (null when the block has no concession geometry)
  area_km2: number | null
  well_density: number | null
  pct_developed: number | null
  eur_gas_km2: number | null
  eur_oil_km2: number | null
  depletion_gas: number
  depletion_oil: number
  depletion_boe: number
  rf_gas_hoy: number | null
  rf_oil_hoy: number | null
  rf_gas_vs_ult: number | null
  rf_oil_vs_ult: number | null
  maturity_index: number | null
  stage: string
}

export interface ConcesionFeature {
  type: 'Feature'
  properties: {
    id: string
    nombre: string
    operador: string
    interesados?: string
    participacion?: string
    comentario?: string
  }
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] }
}
export interface ConcesionesCollection {
  type: 'FeatureCollection'
  features: ConcesionFeature[]
}
