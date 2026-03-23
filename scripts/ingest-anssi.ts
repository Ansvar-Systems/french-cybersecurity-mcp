/**
 * ANSSI ingestion crawler — scrapes cyber.gouv.fr and cert.ssi.gouv.fr to
 * populate the SQLite database with real cybersecurity guidance, advisories,
 * CTI reports, and hardening recommendations.
 *
 * Data sources:
 *   - cyber.gouv.fr/actualites          — ANSSI publications & news
 *   - cert.ssi.gouv.fr/avis/page/N/     — CERT-FR security advisories
 *   - cert.ssi.gouv.fr/alerte/page/N/   — CERT-FR security alerts
 *   - cert.ssi.gouv.fr/cti/page/N/      — CERT-FR threat intelligence reports
 *   - cert.ssi.gouv.fr/dur/page/N/      — CERT-FR hardening recommendations
 *
 * Usage:
 *   npx tsx scripts/ingest-anssi.ts
 *   npx tsx scripts/ingest-anssi.ts --resume      # skip already-ingested references
 *   npx tsx scripts/ingest-anssi.ts --dry-run      # parse only, do not write to DB
 *   npx tsx scripts/ingest-anssi.ts --force        # delete DB and rebuild from scratch
 *   npx tsx scripts/ingest-anssi.ts --max-pages 5  # limit listing pages per source
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import * as cheerio from "cheerio";
import { SCHEMA_SQL } from "../src/db.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DB_PATH = process.env["ANSSI_DB_PATH"] ?? "data/anssi.db";

/** Minimum delay between HTTP requests (ms). */
const RATE_LIMIT_MS = 1500;

/** Maximum retries per request on transient failure. */
const MAX_RETRIES = 3;

/** Back-off base for retries (ms). Actual delay = BASE * 2^attempt. */
const RETRY_BACKOFF_BASE_MS = 2000;

/** Default cap on listing pages crawled per source category. */
const DEFAULT_MAX_PAGES = 200;

/** Request timeout (ms). */
const REQUEST_TIMEOUT_MS = 30_000;

const USER_AGENT =
  "AnsvarANSSICrawler/1.0 (+https://github.com/Ansvar-Systems/french-cybersecurity-mcp)";

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const FLAG_RESUME = args.includes("--resume");
const FLAG_DRY_RUN = args.includes("--dry-run");
const FLAG_FORCE = args.includes("--force");

