#!/usr/bin/env python3
"""Build blocks.json — per-block (areapermisoconcesion) aggregates for the map,
including development-maturity metrics and an estimated recovery factor (RF).

Aggregates wells.json to one row per bloque, then joins the concession polygons
(concesiones_neuquina.geojson) for area-based metrics:

  eur_*_total      : sum of well EURs in the block (recoverable to date)
  eur_*_km2        : recoverable intensity (EUR per km² of gross concession)
  well_density     : wells per km²
  pct_developed    : well_density / FULL_DEV_DENSITY (areal development, capped 1)
  depletion_*      : Σcum / ΣEUR (fraction of drilled recoverable already produced)
  rf_*_hoy         : ΣEUR / (in-place density · area) — recovery factor TO DATE
  rf_*_vs_ult      : rf_hoy / play-ultimate RF (share of ultimate recovery captured)
  maturity_index   : 0-100 blend of development + depletion + age
  stage            : Piloto / Desarrollo temprano / Desarrollo activo / Maduro / Declinación

The recovery factor uses a UNIFORM in-place density derived from EIA play totals
over the Vaca Muerta extent — see ASSUMPTIONS below. It is an assumption-driven
estimate (documented in the Metodología tab), not a volumetric certification.

Output: public/data/blocks.json (+ blocks.csv). Frontend joins by uppercased name.

Usage: python scripts/build_blocks.py
"""

import os
import sys
import json
import math
from collections import Counter, defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _meta import write_json, write_csv  # noqa: E402

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, '..', 'public', 'data')
WELLS_JSON = os.path.join(DATA_DIR, 'wells.json')
GEOJSON = os.path.join(DATA_DIR, 'concesiones_neuquina.geojson')
OUT_JSON = os.path.join(DATA_DIR, 'blocks.json')

# ---- ASSUMPTIONS (single source of truth; documented in the Metodología tab) ----
TCF_TO_MMM3 = 28320.0          # 1 Tcf = 28.32e9 m³ = 28 320 MMm³
BBL_TO_M3 = 1.0 / 6.2898       # 1 bbl ≈ 0.159 m³
VM_AREA_KM2 = 30000.0          # Vaca Muerta areal extent (EIA/ARI)
GIP_TOTAL_MMM3 = 1202.0 * TCF_TO_MMM3                 # gas-in-place (EIA risked)
OIP_TOTAL_Mm3 = 270.0e9 * BBL_TO_M3 / 1000.0          # oil-in-place → Mm³ (miles m³)
GIP_DENSITY = GIP_TOTAL_MMM3 / VM_AREA_KM2            # ≈ 1135 MMm³/km²
OIP_DENSITY = OIP_TOTAL_Mm3 / VM_AREA_KM2             # ≈ 1431 Mm³/km²
REC_GAS_TCF = 308.0            # technically recoverable gas (EIA)
REC_OIL_BBBL = 16.0           # technically recoverable oil+condensate (EIA)
RF_ULT_GAS = REC_GAS_TCF * TCF_TO_MMM3 / GIP_TOTAL_MMM3   # ≈ 0.256
RF_ULT_OIL = (REC_OIL_BBBL * 1e9 * BBL_TO_M3 / 1000.0) / OIP_TOTAL_Mm3  # ≈ 0.059
FULL_DEV_DENSITY = 3.0         # wells/km² at full development (2 stacked benches)
# BOE only to blend fluids for the combined depletion / index:
KBOE_GAS = 6.07                # per MMm³ gas (≈ 1 Tcf ~ 172 MMboe)
KBOE_OIL = 6.29                # per Mm³ oil

MIN_WELLS_STAGE = 5            # below this a block is "Piloto/exploratorio"


def _load(path):
    with open(path, encoding='utf-8') as f:
        raw = json.load(f)
    return raw.get('data', raw)


def polygon_area_km2(coords):
    """Gross polygon area (km²) via local equirectangular projection."""
    earth_r = 6378.137
    total = 0.0
    for poly in coords:
        ring = poly[0] if poly else []
        if len(ring) < 3:
            continue
        mean_lat = sum(p[1] for p in ring) / len(ring)
        cos_lat = math.cos(mean_lat * math.pi / 180)
        pts = [((lon * math.pi / 180) * earth_r * cos_lat, (lat * math.pi / 180) * earth_r)
               for lon, lat in ring]
        a = sum(pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1] for i in range(len(pts) - 1))
        total += abs(a) / 2
    return total


def _med(xs):
    return round(float(np.median(xs)), 1) if xs else None


