# Pozos Neuquina

Producción por pozo, **declinación (Arps)** y **pozos tipo** para los pozos **no
convencionales** de la Cuenca Neuquina (Vaca Muerta + tight), a partir de datos
públicos de la Secretaría de Energía. Sitio estático publicado en GitHub Pages.

**Live:** `https://mpodeley.github.io/pozos-neuquina/`

## Qué hace

- Ingesta la **producción por pozo** del **Capítulo IV** (una serie mensual por `idpozo`,
  filtrada a `cuenca = NEUQUINA` y `tipo_de_recurso != CONVENCIONAL`).
- La une con el **Adjunto IV / Datos de Fractura** (largo de rama horizontal, etapas,
  arena, agua) por `idpozo`.
- Ajusta **declinación hiperbólica de Arps** (`qi, Di, b`) por pozo, con **declinación
  terminal mínima** para el EUR (gas y petróleo por separado).
- Construye **pozos tipo** P10/P50/P90 por cohorte (formación, añada, operador, ventana),
  en absoluto y **normalizados por 1000 m de rama**.
- Clasifica la **ventana de fluido** por GOR (petróleo / volátil / gas húmedo / gas seco).

> EUR y pozos tipo son estimaciones con fines analíticos, **no** certificaciones de reservas.
> Los EUR individuales de pozos con poca historia son de baja confianza; los **pozos tipo**
> (mediana de cohorte) son el agregado robusto.

## Stack

- **Frontend:** React + TypeScript + Vite + Recharts → sitio estático.
- **Pipeline:** Python (requests + pandas/numpy + scipy `curve_fit`), genera JSON en
  `public/data/` que el frontend lee en runtime.
- **Deploy:** GitHub Actions (cron mensual + manual) → `peaceiris/actions-gh-pages`.

## Fuentes de datos (datos.energia.gob.ar)

| Dato | Dataset (CKAN) |
|------|----------------|
| Producción por pozo (Cap IV) | `c846e79c-026c-4040-897f-1ad3543b407c` |
| Datos de Fractura (Adjunto IV) | `71fa2e84-0316-4a1b-af68-7f35e41f58d7` |

## Cómo correrlo

Python en la máquina de dev (ver `estado_del_sistema`):

```bash
PY="/c/Users/mpodeley/AppData/Local/Programs/Python/Python312/python.exe"

# Backfill histórico una vez (descarga ~16 CSV anuales, ~5-8 min):
$PY scripts/fetch_capiv_pozos.py --since 2010

# Pipeline completo (delta fetch + analítica) — lo que corre la CI cada mes:
$PY scripts/build_data.py

# Sólo recalcular analítica desde datos ya descargados (sin red):
$PY scripts/build_data.py --skip-fetch
```

Frontend:

```bash
npm install
npm run dev          # servidor de desarrollo
npx tsc --noEmit     # chequeo de tipos
npm run build        # tsc + vite build -> dist/
```

## Pipeline (`scripts/`)

| Script | Salida |
|--------|--------|
| `fetch_capiv_pozos.py` | `public/data/well_series.json` (+ `scripts/capiv_raw.json.gz`, store persistente) |
| `fetch_fractura_adjiv.py` | `public/data/fractura.json` |
| `build_wells.py` | `public/data/wells.json` (features + ventana GOR + Arps + EUR + IP) |
| `build_type_wells.py` | `public/data/type_wells.json`, `public/data/activity.json` |
| `arps.py` | matemática de declinación (importable) |
| `build_data.py` | orquestador + validación |

`capiv_raw.json.gz` es el almacén persistente por pozo (commiteado, gzip): permite que el
update mensual baje sólo el año corriente y haga *upsert* en vez de re-procesar 16 años.

## Convenciones

- Texto de UI en español; comentarios y nombres de variables en inglés.
- Unidades: gas en **MMm³** (rate **MMm³/d**); petróleo en **Mm³** (rate **m³/d**); GOR en m³/m³.
- Envelope JSON `{generated_at, source, source_date, data}` (igual que `estado_del_sistema`).