function flagValue(name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

const MAX_PAGES = Number(flagValue("--max-pages") || DEFAULT_MAX_PAGES);

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

function log(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function warn(msg: string): void {
  const ts = new Date().toISOString();
  console.warn(`[${ts}] WARN: ${msg}`);
}

function error(msg: string): void {
  const ts = new Date().toISOString();
  console.error(`[${ts}] ERROR: ${msg}`);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

let lastRequestTime = 0;

async function rateLimit(): Promise<void> {
  const elapsed = Date.now() - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - elapsed);
  }
  lastRequestTime = Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(url: string, attempt = 0): Promise<string> {
  await rateLimit();
  log(`  GET ${url}`);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.5",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return await res.text();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (attempt < MAX_RETRIES) {
      const backoff = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt);
      warn(`Request failed (${msg}), retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(backoff);
      return fetchPage(url, attempt + 1);
    }
    throw new Error(`Failed to fetch ${url} after ${MAX_RETRIES} retries: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

function openDatabase(): Database.Database {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    log(`Created directory: ${dir}`);
  }

  if (FLAG_FORCE && existsSync(DB_PATH)) {
    unlinkSync(DB_PATH);
    log(`Deleted existing database at ${DB_PATH}`);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  log(`Database ready at ${DB_PATH}`);
  return db;
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface ListingEntry {
  /** Absolute URL to the detail page. */
  url: string;
  /** Reference ID (e.g. CERTFR-2026-AVI-0334). */
  reference: string;
  /** Title text from the listing. */
  title: string;
  /** Date string (YYYY-MM-DD) if available from listing. */
  date: string | null;
}

interface ParsedAdvisory {
  reference: string;
  title: string;
  date: string | null;
  severity: string | null;
  affected_products: string | null; // JSON array
  summary: string | null;
  full_text: string;
  cve_references: string | null; // JSON array
}

interface ParsedGuidance {
  reference: string;
  title: string;
  title_en: string | null;
  date: string | null;
  type: string;
  series: string;
  summary: string | null;
  full_text: string;
  topics: string | null; // JSON array
  status: string;
}

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

const FRENCH_MONTHS: Record<string, string> = {
  janvier: "01",
  février: "02",
  fevrier: "02",
  mars: "03",
  avril: "04",
  mai: "05",
  juin: "06",
  juillet: "07",
  août: "08",
  aout: "08",
  septembre: "09",
  octobre: "10",
  novembre: "11",
  décembre: "12",
  decembre: "12",
};

/**
 * Parse a French date string like "20 mars 2026" or "04 février 2026"
 * into ISO YYYY-MM-DD format.
 */
function parseFrenchDate(raw: string): string | null {
  if (!raw) return null;
  const clean = raw.trim().toLowerCase().replace(/\s+/g, " ");

  // Try "DD monthName YYYY" pattern
  const match = clean.match(/(\d{1,2})\s+(\S+)\s+(\d{4})/);
  if (match) {
    const day = match[1]!.padStart(2, "0");
    const monthStr = match[2]!;
    const year = match[3]!;
    const month = FRENCH_MONTHS[monthStr];
    if (month) return `${year}-${month}-${day}`;
  }

  // Try ISO format already
  const isoMatch = clean.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0];

  // Try "DD/MM/YYYY"
  const slashMatch = clean.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (slashMatch) return `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`;

  return null;
}

// ---------------------------------------------------------------------------
// Topic extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract topic tags from advisory/guidance text by matching known
 * cybersecurity keywords.
 */
function extractTopics(text: string): string[] {
  const lower = text.toLowerCase();
  const topics: string[] = [];
  const topicPatterns: [string, string][] = [
    ["rancongiciel", "ransomware"],
    ["ransomware", "ransomware"],
    ["rançongiciel", "ransomware"],
    ["hameconnage", "phishing"],
    ["hameçonnage", "phishing"],
    ["phishing", "phishing"],
    ["authentification", "authentification"],
    ["chiffrement", "chiffrement"],
    ["cryptographie", "cryptographie"],
    ["active directory", "active-directory"],
    ["vpn", "vpn"],
    ["pare-feu", "pare-feu"],
    ["firewall", "pare-feu"],
    ["cloud", "cloud"],
    ["secnumcloud", "secnumcloud"],
    ["nis ?2", "NIS2"],
    ["nis2", "NIS2"],
    ["rgpd", "RGPD"],
    ["donnees de sante", "donnees-sante"],
    ["données de santé", "donnees-sante"],
    ["pgssi", "PGSSI-S"],
    ["rgs", "RGS"],
    ["oiv", "OIV"],
    ["ose", "OSE"],
    ["sante", "sante"],
    ["santé", "sante"],
    ["industriel", "systemes-industriels"],
    ["scada", "systemes-industriels"],
    ["ics", "systemes-industriels"],
    ["mobile", "mobile"],
    ["dns", "dns"],
    ["messagerie", "messagerie"],
    ["sauvegarde", "sauvegarde"],
    ["journalisation", "journalisation"],
    ["audit", "audit"],
    ["remediation", "remediation"],
    ["remédiation", "remediation"],
    ["virtualisation", "virtualisation"],
    ["conteneur", "conteneurs"],
    ["container", "conteneurs"],
    ["kubernetes", "kubernetes"],
    ["linux", "linux"],
    ["windows", "windows"],
    ["nomadisme", "nomadisme"],
    ["teletravail", "teletravail"],
    ["télétravail", "teletravail"],
    ["intelligence artificielle", "intelligence-artificielle"],
    ["ia générative", "intelligence-artificielle"],
    ["supply chain", "chaine-approvisionnement"],
    ["chaîne d'approvisionnement", "chaine-approvisionnement"],
    ["sous-traitant", "chaine-approvisionnement"],
    ["apt", "apt"],
    ["post-quantique", "post-quantique"],
    ["zero-day", "zero-day"],
    ["0day", "zero-day"],
  ];

  const seen = new Set<string>();
  for (const [pattern, topic] of topicPatterns) {
    if (!seen.has(topic) && new RegExp(pattern, "i").test(lower)) {
      seen.add(topic);
      topics.push(topic);
    }
  }

  return topics;
}

// ---------------------------------------------------------------------------
// CERT-FR advisory/alert listing parser
// ---------------------------------------------------------------------------

/**
 * Parse a CERT-FR listing page (avis, alerte, cti, dur).
 * Each entry is an <a> with the reference in the href and the title as link text.
 */
function parseCertfrListing(
  html: string,
  baseUrl: string,
  category: string,
): { entries: ListingEntry[]; hasNextPage: boolean; nextPageUrl: string | null } {
  const $ = cheerio.load(html);
  const entries: ListingEntry[] = [];

  // CERT-FR listing pages use article elements or link-based entries.
  // Each advisory entry is typically an <a> linking to /avis/CERTFR-.../ etc.
  // Look for links matching the CERTFR-YYYY-XXX-NNNN pattern.
  const certfrPattern = /CERTFR-\d{4}-[A-Z]+-\d+/;

  $("a").each((_i, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const refMatch = href.match(certfrPattern);
    if (!refMatch) return;

    const reference = refMatch[0];
    const title = $(el).text().trim();

    // Skip navigation links that just contain the reference itself
    if (!title || title === reference) return;
    // Skip very short titles (pagination artifacts)
    if (title.length < 10) return;

    // Deduplicate by reference
    if (entries.some((e) => e.reference === reference)) return;

    // Build absolute URL
    let url: string;
    if (href.startsWith("http")) {
      url = href;
    } else {
      url = `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
    }

    entries.push({ url, reference, title, date: null });
  });

  // Try to extract dates from the listing page.
  // CERT-FR listings often show date text near each entry.
  // We parse dates from meta-information elements near the links.
  $("article, .item, .cert-fr-item, [class*='item']").each((_i, el) => {
    const $el = $(el);
    const link = $el.find("a[href*='CERTFR-']").first();
    if (!link.length) return;
    const href = link.attr("href") ?? "";
    const refMatch = href.match(certfrPattern);
    if (!refMatch) return;

    const ref = refMatch[0];
    const dateText = $el.text();
    const parsedDate = parseFrenchDate(dateText);

    const entry = entries.find((e) => e.reference === ref);
    if (entry && parsedDate) {
      entry.date = parsedDate;
    }
  });

  // Pagination: look for "Suivant" or "next" links, or page/N+1/
  let hasNextPage = false;
  let nextPageUrl: string | null = null;

  $("a").each((_i, el) => {
    const text = $(el).text().trim().toLowerCase();
    const href = $(el).attr("href");
    if (!href) return;

    if (text.includes("suivant") || text === "»" || text === "next") {
      hasNextPage = true;
      if (href.startsWith("http")) {
        nextPageUrl = href;
      } else {
        nextPageUrl = `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
      }
    }
  });

  return { entries, hasNextPage, nextPageUrl };
}

// ---------------------------------------------------------------------------
// CERT-FR detail page parser
// ---------------------------------------------------------------------------

function parseCertfrDetailPage(
  html: string,
  reference: string,
  category: "avis" | "alerte" | "cti" | "dur",
): ParsedAdvisory | ParsedGuidance {
  const $ = cheerio.load(html);

  // Extract title
  const title =
    $("h1").first().text().trim() ||
    $("h2").first().text().trim() ||
    reference;

  // Extract date from the "Gestion du document" section
  let date: string | null = null;
  const fullText = $("body").text();

  // Look for "Date de la première version" or "date de la version initiale"
  const datePatterns = [
    /(?:date de la premi[eè]re version|version initiale)[:\s]*(\d{1,2}\s+\S+\s+\d{4})/i,
    /(?:date de la derni[eè]re version)[:\s]*(\d{1,2}\s+\S+\s+\d{4})/i,
    /(\d{1,2}\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+\d{4})/i,
  ];

  for (const pattern of datePatterns) {
    const m = fullText.match(pattern);
    if (m?.[1]) {
      date = parseFrenchDate(m[1]);
      if (date) break;
    }
  }

  // Extract sections by heading text
  const sections: Record<string, string> = {};
  const sectionHeadings = [
    "risque", "systèmes affectés", "systemes affectes",
    "résumé", "resume", "description", "solution",
    "documentation", "contournement provisoire",
    "recommandations", "objet",
  ];

  // Collect all text content from the main content area
  const mainContent = $(".content, main, article, #content, .main-content")
    .first();
  const contentRoot = mainContent.length ? mainContent : $("body");

  // Build full text from paragraphs
  const paragraphs: string[] = [];
  contentRoot.find("p, li").each((_i, el) => {
    const text = $(el).text().trim();
    if (text.length > 5) {
      paragraphs.push(text);
    }
  });

  // Try to identify sections by h2/h3 headings
  contentRoot.find("h2, h3, h4, dt, strong, b").each((_i, el) => {
    const heading = $(el).text().trim().toLowerCase();
    for (const sh of sectionHeadings) {
      if (heading.includes(sh)) {
        // Collect text from following siblings until next heading
        let sectionText = "";
        let sibling = $(el).next();
        while (sibling.length && !sibling.is("h2, h3, h4")) {
          const t = sibling.text().trim();
          if (t) sectionText += t + "\n";
          sibling = sibling.next();
        }
        if (sectionText) {
          sections[sh] = sectionText.trim();
        }
        break;
      }
    }
  });

  const bodyText = paragraphs.join("\n\n");

  // Extract CVE references
  const cveMatches = bodyText.match(/CVE-\d{4}-\d+/g);
  const cves = cveMatches ? [...new Set(cveMatches)] : [];

  // Extract affected products from "Systèmes affectés" section
  let affectedProducts: string[] = [];
  const affectedSection =
    sections["systèmes affectés"] ??
    sections["systemes affectes"] ??
    "";
  if (affectedSection) {
    affectedProducts = affectedSection
      .split("\n")
      .map((line) => line.replace(/^[-–•*]\s*/, "").trim())
      .filter((line) => line.length > 2);
  }

  // Determine severity from risk text or alert category
  let severity: string | null = null;
  const riskSection = sections["risque"] ?? "";
  const riskLower = riskSection.toLowerCase();
  if (
    category === "alerte" ||
    riskLower.includes("exécution de code") ||
    riskLower.includes("execution de code") ||
    riskLower.includes("code arbitraire")
  ) {
    severity = "critical";
  } else if (
    riskLower.includes("déni de service") ||
    riskLower.includes("élévation de privil") ||
    riskLower.includes("elevation de privil")
  ) {
    severity = "high";
  } else if (
    riskLower.includes("atteinte à la confidentialité") ||
    riskLower.includes("contournement")
  ) {
    severity = "medium";
  } else if (riskLower.length > 0) {
    severity = "medium";
  }

  // Build summary
  const summary =
    sections["résumé"] ??
    sections["resume"] ??
    sections["objet"] ??
    sections["description"] ??
    (paragraphs.length > 0 ? paragraphs[0] : null) ??
    null;

  // For CTI and DUR, return as guidance rather than advisory
  if (category === "cti" || category === "dur") {
    const seriesMap: Record<string, string> = {
      cti: "CERT-FR CTI",
      dur: "CERT-FR Recommandations",
    };
    const typeMap: Record<string, string> = {
      cti: "threat-intelligence",
      dur: "hardening",
    };
    const topics = extractTopics(bodyText);

    return {
      reference,
      title,
      title_en: null,
      date,
      type: typeMap[category] ?? "guidance",
      series: seriesMap[category] ?? "CERT-FR",
      summary: summary ? truncate(summary, 1000) : null,
      full_text: bodyText || title,
      topics: topics.length > 0 ? JSON.stringify(topics) : null,
      status: "current",
    } satisfies ParsedGuidance;
  }

  // Advisories and alerts
  return {
    reference,
    title,
    date,
    severity,
    affected_products:
      affectedProducts.length > 0
        ? JSON.stringify(affectedProducts)
        : null,
    summary: summary ? truncate(summary, 1000) : null,
    full_text: bodyText || title,
    cve_references: cves.length > 0 ? JSON.stringify(cves) : null,
  } satisfies ParsedAdvisory;
}

// ---------------------------------------------------------------------------
// cyber.gouv.fr publications parser
// ---------------------------------------------------------------------------

/**
 * Parse the cyber.gouv.fr/actualites listing page.
 * Returns entries and pagination info.
 */
function parseActualitesListing(
  html: string,
): { entries: ListingEntry[]; hasNextPage: boolean; nextPage: number | null } {
  const $ = cheerio.load(html);
  const entries: ListingEntry[] = [];

  // Each news item on cyber.gouv.fr/actualites is a card with a link, title, and date
  $("a[href*='/actualites/']").each((_i, el) => {
    const href = $(el).attr("href");
    if (!href || href === "/actualites/" || href === "/actualites") return;

    // Skip pagination links
    if (href.includes("?page=")) return;

    const title = $(el).text().trim();
    if (!title || title.length < 10) return;

    // Build full URL
    let url: string;
    if (href.startsWith("http")) {
      url = href;
    } else {
      url = `https://cyber.gouv.fr${href.startsWith("/") ? "" : "/"}${href}`;
    }

    // Generate a reference from the slug
    const slug = href
      .replace(/^\/actualites\//, "")
      .replace(/\/$/, "")
      .replace(/%[0-9A-F]{2}/gi, "");
    const reference = `ANSSI-PUB-${slug.substring(0, 80).toUpperCase().replace(/[^A-Z0-9]/g, "-")}`;

    if (entries.some((e) => e.url === url)) return;

    entries.push({ url, reference, title, date: null });
  });

  // Check pagination: look for current page indicator "N / M"
  let hasNextPage = false;
  let nextPage: number | null = null;

  const paginationText = $("body").text();
  const pageMatch = paginationText.match(/(\d+)\s*\/\s*(\d+)/);
  if (pageMatch) {
    const current = Number(pageMatch[1]);
    const total = Number(pageMatch[2]);
    if (current < total) {
      hasNextPage = true;
      nextPage = current + 1;
    }
  }

  // Also check for "?page=N" style next links
  $("a[href*='?page=']").each((_i, el) => {
    const text = $(el).text().trim().toLowerCase();
    if (text.includes("suivant") || text === "›" || text === "»") {
      hasNextPage = true;
      const href = $(el).attr("href") ?? "";
      const m = href.match(/[?&]page=(\d+)/);
      if (m) nextPage = Number(m[1]);
    }
  });

  return { entries, hasNextPage, nextPage };
}

/**
 * Parse an individual cyber.gouv.fr publication detail page.
 */
function parseActualitesDetail(
  html: string,
  reference: string,
): ParsedGuidance {
  const $ = cheerio.load(html);

  const title =
    $("h1").first().text().trim() ||
    $("title").first().text().trim().replace(/ \| .*$/, "") ||
    reference;

  // Extract date
  let date: string | null = null;
  const bodyText = $("body").text();

  // Look for French date patterns in the page
  const datePatterns = [
    /(?:publié|publication|mis à jour|date)[:\s]*(?:le\s+)?(\d{1,2}\s+\S+\s+\d{4})/i,
    /(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+(\d{1,2}\s+\S+\s+\d{4})/i,
    /(\d{1,2}\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+\d{4})/i,
  ];

  for (const pattern of datePatterns) {
    const m = bodyText.match(pattern);
    if (m?.[1]) {
      date = parseFrenchDate(m[1]);
      if (date) break;
    }
  }

  // Extract main content paragraphs
  const mainContent = $("main, article, .content, .field--name-body, #content")
    .first();
  const contentRoot = mainContent.length ? mainContent : $("body");

  const paragraphs: string[] = [];
  contentRoot.find("p, li, blockquote").each((_i, el) => {
    const text = $(el).text().trim();
    // Skip very short lines, nav text, footer text
    if (text.length > 20) {
      paragraphs.push(text);
    }
  });

  const fullText = paragraphs.join("\n\n");

  // Determine type and series based on content
  let type = "publication";
  let series = "ANSSI";

  const lowerTitle = title.toLowerCase();
  const lowerText = fullText.toLowerCase();

  if (lowerTitle.includes("panorama") || lowerTitle.includes("cybermenace")) {
    type = "threat-landscape";
    series = "Panorama de la cybermenace";
  } else if (lowerTitle.includes("guide") || lowerTitle.includes("recommandation")) {
    type = "guidance";
  } else if (lowerTitle.includes("nis 2") || lowerTitle.includes("nis2")) {
    type = "regulatory";
    series = "NIS2";
  } else if (lowerTitle.includes("secnumcloud")) {
    type = "framework";
    series = "SecNumCloud";
  } else if (lowerTitle.includes("rgs")) {
    type = "framework";
    series = "RGS";
  } else if (lowerTitle.includes("pgssi")) {
    type = "framework";
    series = "PGSSI-S";
  } else if (
    lowerTitle.includes("remédiation") ||
    lowerTitle.includes("remediation")
  ) {
    type = "guidance";
    series = "Remediation";
  } else if (
    lowerText.includes("intelligence artificielle") ||
    lowerTitle.includes("ia ")
  ) {
    type = "publication";
    series = "ANSSI";
  }

  // Build summary from first substantive paragraph
  const summary = paragraphs.length > 0 ? truncate(paragraphs[0]!, 1000) : null;

  // Extract topics
  const topics = extractTopics(fullText + " " + title);

  return {
    reference,
    title,
    title_en: null,
    date,
    type,
    series,
    summary,
    full_text: fullText || title,
    topics: topics.length > 0 ? JSON.stringify(topics) : null,
    status: "current",
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + "...";
}

// ---------------------------------------------------------------------------
// Database write helpers
// ---------------------------------------------------------------------------

function insertAdvisory(db: Database.Database, adv: ParsedAdvisory): boolean {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO advisories
        (reference, title, date, severity, affected_products, summary, full_text, cve_references)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      adv.reference,
      adv.title,
      adv.date,
      adv.severity,
      adv.affected_products,
      adv.summary,
      adv.full_text,
      adv.cve_references,
    );
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    warn(`Failed to insert advisory ${adv.reference}: ${msg}`);
    return false;
  }
}

function insertGuidance(db: Database.Database, g: ParsedGuidance): boolean {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO guidance
        (reference, title, title_en, date, type, series, summary, full_text, topics, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      g.reference,
      g.title,
      g.title_en,
      g.date,
      g.type,
      g.series,
      g.summary,
      g.full_text,
      g.topics,
      g.status,
    );
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    warn(`Failed to insert guidance ${g.reference}: ${msg}`);
    return false;
  }
}

function referenceExists(db: Database.Database, table: string, reference: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM ${table} WHERE reference = ? LIMIT 1`)
    .get(reference) as { 1: number } | undefined;
  return row !== undefined;
}

// ---------------------------------------------------------------------------
// Crawl orchestration: CERT-FR sources
// ---------------------------------------------------------------------------

interface CertfrSource {
  /** Human-readable name. */
  name: string;
  /** Category path segment (avis, alerte, cti, dur). */
  category: "avis" | "alerte" | "cti" | "dur";
  /** Which DB table the data goes to. */
  targetTable: "advisories" | "guidance";
}

const CERTFR_SOURCES: CertfrSource[] = [
  {
    name: "CERT-FR Security Advisories (Avis)",
    category: "avis",
    targetTable: "advisories",
  },
  {
    name: "CERT-FR Security Alerts (Alertes)",
    category: "alerte",
    targetTable: "advisories",
  },
  {
    name: "CERT-FR Threat Intelligence (CTI)",
    category: "cti",
    targetTable: "guidance",
  },
  {
    name: "CERT-FR Hardening Recommendations (DUR)",
    category: "dur",
    targetTable: "guidance",
  },
];

async function crawlCertfrSource(
  db: Database.Database,
  source: CertfrSource,
): Promise<{ inserted: number; skipped: number; errors: number }> {
  log(`\n=== Crawling: ${source.name} ===`);

  const baseUrl = "https://www.cert.ssi.gouv.fr";
  let page = 1;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  while (page <= MAX_PAGES) {
    const listUrl = `${baseUrl}/${source.category}/page/${page}/`;
    log(`Fetching listing page ${page}: ${listUrl}`);

    let listHtml: string;
    try {
      listHtml = await fetchPage(listUrl);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // A 404 on a listing page means we have gone past the last page
      if (msg.includes("404")) {
        log(`Reached end of listings at page ${page}`);
        break;
      }
      error(`Failed to fetch listing page ${page}: ${msg}`);
      totalErrors++;
      break;
    }

    const { entries, hasNextPage } = parseCertfrListing(
      listHtml,
      baseUrl,
      source.category,
    );

    if (entries.length === 0) {
      log(`No entries found on page ${page}, stopping`);
      break;
    }

    log(`Found ${entries.length} entries on page ${page}`);

    for (const entry of entries) {
      // Resume mode: skip if already in DB
      if (FLAG_RESUME && referenceExists(db, source.targetTable, entry.reference)) {
        totalSkipped++;
        continue;
      }

      if (FLAG_DRY_RUN) {
        log(`  [DRY RUN] Would fetch: ${entry.reference} — ${entry.title}`);
        totalSkipped++;
        continue;
      }

      // Fetch detail page
      let detailHtml: string;
      try {
        detailHtml = await fetchPage(entry.url);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        error(`Failed to fetch detail for ${entry.reference}: ${msg}`);
        totalErrors++;
        continue;
      }

      const parsed = parseCertfrDetailPage(
        detailHtml,
        entry.reference,
        source.category,
      );

      // Use the listing date if the detail page parse did not find one
      if (!parsed.date && entry.date) {
        parsed.date = entry.date;
      }

      let ok: boolean;
      if (source.targetTable === "advisories") {
        ok = insertAdvisory(db, parsed as ParsedAdvisory);
      } else {
        ok = insertGuidance(db, parsed as ParsedGuidance);
      }

      if (ok) {
        totalInserted++;
      } else {
        totalErrors++;
      }
    }

    if (!hasNextPage) {
      log(`No more pages after page ${page}`);
      break;
    }

    page++;
  }

  log(`${source.name}: inserted=${totalInserted}, skipped=${totalSkipped}, errors=${totalErrors}`);
  return { inserted: totalInserted, skipped: totalSkipped, errors: totalErrors };
}

// ---------------------------------------------------------------------------
// Crawl orchestration: cyber.gouv.fr publications
// ---------------------------------------------------------------------------

async function crawlActualites(
  db: Database.Database,
): Promise<{ inserted: number; skipped: number; errors: number }> {
  log("\n=== Crawling: cyber.gouv.fr publications (actualites) ===");

  let page = 1;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  while (page <= MAX_PAGES) {
    const listUrl =
      page === 1
        ? "https://cyber.gouv.fr/actualites"
        : `https://cyber.gouv.fr/actualites?page=${page}`;

    log(`Fetching publications listing page ${page}: ${listUrl}`);

    let listHtml: string;
    try {
      listHtml = await fetchPage(listUrl);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("404")) {
        log(`Reached end of publications at page ${page}`);
        break;
      }
      error(`Failed to fetch publications page ${page}: ${msg}`);
      totalErrors++;
      break;
    }

    const { entries, hasNextPage, nextPage } = parseActualitesListing(listHtml);

    if (entries.length === 0) {
      log(`No entries found on publications page ${page}, stopping`);
      break;
    }

    log(`Found ${entries.length} entries on publications page ${page}`);

    for (const entry of entries) {
      // Resume mode
      if (FLAG_RESUME && referenceExists(db, "guidance", entry.reference)) {
        totalSkipped++;
        continue;
      }

      if (FLAG_DRY_RUN) {
        log(`  [DRY RUN] Would fetch: ${entry.reference} — ${entry.title}`);
        totalSkipped++;
        continue;
      }

      let detailHtml: string;
      try {
        detailHtml = await fetchPage(entry.url);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        error(`Failed to fetch publication ${entry.reference}: ${msg}`);
        totalErrors++;
        continue;
      }

      const parsed = parseActualitesDetail(detailHtml, entry.reference);

      // Use listing date as fallback
      if (!parsed.date && entry.date) {
        parsed.date = entry.date;
      }

      const ok = insertGuidance(db, parsed);
      if (ok) {
        totalInserted++;
      } else {
        totalErrors++;
      }
    }

    if (!hasNextPage) {
      log(`No more publication pages after page ${page}`);
      break;
    }

    page = nextPage ?? page + 1;
  }

  log(`Publications: inserted=${totalInserted}, skipped=${totalSkipped}, errors=${totalErrors}`);
  return { inserted: totalInserted, skipped: totalSkipped, errors: totalErrors };
}