def classify(n_wells, pct_dev, deplet, share3a):
    """Lifecycle stage. pct_dev may be None (block without geometry).

    Note: areal development (pct_dev) is over GROSS concession area, so a productive
    block with many wells but lots of undrilled acreage reads as low pct_dev — it is
    still 'Desarrollo activo', not a pilot. Pilot is reserved for genuinely few wells.
    """
    pd = pct_dev or 0.0
    if n_wells < MIN_WELLS_STAGE:
        return 'Piloto/exploratorio'
    if deplet >= 0.70 and share3a < 0.05:           # depleted + no recent drilling
        return 'Declinación'
    if pd >= 0.55:                                   # mostly drilled out
        return 'Maduro'
    if share3a >= 0.15 and (pd >= 0.15 or n_wells >= 25):
        return 'Desarrollo activo'
    return 'Desarrollo temprano'


def main():
    wells = _load(WELLS_JSON)
    gj = json.load(open(GEOJSON, encoding='utf-8'))
    area_by_name = {(f['properties'].get('nombre') or '').strip().upper():
                    polygon_area_km2(f['geometry']['coordinates']) for f in gj['features']}
    cur_year = max(w['vintage'] for w in wells)

    groups = defaultdict(list)
    for w in wells:
        groups[(w.get('area') or '').strip()].append(w)

    rows = []
    for bloque, ws in groups.items():
        if not bloque:
            continue
        n = len(ws)
        gas_km = [w['eur_gas_por_km'] for w in ws
                  if w.get('eur_gas_por_km') and w.get('eur_conf_gas') in ('alta', 'media')]
        oil_km = [w['eur_oil_por_km'] for w in ws
                  if w.get('eur_oil_por_km') and w.get('eur_conf_oil') in ('alta', 'media')]
        ramas = [w['rama_m'] for w in ws if w.get('rama_m')]
        eur_gas = sum(w['eur_gas_mmm3'] or 0 for w in ws)
        eur_oil = sum(w['eur_oil_mm3'] or 0 for w in ws)
        cum_gas = sum(w['cum_gas_mmm3'] or 0 for w in ws)
        cum_oil = sum(w['cum_oil_mm3'] or 0 for w in ws)

        # depletion is a fraction by definition; clamp to [0,1] (tiny wells can have
        # cum slightly above the rounded EUR, which would otherwise exceed 1).
        deplet_gas = min(cum_gas / eur_gas, 1.0) if eur_gas > 0 else 0.0
        deplet_oil = min(cum_oil / eur_oil, 1.0) if eur_oil > 0 else 0.0
        eur_boe = eur_gas * KBOE_GAS + eur_oil * KBOE_OIL
        cum_boe = cum_gas * KBOE_GAS + cum_oil * KBOE_OIL
        deplet_boe = min(cum_boe / eur_boe, 1.0) if eur_boe > 0 else 0.0

        pozos_3a = sum(1 for w in ws if w['vintage'] >= cur_year - 2)
        share_3a = pozos_3a / n
        anios = cur_year - min(w['vintage'] for w in ws) + 1

        km2 = area_by_name.get(bloque.strip().upper())
        if km2 and km2 > 0:
            density = n / km2
            pct_dev = min(density / FULL_DEV_DENSITY, 1.0)
            eur_gas_km2 = eur_gas / km2
            eur_oil_km2 = eur_oil / km2
            rf_gas = eur_gas / (GIP_DENSITY * km2)
            rf_oil = eur_oil / (OIP_DENSITY * km2)
            # Madurez: dominada por el desarrollo areal (pct_dev), con agotamiento y
            # antigüedad como modificadores de posición en el ciclo de vida.
            maturity = 100 * (0.55 * pct_dev + 0.30 * deplet_boe + 0.15 * min(anios / 12, 1))
            stage = classify(n, pct_dev, deplet_boe, share_3a)
        else:
            density = pct_dev = eur_gas_km2 = eur_oil_km2 = rf_gas = rf_oil = maturity = None
            stage = classify(n, None, deplet_boe, share_3a)

        rows.append({
            'bloque': bloque,
            'operador': Counter(w['empresa'] for w in ws).most_common(1)[0][0],
            'formacion': Counter(w['formacion'] for w in ws if w['formacion']).most_common(1)[0][0]
                         if any(w['formacion'] for w in ws) else '',
            'ventana': Counter(w['ventana'] for w in ws).most_common(1)[0][0],
            'n_wells': n,
            'n_vm': sum(1 for w in ws if w['formacion'] == 'vaca muerta'),
            'n_gas': len(gas_km),
            'n_oil': len(oil_km),
            'vintage_min': min(w['vintage'] for w in ws),
            'vintage_max': max(w['vintage'] for w in ws),
            'pozos_ult3a': pozos_3a,
            'share_ult3a': round(share_3a, 2),
            'anios_activo': anios,
            'rama_mediana': _med(ramas),
            'area_km2': round(km2, 0) if km2 else None,
            'well_density': round(density, 2) if density is not None else None,
            'pct_developed': round(pct_dev, 3) if pct_dev is not None else None,
            'eur_gas_total': round(eur_gas, 0),
            'eur_oil_total': round(eur_oil, 0),
            'cum_gas': round(cum_gas, 0),
            'cum_oil': round(cum_oil, 0),
            'eur_gas_km2': round(eur_gas_km2, 1) if eur_gas_km2 is not None else None,
            'eur_oil_km2': round(eur_oil_km2, 1) if eur_oil_km2 is not None else None,
            'eur_gas_km_med': _med(gas_km),
            'eur_oil_km_med': _med(oil_km),
            'depletion_gas': round(deplet_gas, 3),
            'depletion_oil': round(deplet_oil, 3),
            'depletion_boe': round(deplet_boe, 3),
            'rf_gas_hoy': round(rf_gas, 4) if rf_gas is not None else None,
            'rf_oil_hoy': round(rf_oil, 4) if rf_oil is not None else None,
            'rf_gas_vs_ult': round(rf_gas / RF_ULT_GAS, 3) if rf_gas is not None else None,
            'rf_oil_vs_ult': round(rf_oil / RF_ULT_OIL, 3) if rf_oil is not None else None,
            'maturity_index': round(maturity, 1) if maturity is not None else None,
            'stage': stage,
        })

    rows.sort(key=lambda r: -(r['maturity_index'] or -1))

    # Basin context (gas/oil separately to avoid BOE ambiguity).
    tot_eur_gas = sum(r['eur_gas_total'] for r in rows)
    tot_eur_oil = sum(r['eur_oil_total'] for r in rows)
    rf_cuenca_gas = tot_eur_gas / GIP_TOTAL_MMM3
    rf_cuenca_oil = tot_eur_oil / OIP_TOTAL_Mm3
    captured_gas = (tot_eur_gas / TCF_TO_MMM3) / REC_GAS_TCF      # share of EIA recoverable gas
    captured_oil = (tot_eur_oil * 1000.0 / BBL_TO_M3 / 1e9) / REC_OIL_BBBL  # Mm3→m3→bbl→Bbbl

    write_json(OUT_JSON, rows,
               source='Agregado por bloque de Cap IV + Adjunto IV (EUR Arps por pozo)',
               source_date=max((w['ultimo_mes'] for w in wells), default=None),
               block_count=len(rows),
               supuestos={
                   'in_situ': 'EIA: GIP 1202 Tcf, OIP 270 Bbbl sobre ~30.000 km² de Vaca Muerta',
                   'gip_density_mmm3_km2': round(GIP_DENSITY, 1),
                   'oip_density_mm3_km2': round(OIP_DENSITY, 1),
                   'rf_ultimo_gas': round(RF_ULT_GAS, 3),
                   'rf_ultimo_oil': round(RF_ULT_OIL, 3),
                   'full_dev_density_km2': FULL_DEV_DENSITY,
                   'rec_gas_tcf': REC_GAS_TCF,
                   'rec_oil_bbbl': REC_OIL_BBBL,
               },
               cuenca={
                   'eur_gas_total_mmm3': round(tot_eur_gas, 0),
                   'eur_oil_total_mm3': round(tot_eur_oil, 0),
                   'rf_cuenca_gas': round(rf_cuenca_gas, 4),
                   'rf_cuenca_oil': round(rf_cuenca_oil, 4),
                   'captured_gas_vs_eia': round(captured_gas, 4),
                   'captured_oil_vs_eia': round(captured_oil, 4),
               })
    write_csv(os.path.splitext(OUT_JSON)[0] + '.csv', rows)

    print(f'blocks.json written: {len(rows)} bloques')
    print(f'  RF-a-la-fecha cuenca: gas {rf_cuenca_gas*100:.2f}% (vs últ {RF_ULT_GAS*100:.0f}%) · '
          f'oil {rf_cuenca_oil*100:.2f}% (vs últ {RF_ULT_OIL*100:.0f}%)')
    print(f'  EUR perforado vs recuperable EIA: gas {captured_gas*100:.1f}% de 308 Tcf · '
          f'oil {captured_oil*100:.1f}% de 16 Bbbl')
    print('  Mas maduros (indice, >=8 pozos):')
    for r in [r for r in rows if r['maturity_index'] is not None and r['n_wells'] >= 8][:6]:
        print(f"    {r['bloque'][:22]:22s} idx {r['maturity_index']:5.1f} [{r['stage']:20s}] "
              f"dens {r['well_density']} %dev {r['pct_developed']} %agot {r['depletion_boe']} "
              f"RFgas {r['rf_gas_hoy']}")


if __name__ == '__main__':
    main()
