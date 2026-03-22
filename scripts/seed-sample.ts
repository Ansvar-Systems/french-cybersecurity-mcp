/**
 * Seed the ANSSI database with sample guidance documents, advisories, and
 * frameworks for testing.
 *
 * Usage:
 *   npx tsx scripts/seed-sample.ts
 *   npx tsx scripts/seed-sample.ts --force
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

const DB_PATH = process.env["ANSSI_DB_PATH"] ?? "data/anssi.db";
const force = process.argv.includes("--force");

const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

if (force && existsSync(DB_PATH)) {
  unlinkSync(DB_PATH);
  console.log(`Deleted existing database at ${DB_PATH}`);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(SCHEMA_SQL);

console.log(`Database initialised at ${DB_PATH}`);

// --- Frameworks --------------------------------------------------------------

interface FrameworkRow {
  id: string;
  name: string;
  name_en: string;
  description: string;
  document_count: number;
}

const frameworks: FrameworkRow[] = [
  {
    id: "pgssi-s",
    name: "PGSSI-S - Politique Generale de Securite des Systemes d'Information de Sante",
    name_en: "General Security Policy for Health Information Systems",
    description: "La PGSSI-S definit le cadre de securite applicable aux systemes d'information de sante en France. Elle couvre l'identification des acteurs, la politique de securite, la gestion des risques et les exigences techniques pour la protection des donnees de sante.",
    document_count: 2,
  },
  {
    id: "rgs",
    name: "Referentiel General de Securite (RGS)",
    name_en: "General Security Reference Framework",
    description: "Le Referentiel General de Securite (RGS) fixe les regles auxquelles doivent se conformer les fonctions et produits de securite des systemes d'information des autorites administratives.",
    document_count: 1,
  },
  {
    id: "secnumcloud",
    name: "SecNumCloud",
    name_en: "SecNumCloud",
    description: "SecNumCloud est le referentiel de qualification des prestataires de services d'informatique en nuage (cloud) de l'ANSSI. Il definit un ensemble d'exigences techniques et organisationnelles.",
    document_count: 1,
  },
];

const insertFramework = db.prepare(
  "INSERT OR IGNORE INTO frameworks (id, name, name_en, description, document_count) VALUES (?, ?, ?, ?, ?)",
);

for (const f of frameworks) {
  insertFramework.run(f.id, f.name, f.name_en, f.description, f.document_count);
}

console.log(`Inserted ${frameworks.length} frameworks`);

// --- Guidance ----------------------------------------------------------------

interface GuidanceRow {
  reference: string;
  title: string;
  title_en: string;
  date: string;
  type: string;
  series: string;
  summary: string;
  full_text: string;
  topics: string;
  status: string;
}

const guidance: GuidanceRow[] = [
  {
    reference: "ANSSI-PGSSI-2021",
    title: "PGSSI-S - Guide de gestion des habilitations d'acces au SI des organismes de sante",
    title_en: "PGSSI-S - Access Rights Management Guide for Health IS",
    date: "2021-07-01",
    type: "guidance",
    series: "PGSSI-S",
    summary: "Guide relatif a la gestion des habilitations d'acces aux systemes d'information de sante. Couvre les principes de moindre privilege, la gestion du cycle de vie des comptes, l'authentification forte et la tracabilite des acces.",
    full_text: "La gestion des habilitations est un enjeu majeur de securite pour les systemes d'information de sante. Ce guide de la PGSSI-S definit les principes et les bonnes pratiques pour la gestion des droits d'acces. Principes fondamentaux : (1) Moindre privilege — chaque utilisateur ne doit disposer que des droits strictement necessaires a l'exercice de ses fonctions ; (2) Besoin d'en connaitre — l'acces aux donnees de sante est limite aux personnels ayant un besoin medical ou de soin demontre ; (3) Separation des roles — les roles incompatibles doivent etre separes. Cycle de vie des comptes : La creation, la modification et la suppression des comptes doivent faire l'objet de procedures formalisees. Les comptes doivent etre desactives immediatement lors de la fin de la relation de travail. Authentification forte (a deux facteurs) obligatoire pour l'acces aux donnees de sante a caractere personnel.",
    topics: JSON.stringify(["controle-acces", "habilitations", "donnees-sante", "authentification"]),
    status: "current",
  },
  {
    reference: "ANSSI-RGS-2.0",
    title: "Referentiel General de Securite v2.0",
    title_en: "General Security Reference Framework v2.0",
    date: "2014-07-13",
    type: "framework",
    series: "RGS",
    summary: "Le RGS v2.0 definit les regles de securite applicables aux autorites administratives pour la mise en place de fonctions de securite. Couvre la signature electronique, l'authentification, la confidentialite et l'horodatage avec trois niveaux d'exigences (*,**,***).",
    full_text: "Le Referentiel General de Securite (RGS) est un ensemble de regles auxquelles les systemes d'information des autorites administratives doivent se conformer. Le RGS v2.0 s'articule autour de quatre fonctions de securite : (1) Signature electronique — trois niveaux de qualification (*,**,***). Les certificats doivent etre emis par une Autorite de Certification qualifiee RGS. (2) Authentification — les mecanismes d'authentification sont classes selon leur resistance aux attaques. L'authentification forte (deux facteurs) est requise pour les niveaux ** et ***. (3) Confidentialite — le chiffrement doit respecter les algorithmes de l'Annexe B1 du RGS. (4) Horodatage — les services d'horodatage doivent etre qualifies par l'ANSSI. La qualification RGS est delivree par l'ANSSI a l'issue d'une evaluation par un Centre d'Evaluation (CESTI).",
    topics: JSON.stringify(["signature-electronique", "authentification", "qualification", "administration-publique"]),
    status: "current",
  },
  {
    reference: "ANSSI-SecNumCloud-3.2",
    title: "Referentiel SecNumCloud v3.2",
    title_en: "SecNumCloud Reference Framework v3.2",
    date: "2022-04-26",
    type: "framework",
    series: "SecNumCloud",
    summary: "Le referentiel SecNumCloud v3.2 definit les exigences pour les prestataires de services cloud souhaitant obtenir la qualification ANSSI. Introduit des exigences de souverainete numerique et de resistance aux lois extraterritoriales.",
    full_text: "Le referentiel SecNumCloud v3.2 introduit des exigences renforcees pour garantir la souverainete des donnees. Principales exigences : (1) Immunite aux lois extraterritoriales — les prestataires et leurs sous-traitants ne doivent pas etre soumis a des legislations non europeennes permettant un acces non autorise aux donnees ; (2) Localisation des donnees — les donnees et metadonnees doivent etre hebergees exclusivement dans l'Union Europeenne ; (3) Securite des infrastructures — exigences renforcees en matiere de securite physique et de cloisonnement multi-tenant ; (4) Gestion des acces — controle strict des acces des employes du prestataire aux donnees clients, avec journalisation complete ; (5) Continuite d'activite — capacite demontree a maintenir la disponibilite des services. Les services qualifies SecNumCloud sont recommandes pour les systemes d'information de l'Etat et des Operateurs d'Importance Vitale (OIV).",
    topics: JSON.stringify(["cloud", "souverainete-numerique", "qualification", "donnees", "OIV"]),
    status: "current",
  },
  {
    reference: "ANSSI-HYGIENE-2017",
    title: "Guide d'hygiene informatique - Renforcer la securite du SI",
    title_en: "IT Hygiene Guide - Strengthening IS Security",
    date: "2017-01-01",
    type: "guidance",
    series: "ANSSI",
    summary: "Le guide d'hygiene informatique de l'ANSSI presente 42 regles fondamentales pour securiser un systeme d'information. Couvre la gestion des comptes, les mises a jour, la sauvegarde, la securite reseau et la sensibilisation.",
    full_text: "Le guide d'hygiene informatique de l'ANSSI regroupe 42 mesures de securite fondamentales organisees en dix themes : (1) Connaitre le systeme d'information ; (2) Maitriser le reseau — cartographier, filtrer les flux, pare-feux ; (3) Mettre a jour les logiciels — appliquer les correctifs de securite en priorite pour les logiciels exposes ; (4) Authentifier les utilisateurs — mots de passe robustes, double facteur pour les acces sensibles ; (5) Securiser les postes de travail — antivirus, chiffrement des postes nomades ; (6) Securiser les serveurs — renforcer la configuration, limiter les services actifs ; (7) Securiser les acces distants — VPN avec authentification forte ; (8) Sauvegarder les donnees — sauvegardes regulieres, tests de restauration, copies hors site ; (9) Surveiller les systemes — journalisation centralisee, detection des comportements anormaux ; (10) Sensibiliser les utilisateurs — formation reguliere aux risques cyber.",
    topics: JSON.stringify(["hygiene-informatique", "bonnes-pratiques", "sensibilisation"]),
    status: "current",
  },
  {
    reference: "ANSSI-NIS2-2023",
    title: "NIS 2 - Guide de mise en conformite pour les entites essentielles et importantes",
    title_en: "NIS2 Compliance Guide for Essential and Important Entities",
    date: "2023-10-17",
    type: "guidance",
    series: "ANSSI",
    summary: "Guide de l'ANSSI pour la conformite avec la directive NIS 2. Couvre les obligations des entites essentielles (EE) et importantes (EI), les mesures de securite requises, et les obligations de notification d'incidents.",
    full_text: "La directive NIS 2 distingue les Entites Essentielles (EE) des Entites Importantes (EI). Secteurs hautement critiques (EE) : energie, transports, banque, sante, eau, infrastructures numeriques, administration publique, espace. Mesures de securite requises : politique de securite des SI, gestion des incidents, continuite des activites, securite de la chaine d'approvisionnement, controle d'acces, cryptographie, securite RH, gestion des vulnerabilites. Notification d'incidents : alerter l'ANSSI dans les 24 heures (alerte precoce) et 72 heures (notification initiale). Rapport final dans le mois suivant l'incident. Sanctions : amendes jusqu'a 10 millions d'euros ou 2% du chiffre d'affaires mondial pour les EE.",
    topics: JSON.stringify(["NIS2", "conformite", "entites-essentielles", "notification-incidents"]),
    status: "current",
  },
  {
    reference: "ANSSI-GUIDES-CISO-2023",
    title: "La securite numerique, une priorite pour le dirigeant",
    title_en: "Digital Security — A Priority for Business Leaders",
    date: "2023-06-01",
    type: "board",
    series: "ANSSI",
    summary: "Guide de l'ANSSI destine aux dirigeants d'entreprise sur le role de la direction dans la cybersecurite. Couvre la gouvernance, le budget, la responsabilite et la gestion des crises cyber.",
    full_text: "Ce guide s'adresse aux dirigeants d'entreprises et d'administrations et leur explique leur role dans la cybersecurite. Points cles : (1) La cybersecurite est une responsabilite de la direction — le risque cyber doit etre integre dans la strategie de l'organisation ; (2) Budget dedie — allouer un budget suffisant a la cybersecurite, proportionnel aux risques ; (3) Responsabilite claire — designer un responsable de la securite des SI (RSSI) avec un rattachement hierarchique adequat ; (4) Gestion de crise — preparer et tester un plan de reponse aux incidents cyber ; (5) Chaine d'approvisionnement — exiger des garanties de securite de la part des fournisseurs critiques. En cas d'incident majeur, l'ANSSI peut etre sollicitee pour appuyer la reponse.",
    topics: JSON.stringify(["gouvernance", "direction", "RSSI", "budget", "risque-cyber"]),
    status: "current",
  },
];

const insertGuidance = db.prepare(`
  INSERT OR IGNORE INTO guidance
    (reference, title, title_en, date, type, series, summary, full_text, topics, status)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertGuidanceAll = db.transaction(() => {
  for (const g of guidance) {
    insertGuidance.run(
      g.reference, g.title, g.title_en, g.date, g.type,
      g.series, g.summary, g.full_text, g.topics, g.status,
    );
  }
});

insertGuidanceAll();
console.log(`Inserted ${guidance.length} guidance documents`);

// --- Advisories --------------------------------------------------------------

interface AdvisoryRow {
  reference: string;
  title: string;
  date: string;
  severity: string;
  affected_products: string;
  summary: string;
  full_text: string;
  cve_references: string;
}

const advisories: AdvisoryRow[] = [
  {
    reference: "ANSSI-ADV-2024-001",
    title: "Campagne d'attaques par rancongiciel ciblant les etablissements de sante",
    date: "2024-02-08",
    severity: "critical",
    affected_products: JSON.stringify(["Windows", "VPN Cisco", "Citrix ADC"]),
    summary: "L'ANSSI alerte sur une recrudescence d'attaques par rancongiciel ciblant les etablissements de sante francais. Les attaquants exploitent des vulnerabilites dans les solutions VPN non patchees pour obtenir un acces initial.",
    full_text: "L'ANSSI et le CERT-FR constatent une recrudescence des attaques par rancongiciel visant les etablissements de sante. Mode operatoire : exploitation de vulnerabilites dans les solutions d'acces distant (VPN Cisco, Citrix ADC), hameconnage, utilisation de credentials voles. Rancongiciels identifies : LockBit 3.0, ALPHV/BlackCat, Rhysida. Recommandations : appliquer immediatement les correctifs de securite, activer l'authentification multi-facteurs, segmenter le reseau, verifier les sauvegardes. En cas d'incident, contacter le CERT-FR et ne pas payer la rancon.",
    cve_references: JSON.stringify(["CVE-2023-20269", "CVE-2023-4966", "CVE-2024-21762"]),
  },
  {
    reference: "ANSSI-ADV-2023-022",
    title: "Compromission de la chaine d'approvisionnement logicielle 3CX",
    date: "2023-03-30",
    severity: "critical",
    affected_products: JSON.stringify(["3CX Desktop App Windows", "3CX Desktop App macOS"]),
    summary: "Alerte relative a la compromission de la chaine d'approvisionnement du logiciel 3CX. L'application a ete trojanisee par le groupe Lazarus (Coree du Nord) et distribue un implant malveillant permettant l'exfiltration de donnees.",
    full_text: "Le CERT-FR alerte sur la compromission de la chaine d'approvisionnement de 3CX. Versions affectees : Windows v18.12.407 et v18.12.416, macOS v18.11.1213 et v18.12.402. Comportement malveillant : les versions trojanisees contiennent des bibliotheques DLL malveillantes (ffmpeg.dll et d3dcompiler_47.dll sur Windows) qui telechargent un payload chiffre depuis GitHub. Ce payload installe un backdoor permettant l'exfiltration de donnees. Actions immediates : desinstaller les versions affectees, utiliser la version PWA, analyser les systemes pour detecter des indicateurs de compromission.",
    cve_references: JSON.stringify(["CVE-2023-29059"]),
  },
  {
    reference: "ANSSI-ADV-2024-007",
    title: "Vulnerabilites critiques dans Fortinet FortiOS - Exploitation active",
    date: "2024-02-13",
    severity: "critical",
    affected_products: JSON.stringify(["Fortinet FortiOS", "Fortinet FortiProxy"]),
    summary: "Alerte du CERT-FR sur des vulnerabilites critiques dans Fortinet FortiOS et FortiProxy en cours d'exploitation active. CVE-2024-21762 permet une execution de code a distance sans authentification.",
    full_text: "CVE-2024-21762 (CVSS 9.6) est une vulnerabilite d'ecriture hors limites dans le daemon SSL-VPN de FortiOS permettant a un attaquant distant non authentifie d'executer du code arbitraire. Fortinet a confirme l'exploitation active dans des environnements en production. Versions affectees : FortiOS 7.4.0-7.4.2 (corrige en 7.4.3), FortiOS 7.2.0-7.2.6 (corrige en 7.2.7), FortiOS 7.0.0-7.0.13 (corrige en 7.0.14). Mesures correctives : appliquer les mises a jour immediatement ou desactiver SSL-VPN. Declarer tout incident a l'ANSSI via cert-fr@ssi.gouv.fr.",
    cve_references: JSON.stringify(["CVE-2024-21762", "CVE-2024-23108", "CVE-2024-23109"]),
  },
];

const insertAdvisory = db.prepare(`
  INSERT OR IGNORE INTO advisories
    (reference, title, date, severity, affected_products, summary, full_text, cve_references)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertAdvisoriesAll = db.transaction(() => {
  for (const a of advisories) {
    insertAdvisory.run(
      a.reference, a.title, a.date, a.severity,
      a.affected_products, a.summary, a.full_text, a.cve_references,
    );
  }
});

insertAdvisoriesAll();
console.log(`Inserted ${advisories.length} advisories`);

const guidanceCount = (db.prepare("SELECT count(*) as cnt FROM guidance").get() as { cnt: number }).cnt;
const advisoryCount = (db.prepare("SELECT count(*) as cnt FROM advisories").get() as { cnt: number }).cnt;
const frameworkCount = (db.prepare("SELECT count(*) as cnt FROM frameworks").get() as { cnt: number }).cnt;

console.log(`\nDatabase summary:`);
console.log(`  Frameworks:  ${frameworkCount}`);
console.log(`  Guidance:    ${guidanceCount}`);
console.log(`  Advisories:  ${advisoryCount}`);
console.log(`\nDone. Database ready at ${DB_PATH}`);

db.close();
