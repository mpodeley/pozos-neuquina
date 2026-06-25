#!/usr/bin/env python3
"""Build blocks.json — per-block (areapermisoconcesion) aggregates for the map.

Aggregates wells.json to one row per bloque so the choropleth can color
concessions by EUR (total) and EUR/1000m (productivity), gas and oil.

  eur_gas_total / eur_oil_total : sum of well EURs in the block (recoverable total)
  eur_gas_km_med / eur_oil_km_med: median of per-well EUR/1000m, over wells with a
                                   real fit (confianza alta/media) and lateral length
                                   — i.e. the "typical productive well" of the block.

Output: public/data/blocks.json. The frontend joins it to
public/data/concesiones_neuquina.geojson by uppercased block name.

Usage: python scripts/build_blocks.py
"""

import os
import sys
import json
from collections import Counter, defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _meta import write_json, write_csv  # noqa: E402

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, '..', 'public', 'data')
WELLS_JSON = os.path.join(DATA_DIR, 'wells.json')
OUT_JSON = os.path.join(DATA_DIR, 'blocks.json')


def _load(path):
    with open(path, encoding='utf-8') as f:
        raw = json.load(f)
    return raw.get('data', raw)


def _med(xs):
    return round(float(np.median(xs)), 1) if xs else None


def main():
    wells = _load(WELLS_JSON)
    groups = defaultdict(list)
    for w in wells:
        groups[(w.get('area') or '').strip()].append(w)

    rows = []
    for bloque, ws in groups.items():
        if not bloque:
            continue
        gas_km = [w['eur_gas_por_km'] for w in ws
                  if w.get('eur_gas_por_km') and w.get('eur_conf_gas') in ('alta', 'media')]
        oil_km = [w['eur_oil_por_km'] for w in ws
                  if w.get('eur_oil_por_km') and w.get('eur_conf_oil') in ('alta', 'media')]
        ramas = [w['rama_m'] for w in ws if w.get('rama_m')]
        rows.append({
            'bloque': bloque,
            'operador': Counter(w['empresa'] for w in ws).most_common(1)[0][0],
            'formacion': Counter(w['formacion'] for w in ws if w['formacion']).most_common(1)[0][0]
                         if any(w['formacion'] for w in ws) else '',
            'ventana': Counter(w['ventana'] for w in ws).most_common(1)[0][0],
            'n_wells': len(ws),
            'n_vm': sum(1 for w in ws if w['formacion'] == 'vaca muerta'),
            'n_gas': len(gas_km),
            'n_oil': len(oil_km),
            'vintage_min': min(w['vintage'] for w in ws),
            'vintage_max': max(w['vintage'] for w in ws),
            'rama_mediana': _med(ramas),
            'eur_gas_total': round(sum(w['eur_gas_mmm3'] or 0 for w in ws), 0),
            'eur_oil_total': round(sum(w['eur_oil_mm3'] or 0 for w in ws), 0),
            'cum_gas': round(sum(w['cum_gas_mmm3'] or 0 for w in ws), 0),
            'cum_oil': round(sum(w['cum_oil_mm3'] or 0 for w in ws), 0),
            'eur_gas_km_med': _med(gas_km),
            'eur_oil_km_med': _med(oil_km),
        })

    rows.sort(key=lambda r: -r['eur_gas_total'])
    write_json(OUT_JSON, rows,
               source='Agregado por bloque de Cap IV + Adjunto IV (EUR Arps por pozo)',
               source_date=max((w['ultimo_mes'] for w in wells), default=None),
               block_count=len(rows))
    write_csv(os.path.splitext(OUT_JSON)[0] + '.csv', rows)
    print(f'blocks.json written: {len(rows)} bloques')
    for r in rows[:5]:
        print(f"  {r['bloque']:24s} {r['n_wells']:4d} pozos  EUR gas {r['eur_gas_total']:.0f} MMm³  "
              f"/1000m {r['eur_gas_km_med']}  ({r['operador']})")


if __name__ == '__main__':
    main()
