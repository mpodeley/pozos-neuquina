#!/usr/bin/env python3
"""Orchestrate the full data pipeline for pozos-neuquina.

Order:
  1. fetch_fractura_adjiv.py   -> fractura.json
  2. fetch_capiv_pozos.py      -> well_series.json (+ capiv_raw.json.gz)   [delta by default]
  3. build_wells.py            -> wells.json
  4. build_type_wells.py       -> type_wells.json, activity.json

For a first build (or a full historical refit) run the backfill once first:
  python scripts/fetch_capiv_pozos.py --since 2010
Then `build_data.py` keeps it current with monthly delta fetches.

Usage:
  python scripts/build_data.py                  # delta fetch + rebuild analytics
  python scripts/build_data.py --skip-fetch      # only rebuild analytics from stored data
"""

import argparse
import json
import os
import subprocess
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, '..', 'public', 'data')
PY = sys.executable

REQUIRED = ['fractura.json', 'well_series.json', 'wells.json',
            'type_wells.json', 'activity.json', 'blocks.json']


def run(script, *args, timeout=1200):
    cmd = [PY, os.path.join(SCRIPT_DIR, script), *args]
    print(f'\n=== {script} {" ".join(args)} ===', flush=True)
    t0 = time.time()
    r = subprocess.run(cmd, timeout=timeout)
    dt = time.time() - t0
    if r.returncode != 0:
        print(f'  FAILED ({script}) rc={r.returncode} after {dt:.0f}s', file=sys.stderr)
        return False
    print(f'  ok ({dt:.0f}s)')
    return True


def validate():
    ok = True
    for name in REQUIRED:
        path = os.path.join(DATA_DIR, name)
        if not os.path.exists(path):
            print(f'  MISSING: {name}', file=sys.stderr)
            ok = False
            continue
        with open(path, encoding='utf-8') as f:
            payload = json.load(f)
        data = payload.get('data', payload)
        empty = not data or (isinstance(data, (list, dict)) and len(data) == 0)
        if empty:
            print(f'  EMPTY: {name}', file=sys.stderr)
            ok = False
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--skip-fetch', action='store_true',
                    help='Rebuild analytics from already-stored data (no network).')
    args = ap.parse_args()

    steps_ok = True
    if not args.skip_fetch:
        steps_ok &= run('fetch_fractura_adjiv.py')
        steps_ok &= run('fetch_capiv_pozos.py')
    steps_ok &= run('build_wells.py')
    steps_ok &= run('build_type_wells.py')
    steps_ok &= run('build_blocks.py')

    print('\n=== validation ===')
    valid = validate()
    if not (steps_ok and valid):
        print('Pipeline finished with errors.', file=sys.stderr)
        sys.exit(1)
    print('All outputs present and non-empty.')


if __name__ == '__main__':
    main()
