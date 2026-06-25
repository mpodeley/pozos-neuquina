#!/usr/bin/env python3
"""Fetch Capítulo IV — per-well monthly production for the Neuquina basin.

Unlike estado_del_sistema's fetch_capiv.py (which aggregates to mes×bloque×empresa
and throws away the per-well detail), this keeps one time series PER WELL (idpozo),
which is what decline-curve and type-well analysis needs.

Source: datos.energia.gob.ar CKAN dataset
  "Producción de petróleo y gas por pozo (Capítulo IV)"
  package id c846e79c-026c-4040-897f-1ad3543b407c
One CSV per calendar year (~100-330 MB), one row per (well, month, formation).

Scope: cuenca == NEUQUINA and tipo_de_recurso != CONVENCIONAL (foco no convencional:
Vaca Muerta / Mulichinco / tight). Conventional aggregate context already lives in
estado_del_sistema.

Persistence model (so we don't re-stream 16 years of CSVs every run):
  scripts/capiv_raw.json.gz   -- internal, committed: per-well SPARSE monthly raw
                                 volumes + latest attributes. Upsert target.
  public/data/well_series.json -- frontend: per-well CONTIGUOUS daily-rate arrays
                                 aligned to first production month (m0).

A monthly CI run fetches only the current+previous year (delta), upserts those
months into the raw store, and re-derives well_series.json from the full store.

Usage:
  python scripts/fetch_capiv_pozos.py                # delta: current + previous year
  python scripts/fetch_capiv_pozos.py --since 2010   # backfill all years >= 2010
  python scripts/fetch_capiv_pozos.py --years 3      # most recent 3 years
  python scripts/fetch_capiv_pozos.py --force        # ignore Last-Modified cache
"""

import argparse
import csv
import gzip
import json
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timezone

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _meta import write_json  # noqa: E402

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(SCRIPT_DIR, '..', 'public', 'data')
RAW_STORE = os.path.join(SCRIPT_DIR, 'capiv_raw.json.gz')
SERIES_JSON = os.path.join(OUT_DIR, 'well_series.json')
CACHE_PATH = os.path.join(SCRIPT_DIR, '.capiv_pozos_cache.json')

DATASET_ID = 'c846e79c-026c-4040-897f-1ad3543b407c'
CKAN_BASE = 'http://datos.energia.gob.ar/api/3/action'
HDRS = {'User-Agent': 'Mozilla/5.0 Chrome/130 pozos-neuquina'}
TARGET_CUENCA = 'NEUQUINA'
# Non-conventional production in Neuquina is negligible before ~2010, so a full
# backfill defaults to this start year to keep the raw store small.
DEFAULT_SINCE = 2010

# Attributes we snapshot from the most recent month a well reports.
ATTR_KEYS = ('sigla', 'empresa', 'area', 'provincia', 'formacion', 'formprod',
             'recurso', 'tipopozo')


def list_yearly_resources(session):
    """Return {year: resource_dict} for the per-year production CSVs.

    Prefers the consolidated flavor over the "(DDJJ abiertas y cerradas)" one.
    """
    r = session.get(f'{CKAN_BASE}/package_show',
                    params={'id': DATASET_ID}, headers=HDRS, timeout=60)
    r.raise_for_status()
    pkg = r.json()['result']

    plain, ddjj = {}, {}
    for res in pkg.get('resources', []):
        name = (res.get('name') or '').strip()
        if res.get('format', '').upper() != 'CSV':
            continue
        if 'Producción de Pozos de Gas y Petróleo' not in name:
            continue
        year = None
        for token in name.replace('-', ' ').replace('(', ' ').split():
            if len(token) == 4 and token.isdigit() and 2000 <= int(token) <= 2100:
                year = int(token)
        if year is None:
            continue
        bucket = ddjj if 'DDJJ' in name else plain
        prev = bucket.get(year)
        if prev is None or (res.get('last_modified') or '') > (prev.get('last_modified') or ''):
            bucket[year] = res

    out = {}
    for year in sorted(set(plain) | set(ddjj)):
        out[year] = plain.get(year) or ddjj[year]
    return out