// ---------------------------------------------------------------------------
// Framework auto-population
// ---------------------------------------------------------------------------

/**
 * Insert or update framework entries based on the guidance documents
 * collected. Counts documents per series and creates framework rows.
 */
function updateFrameworks(db: Database.Database): void {
  log("\n=== Updating frameworks ===");

  const FRAMEWORK_DEFS: {
    id: string;
    name: string;
    name_en: string;
    description: string;
  }[] = [
    {
      id: "pgssi-s",
      name: "PGSSI-S - Politique Generale de Securite des Systemes d'Information de Sante",
      name_en: "General Security Policy for Health Information Systems",
      description:
        "La PGSSI-S definit le cadre de securite applicable aux systemes d'information de sante en France. Elle couvre l'identification des acteurs, la politique de securite, la gestion des risques et les exigences techniques pour la protection des donnees de sante.",
    },
    {
      id: "rgs",
      name: "Referentiel General de Securite (RGS)",
      name_en: "General Security Reference Framework",
      description:
        "Le Referentiel General de Securite (RGS) fixe les regles auxquelles doivent se conformer les fonctions et produits de securite des systemes d'information des autorites administratives.",
    },
    {
      id: "secnumcloud",
      name: "SecNumCloud",
      name_en: "SecNumCloud",
      description:
        "SecNumCloud est le referentiel de qualification des prestataires de services d'informatique en nuage (cloud) de l'ANSSI. Il definit un ensemble d'exigences techniques et organisationnelles.",
    },
    {
      id: "cert-fr-cti",
      name: "CERT-FR Threat Intelligence",
      name_en: "CERT-FR Cyber Threat Intelligence Reports",
      description:
        "Rapports de renseignement sur les cybermenaces publies par le CERT-FR. Couvre les analyses de menace, les modes operatoires des attaquants, et les panoramas de la cybermenace.",
    },
    {
      id: "cert-fr-dur",
      name: "CERT-FR Recommandations de durcissement",
      name_en: "CERT-FR Hardening Recommendations",
      description:
        "Recommandations de durcissement et de securisation publiees par le CERT-FR. Couvre Active Directory, les systemes industriels, les terminaux mobiles, et les bonnes pratiques sectorielles.",
    },
    {
      id: "anssi-guides",
      name: "Guides ANSSI",
      name_en: "ANSSI Guidance",
      description:
        "Guides de bonnes pratiques et de securisation publies par l'ANSSI. Couvre l'hygiene informatique, la securite du cloud, les systemes industriels, et la conformite reglementaire.",
    },
    {
      id: "nis2",
      name: "NIS 2",
      name_en: "NIS 2 Directive",
      description:
        "Publications de l'ANSSI relatives a la transposition et mise en oeuvre de la directive NIS 2 en France. Couvre les obligations des entites essentielles et importantes.",
    },
    {
      id: "panorama",
      name: "Panorama de la cybermenace",
      name_en: "Cyber Threat Landscape Reports",
      description:
        "Rapports annuels de l'ANSSI sur l'etat de la menace cyber en France. Analyse des tendances, des secteurs cibles et des modes operatoires des attaquants.",
    },
  ];

  // Map series names to framework IDs
  const seriesToFramework: Record<string, string> = {
    "PGSSI-S": "pgssi-s",
    RGS: "rgs",
    SecNumCloud: "secnumcloud",
    "CERT-FR CTI": "cert-fr-cti",
    "CERT-FR Recommandations": "cert-fr-dur",
    ANSSI: "anssi-guides",
    NIS2: "nis2",
    "Panorama de la cybermenace": "panorama",
    Remediation: "anssi-guides",
  };

  // Count documents per series
  const seriesCounts = db
    .prepare("SELECT series, COUNT(*) as cnt FROM guidance GROUP BY series")
    .all() as { series: string; cnt: number }[];

  const countByFramework = new Map<string, number>();
  for (const row of seriesCounts) {
    const fwId = seriesToFramework[row.series];
    if (fwId) {
      countByFramework.set(
        fwId,
        (countByFramework.get(fwId) ?? 0) + row.cnt,
      );
    }
  }

  const insertFw = db.prepare(
    "INSERT OR REPLACE INTO frameworks (id, name, name_en, description, document_count) VALUES (?, ?, ?, ?, ?)",
  );

  const txn = db.transaction(() => {
    for (const fw of FRAMEWORK_DEFS) {
      const count = countByFramework.get(fw.id) ?? 0;
      if (count > 0 || fw.id === "pgssi-s" || fw.id === "rgs" || fw.id === "secnumcloud") {
        insertFw.run(fw.id, fw.name, fw.name_en, fw.description, count);
        log(`  Framework ${fw.id}: ${count} documents`);
      }
    }
  });

  txn();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log("ANSSI Ingestion Crawler");
  log(`  Resume: ${FLAG_RESUME}`);
  log(`  Dry run: ${FLAG_DRY_RUN}`);
  log(`  Force rebuild: ${FLAG_FORCE}`);
  log(`  Max pages per source: ${MAX_PAGES}`);
  log(`  Rate limit: ${RATE_LIMIT_MS}ms between requests`);
  log("");

  const db = FLAG_DRY_RUN ? openDryRunDb() : openDatabase();

  const stats = {
    advisories: { inserted: 0, skipped: 0, errors: 0 },
    guidance: { inserted: 0, skipped: 0, errors: 0 },
  };

  // 1. Crawl CERT-FR sources (advisories, alerts, CTI, hardening)
  for (const source of CERTFR_SOURCES) {
    try {
      const result = await crawlCertfrSource(db, source);
      if (source.targetTable === "advisories") {
        stats.advisories.inserted += result.inserted;
        stats.advisories.skipped += result.skipped;
        stats.advisories.errors += result.errors;
      } else {
        stats.guidance.inserted += result.inserted;
        stats.guidance.skipped += result.skipped;
        stats.guidance.errors += result.errors;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      error(`Fatal error crawling ${source.name}: ${msg}`);
    }
  }

  // 2. Crawl cyber.gouv.fr publications
  try {
    const result = await crawlActualites(db);
    stats.guidance.inserted += result.inserted;
    stats.guidance.skipped += result.skipped;
    stats.guidance.errors += result.errors;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`Fatal error crawling publications: ${msg}`);
  }

  // 3. Update frameworks based on collected data
  if (!FLAG_DRY_RUN) {
    updateFrameworks(db);
  }

  // Final summary
  log("\n=== Ingestion complete ===");

  if (!FLAG_DRY_RUN) {
    const guidanceCount = (
      db.prepare("SELECT count(*) as cnt FROM guidance").get() as {
        cnt: number;
      }
    ).cnt;
    const advisoryCount = (
      db.prepare("SELECT count(*) as cnt FROM advisories").get() as {
        cnt: number;
      }
    ).cnt;
    const frameworkCount = (
      db.prepare("SELECT count(*) as cnt FROM frameworks").get() as {
        cnt: number;
      }
    ).cnt;

    log(`\nDatabase summary (${DB_PATH}):`);
    log(`  Frameworks:  ${frameworkCount}`);
    log(`  Guidance:    ${guidanceCount} (inserted this run: ${stats.guidance.inserted})`);
    log(`  Advisories:  ${advisoryCount} (inserted this run: ${stats.advisories.inserted})`);
    log(`  Skipped:     ${stats.guidance.skipped + stats.advisories.skipped}`);
    log(`  Errors:      ${stats.guidance.errors + stats.advisories.errors}`);
  } else {
    log(`\n[DRY RUN] No data written`);
    log(`  Guidance entries found:  ${stats.guidance.skipped}`);
    log(`  Advisory entries found:  ${stats.advisories.skipped}`);
  }

  db.close();
  log("Done.");
}

/**
 * In dry-run mode, create an in-memory DB so we can still use
 * referenceExists() and the schema without writing to disk.
 */
function openDryRunDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  log("[DRY RUN] Using in-memory database");
  return db;
}

main().catch((err: unknown) => {
  error(`Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
