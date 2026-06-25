#!/usr/bin/env python3
"""Build wells.json — one row per well with completion features, GOR window,
IP metrics and fitted Arps decline / EUR.

Inputs (produced by the fetchers):
  public/data/well_series.json  -- per-well monthly daily-rate arrays
  public/data/fractura.json     -- per-well completion metadata (lateral, stages)

Output:
  public/data/wells.json (+ wells.csv)

Units in the output:
  gas rate/EUR ...... MMm³ (= million m³); MMm³/d for rates
  oil rate .......... m³/d ; oil EUR ......... Mm³ (= thousand m³)
  GOR ............... m³/m³
  Normalised ........ "_por_km" = per 1000 m of horizontal lateral
"""

import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import arps  # noqa: E402
from _meta import write_json, write_csv  # noqa: E402

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, '..', 'public', 'data')
SERIES_JSON = os.path.join(DATA_DIR, 'well_series.json')
FRACTURA_JSON = os.path.join(DATA_DIR, 'fractura.json')
OUT_JSON = os.path.join(DATA_DIR, 'wells.json')


def _load(path):
    with open(path, encoding='utf-8') as f:
        raw = json.load(f)
    return raw.get('data', raw)


def add_months(m0, k):
    y, mo = (int(x) for x in m0.split('-'))
    mo += k
    y += (mo - 1) // 12
    mo = (mo - 1) % 12 + 1
    return f'{y:04d}-{mo:02d}'


def cum_at_days(rate, days, targets):
    """Cumulative volume (rate*day) reached at each target of cumulative producing days.
    Returns {target: vol or None}. None when the well hasn't produced that long yet."""
    targets = sorted(targets)
    res = {}
    ti = 0
    cum_days = 0.0
    cum_vol = 0.0
    for r, d in zip(rate, days):
        if d <= 0:
            continue
        while ti < len(targets) and cum_days + d >= targets[ti]:
            frac = (targets[ti] - cum_days) / d
            res[targets[ti]] = cum_vol + r * d * frac
            ti += 1
        cum_days += d
        cum_vol += r * d
    for tg in targets:
        res.setdefault(tg, None)
    return res


def ventana(gor, cum_oil, cum_gas):
    """Fluid window from cumulative GOR (m³/m³)."""
    if cum_gas <= 0 and cum_oil <= 0:
        return 'sin producción'
    if cum_oil <= 0 or gor is None or gor > 10000:
        return 'gas seco'
    if gor < 250:
        return 'petróleo'
    if gor < 1500:
        return 'petróleo volátil'
    return 'gas húmedo / condensado'


def _r(x, n=2):
    return None if x is None else round(x, n)


