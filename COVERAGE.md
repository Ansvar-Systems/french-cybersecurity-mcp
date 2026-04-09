# Corpus Coverage

This document describes the completeness of the data corpus included in the French Cybersecurity MCP.

## Sources

### ANSSI — Agence nationale de la sécurité des systèmes d'information

**URL:** https://www.ssi.gouv.fr/

The French national cybersecurity agency. Issues binding frameworks for public-sector IT security and certification schemes for cloud services and security products.

### CERT-FR — Centre gouvernemental de veille, d'alerte et de réponse aux attaques informatiques

**URL:** https://www.cert.ssi.gouv.fr/

The French government CERT operated by ANSSI. Publishes security advisories (AVI), alerts (ALE), and incident reports (IOC).

---

## Frameworks Covered

| Framework | Full Name | Status | Notes |
|-----------|-----------|--------|-------|
| PGSSI-S | Politique Générale de Sécurité des Systèmes d'Information de Santé | Current | Healthcare IT security policy series |
| RGS | Référentiel Général de Sécurité | Current | General security reference framework for public administrations |
| SecNumCloud | Référentiel de qualification des prestataires de services d'informatique en nuage | Current | Cloud service provider qualification scheme |
| ANSSI | General ANSSI technical guidance and recommendations | Current | Technical notes, configuration guides, best practices |

---

## CERT-FR Advisories

| Type | Code Prefix | Description |
|------|-------------|-------------|
| Security Advisory | AVI | Vulnerability notifications for software/hardware |
| Alert | ALE | High-urgency advisories requiring immediate action |
| Threat Report | MEN | Threat actor and campaign reports |

---

## Known Gaps

- ANSSI certification decisions (CSPN, CC) are not included — available at https://www.ssi.gouv.fr/entreprise/produits-certifies/
- Historical CERT-FR advisories before 2020 may have incomplete coverage
- ANSSI approved product lists (lists visées) are not included
- Real-time threat intelligence feeds are not included

---

## Data Currency

Database updates are performed periodically. Use the `fr_cyber_check_data_freshness` tool to verify the age of the data before relying on it for compliance decisions.