def _safe_float(x):
    if x is None:
        return 0.0
    s = str(x).strip().replace(',', '.')
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def stream_year(session, resource, fetched, attrs):
    """Stream one yearly CSV; accumulate per (idpozo, month) volumes for this run.

    `fetched`: {idpozo: {month: [gas_dam3, pet_m3, agua_m3, tef]}} summed within run.
    `attrs`:   {idpozo: (sort_key, attr_dict)} latest-month attributes.
    Returns (rows_seen, rows_kept).
    """
    url = resource['url']
    with session.get(url, headers=HDRS, stream=True, timeout=900) as r:
        r.raise_for_status()
        r.encoding = 'utf-8'
        lines = r.iter_lines(decode_unicode=True)
        first = next(lines, '')
        if first.startswith('﻿'):
            first = first[1:]
        reader = csv.DictReader(_chain_first(first, lines))
        seen = kept = 0
        for row in reader:
            seen += 1
            if (row.get('cuenca') or '').strip().upper() != TARGET_CUENCA:
                continue
            if (row.get('tipo_de_recurso') or '').strip().upper() == 'CONVENCIONAL':
                continue
            try:
                idpozo = int(row['idpozo'])
                year = int(row['anio'])
                month = int(row['mes'])
            except (KeyError, ValueError, TypeError):
                continue
            kept += 1
            mes = f'{year:04d}-{month:02d}'
            gas = _safe_float(row.get('prod_gas'))   # dam³ (= mil m³)
            pet = _safe_float(row.get('prod_pet'))   # m³
            agua = _safe_float(row.get('prod_agua'))  # m³
            tef = _safe_float(row.get('tef'))         # días efectivos

            wm = fetched[idpozo]
            cur = wm.get(mes)
            if cur is None:
                wm[mes] = [gas, pet, agua, tef]
            else:
                cur[0] += gas
                cur[1] += pet
                cur[2] += agua
                cur[3] = max(cur[3], tef)  # tef is per-well-month, not per-formation

            sort_key = (year, month)
            prev = attrs.get(idpozo)
            if prev is None or sort_key >= prev[0]:
                attrs[idpozo] = (sort_key, {
                    'sigla': (row.get('sigla') or '').strip(),
                    'empresa': (row.get('empresa') or '').strip(),
                    'area': (row.get('areapermisoconcesion') or '').strip(),
                    'provincia': (row.get('provincia') or '').strip(),
                    'formacion': (row.get('formacion') or '').strip().lower(),
                    'formprod': (row.get('formprod') or '').strip(),
                    'recurso': (row.get('sub_tipo_recurso') or '').strip().upper()
                               or (row.get('tipo_de_recurso') or '').strip().upper(),
                    'tipopozo': (row.get('tipopozo') or '').strip(),
                })
        return seen, kept


def _chain_first(first, rest):
    yield first
    yield from rest


def load_raw_store():
    """Load persistent raw store: {idpozo(str): {attrs..., 'm': {month: [g,p,a,tef]}}}."""
    if not os.path.exists(RAW_STORE):
        return {}
    with gzip.open(RAW_STORE, 'rt', encoding='utf-8') as f:
        return json.load(f)


def save_raw_store(store):
    os.makedirs(os.path.dirname(RAW_STORE), exist_ok=True)
    with gzip.open(RAW_STORE, 'wt', encoding='utf-8') as f:
        json.dump(store, f, ensure_ascii=False, separators=(',', ':'))


