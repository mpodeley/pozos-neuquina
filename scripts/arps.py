"""Arps decline-curve fitting + EUR for single wells and type curves.

Conventions
-----------
t      : months since the production peak (t=0 at peak).
q      : average daily rate in that month (gas in dam³/d, oil in m³/d).
qi,Di,b: Arps params. Di is the nominal instantaneous decline at t=0, per month.
         b is the hyperbolic exponent (0 = exponential, 1 = harmonic).

q(t) = qi / (1 + b*Di*t)**(1/b)          (b > 0)
q(t) = qi * exp(-Di*t)                    (b -> 0)

EUR robustness (short/noisy histories over-predict badly with raw hyperbolic):
  * b is capped (B_MAX) and a terminal exponential switch at Dmin caps the tail.
  * Poor fits (R² < R2_MIN, or params pinned to a bound) are rejected — EUR then
    falls back to the actual cumulative (conservative, no speculative tail).
  * The forecast is anchored to the MEDIAN of the last few real rates (kills the
    single-month spikes that otherwise launch the tail to absurd EURs).
"""

import numpy as np
from scipy.optimize import curve_fit

DAYS_PER_MONTH = 30.4

# Fitting bounds / defaults
B_MAX = 1.2                    # shale-style cap on the hyperbolic exponent
DI_BOUNDS = (1e-3, 0.6)        # per month
PEAK_WINDOW = 12               # peak searched within the first N months
MIN_POINTS = 6                 # need at least this many producing months to fit
R2_MIN = 0.30                  # below this the fit is rejected

# EUR forecast defaults
DMIN_ANNUAL = 0.08             # 8%/yr terminal nominal decline
MAX_FORECAST_MONTHS = 360      # 30-year cap
Q_ECON = {'gas': 2.0, 'oil': 0.5}   # economic-limit rate (dam³/d gas, m³/d oil)


def arps_q(t, qi, di, b):
    """Hyperbolic Arps rate. Vectorised; b~0 falls back to exponential."""
    t = np.asarray(t, dtype=float)
    if b < 1e-4:
        return qi * np.exp(-di * t)
    return qi / np.power(1.0 + b * di * t, 1.0 / b)


def _peak_index(q):
    head = q[:PEAK_WINDOW] if len(q) > PEAK_WINDOW else q
    return int(np.argmax(head))


def fit_well(rate, days, fluid):
    """Fit Arps to one well's monthly rate series.

    Returns dict {qi, di, b, r2, n_fit, peak, t_peak, pinned} or None if unfittable.
    `pinned` flags a fit that hit a parameter bound (often a sign of a bad fit).
    """
    rate = np.asarray(rate, dtype=float)
    days = np.asarray(days, dtype=float)
    if rate.size == 0 or np.nanmax(rate) <= 0:
        return None

    ipk = _peak_index(rate)
    q = rate[ipk:]
    d = days[ipk:]
    t = np.arange(q.size, dtype=float)
    mask = (q > 0) & (d > 0)
    q, t = q[mask], t[mask]
    if q.size < MIN_POINTS:
        return None
    t = t - t.min()

    qi0 = float(q.max())
    lo = [qi0 * 0.3, DI_BOUNDS[0], 0.0]
    hi = [qi0 * 3.0, DI_BOUNDS[1], B_MAX]
    try:
        popt, _ = curve_fit(arps_q, t, q, p0=[qi0, 0.1, 1.0],
                            bounds=(lo, hi), maxfev=8000)
    except Exception:
        return None
    qi, di, b = (float(x) for x in popt)
    pred = arps_q(t, qi, di, b)
    ss_res = float(np.sum((q - pred) ** 2))
    ss_tot = float(np.sum((q - q.mean()) ** 2)) or 1.0
    r2 = 1.0 - ss_res / ss_tot
    pinned = (b >= B_MAX * 0.99) or (di >= DI_BOUNDS[1] * 0.99)
    return {'qi': round(qi, 3), 'di': round(di, 5), 'b': round(b, 3),
            'r2': round(r2, 3), 'n_fit': int(q.size),
            'peak': round(qi0, 2), 't_peak': int(ipk), 'pinned': bool(pinned)}


