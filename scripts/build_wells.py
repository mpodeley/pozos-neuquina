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
TRAY_JSON = os.path.join(DATA_DIR, 'trayectorias.json')
OUT_JSON = os.path.join(DATA_DIR, 'wells.json')

LBS_PER_TN = 2204.62
FT_PER_M = 3.28084
LBS_FT_FACTOR = LBS_PER_TN / FT_PER_M  # arena_tn/rama_m * 672 ≈ lbs/ft
BCF_PER_DAM3 = 1.0 / 28320.0           # 1 BCF = 28.32e6 m³ = 28 320 dam³

# Completion intensity buckets by proppant (lbs/ft), anchored to the ~3000 lbs/ft
# modern standard (Fortín de Piedra study). Wells above 6000 lbs/ft are outliers.
COMPLETION_EDGES = [(0, 1500, 'SSD'), (1500, 2500, 'SD'), (2500, 3000, 'HD'),
                    (3000, 3500, 'HD+'), (3500, 6000, 'UHD+')]


def completion_bucket(lbs_ft):
    if lbs_ft is None or lbs_ft <= 0 or lbs_ft > 6000:
        return None
    for lo, hi, label in COMPLETION_EDGES:
        if lo <= lbs_ft < hi:
            return label
    return 'UHD+'


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
    tray = {t['id']: t for t in _load(TRAY_JSON)} if os.path.exists(TRAY_JSON) else {}

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

        # decline (fit once) + EUR + cum-5yr (gas & oil)
        fitg = arps.fit_well(gas, days, 'gas')
        fito = arps.fit_well(oil, days, 'oil')
        eur_g, _, lifeg = arps.forecast_eur(fitg, gas, days, 'gas')
        eur_o, _, lifeo = arps.forecast_eur(fito, oil, days, 'oil')
        confg = arps.confidence(fitg, sum(1 for x in gas if x > 0))
        confo = arps.confidence(fito, sum(1 for x in oil if x > 0))
        ug, uo = confg != 'baja', confo != 'baja'
        cum5y_gas_dam3 = arps.cum_at_horizon(fitg, gas, days, 60, 'gas')
        cum5y_oil_m3 = arps.cum_at_horizon(fito, oil, days, 60, 'oil')

        f = frac.get(w['id'], {})
        t = tray.get(w['id'], {})
        rama = f.get('rama_m', 0) or 0
        rama_eff = rama or (t.get('hz') or 0)   # prefer Adjunto IV; else trajectory HZ
        km = (rama / 1000.0) if rama > 0 else None
        fracturas = f.get('fracturas', 0) or 0
        arena = f.get('arena_tn', 0) or 0
        agua_frac = f.get('agua_m3', 0) or 0

        eur_gas_mmm3 = eur_g / 1000.0
        eur_oil_mm3 = eur_o / 1000.0

        # completion intensity (lbs of proppant per ft of lateral) + fluid (bbl/ft)
        lbs_ft = (arena / rama * LBS_FT_FACTOR) if (rama > 0 and arena > 0) else None
        fluid_bbl_ft = (agua_frac / rama * (6.2898 / FT_PER_M)) if (rama > 0 and agua_frac > 0) else None
        bucket = completion_bucket(lbs_ft)

        # cum-5yr (study performance metric): gas in BCF, oil in kbbl, normalised to 3000 m
        cum5y_gas_bcf = cum5y_gas_dam3 * BCF_PER_DAM3
        cum5y_oil_kbbl = cum5y_oil_m3 * 6.2898 / 1000.0
        # normalise to 3000 m only for plausible horizontal laterals (else short
        # laterals explode the ×3000 factor and dominate the medians)
        norm = (3000.0 / rama_eff) if 1500.0 <= rama_eff <= 4500.0 else None
        landing = t.get('landing')

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
            'lbs_ft': _r(lbs_ft, 0),
            'fluid_bbl_ft': _r(fluid_bbl_ft, 0),
            'completion_bucket': bucket,
            'fecha_fractura': f.get('fecha_fractura', ''),
            # trajectory / landing
            'landing': landing,
            'landing_zona': t.get('landing_zona'),
            'tvd': t.get('tvd'),
            # performance metric (study: cum 5yr normalised to 3000 m)
            'cum5y_gas_bcf': _r(cum5y_gas_bcf, 2),
            'cum5y_gas_norm': _r(cum5y_gas_bcf * norm, 2) if norm else None,
            'cum5y_oil_kbbl': _r(cum5y_oil_kbbl, 1),
            'cum5y_oil_norm': _r(cum5y_oil_kbbl * norm, 1) if norm else None,
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
            'qi_gas': fitg['qi'] if (fitg and ug) else None,
            'di_gas': fitg['di'] if (fitg and ug) else None,
            'b_gas': fitg['b'] if (fitg and ug) else None,
            'r2_gas': fitg['r2'] if (fitg and ug) else None,
            't_peak_gas': fitg['t_peak'] if (fitg and ug) else None,
            'eur_gas_mmm3': _r(eur_gas_mmm3, 1),
            'eur_gas_por_km': _r(eur_gas_mmm3 / km, 1) if km else None,
            'vida_gas_meses': lifeg,
            'eur_conf_gas': confg,
            # oil decline (qi in m³/d)
            'qi_oil': fito['qi'] if (fito and uo) else None,
            'di_oil': fito['di'] if (fito and uo) else None,
            'b_oil': fito['b'] if (fito and uo) else None,
            'r2_oil': fito['r2'] if (fito and uo) else None,
            't_peak_oil': fito['t_peak'] if (fito and uo) else None,
            'eur_oil_mm3': _r(eur_oil_mm3, 1),
            'eur_oil_por_km': _r(eur_oil_mm3 / km, 1) if km else None,
            'vida_oil_meses': lifeo,
            'eur_conf_oil': confo,
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
