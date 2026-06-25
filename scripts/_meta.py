"""Shared helpers for writing JSON + CSV outputs with a consistent metadata
envelope. Copied from the estado_del_sistema pipeline so the frontend's
useJson() hook can unwrap payloads identically."""

import csv
import json
import os
from datetime import datetime, timezone


def wrap(data, source=None, source_date=None, **extra):
    """Wrap output payload with generated_at + source metadata.

    Shape: {generated_at, source, source_date, data, ...extra}
    """
    envelope = {
        'generated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'source': source,
        'source_date': source_date,
        'data': data,
    }
    envelope.update(extra)
    return envelope


def write_json(path, data, source=None, source_date=None, **extra):
    """Write a JSON file wrapped with metadata."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    envelope = wrap(data, source=source, source_date=source_date, **extra)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(envelope, f, ensure_ascii=False, separators=(',', ':'))
    return envelope


def _collect_fieldnames(rows):
    """Preserve first-seen order across all rows' keys."""
    seen = []
    seen_set = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        for k in row.keys():
            if k not in seen_set:
                seen.append(k)
                seen_set.add(k)
    return seen


def write_csv(path, rows, fieldnames=None):
    """Write a CSV file (UTF-8 with BOM so Excel opens tildes correctly)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    rows = list(rows or [])
    if fieldnames is None:
        fieldnames = _collect_fieldnames(rows)
    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        if not fieldnames:
            f.write('# sin datos\n')
            return 0
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore')
        writer.writeheader()
        for row in rows:
            if not isinstance(row, dict):
                continue
            writer.writerow({k: ('' if row.get(k) is None else row.get(k)) for k in fieldnames})
    return len(rows)