def main():
    wells_in = _load(SERIES_JSON)['wells']
    frac_rows = _load(FRACTURA_JSON)
    frac = {f['id']: f for f in frac_rows}

    out = []
    for w in wells_in:
        gas, oil, days = w['gas'], w['oil'], w['days']
        n = w['n']
        m0 = w['m0']
        ult = add_months(m0, n - 1)

        # cumulative to date
        cum_gas_dam3 = arps.cum_actual(gas, days)     # dam³
        cum_oil_m3 = arps.cum_actual(oil, days)       # m³
        gor = (cum_gas_dam3 * 1000.0 / cum_oil_m3) if cum_oil_m3 > 0 else None

        # IP at 180 / 365 producing days
        ipg = cum_at_days(gas, days, [180, 365])
        ipo = cum_at_days(oil, days, [180, 365])

        # decline + EUR (gas & oil)
        fg = arps.fit_and_eur(gas, days, 'gas')
        fo = arps.fit_and_eur(oil, days, 'oil')

        f = frac.get(w['id'], {})
        rama = f.get('rama_m', 0) or 0
        km = (rama / 1000.0) if rama > 0 else None
        fracturas = f.get('fracturas', 0) or 0
        arena = f.get('arena_tn', 0) or 0

        eur_gas_mmm3 = fg['eur'] / 1000.0
        eur_oil_mm3 = fo['eur'] / 1000.0

        row = {
            'id': w['id'],
            'sigla': w.get('sigla', ''),
            'empresa': w.get('empresa', ''),
            'area': w.get('area', ''),
            'provincia': w.get('provincia', ''),
            'formacion': w.get('formacion', '') or f.get('formacion_frac', ''),
            'recurso': w.get('recurso', ''),
            'reservorio': f.get('reservorio', ''),
            'tipopozo': w.get('tipopozo', ''),
            'm0': m0,
            'ultimo_mes': ult,
            'vintage': int(m0[:4]),
            'n_meses': n,
            # completion
            'rama_m': _r(rama, 0),
            'fracturas': int(fracturas),
            'etapas_km': _r(fracturas / km, 2) if km else None,
            'arena_tn': _r(arena, 0),
            'arena_tn_m': _r(arena / rama, 3) if rama > 0 else None,
            'fecha_fractura': f.get('fecha_fractura', ''),
            # production summary
            'gor': _r(gor, 0),
            'ventana': ventana(gor, cum_oil_m3, cum_gas_dam3),
            'peak_gas_mmm3d': _r(max(gas) / 1000.0 if gas else 0, 4),
            'peak_oil_m3d': _r(max(oil) if oil else 0, 1),
            'cum_gas_mmm3': _r(cum_gas_dam3 / 1000.0, 2),
            'cum_oil_mm3': _r(cum_oil_m3 / 1000.0, 2),
            'ip180_gas_mmm3': _r(ipg[180] / 1000.0 if ipg[180] is not None else None, 2),
            'ip365_gas_mmm3': _r(ipg[365] / 1000.0 if ipg[365] is not None else None, 2),
            'ip180_oil_mm3': _r(ipo[180] / 1000.0 if ipo[180] is not None else None, 2),
            'ip365_oil_mm3': _r(ipo[365] / 1000.0 if ipo[365] is not None else None, 2),
            # gas decline (qi in dam³/d — frontend divides by 1000 for MMm³/d)
            'qi_gas': fg.get('qi'),
            'di_gas': fg.get('di'),
            'b_gas': fg.get('b'),
            'r2_gas': fg.get('r2'),
            't_peak_gas': fg.get('t_peak'),
            'eur_gas_mmm3': _r(eur_gas_mmm3, 1),
            'eur_gas_por_km': _r(eur_gas_mmm3 / km, 1) if km else None,
            'vida_gas_meses': fg.get('life_months'),
            'eur_conf_gas': fg.get('conf'),
            # oil decline (qi in m³/d)
            'qi_oil': fo.get('qi'),
            'di_oil': fo.get('di'),
            'b_oil': fo.get('b'),
            'r2_oil': fo.get('r2'),
            't_peak_oil': fo.get('t_peak'),
            'eur_oil_mm3': _r(eur_oil_mm3, 1),
            'eur_oil_por_km': _r(eur_oil_mm3 / km, 1) if km else None,
            'vida_oil_meses': fo.get('life_months'),
            'eur_conf_oil': fo.get('conf'),
        }
        out.append(row)

    out.sort(key=lambda r: (-(r['eur_gas_mmm3'] or 0), -(r['eur_oil_mm3'] or 0)))
    src_date = max((r['ultimo_mes'] for r in out), default=None)
    write_json(OUT_JSON, out,
               source='Cap IV (producción por pozo) + Adjunto IV (fractura) — Secretaría de Energía',
               source_date=src_date,
               well_count=len(out),
               con_rama=sum(1 for r in out if r['rama_m']))
    write_csv(os.path.splitext(OUT_JSON)[0] + '.csv', out)

    con_rama = sum(1 for r in out if r['rama_m'])
    fit_gas = sum(1 for r in out if r['r2_gas'] is not None)
    print(f'wells.json written: {len(out):,} pozos  (con rama {con_rama:,}, fit gas {fit_gas:,})')
    if out:
        top = out[0]
        print(f"  top EUR gas: {top['sigla']} ({top['empresa']}) "
              f"EUR {top['eur_gas_mmm3']} MMm³, rama {top['rama_m']} m, ventana {top['ventana']}")


if __name__ == '__main__':
    main()