def cum_actual(rate, days):
    """Cumulative produced volume from the daily-rate series (rate*days summed)."""
    rate = np.asarray(rate, dtype=float)
    days = np.asarray(days, dtype=float)
    return float(np.sum(rate * days))


def _fit_usable(fit):
    return fit is not None and fit['r2'] >= R2_MIN and not fit['pinned']


def forecast_eur(fit, rate, days, fluid,
                 dmin_annual=DMIN_ANNUAL, max_months=MAX_FORECAST_MONTHS):
    """EUR = actual cumulative + forecast remaining with terminal-decline switch.

    Returns (eur_vol, remaining_vol, months_to_econ) in the rate's volume units.
    A rejected fit gives EUR = cumulative (no speculative tail).
    """
    cum = cum_actual(rate, days)
    if not _fit_usable(fit):
        return cum, 0.0, 0
    rate = np.asarray(rate, dtype=float)
    nz = np.nonzero(rate > 0)[0]
    if nz.size == 0:
        return cum, 0.0, 0
    last_i = int(nz[-1])
    # robust anchor: median of the last up-to-3 real rates (kills spikes)
    recent = rate[nz[-min(3, nz.size):]]
    q = float(np.median(recent))
    q_econ = Q_ECON.get(fluid, 0.5)
    if q < q_econ:
        return cum, 0.0, 0

    t = float(last_i - fit['t_peak'])
    if t < 0:
        t = 0.0
    di, b = fit['di'], fit['b']
    dmin_m = dmin_annual / 12.0

    remaining = 0.0
    months = 0
    for _ in range(max_months):
        t += 1.0
        d_nom = di / (1.0 + b * di * t) if b >= 1e-4 else di
        d = max(d_nom, dmin_m)
        q = q * np.exp(-d)
        if q < q_econ:
            break
        remaining += q * DAYS_PER_MONTH
        months += 1
    return cum + remaining, remaining, months


def cum_at_horizon(fit, rate, days, horizon_months, fluid,
                   dmin_annual=DMIN_ANNUAL):
    """Cumulative volume to a fixed horizon (months-on-production), the study's
    'acumulada a N años' metric. Actual production for the months present; if the
    well is younger, the remaining months are forecast with the fit (anchored to
    the median of the last real rates). Returns volume in the rate's units."""
    rate = np.asarray(rate, dtype=float)
    days = np.asarray(days, dtype=float)
    n = rate.size
    k = min(horizon_months, n)
    cum = float(np.sum(rate[:k] * days[:k]))
    if n >= horizon_months or not _fit_usable(fit):
        return cum
    nz = np.nonzero(rate > 0)[0]
    if nz.size == 0:
        return cum
    q = float(np.median(rate[nz[-min(3, nz.size):]]))
    di, b = fit['di'], fit['b']
    dmin_m = dmin_annual / 12.0
    t = float(nz[-1] - fit['t_peak'])
    if t < 0:
        t = 0.0
    for _ in range(n, horizon_months):
        t += 1.0
        d = max(di / (1.0 + b * di * t) if b >= 1e-4 else di, dmin_m)
        q = q * np.exp(-d)
        cum += q * DAYS_PER_MONTH
    return cum


def confidence(fit, n_months):
    """Qualitative EUR confidence for the UI."""
    if not _fit_usable(fit):
        return 'baja'
    if fit['r2'] >= 0.6 and n_months >= 18:
        return 'alta'
    return 'media'


def fit_and_eur(rate, days, fluid):
    """Fit + EUR in one call. Returns a flat dict (vol units = rate*day)."""
    fit = fit_well(rate, days, fluid)
    eur, remaining, life = forecast_eur(fit, rate, days, fluid)
    n_months = sum(1 for r in rate if r > 0)
    out = {'eur': eur, 'remaining': remaining, 'life_months': life,
           'cum': cum_actual(rate, days), 'conf': confidence(fit, n_months)}
    if _fit_usable(fit):
        out.update({k: fit[k] for k in ('qi', 'di', 'b', 'r2', 't_peak')})
    return out
