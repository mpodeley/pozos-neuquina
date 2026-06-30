#!/usr/bin/env python3
"""Tag wells parent / child / confined / standalone (the Fortín de Piedra study).

A pozo is a CHILD when it comes on production well after a neighbouring well that
was already producing (drilled into a depleting parent); CONFINED when codeveloped
with its neighbours (came online together, e.g. a cube); PARENT when it has at least
one child; STANDALONE when it has no qualifying neighbour.

Spatial neighbour = another well whose lateral is roughly parallel, overlaps along
strike (≥ OVERLAP_MIN) and lies within NEIGHBOR_PERP_MAX perpendicular distance.
Timing uses each well's first production month (m0, PEM proxy):
  confined  : |m0_i − m0_j| < CONFINED_MONTHS
  i child of j : m0_i > m0_j + CONFINED_MONTHS  (i online >Δ after neighbour j)

Inputs:  public/data/trayectorias.json, public/data/wells.json
Outputs: public/data/parent_child.json (child→parent pairs),
         public/data/well_tags.json   (per-well tags for the multi-tag pozo tipo),
         and tipo_pc / parent_id / dist_bucket merged into wells.json.
"""

import json
import math
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _meta import write_json  # noqa: E402

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, '..', 'public', 'data')
TRAY_JSON = os.path.join(DATA_DIR, 'trayectorias.json')
WELLS_JSON = os.path.join(DATA_DIR, 'wells.json')
PC_JSON = os.path.join(DATA_DIR, 'parent_child.json')
TAGS_JSON = os.path.join(DATA_DIR, 'well_tags.json')

LAT0 = -38.5
NEIGHBOR_PERP_MAX = 600.0   # m perpendicular
OVERLAP_MIN = 500.0         # m of lateral overlap to count as a neighbour
PARALLEL_COS = 0.866        # |cos(angle)| > this  → within 30° (parallel)
CONFINED_MONTHS = 3
DIST_1 = 280.0              # ≤ → 1 distanciamiento (~225 m)
DIST_2 = 500.0             # ≤ → 2 distanciamientos (~450 m)
PRUNE_MID = 1600.0         # skip pairs whose mid-laterals are farther than this


def _load(path):
    with open(path, encoding='utf-8') as f:
        raw = json.load(f)
    return raw.get('data', raw)


def to_m(lon, lat):
    return (lon * 111320.0 * math.cos(math.radians(LAT0)), lat * 110540.0)


def _month(m0):
    y, m = (int(x) for x in m0.split('-'))
    return y * 12 + (m - 1)


def seg_relation(a1, a2, ua, La, b1, b2):
    """Perpendicular offset + along-strike overlap of segment B relative to line A."""
    ux, uy = ua

    def proj(p):
        rx, ry = p[0] - a1[0], p[1] - a1[1]
        return rx * ux + ry * uy, abs(-rx * uy + ry * ux)
    t1, p1 = proj(b1)
    t2, p2 = proj(b2)
    lo, hi = max(0.0, min(t1, t2)), min(La, max(t1, t2))
    return (p1 + p2) / 2.0, max(0.0, hi - lo)


def dist_bucket(perp):
    if perp <= DIST_1:
        return 1
    if perp <= DIST_2:
        return 2
    return 3


