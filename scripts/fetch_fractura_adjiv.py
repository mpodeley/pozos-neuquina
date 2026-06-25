#!/usr/bin/env python3
"""Fetch Adjunto IV — Datos de Fractura (well completions metadata).

Source: datos.energia.gob.ar CKAN dataset
  "Datos de fractura de pozos de hidrocarburos (Adjunto IV)"
  package id 71fa2e84-0316-4a1b-af68-7f35e41f58d7  (actualización diaria)

This is the key join for normalization: it carries longitud_rama_horizontal_m
(lateral length), cantidad_fracturas (stages), and proppant/water volumes per well.

A well can have several fracture records (stages reported on different dates,
re-fracs). We collapse to ONE row per idpozo:
  rama_m         = max longitud_rama_horizontal_m  (full lateral)
  fracturas      = sum cantidad_fracturas          (total stages pumped)
  arena_tn       = sum (nacional + importada)      (total proppant)
  agua_m3        = sum agua_inyectada_m3
  reservorio     = latest subtipo_reservorio (SHALE/TIGHT) | tipo_reservorio
  formacion_frac = latest formacion_productiva
  fecha_fractura = latest YYYY-MM of fecha_fin_fractura (completion month)

Output: public/data/fractura.json  (envelope, one row per well — small)

Usage:
  python scripts/fetch_fractura_adjiv.py
"""

import csv
import os
import sys
from datetime import datetime, timezone

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _meta import write_json, write_csv  # noqa: E402

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(SCRIPT_DIR, '..', 'public', 'data')
OUT_JSON = os.path.join(OUT_DIR, 'fractura.json')

DATASET_ID = '71fa2e84-0316-4a1b-af68-7f35e41f58d7'
CKAN_BASE = 'http://datos.energia.gob.ar/api/3/action'
FALLBACK_URL = ('http://datos.energia.gob.ar/dataset/71fa2e84-0316-4a1b-af68-7f35e41f58d7/'
                'resource/2280ad92-6ed3-403e-a095-50139863ab0d/download/'
                'datos-de-fractura-de-pozos-de-hidrocarburos-adjunto-iv-actualizacin-diaria.csv')
HDRS = {'User-Agent': 'Mozilla/5.0 Chrome/130 pozos-neuquina'}
TARGET_CUENCA = 'NEUQUINA'


def resolve_csv_url(session):
    try:
        r = session.get(f'{CKAN_BASE}/package_show', params={'id': DATASET_ID},
                        headers=HDRS, timeout=60)
        r.raise_for_status()
        for res in r.json()['result'].get('resources', []):
            if res.get('format', '').upper() == 'CSV' and res.get('url'):
                return res['url']
    except Exception as e:
        print(f'  package_show failed ({e}); using fallback URL', file=sys.stderr)
    return FALLBACK_URL


def _f(x):
    if x is None:
        return 0.0
    s = str(x).strip().replace(',', '.')
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def _chain_first(first, rest):
    yield first
    yield from rest


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    session = requests.Session()
    url = resolve_csv_url(session)
    print(f'Streaming Adjunto IV: {url}')

    # {idpozo: aggregated dict}
    agg = {}
    seen = kept = 0
    with session.get(url, headers=HDRS, stream=True, timeout=600) as r:
        r.raise_for_status()
        r.encoding = 'utf-8'
        lines = r.iter_lines(decode_unicode=True)
        first = next(lines, '')
        if first.startswith('﻿'):
            first = first[1:]
        reader = csv.DictReader(_chain_first(first, lines))
        for row in reader:
            seen += 1
            if (row.get('cuenca') or '').strip().upper() != TARGET_CUENCA:
                continue
            try:
                idpozo = int(row['idpozo'])
            except (KeyError, ValueError, TypeError):
                continue
            kept += 1
            rama = _f(row.get('longitud_rama_horizontal_m'))
            frac = _f(row.get('cantidad_fracturas'))
            arena = _f(row.get('arena_bombeada_nacional_tn')) + _f(row.get('arena_bombeada_importada_tn'))
            agua = _f(row.get('agua_inyectada_m3'))
            # completion month from fecha_fin_fractura (YYYY-MM) or anio_ff/mes_ff
            fmes = ''
            ff = (row.get('fecha_fin_fractura') or '').strip()
            if len(ff) >= 7 and ff[4] == '-':
                fmes = ff[:7]
            elif row.get('anio_ff') and row.get('mes_ff'):
                try:
                    fmes = f"{int(row['anio_ff']):04d}-{int(row['mes_ff']):02d}"
                except (ValueError, TypeError):
                    fmes = ''

            rec = agg.get(idpozo)
            if rec is None:
                rec = {
                    'id': idpozo,
                    'sigla': (row.get('sigla') or '').strip(),
                    'area': (row.get('areapermisoconcesion') or '').strip(),
                    'empresa_frac': (row.get('empresa_informante') or '').strip(),
                    'rama_m': 0.0,
                    'fracturas': 0.0,
                    'arena_tn': 0.0,
                    'agua_m3': 0.0,
                    'formacion_frac': '',
                    'reservorio': '',
                    'fecha_fractura': '',
                }
                agg[idpozo] = rec
            rec['rama_m'] = max(rec['rama_m'], rama)
            rec['fracturas'] += frac
            rec['arena_tn'] += arena
            rec['agua_m3'] += agua
            if fmes >= rec['fecha_fractura']:  # latest record wins for categorical attrs
                rec['fecha_fractura'] = fmes
                f_prod = (row.get('formacion_productiva') or '').strip().lower()
                reserv = ((row.get('subtipo_reservorio') or '').strip().upper()
                          or (row.get('tipo_reservorio') or '').strip().upper())
                if f_prod:
                    rec['formacion_frac'] = f_prod
                if reserv:
                    rec['reservorio'] = reserv

    rows = sorted(agg.values(), key=lambda d: d['id'])
    for rec in rows:
        rec['rama_m'] = round(rec['rama_m'], 1)
        rec['fracturas'] = int(rec['fracturas'])
        rec['arena_tn'] = round(rec['arena_tn'], 1)
        rec['agua_m3'] = round(rec['agua_m3'], 1)

    write_json(OUT_JSON, rows,
               source='Secretaría de Energía — Adjunto IV / Datos de Fractura (datos.energia.gob.ar)',
               source_date=max((r['fecha_fractura'] for r in rows if r['fecha_fractura']), default=None),
               well_count=len(rows))
    write_csv(os.path.splitext(OUT_JSON)[0] + '.csv', rows)

    with_rama = sum(1 for r in rows if r['rama_m'] > 0)
    print(f'fractura.json written: {len(rows):,} pozos (rows seen={seen:,}, kept={kept:,})')
    print(f'  con largo de rama > 0: {with_rama:,}')


if __name__ == '__main__':
    main()
