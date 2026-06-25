#!/usr/bin/env python3
"""Build type_wells.json + activity.json.

Type wells (pozos tipo): group wells into cohorts and, aligning every well by
month-on-production, compute P10/P50/P90 rate fans (gas & oil), both raw and
normalised per 1000 m of lateral. Fit Arps to the P50 curve for a representative
type-EUR.

  P10 = high case (90th pct of rate), P50 = median, P90 = low case (10th pct)
  -- petroleum convention (P10 is the optimistic curve).

Cohort groups produced:
  formacion : every formation with enough wells
  vintage   : Vaca Muerta wells by year of first production
  empresa   : Vaca Muerta wells by operator (top by count)
  ventana   : Vaca Muerta wells by fluid window (GOR)

Inputs:  public/data/well_series.json, public/data/wells.json
Outputs: public/data/type_wells.json, public/data/activity.json
"""

import os
import sys
import json
from collections import defaultdict

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import arps  # noqa: E402
from _meta import write_json  # noqa: E402

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, '..', 'public', 'data')
SERIES_JSON = os.path.join(DATA_DIR, 'well_series.json')
WELLS_JSON = os.path.join(DATA_DIR, 'wells.json')
TYPE_JSON = os.path.join(DATA_DIR, 'type_wells.json')
ACT_JSON = os.path.join(DATA_DIR, 'activity.json')

MIN_WELLS = 8       # cohort must have at least this many wells
MIN_AT_T = 4        # keep a month only while this many wells still report
TMAX = 120          # cap type curves at 10 years
TOP_OPERATORS = 12


def _load(path):
    with open(path, encoding='utf-8') as f:
        raw = json.load(f)
    return raw.get('data', raw)


def type_curve(cohort_wells, series_by_id):
    """Build P10/P50/P90 fans (raw + per-km) and a P50 type-EUR for a cohort.

    cohort_wells: list of wells.json rows. series_by_id: {id: well_series row}.
    Returns a cohort dict or None if too few wells.
    """
    ids = [w['id'] for w in cohort_wells if w['id'] in series_by_id]
    if len(ids) < MIN_WELLS:
        return None
    rama_by_id = {w['id']: (w.get('rama_m') or 0) for w in cohort_wells}

    # gas in MMm³/d (÷1000 from stored dam³/d), oil in m³/d.
    gas_raw, oil_raw = defaultdict(list), defaultdict(list)
    gas_km, oil_km = defaultdict(list), defaultdict(list)
    for wid in ids:
        s = series_by_id[wid]
        rama = rama_by_id.get(wid, 0)
        km = rama / 1000.0 if rama and rama > 0 else None
        for t, (g, o) in enumerate(zip(s['gas'], s['oil'])):
            if t >= TMAX:
                break
            gmm = g / 1000.0
            gas_raw[t].append(gmm)
            oil_raw[t].append(o)
            if km:
                gas_km[t].append(gmm / km)
                oil_km[t].append(o / km)

    def fans(store):
        p10, p50, p90 = [], [], []
        for t in range(TMAX):
            vals = store.get(t)
            if not vals or len(vals) < MIN_AT_T:
                break
            a = np.asarray(vals, dtype=float)
            p10.append(round(float(np.percentile(a, 90)), 4))
            p50.append(round(float(np.percentile(a, 50)), 4))
            p90.append(round(float(np.percentile(a, 10)), 4))
        return p10, p50, p90

    g10, g50, g90 = fans(gas_raw)
    o10, o50, o90 = fans(oil_raw)
    gk10, gk50, gk90 = fans(gas_km)
    ok10, ok50, ok90 = fans(oil_km)
    if len(g50) < 3:
        return None

    # type-EUR by fitting the P50 raw curve (convert gas back to dam³/d for arps units)
    days = [arps.DAYS_PER_MONTH] * len(g50)
    gas_dam3 = [v * 1000.0 for v in g50]
    fg = arps.fit_and_eur(gas_dam3, days, 'gas')
    days_o = [arps.DAYS_PER_MONTH] * len(o50)
    fo = arps.fit_and_eur(o50, days_o, 'oil')

    ramas = [rama_by_id[i] for i in ids if rama_by_id.get(i, 0) > 0]
    return {
        'n_wells': len(ids),
        'n_wells_rama': len(ramas),
        'rama_mediana': round(float(np.median(ramas)), 0) if ramas else None,
        'tmax': len(g50),
        'gas_p10': g10, 'gas_p50': g50, 'gas_p90': g90,
        'oil_p10': o10, 'oil_p50': o50, 'oil_p90': o90,
        'gas_p50_km': gk50, 'gas_p10_km': gk10, 'gas_p90_km': gk90,
        'oil_p50_km': ok50, 'oil_p10_km': ok10, 'oil_p90_km': ok90,
        'type_eur_gas_mmm3': round(fg['eur'] / 1000.0, 1),
        'type_eur_oil_mm3': round(fo['eur'] / 1000.0, 1),
        'type_qi_gas_mmm3d': round(fg.get('qi', 0) / 1000.0, 4) if fg.get('qi') else None,
        'type_di_gas': fg.get('di'),
        'type_b_gas': fg.get('b'),
    }