def main():
    tray = _load(TRAY_JSON)
    wells = {w['id']: w for w in _load(WELLS_JSON)}

    # geometry + timing per well
    G = {}
    for t in tray:
        wid = t['id']
        w = wells.get(wid)
        if not w or not w.get('m0'):
            continue
        h = to_m(*t['heel'])
        e = to_m(*t['toe'])
        L = math.hypot(e[0] - h[0], e[1] - h[1])
        if L < 200:
            continue
        u = ((e[0] - h[0]) / L, (e[1] - h[1]) / L)
        mid = ((h[0] + e[0]) / 2, (h[1] + e[1]) / 2)
        G[wid] = {'h': h, 'e': e, 'u': u, 'L': L, 'mid': mid,
                  'm0': _month(w['m0']), 'landing': t.get('landing'),
                  'bucket': w.get('completion_bucket'), 'lbs_ft': w.get('lbs_ft')}

    ids = list(G)
    neighbors = defaultdict(list)   # wid -> list of (other, perp, overlap)
    for i, a in enumerate(ids):
        A = G[a]
        for b in ids[i + 1:]:
            B = G[b]
            if abs(A['mid'][0] - B['mid'][0]) > PRUNE_MID or abs(A['mid'][1] - B['mid'][1]) > PRUNE_MID:
                continue
            if abs(A['u'][0] * B['u'][0] + A['u'][1] * B['u'][1]) < PARALLEL_COS:
                continue  # not parallel
            perp, ov = seg_relation(A['h'], A['e'], A['u'], A['L'], B['h'], B['e'])
            if ov < OVERLAP_MIN or perp > NEIGHBOR_PERP_MAX:
                continue
            neighbors[a].append((b, perp, ov))
            neighbors[b].append((a, perp, ov))

    pairs = []   # child -> parent
    tag = {}     # wid -> tipo_pc
    parent_of = {}
    for wid in ids:
        A = G[wid]
        kids, parents, confined = [], [], []
        for (o, perp, ov) in neighbors.get(wid, []):
            B = G[o]
            dm = A['m0'] - B['m0']
            if abs(dm) < CONFINED_MONTHS:
                confined.append((o, perp))
            elif dm > 0:                 # wid came online after o → o is a parent of wid
                parents.append((o, perp))
            else:                        # o came online after wid → wid is parent of o
                kids.append((o, perp))
        if parents:
            tag[wid] = 'child'
            o, perp = min(parents, key=lambda x: x[1])   # nearest parent
            parent_of[wid] = (o, perp)
        elif kids:
            tag[wid] = 'parent'
        elif confined:
            tag[wid] = 'confined'
        else:
            tag[wid] = 'standalone'

    for child, (par, perp) in parent_of.items():
        A, B = G[child], G[par]
        ja = (A['lbs_ft'] or 0) + (B['lbs_ft'] or 0)
        pairs.append({
            'child': child, 'parent': par,
            'perp_m': round(perp, 0), 'dist_bucket': dist_bucket(perp),
            'meses_post_pem': A['m0'] - B['m0'],
            'child_bucket': A['bucket'], 'parent_bucket': B['bucket'],
            'arena_conjunta': round(ja, 0) if ja else None,
            'same_landing': A['landing'] == B['landing'] and A['landing'] is not None,
        })

    # merge tags into wells.json + build compact well_tags.json
    tags_out = []
    for wid, w in wells.items():
        tp = tag.get(wid)
        pc = parent_of.get(wid)
        w['tipo_pc'] = tp
        w['parent_id'] = pc[0] if pc else None
        w['dist_parent_m'] = round(pc[1], 0) if pc else None
        w['dist_bucket'] = dist_bucket(pc[1]) if pc else None
        tags_out.append({
            'id': wid, 'area': w.get('area'), 'formacion': w.get('formacion'),
            'vintage': w.get('vintage'), 'ventana': w.get('ventana'),
            'tipo_pc': tp, 'completion_bucket': w.get('completion_bucket'),
            'landing': w.get('landing'), 'dist_bucket': w.get('dist_bucket'),
            'operador': w.get('empresa'), 'rama': w.get('rama_m'),
        })

    wells_list = sorted(wells.values(), key=lambda r: (-(r.get('eur_gas_mmm3') or 0), -(r.get('eur_oil_mm3') or 0)))
    write_json(WELLS_JSON, wells_list,
               source='Cap IV + Adjunto IV + Trayectorias — Secretaría de Energía',
               source_date=max((r['ultimo_mes'] for r in wells_list), default=None),
               well_count=len(wells_list))
    write_json(PC_JSON, pairs, source='Pares parent-child derivados de trayectorias + Cap IV',
               pair_count=len(pairs))
    write_json(TAGS_JSON, tags_out, source='Etiquetas por pozo para pozo tipo multi-etiqueta',
               well_count=len(tags_out))

    print(f'parent/child: {len(G)} pozos con geometría/timing')
    print('  tipos:', dict(Counter(tag.values())))
    print(f'  pares child-parent: {len(pairs)}')
    # validación FP: % child por añada
    fp_ids = [wid for wid in G if wells[wid].get('area') == 'FORTIN DE PIEDRA']
    by_year = defaultdict(lambda: [0, 0])
    for wid in fp_ids:
        y = wells[wid]['vintage']
        by_year[y][0] += 1
        if tag.get(wid) == 'child':
            by_year[y][1] += 1
    print('  FORTIN DE PIEDRA % child por anada (estudio: ~10% 2020 a ~40% 2025):')
    for y in sorted(by_year):
        tot, ch = by_year[y]
        print(f'    {y}: {ch}/{tot} = {100*ch/tot:.0f}%')


if __name__ == '__main__':
    main()