def load_cache():
    if not os.path.exists(CACHE_PATH):
        return {}
    try:
        with open(CACHE_PATH, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def save_cache(cache):
    with open(CACHE_PATH, 'w', encoding='utf-8') as f:
        json.dump(cache, f, indent=2)


def merge_into_store(store, fetched, attrs):
    """Upsert this run's fetched months + refreshed attrs into the raw store."""
    for idpozo, months in fetched.items():
        key = str(idpozo)
        rec = store.get(key)
        if rec is None:
            rec = {'m': {}}
            store[key] = rec
        # Replace (not add) each fetched month so re-runs don't double count.
        rec['m'].update({m: v for m, v in months.items()})
        # Refresh attributes if this run saw a newer month for the well.
        sort_key, attr = attrs[idpozo]
        prev_key = tuple(rec.get('_attr_month', (0, 0)))
        if sort_key >= prev_key:
            rec.update(attr)
            rec['_attr_month'] = list(sort_key)


def _months_between(m0, m1):
    """Inclusive list of YYYY-MM strings from m0 to m1."""
    y0, mo0 = (int(x) for x in m0.split('-'))
    y1, mo1 = (int(x) for x in m1.split('-'))
    out = []
    y, mo = y0, mo0
    while (y, mo) <= (y1, mo1):
        out.append(f'{y:04d}-{mo:02d}')
        mo += 1
        if mo > 12:
            mo = 1
            y += 1
    return out


def _days_in_month(mes):
    y, m = (int(x) for x in mes.split('-'))
    nxt = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
    return (nxt - date(y, m, 1)).days


def derive_series(store):
    """Turn the raw store into per-well contiguous daily-rate arrays from m0.

    Drops wells that never produced (no month with gas>0 or oil>0).
    Rate = monthly volume / days, where days = tef (effective) if >0 else calendar.
    Gas rate in dam³/d (mil m³/d); oil & water in m³/d.
    """
    wells = []
    for key, rec in store.items():
        months = rec.get('m', {})
        if not months:
            continue
        producing = sorted(m for m, v in months.items() if (v[0] > 0 or v[1] > 0))
        if not producing:
            continue
        m0, mlast = producing[0], max(months)
        timeline = _months_between(m0, mlast)
        gas, oil, wat, days = [], [], [], []
        for mes in timeline:
            v = months.get(mes)
            if v is None:
                gas.append(0.0); oil.append(0.0); wat.append(0.0); days.append(0)
                continue
            g, p, a, tef = v
            d = tef if tef and tef > 0 else _days_in_month(mes)
            d = d or 1
            gas.append(round(g / d, 1))     # dam³/d
            oil.append(round(p / d, 2))     # m³/d
            wat.append(round(a / d, 1))     # m³/d
            days.append(round(tef, 1) if tef else _days_in_month(mes))
        well = {
            'id': int(key),
            'm0': m0,
            'n': len(timeline),
            'gas': gas,
            'oil': oil,
            'wat': wat,
            'days': days,
        }
        for k in ATTR_KEYS:
            well[k] = rec.get(k, '')
        wells.append(well)
    wells.sort(key=lambda w: w['id'])
    return wells


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--years', type=int, default=2,
                    help='Most recent N years to fetch when no --since (default 2).')
    ap.add_argument('--since', type=int, default=None,
                    help='Backfill every year >= SINCE (overrides --years).')
    ap.add_argument('--force', action='store_true',
                    help='Ignore Last-Modified cache; re-download targeted years.')
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    session = requests.Session()

    print('Listing yearly resources from CKAN...')
    resources = list_yearly_resources(session)
    if not resources:
        print('ERROR: no yearly production resources found', file=sys.stderr)
        sys.exit(1)

    store = load_raw_store()
    # First-ever run with no store: force a full backfill so well histories are complete.
    since = args.since
    if since is None and not store:
        since = DEFAULT_SINCE
        print(f'No existing raw store -> full backfill since {since}')

    current_year = date.today().year
    if since is not None:
        target_years = sorted(y for y in resources if y >= since)
    else:
        target_years = sorted(y for y in resources
                              if (current_year - args.years) < y <= current_year)
        if not target_years:
            target_years = sorted(resources)[-args.years:]
    print(f'Target years: {target_years}')

    cache = {} if args.force else load_cache()
    fetched = defaultdict(dict)
    attrs = {}
    fetched_years, errors = [], []

    for year in target_years:
        res = resources[year]
        modified = res.get('last_modified') or ''
        if not args.force and cache.get(str(year)) == modified and store:
            print(f'  {year}: unchanged since last run, skipping')
            continue
        size_mb = (res.get('size') or 0) / 1024 / 1024
        print(f'  {year}: streaming {size_mb:.0f} MB...')
        try:
            seen, kept = stream_year(session, res, fetched, attrs)
            print(f'    rows seen={seen:,}  Neuquina no-conv kept={kept:,}')
            cache[str(year)] = modified
            fetched_years.append(year)
        except Exception as e:
            errors.append(f'year {year}: {e}')
            print(f'    ERROR: {e}', file=sys.stderr)

    if fetched:
        merge_into_store(store, fetched, attrs)
        save_raw_store(store)
        save_cache(cache)
    elif not store:
        print('No data accumulated and no existing store. Aborting.', file=sys.stderr)
        sys.exit(2)

    wells = derive_series(store)
    latest_month = max((w['m0'] for w in wells), default=None)
    # source_date = latest calendar month present anywhere
    all_last = max((_months_between(w['m0'], w['m0'])[0] if w['n'] == 1
                    else _add_months(w['m0'], w['n'] - 1)) for w in wells) if wells else None

    write_json(
        SERIES_JSON,
        {'wells': wells},
        source='Secretaría de Energía — Capítulo IV (datos.energia.gob.ar)',
        source_date=all_last,
        years_fetched=fetched_years,
        scope='cuenca=NEUQUINA, tipo_de_recurso != CONVENCIONAL',
        well_count=len(wells),
        errors=errors or None,
    )

    print()
    print(f'well_series.json written: {len(wells):,} pozos no-conv (último mes {all_last})')
    if errors:
        print(f'  WARN: {len(errors)} errors: {errors}', file=sys.stderr)


def _add_months(m0, k):
    y, mo = (int(x) for x in m0.split('-'))
    mo += k
    y += (mo - 1) // 12
    mo = (mo - 1) % 12 + 1
    return f'{y:04d}-{mo:02d}'


if __name__ == '__main__':
    main()