def build_cohorts(wells, series_by_id):
    cohorts = []

    def add(group, key, label, subset):
        tc = type_curve(subset, series_by_id)
        if tc:
            tc.update({'group': group, 'key': str(key), 'label': label})
            cohorts.append(tc)

    # by formacion (all wells)
    by_form = defaultdict(list)
    for w in wells:
        by_form[w.get('formacion') or 'otras'].append(w)
    for form, subset in sorted(by_form.items(), key=lambda kv: -len(kv[1])):
        add('formacion', form, form.title(), subset)

    vm = [w for w in wells if (w.get('formacion') or '') == 'vaca muerta']

    # Vaca Muerta by vintage
    by_vint = defaultdict(list)
    for w in vm:
        by_vint[w['vintage']].append(w)
    for year in sorted(by_vint):
        add('vintage', year, f'VM {year}', by_vint[year])

    # Vaca Muerta by operator (top by count)
    by_emp = defaultdict(list)
    for w in vm:
        by_emp[w.get('empresa') or '—'].append(w)
    for emp, subset in sorted(by_emp.items(), key=lambda kv: -len(kv[1]))[:TOP_OPERATORS]:
        add('empresa', emp, emp, subset)

    # Vaca Muerta by window
    by_win = defaultdict(list)
    for w in vm:
        by_win[w.get('ventana') or '—'].append(w)
    for win, subset in sorted(by_win.items(), key=lambda kv: -len(kv[1])):
        add('ventana', win, win, subset)

    return cohorts


def build_activity(wells):
    """New-well counts: per month (total) and per (year, operator) for stacked bars."""
    by_month = defaultdict(int)
    by_month_vm = defaultdict(int)
    by_year_emp = defaultdict(int)
    for w in wells:
        m0 = w['m0']
        by_month[m0] += 1
        if (w.get('formacion') or '') == 'vaca muerta':
            by_month_vm[m0] += 1
        by_year_emp[(int(m0[:4]), w.get('empresa') or '—')] += 1

    months = sorted(by_month)
    by_month_rows = [{'mes': m, 'nuevos': by_month[m], 'vaca_muerta': by_month_vm.get(m, 0)}
                     for m in months]
    # keep top operators overall for the stacked view
    emp_tot = defaultdict(int)
    for (yr, emp), c in by_year_emp.items():
        emp_tot[emp] += c
    top_emps = [e for e, _ in sorted(emp_tot.items(), key=lambda kv: -kv[1])[:TOP_OPERATORS]]
    years = sorted({yr for (yr, _) in by_year_emp})
    by_year_rows = []
    for yr in years:
        row = {'anio': yr}
        for emp in top_emps:
            row[emp] = by_year_emp.get((yr, emp), 0)
        row['otras'] = sum(c for (y, e), c in by_year_emp.items() if y == yr and e not in top_emps)
        by_year_rows.append(row)

    return {'by_month': by_month_rows, 'by_year_empresa': by_year_rows,
            'operadores': top_emps}


def main():
    series = _load(SERIES_JSON)['wells']
    series_by_id = {w['id']: w for w in series}
    wells = _load(WELLS_JSON)

    cohorts = build_cohorts(wells, series_by_id)
    src_date = max((w['ultimo_mes'] for w in wells), default=None)
    write_json(TYPE_JSON, {'cohorts': cohorts},
               source='Pozos tipo derivados de Cap IV + Adjunto IV',
               source_date=src_date, cohort_count=len(cohorts))

    activity = build_activity(wells)
    write_json(ACT_JSON, activity,
               source='Cap IV (producción por pozo) — Secretaría de Energía',
               source_date=src_date)

    print(f'type_wells.json: {len(cohorts)} cohortes')
    for c in cohorts[:6]:
        print(f"  [{c['group']}] {c['label']}: {c['n_wells']} pozos, "
              f"type EUR gas {c['type_eur_gas_mmm3']} MMm³ / oil {c['type_eur_oil_mm3']} Mm³")
    print(f'activity.json: {len(activity["by_month"])} meses, {len(activity["operadores"])} operadores top')


if __name__ == '__main__':
    main()
