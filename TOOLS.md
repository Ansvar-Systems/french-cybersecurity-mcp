# Tool Reference

All tools are prefixed with `fr_cyber_` and are available via both stdio and HTTP transports.

---

## fr_cyber_search_guidance

Full-text search across ANSSI guidance documents. Covers PGSSI-S, RGS, SecNumCloud, Référentiel de sécurité, and technical publications.

### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query (e.g., `patch management`, `sécurité réseau`) |
| `type` | string | No | Filter by document type: `guidance`, `framework`, `technical`, `board` |
| `series` | string | No | Filter by series: `PGSSI-S`, `RGS`, `SecNumCloud`, `ANSSI` |
| `status` | string | No | Filter by status: `current`, `superseded`, `draft` |
| `limit` | number | No | Max results (default: 20, max: 100) |

### Output

```json
{
  "results": [{ "reference": "...", "title": "...", "series": "...", "summary": "..." }],
  "count": 5,
  "_meta": { "disclaimer": "...", "copyright": "...", "source_url": "..." }
}
```

---

## fr_cyber_get_guidance

Get a specific ANSSI guidance document by reference.

### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `reference` | string | Yes | ANSSI document reference (e.g., `ANSSI-PGSSI-2021`, `ANSSI-SecNumCloud-3.2`) |

### Output

Full document record plus `_citation` and `_meta` blocks.

---

## fr_cyber_search_advisories

Search ANSSI/CERT-FR security advisories and alerts.

### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query (e.g., `ransomware`, `zero-day`) |
| `severity` | string | No | Filter by severity: `critical`, `high`, `medium`, `low` |
| `limit` | number | No | Max results (default: 20, max: 100) |

### Output

```json
{
  "results": [{ "reference": "...", "title": "...", "severity": "...", "date": "..." }],
  "count": 3,
  "_meta": { "disclaimer": "...", "copyright": "...", "source_url": "..." }
}
```

---

## fr_cyber_get_advisory

Get a specific ANSSI security advisory by reference.

### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `reference` | string | Yes | ANSSI advisory reference (e.g., `ANSSI-ADV-2024-001`) |

### Output

Full advisory record plus `_citation` and `_meta` blocks.

---

## fr_cyber_list_frameworks

List all ANSSI frameworks and guidance series covered in this MCP.

### Input

No parameters.

### Output

```json
{
  "frameworks": [{ "id": "PGSSI-S", "name": "...", "description": "..." }],
  "count": 4,
  "_meta": { "disclaimer": "...", "copyright": "...", "source_url": "..." }
}
```

---

## fr_cyber_about

Return metadata about this MCP server.

### Input

No parameters.

### Output

Server name, version, description, data source, coverage summary, and tool list.

---

## fr_cyber_list_sources

List all data sources used by this MCP.

### Input

No parameters.

### Output

```json
{
  "sources": [
    { "name": "ANSSI", "url": "https://www.ssi.gouv.fr/", "description": "..." },
    { "name": "CERT-FR", "url": "https://www.cert.ssi.gouv.fr/", "description": "..." }
  ],
  "_meta": { "disclaimer": "...", "copyright": "...", "source_url": "..." }
}
```

---

## fr_cyber_check_data_freshness

Check how recent the data in the database is.

### Input

No parameters.

### Output

```json
{
  "guidance_latest_date": "2024-11-15",
  "advisories_latest_date": "2024-12-01",
  "note": "Dates reflect the most recent document date in each table. null means the table is empty.",
  "_meta": { "disclaimer": "...", "copyright": "...", "source_url": "..." }
}
```

---

## _citation block

`fr_cyber_get_guidance` and `fr_cyber_get_advisory` include a `_citation` block for use by the platform's entity linker:

```json
{
  "_citation": {
    "canonical_ref": "ANSSI-PGSSI-2021",
    "display_text": "ANSSI-PGSSI-2021",
    "source_url": "https://www.ssi.gouv.fr/...",
    "lookup": {
      "tool": "fr_cyber_get_guidance",
      "args": { "reference": "ANSSI-PGSSI-2021" }
    }
  }
}
```

## _meta block

All tool responses include a `_meta` block:

```json
{
  "_meta": {
    "disclaimer": "This server provides ANSSI guidance and CERT-FR advisories for research purposes only. Not legal or regulatory advice.",
    "copyright": "Content sourced from ANSSI and CERT-FR. Official content is subject to French government copyright.",
    "source_url": "https://www.ssi.gouv.fr/"
  }
}
```
