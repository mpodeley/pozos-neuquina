#!/usr/bin/env python3
"""Fetch well trajectories — "Trayectorias de Pozo Vaca Muerta".

Source: datos.energia.gob.ar CKAN dataset
  package id f5c0b5a5-b402-44d7-8fe0-f9e4fcb78b8d
The CSV carries, per idpozo, the full wellbore as a GeoJSON MultiLineString plus
the SEN stratigraphic navigation codes (the landing). We keep only wells that are
in our non-conventional set and derive, per well:
  - heel / toe / mid-lateral coordinates (lon,lat) — for the map and neighbour
    distance (parent/child),
  - landing (decoded from the SEN unit/detail codes, see NAV_* below),
  - lateral length (HZ), TVD, drilling/termination dates.

Landing decode (instructivo Res 319/93, "Equivalencias y Códigos de Sistemas
Estratigráficos"): unidad 1..6 = Vaca Muerta systems (1 = VM Inferior … 6 = VM
Superior alta); detalle = {unidad}{nivel} with nivel 1=Inferior,2=Medio,3=Superior.

Output: public/data/trayectorias.json  (one row per well with trajectory)
        scripts/landing_map.json        (the code→landing legend, for transparency)

Usage: python scripts/fetch_trayectorias.py
"""

import json
import csv
import math
import os
import sys

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _meta import write_json  # noqa: E402

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, '..', 'public', 'data')
SERIES_JSON = os.path.join(DATA_DIR, 'well_series.json')
OUT_JSON = os.path.join(DATA_DIR, 'trayectorias.json')
LANDING_MAP_JSON = os.path.join(SCRIPT_DIR, 'landing_map.json')

DATASET_ID = 'f5c0b5a5-b402-44d7-8fe0-f9e4fcb78b8d'
CKAN = 'http://datos.energia.gob.ar/api/3/action'
FALLBACK_URL = ('http://datos.energia.gob.ar/dataset/f5c0b5a5-b402-44d7-8fe0-f9e4fcb78b8d/'
                'resource/94741ac7-4f46-4efe-b112-d3f82a4ef7c5/download/'
                'trayectorias-de-pozo-vaca-muerta.csv')
HDRS = {'User-Agent': 'Mozilla/5.0 Chrome/130 pozos-neuquina'}

LAT0 = -38.5  # reference latitude for the local equirectangular projection (m)
NIVEL = {'1': 'Inferior', '2': 'Medio', '3': 'Superior'}
UNIT_ZONA = {'1': 'VM Inferior', '2': 'VM Medio', '3': 'VM Medio',
             '4': 'VM Superior', '5': 'VM Superior', '6': 'VM Superior'}
# Rough correspondence to the study's nomenclature (CO/OA/OB), refinable by the user.
UNIT_NOMBRE = {'1': 'Inferior (Cocina/OA)', '2': 'Orgánico Inferior (OA)',
               '3': 'Orgánico Medio (OB)', '4': 'VM Superior baja',
               '5': 'VM Superior media', '6': 'VM Superior alta'}


def decode_landing(unit, detail):
    unit = (unit or '').strip()
    detail = (detail or '').strip()
    if unit in ('', '0'):
        return {'landing': None, 'landing_nivel': None, 'landing_zona': None, 'landing_nombre': None}
    nivel = NIVEL.get(detail[1:2]) if len(detail) == 2 and detail[0] == unit else None
    return {
        'landing': f'U{unit}',
        'landing_nivel': nivel,
        'landing_zona': UNIT_ZONA.get(unit),
        'landing_nombre': UNIT_NOMBRE.get(unit),
    }


def write_landing_map():
    rows = []
    for u in '123456':
        for lvl in '123':
            rows.append({'codigo_unidad': u, 'codigo_detalle': f'{u}{lvl}',
                         'unidad': f'U{u}', 'nivel': NIVEL[lvl],
                         'zona': UNIT_ZONA[u], 'nombre': UNIT_NOMBRE[u]})
    with open(LANDING_MAP_JSON, 'w', encoding='utf-8') as f:
        json.dump({'fuente': 'Instructivo Res 319/93 — Equivalencias y Códigos de Sistemas Estratigráficos',
                   'nota': 'Refinable con pases de landing regionales del usuario',
                   'codigos': rows}, f, ensure_ascii=False, indent=2)


def to_m(lon, lat):
    return (lon * 111320.0 * math.cos(math.radians(LAT0)), lat * 110540.0)


