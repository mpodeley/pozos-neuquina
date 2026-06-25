import { useEffect, useState } from 'react'
import type {
  Activity, BlockRow, Cohort, ConcesionesCollection, Envelope, FetchState, WellRow, WellSeries,
} from '../types'

/**
 * Loads a JSON file from ./data/ and unwraps the {generated_at, data} envelope
 * written by the Python pipeline (same convention as estado_del_sistema).
 */
export function useJson<T>(path: string): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: true,
    error: null,
    meta: { generated_at: null, source: null, source_date: null },
  })

  useEffect(() => {
    let cancelled = false
    fetch(path, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${path}`)
        return r.json()
      })
      .then((raw: unknown) => {
        if (cancelled) return
        if (raw && typeof raw === 'object' && 'data' in raw && 'generated_at' in raw) {
          const env = raw as Envelope<T>
          setState({
            data: env.data,
            loading: false,
            error: null,
            meta: {
              generated_at: env.generated_at ?? null,
              source: env.source ?? null,
              source_date: env.source_date ?? null,
            },
          })
        } else {
          setState({
            data: raw as T,
            loading: false,
            error: null,
            meta: { generated_at: null, source: null, source_date: null },
          })
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setState((s) => ({ ...s, loading: false, error: err }))
      })
    return () => {
      cancelled = true
    }
  }, [path])

  return state
}

export const useWells = () => useJson<WellRow[]>('./data/wells.json')
export const useWellSeries = () => useJson<{ wells: WellSeries[] }>('./data/well_series.json')
export const useTypeWells = () => useJson<{ cohorts: Cohort[] }>('./data/type_wells.json')
export const useActivity = () => useJson<Activity>('./data/activity.json')
export const useBlocks = () => useJson<BlockRow[]>('./data/blocks.json')

/** Concesiones GeoJSON: a plain FeatureCollection (no pipeline envelope), so
 *  fetch it directly rather than through useJson. */
export function useConcesiones() {
  const [state, setState] = useState<{ data: ConcesionesCollection | null; loading: boolean; error: Error | null }>({
    data: null, loading: true, error: null,
  })
  useEffect(() => {
    fetch('./data/concesiones_neuquina.geojson', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: ConcesionesCollection) => setState({ data: d, loading: false, error: null }))
      .catch((e: Error) => setState({ data: null, loading: false, error: e }))
  }, [])
  return state
}
