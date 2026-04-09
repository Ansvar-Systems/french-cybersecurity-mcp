#!/usr/bin/env node

/**
 * French Cybersecurity MCP — stdio entry point.
 *
 * Provides MCP tools for querying ANSSI (Agence nationale de la sécurité des systèmes d'information)
 * guidance documents (PGSSI-S, RGS, SecNumCloud) and CERT-FR security advisories.
 *
 * Tool prefix: fr_cyber_
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  searchGuidance,
  getGuidance,
  searchAdvisories,
  getAdvisory,
  listFrameworks,
  getDataFreshness,
} from "./db.js";
import { buildCitation } from "./citation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let pkgVersion = "0.1.0";
try {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf8"),
  ) as { version: string };
  pkgVersion = pkg.version;
} catch {
  // fallback to default
}

const SERVER_NAME = "french-cybersecurity-mcp";

// --- Tool definitions ---------------------------------------------------------

const TOOLS = [
  {
    name: "fr_cyber_search_guidance",
    description:
      "Full-text search across ANSSI guidance documents. Covers PGSSI-S, RGS, SecNumCloud, Référentiel de sécurité, and technical publications. Returns matching documents with reference, title, series, and summary.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g., 'patch management', 'network security', 'incident response')",
        },
        type: {
          type: "string",
          enum: ["guidance", "framework", "technical", "board"],
          description: "Filter by document type. Optional.",
        },
        series: {
          type: "string",
          enum: ["PGSSI-S", "RGS", "SecNumCloud", "ANSSI"],
          description: "Filter by ANSSI series. Optional.",
        },
        status: {
          type: "string",
          enum: ["current", "superseded", "draft"],
          description: "Filter by document status. Defaults to returning all statuses.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return. Defaults to 20.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "fr_cyber_get_guidance",
    description:
      "Get a specific ANSSI guidance document by reference (e.g., 'ANSSI-PGSSI-2021', 'ANSSI-RGS-2.0', 'ANSSI-SecNumCloud-3.2').",
    inputSchema: {
      type: "object" as const,
      properties: {
        reference: {
          type: "string",
          description: "ANSSI document reference (e.g., 'ANSSI-PGSSI-2021', 'ANSSI-SecNumCloud-3.2')",
        },
      },
      required: ["reference"],
    },
  },
  {
    name: "fr_cyber_search_advisories",
    description:
      "Search ANSSI security advisories and alerts (CERT-FR). Returns advisories with severity, affected products, and CVE references where available.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g., 'ransomware', 'zero-day', 'supply chain')",
        },
        severity: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
          description: "Filter by severity level. Optional.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return. Defaults to 20.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "fr_cyber_get_advisory",
    description:
      "Get a specific ANSSI security advisory by reference (e.g., 'ANSSI-ADV-2024-001').",
    inputSchema: {
      type: "object" as const,
      properties: {
        reference: {
          type: "string",
          description: "ANSSI advisory reference (e.g., 'ANSSI-ADV-2024-001')",
        },
      },
      required: ["reference"],
    },
  },
  {
    name: "fr_cyber_list_frameworks",
    description:
      "List all ANSSI frameworks and guidance series covered in this MCP, including PGSSI-S, RGS, and SecNumCloud.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "fr_cyber_about",
    description: "Return metadata about this MCP server: version, data source, coverage, and tool list.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "fr_cyber_list_sources",
    description:
      "List all data sources used by this MCP, including ANSSI and CERT-FR official URLs with descriptions.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "fr_cyber_check_data_freshness",
    description:
      "Check how recent the data is. Returns the latest document date in the guidance and advisories tables so callers can assess data staleness.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

// --- Zod schemas for argument validation --------------------------------------

const SearchGuidanceArgs = z.object({
  query: z.string().min(1),
  type: z.enum(["guidance", "framework", "technical", "board"]).optional(),
  series: z.enum(["PGSSI-S", "RGS", "SecNumCloud", "ANSSI"]).optional(),
  status: z.enum(["current", "superseded", "draft"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const GetGuidanceArgs = z.object({
  reference: z.string().min(1),
});

const SearchAdvisoriesArgs = z.object({
  query: z.string().min(1),
  severity: z.enum(["critical", "high", "medium", "low"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const GetAdvisoryArgs = z.object({
  reference: z.string().min(1),
});

// --- Meta block (added to all tool responses) --------------------------------

const META = {
  disclaimer:
    "This server provides ANSSI guidance and CERT-FR advisories for research purposes only. Not legal or regulatory advice. Verify all references against primary sources before making compliance decisions.",
  copyright:
    "Content sourced from ANSSI (Agence nationale de la sécurité des systèmes d'information) and CERT-FR. Official content is subject to French government copyright.",
  source_url: "https://www.ssi.gouv.fr/",
};

// --- Helper ------------------------------------------------------------------

function textContent(data: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
    ],
  };
}

function errorContent(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

// --- Server setup ------------------------------------------------------------

const server = new Server(
  { name: SERVER_NAME, version: pkgVersion },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case "fr_cyber_search_guidance": {
        const parsed = SearchGuidanceArgs.parse(args);
        const results = searchGuidance({
          query: parsed.query,
          type: parsed.type,
          series: parsed.series,
          status: parsed.status,
          limit: parsed.limit,
        });
        return textContent({ results, count: results.length, _meta: META });
      }

      case "fr_cyber_get_guidance": {
        const parsed = GetGuidanceArgs.parse(args);
        const doc = getGuidance(parsed.reference);
        if (!doc) {
          return errorContent(`Guidance document not found: ${parsed.reference}`);
        }
        const guidanceRecord = doc as Record<string, unknown>;
        return textContent({
          ...guidanceRecord,
          _citation: buildCitation(
            String(guidanceRecord.reference ?? parsed.reference),
            String(guidanceRecord.title ?? guidanceRecord.reference ?? parsed.reference),
            "fr_cyber_get_guidance",
            { reference: parsed.reference },
            guidanceRecord.url as string | undefined,
          ),
          _meta: META,
        });
      }

      case "fr_cyber_search_advisories": {
        const parsed = SearchAdvisoriesArgs.parse(args);
        const results = searchAdvisories({
          query: parsed.query,
          severity: parsed.severity,
          limit: parsed.limit,
        });
        return textContent({ results, count: results.length, _meta: META });
      }

      case "fr_cyber_get_advisory": {
        const parsed = GetAdvisoryArgs.parse(args);
        const advisory = getAdvisory(parsed.reference);
        if (!advisory) {
          return errorContent(`Advisory not found: ${parsed.reference}`);
        }
        const advisoryRecord = advisory as Record<string, unknown>;
        return textContent({
          ...advisoryRecord,
          _citation: buildCitation(
            String(advisoryRecord.reference ?? parsed.reference),
            String(advisoryRecord.title ?? advisoryRecord.reference ?? parsed.reference),
            "fr_cyber_get_advisory",
            { reference: parsed.reference },
            advisoryRecord.url as string | undefined,
          ),
          _meta: META,
        });
      }

      case "fr_cyber_list_frameworks": {
        const frameworks = listFrameworks();
        return textContent({ frameworks, count: frameworks.length, _meta: META });
      }

      case "fr_cyber_about": {
        return textContent({
          name: SERVER_NAME,
          version: pkgVersion,
          description:
            "ANSSI (Agence nationale de la sécurité des systèmes d'information) MCP server. Provides access to ANSSI guidance including PGSSI-S, RGS, SecNumCloud, and CERT-FR security advisories.",
          data_source: "ANSSI (https://www.ssi.gouv.fr/)",
          coverage: {
            guidance: "PGSSI-S, RGS, SecNumCloud, Référentiel de sécurité",
            advisories: "ANSSI security advisories and alerts (CERT-FR)",
            frameworks: "PGSSI-S, RGS, SecNumCloud",
          },
          tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
          _meta: META,
        });
      }

      case "fr_cyber_list_sources": {
        return textContent({
          sources: [
            {
              name: "ANSSI",
              full_name: "Agence nationale de la sécurité des systèmes d'information",
              url: "https://www.ssi.gouv.fr/",
              description: "French national cybersecurity agency. Publishes PGSSI-S, RGS, SecNumCloud frameworks and technical recommendations.",
            },
            {
              name: "CERT-FR",
              full_name: "Centre gouvernemental de veille, d'alerte et de réponse aux attaques informatiques",
              url: "https://www.cert.ssi.gouv.fr/",
              description: "French government CERT. Publishes security advisories, alerts, and incident reports.",
            },
          ],
          _meta: META,
        });
      }

      case "fr_cyber_check_data_freshness": {
        const freshness = getDataFreshness();
        return textContent({
          guidance_latest_date: freshness.guidance_latest,
          advisories_latest_date: freshness.advisories_latest,
          note: "Dates reflect the most recent document date in each table. null means the table is empty.",
          _meta: META,
        });
      }

      default:
        return errorContent(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorContent(`Error executing ${name}: ${message}`);
  }
});

// --- Main --------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`${SERVER_NAME} v${pkgVersion} running on stdio\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
