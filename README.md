# French Cybersecurity MCP

**French cybersecurity data for AI compliance tools.**

[![npm version](https://badge.fury.io/js/%40ansvar%2Ffrench-cybersecurity-mcp.svg)](https://www.npmjs.com/package/@ansvar/french-cybersecurity-mcp)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Query French cybersecurity data -- regulations, decisions, and requirements from ANSSI (Agence nationale de la securite des systemes d'information) -- directly from Claude, Cursor, or any MCP-compatible client.

Built by [Ansvar Systems](https://ansvar.eu) -- Stockholm, Sweden

---

## Quick Start

### Use Remotely (No Install Needed)

> Connect directly to the hosted version -- zero dependencies, nothing to install.

**Endpoint:** `https://mcp.ansvar.eu/french-cybersecurity/mcp`

| Client | How to Connect |
|--------|---------------|
| **Claude.ai** | Settings > Connectors > Add Integration > paste URL |
| **Claude Code** | `claude mcp add french-cybersecurity-mcp --transport http https://mcp.ansvar.eu/french-cybersecurity/mcp` |
| **Claude Desktop** | Add to config (see below) |
| **GitHub Copilot** | Add to VS Code settings (see below) |

**Claude Desktop** -- add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "french-cybersecurity-mcp": {
      "type": "url",
      "url": "https://mcp.ansvar.eu/french-cybersecurity/mcp"
    }
  }
}
```

**GitHub Copilot** -- add to VS Code `settings.json`:

```json
{
  "github.copilot.chat.mcp.servers": {
    "french-cybersecurity-mcp": {
      "type": "http",
      "url": "https://mcp.ansvar.eu/french-cybersecurity/mcp"
    }
  }
}
```

### Use Locally (npm)

```bash
npx @ansvar/french-cybersecurity-mcp
```

**Claude Desktop** -- add to `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "french-cybersecurity-mcp": {
      "command": "npx",
      "args": ["-y", "@ansvar/french-cybersecurity-mcp"]
    }
  }
}
```

**Cursor / VS Code:**

```json
{
  "mcp.servers": {
    "french-cybersecurity-mcp": {
      "command": "npx",
      "args": ["-y", "@ansvar/french-cybersecurity-mcp"]
    }
  }
}
```

---

## Available Tools (8)

| Tool | Description |
|------|-------------|
| `fr_cyber_search_guidance` | Full-text search across ANSSI guidance documents. Covers PGSSI-S, RGS, SecNumCloud, Référentiel de sécurité, and technical publications. |
| `fr_cyber_get_guidance` | Get a specific ANSSI guidance document by reference (e.g., 'ANSSI-PGSSI-2021', 'ANSSI-SecNumCloud-3.2'). |
| `fr_cyber_search_advisories` | Search ANSSI security advisories and alerts (CERT-FR). Returns advisories with severity, affected products, and CVE references. |
| `fr_cyber_get_advisory` | Get a specific ANSSI security advisory by reference (e.g., 'ANSSI-ADV-2024-001'). |
| `fr_cyber_list_frameworks` | List all ANSSI frameworks and guidance series covered in this MCP, including PGSSI-S, RGS, and SecNumCloud. |
| `fr_cyber_about` | Return metadata about this MCP server: version, data source, coverage, and tool list. |
| `fr_cyber_list_sources` | List all data sources used by this MCP, including ANSSI and CERT-FR official URLs with descriptions. |
| `fr_cyber_check_data_freshness` | Check how recent the data is. Returns the latest document date in the guidance and advisories tables. |

All tools return structured data with source references and timestamps.

---

## Data Sources and Freshness

All content is sourced from official French regulatory publications:

- **ANSSI (Agence nationale de la securite des systemes d'information)** -- Official regulatory authority

### Data Currency

- Database updates are periodic and may lag official publications
- Freshness checks run via GitHub Actions workflows
- Last-updated timestamps in tool responses indicate data age

See [COVERAGE.md](COVERAGE.md) for full corpus coverage details.

---

## Security

This project uses multiple layers of automated security scanning:

| Scanner | What It Does | Schedule |
|---------|-------------|----------|
| **CodeQL** | Static analysis for security vulnerabilities | Weekly + PRs |
| **Semgrep** | SAST scanning (OWASP top 10, secrets, TypeScript) | Every push |
| **Gitleaks** | Secret detection across git history | Every push |
| **Trivy** | CVE scanning on filesystem and npm dependencies | Daily |
| **Docker Security** | Container image scanning + SBOM generation | Daily |
| **Socket.dev** | Supply chain attack detection | PRs |
| **Dependabot** | Automated dependency updates | Weekly |

See [SECURITY.md](SECURITY.md) for the full policy and vulnerability reporting.

---

## Important Disclaimers

### Not Regulatory Advice

> **THIS TOOL IS NOT REGULATORY OR LEGAL ADVICE**
>
> Regulatory data is sourced from official publications by ANSSI (Agence nationale de la securite des systemes d'information). However:
> - This is a **research tool**, not a substitute for professional regulatory counsel
> - **Verify all references** against primary sources before making compliance decisions
> - **Coverage may be incomplete** -- do not rely solely on this for regulatory research

**Before using professionally, read:** [DISCLAIMER.md](DISCLAIMER.md) | [PRIVACY.md](PRIVACY.md)

### Confidentiality

Queries go through the Claude API. For privileged or confidential matters, use on-premise deployment. See [PRIVACY.md](PRIVACY.md) for details.

---

## Development

### Setup

```bash
git clone https://github.com/Ansvar-Systems/french-cybersecurity-mcp
cd french-cybersecurity-mcp
npm install
npm run build
npm test
```

### Running Locally

```bash
npm run dev                                       # Start MCP server
npx @anthropic/mcp-inspector node dist/index.js   # Test with MCP Inspector
```

### Data Management

```bash
npm run seed           # Rebuild SQLite database from seed data
npm run ingest         # Ingest latest data from ANSSI
```

---

## Related Projects

This server is part of **Ansvar's MCP fleet** -- 276 MCP servers covering law, regulation, and compliance across 119 jurisdictions.

### Law MCPs

Full national legislation for 108 countries. Example: [@ansvar/swedish-law-mcp](https://github.com/Ansvar-Systems/swedish-law-mcp) -- 2,415 Swedish statutes with EU cross-references.

### Sector Regulator MCPs

National regulatory authority data for 29 EU/EFTA countries across financial regulation, data protection, cybersecurity, and competition. This MCP is one of 116 sector regulator servers.

### Domain MCPs

Specialized compliance domains: [EU Regulations](https://github.com/Ansvar-Systems/EU_compliance_MCP), [Security Frameworks](https://github.com/Ansvar-Systems/security-frameworks-mcp), [Automotive Cybersecurity](https://github.com/Ansvar-Systems/Automotive-MCP), [OT/ICS Security](https://github.com/Ansvar-Systems/ot-security-mcp), [Sanctions](https://github.com/Ansvar-Systems/Sanctions-MCP), and more.

Browse the full fleet at [mcp.ansvar.eu](https://mcp.ansvar.eu).

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

Apache License 2.0. See [LICENSE](./LICENSE) for details.

### Data Licenses

Regulatory data sourced from official government publications. See [COVERAGE.md](COVERAGE.md) for per-source coverage details.

---

## About Ansvar Systems

We build AI-powered compliance and legal research tools for the European market. Our MCP fleet provides structured, verified regulatory data to AI assistants -- so compliance professionals can work with accurate sources instead of guessing.

**[ansvar.eu](https://ansvar.eu)** -- Stockholm, Sweden

---

<p align="center">
  <sub>Built with care in Stockholm, Sweden</sub>
</p>