def _f(x):
    try:
        return float(str(x).strip().replace(',', '.'))
    except (ValueError, TypeError):
        return None


def heel_toe_mid(geojson_str, hz):
    """Return (heel_ll, toe_ll, mid_ll) from the trajectory, walking back HZ metres
    in plan view from the toe to find the heel."""
    try:
        gj = json.loads(geojson_str)
        line = gj['coordinates'][0]
    except Exception:
        return None
    pts = [(p[0], p[1]) for p in line if len(p) >= 2]
    if len(pts) < 2:
        return None
    toe = pts[-1]
    if not hz or hz <= 0:
        return pts[0], toe, ((pts[0][0] + toe[0]) / 2, (pts[0][1] + toe[1]) / 2)
    ptm = [to_m(lon, lat) for lon, lat in pts]
    acc = 0.0
    heel = pts[0]
    for i in range(len(ptm) - 1, 0, -1):
        dx = ptm[i][0] - ptm[i - 1][0]
        dy = ptm[i][1] - ptm[i - 1][1]
        acc += math.hypot(dx, dy)
        if acc >= hz:
            heel = pts[i - 1]
            break
    mid = ((heel[0] + toe[0]) / 2, (heel[1] + toe[1]) / 2)
    return heel, toe, mid


def _ym(s):
    s = (s or '').strip()
    return s[:7] if len(s) >= 7 and s[4] == '-' else None


def resolve_url(session):
    try:
        r = session.get(f'{CKAN}/package_show', params={'id': DATASET_ID}, headers=HDRS, timeout=60)
        for res in r.json()['result'].get('resources', []):
            if res.get('format', '').upper() == 'CSV' and res.get('url'):
                return res['url']
    except Exception as e:
        print(f'  package_show failed ({e}); fallback', file=sys.stderr)
    return FALLBACK_URL


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(SERIES_JSON, encoding='utf-8') as f:
        ourids = {w['id'] for w in json.load(f)['data']['wells']}

    session = requests.Session()
    url = resolve_url(session)
    print(f'Streaming trajectories: {url}')
    out = []
    seen = kept = 0
    with session.get(url, headers=HDRS, stream=True, timeout=600) as r:
        r.raise_for_status()
        r.encoding = 'utf-8'
        lines = r.iter_lines(decode_unicode=True)
        first = next(lines, '')
        if first.startswith('﻿'):
            first = first[1:]
        reader = csv.DictReader(_chain(first, lines))
        for row in reader:
            seen += 1
            try:
                idp = int(row.get('idpo'))
            except (TypeError, ValueError):
                continue
            if idp not in ourids:
                continue
            hz = _f(row.get('largo_rama_horizontal_mt'))
            ht = heel_toe_mid(row.get('geojson'), hz)
            if ht is None:
                continue
            heel, toe, mid = ht
            kept += 1
            rec = {
                'id': idp,
                'sigla': (row.get('sigla') or '').strip(),
                'hz': round(hz, 0) if hz else None,
                'tvd': round(_f(row.get('profundidad_vertical_mt')) or 0, 0) or None,
                'pnl_tvd': round(_f(row.get('pnl_tvd')) or 0, 0) or None,
                'nav_unit': (row.get('unidad_intervalo_navegacion') or '').strip(),
                'nav_detail': (row.get('detalle_unidad_intervalo_navegacion') or '').strip(),
                'drilfin': _ym(row.get('drilfin')),
                'termfin': _ym(row.get('termfin')),
                'heel': [round(heel[0], 6), round(heel[1], 6)],
                'toe': [round(toe[0], 6), round(toe[1], 6)],
                'mid': [round(mid[0], 6), round(mid[1], 6)],
            }
            rec.update(decode_landing(rec['nav_unit'], rec['nav_detail']))
            out.append(rec)

    out.sort(key=lambda r: r['id'])
    write_landing_map()
    write_json(OUT_JSON, out,
               source='Secretaría de Energía — Trayectorias de Pozo Vaca Muerta (datos.energia.gob.ar)',
               well_count=len(out))
    con_landing = sum(1 for r in out if r['landing'])
    print(f'trayectorias.json: {len(out)} pozos con trayectoria (de {len(ourids)} no-conv)')
    print(f'  con landing decodificado: {con_landing}')
    from collections import Counter
    print('  landing (unidad):', dict(Counter(r['landing'] for r in out).most_common()))


def _chain(first, rest):
    yield first
    yield from rest


if __name__ == '__main__':
    main()
