// Reads each catalog entry's official page and reports where the catalog
// no longer matches it. Every finding carries the page text that states it;
// findings whose text is not on the page are dropped and counted.

import { parse as parseHtml } from "node-html-parser";
import { PDFParse } from "pdf-parse";
import type { AvailabilityStatus, Opportunity } from "./catalog.js";
import {
  catalogVerificationReportSchema,
  type CatalogDrift,
  type CatalogEvidence,
  type CatalogVerificationEntry,
  type CatalogVerificationReport,
  type PageCheck,
} from "./catalog-evidence.js";
import { isQuoted, normalizeForQuote } from "./grounding.js";

type Fetcher = typeof fetch;

// ── Page text ──────────────────────────────────────────────────────────────

const removedSelectors =
  "script, style, noscript, template, svg, iframe, select, nav, header, footer";

export function htmlToText(html: string): string {
  // The parser keeps doctype and XML prolog declarations as text nodes.
  const root = parseHtml(html.replace(/<!doctype[^>]*>|<\?xml[^>]*\?>/giu, ""));
  for (const element of root.querySelectorAll(removedSelectors)) element.remove();
  return (root.querySelector("body") ?? root).structuredText;
}

async function pdfToText(data: Uint8Array): Promise<string> {
  const parser = new PDFParse({
    data,
    isEvalSupported: false,
    useWasm: false,
    stopAtErrors: false,
    maxImageSize: 0,
  });
  try {
    return (await parser.getText({ first: 20 })).text;
  } finally {
    await parser.destroy();
  }
}

export interface FetchedPage {
  url: string;
  finalUrl: string | null;
  httpStatus: number | null;
  ok: boolean;
  text: string;
  error: string | null;
}

export async function fetchPageText(url: string, fetcher: Fetcher = fetch): Promise<FetchedPage> {
  try {
    const response = await fetcher(url, {
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
        "user-agent":
          "buffalo-projects-tools catalog verifier (+https://github.com/rhinehart514/buffalo-projects-tools)",
      },
      signal: AbortSignal.timeout(20_000),
    });
    const finalUrl = response.url || url;
    if (!response.ok) {
      return { url, finalUrl, httpStatus: response.status, ok: false, text: "", error: null };
    }
    const isPdf =
      (response.headers.get("content-type") ?? "").includes("application/pdf") ||
      new URL(finalUrl).pathname.toLowerCase().endsWith(".pdf");
    const text = isPdf
      ? await pdfToText(new Uint8Array(await response.arrayBuffer()))
      : htmlToText(await response.text());
    return { url, finalUrl, httpStatus: response.status, ok: true, text, error: null };
  } catch (error) {
    return {
      url,
      finalUrl: null,
      httpStatus: null,
      ok: false,
      text: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ── Dates ──────────────────────────────────────────────────────────────────

const monthPattern =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export interface StatedDate {
  /** `YYYY-MM-DD`, or `--MM-DD` when the text does not state a year. */
  value: string;
  index: number;
  length: number;
}

function statedDate(year: number | null, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const monthDay = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return year === null ? `--${monthDay}` : `${year}-${monthDay}`;
}

/** Dates written in `text`. Code never adds a year the text does not state. */
export function statedDates(text: string): StatedDate[] {
  const found: StatedDate[] = [];
  const named = new RegExp(
    `\\b${monthPattern}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?`,
    "giu",
  );
  for (const match of text.matchAll(named)) {
    const month = months.indexOf(match[1]!.slice(0, 3).toLowerCase()) + 1;
    const value = statedDate(match[3] ? Number(match[3]) : null, month, Number(match[2]));
    if (value) found.push({ value, index: match.index, length: match[0].length });
  }
  for (const match of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/gu)) {
    const year = match[3]!.length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    const value = statedDate(year, Number(match[1]), Number(match[2]));
    if (value) found.push({ value, index: match.index, length: match[0].length });
  }
  return found.sort((left, right) => left.index - right.index);
}

// ── Extraction ─────────────────────────────────────────────────────────────

export interface Finding<T extends string> {
  value: T;
  quote: string;
}

export interface AvailabilityExtraction {
  status: Finding<AvailabilityStatus>[];
  deadlines: Finding<string>[];
  cohortDates: Finding<string>[];
}

/**
 * Anything that reads a page and proposes findings. The default is the
 * deterministic pattern reader below. A model-backed reader implements the
 * same interface; its output passes through the same `groundExtraction`.
 */
export interface AvailabilityExtractor {
  name: string;
  extract(page: { url: string; text: string }): Promise<AvailabilityExtraction>;
}

const statusPatterns: Array<[AvailabilityStatus, RegExp]> = [
  [
    "closed",
    /\b(?:applications? (?:are|is) (?:now |currently )?closed|no longer (?:accepting|available)|not (?:currently )?accepting|(?:is|are) (?:currently |now )?closed|closed for (?:applications|the season|\d{4})|(?:application|intake) (?:period|window) (?:has )?(?:closed|ended)|program has (?:ended|closed)|applications? (?:have )?closed)\b/iu,
  ],
  [
    "rolling",
    /\b(?:(?:on a )?rolling basis|rolling (?:admissions?|applications?|intake)|year[- ]round|(?:at )?any time of (?:the )?year|accepted (?:at )?any ?time)\b/iu,
  ],
  [
    "open",
    /(?<!\b(?:when|once|until|before|after) )\b(?:applications? (?:are|is) (?:now )?open|now accepting|currently accepting|accepting applications|applications? (?:now )?open (?:until|through|now))\b/iu,
  ],
];

const deadlinePattern =
  /\b(?:deadline|due|closes?|closing date|no later than|apply by|submit(?:ted)? by|received by)\b/iu;
const cohortPattern =
  /\b(?:cohort|kick-?off|program (?:begins|starts|runs|launches)|sessions? (?:begins?|starts?))\b/iu;

/** Lines, then sentences. Each segment is an exact substring of `text`. */
function segments(text: string): string[] {
  return text
    .split(/\n+/u)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9])/u))
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/** A readable window of `segment` covering [start, end). Still a substring. */
function window(segment: string, start: number, end: number): string {
  if (segment.length <= 300) return segment;
  let from = Math.max(0, start - 80);
  let to = Math.min(segment.length, end + 80);
  while (from > 0 && /\S/u.test(segment[from - 1]!)) from -= 1;
  while (to < segment.length && /\S/u.test(segment[to]!)) to += 1;
  return segment.slice(from, to).trim();
}

function dedupe<T extends string>(findings: Finding<T>[]): Finding<T>[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.value}\0${normalizeForQuote(finding.quote)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const patternExtractor: AvailabilityExtractor = {
  name: "pattern/v1",
  async extract({ text }) {
    const status: Finding<AvailabilityStatus>[] = [];
    const deadlines: Finding<string>[] = [];
    const cohortDates: Finding<string>[] = [];
    for (const segment of segments(text)) {
      for (const [value, pattern] of statusPatterns) {
        const match = pattern.exec(segment);
        if (!match) continue;
        status.push({ value, quote: window(segment, match.index, match.index + match[0].length) });
        break;
      }
      const dates = statedDates(segment);
      if (dates.length === 0) continue;
      const deadline = deadlinePattern.exec(segment);
      const cohort = deadline ? null : cohortPattern.exec(segment);
      const keyword = deadline ?? cohort;
      if (!keyword) continue;
      for (const date of dates) {
        const quote = window(
          segment,
          Math.min(keyword.index, date.index),
          Math.max(keyword.index + keyword[0].length, date.index + date.length),
        );
        (deadline ? deadlines : cohortDates).push({ value: date.value, quote });
      }
    }
    return {
      status: dedupe(status),
      deadlines: dedupe(deadlines),
      cohortDates: dedupe(cohortDates),
    };
  },
};

// ── Grounding ──────────────────────────────────────────────────────────────

/** Words a quote must contain before it can support each status. */
const statusVocabulary: Record<AvailabilityStatus, RegExp> = {
  open: /\b(?:open|accepting)\b/iu,
  closed: /\b(?:closed?|no longer|not (?:currently )?accepting|ended|paused|suspended)\b/iu,
  rolling: /\b(?:rolling|year[- ]round|any ?time|ongoing|continuous(?:ly)?)\b/iu,
  unknown: /$^/u,
};

export interface GroundedExtraction {
  accepted: AvailabilityExtraction;
  rejections: string[];
}

/**
 * Keeps a finding only when its quote is on the page and states the value:
 * a status quote must use that status's words, a date quote must write that
 * date, and a deadline quote must also say it is a deadline.
 */
export function groundExtraction(
  extraction: AvailabilityExtraction,
  pageText: string,
): GroundedExtraction {
  const rejections: string[] = [];
  const keep = <T extends string>(
    field: string,
    findings: Finding<T>[],
    states: (finding: Finding<T>) => boolean,
  ) =>
    findings.filter((finding) => {
      if (!isQuoted(finding.quote, pageText)) {
        rejections.push(`${field} ${finding.value}: quote is not on the page: "${finding.quote}"`);
        return false;
      }
      if (!states(finding)) {
        rejections.push(`${field} ${finding.value}: quote does not state it: "${finding.quote}"`);
        return false;
      }
      return true;
    });
  const writesDate = (finding: Finding<string>) =>
    statedDates(finding.quote).some((date) => date.value === finding.value);
  return {
    accepted: {
      status: keep("status", extraction.status, (finding) =>
        statusVocabulary[finding.value].test(finding.quote),
      ),
      deadlines: keep(
        "deadline",
        extraction.deadlines,
        (finding) => writesDate(finding) && deadlinePattern.test(finding.quote),
      ),
      cohortDates: keep("cohort date", extraction.cohortDates, writesDate),
    },
    rejections,
  };
}

// ── Comparison ─────────────────────────────────────────────────────────────

function sameDate(stated: string, catalogDate: string): boolean {
  return stated.startsWith("--") ? catalogDate.endsWith(stated.slice(1)) : stated === catalogDate;
}

function pageProblem(page: FetchedPage): CatalogDrift | null {
  if (page.ok) {
    const moved = (value: string) => {
      const url = new URL(value);
      return `${url.host.toLowerCase()}${url.pathname.replace(/\/+$/u, "")}`;
    };
    return page.finalUrl && moved(page.finalUrl) !== moved(page.url)
      ? { kind: "redirected", url: page.url, detail: `Now redirects to ${page.finalUrl}` }
      : null;
  }
  const status = page.httpStatus;
  if (status === 401 || status === 403) {
    return { kind: "access-denied", url: page.url, detail: `HTTP ${status}` };
  }
  if (status !== null && status >= 400 && status < 500 && status !== 429) {
    return { kind: "dead-link", url: page.url, detail: `HTTP ${status}` };
  }
  if (status === null && /ENOTFOUND|getaddrinfo/u.test(page.error ?? "")) {
    return { kind: "dead-link", url: page.url, detail: page.error ?? "DNS lookup failed" };
  }
  return {
    kind: "unreachable",
    url: page.url,
    detail: status === null ? (page.error ?? "request failed") : `HTTP ${status}`,
  };
}

export function compareToCatalog(
  opportunity: Opportunity,
  accepted: AvailabilityExtraction,
  officialUrl: string,
  checkedOn: string,
) {
  const drift: CatalogDrift[] = [];
  const claimed = opportunity.availability;
  const statuses = [...new Set(accepted.status.map((finding) => finding.value))];
  const status: AvailabilityStatus = statuses.length === 1 ? statuses[0]! : "unknown";
  const quotes = (values: Finding<string>[]) => values.map((item) => `"${item.quote}"`).join("; ");

  if (statuses.length > 1) {
    drift.push({
      kind: "status-conflict",
      url: officialUrl,
      detail: `Page states ${statuses.join(" and ")}: ${quotes(accepted.status)}`,
    });
  } else if (status === "closed" && claimed.status !== "closed") {
    drift.push({ kind: "closed", url: officialUrl, detail: `Page says closed: ${quotes(accepted.status)}` });
  } else if (status !== "unknown" && status !== claimed.status) {
    drift.push({
      kind: "status-changed",
      url: officialUrl,
      detail: `Catalog says ${claimed.status}; page says ${status}: ${quotes(accepted.status)}`,
    });
  }

  const upcoming = accepted.deadlines.filter(
    (finding) => finding.value.startsWith("--") || finding.value >= checkedOn,
  );
  const matching = claimed.deadline
    ? accepted.deadlines.find((finding) => sameDate(finding.value, claimed.deadline!))
    : undefined;
  if (claimed.deadline && claimed.deadline < checkedOn) {
    drift.push({
      kind: "deadline-passed",
      url: officialUrl,
      detail: `Catalog deadline ${claimed.deadline} is before ${checkedOn}`,
    });
  } else if (claimed.deadline && !matching) {
    drift.push({
      kind: "deadline-unconfirmed",
      url: officialUrl,
      detail: `Page no longer states the catalog deadline ${claimed.deadline}`,
    });
  }
  const changed = upcoming.filter(
    (finding) => !claimed.deadline || !sameDate(finding.value, claimed.deadline),
  );
  if (changed.length > 0 && !matching) {
    drift.push({
      kind: "deadline-changed",
      url: officialUrl,
      detail: `Catalog deadline ${claimed.deadline ?? "none"}; page states: ${quotes(changed)}`,
    });
  }

  return {
    observed: { status, deadline: matching?.value ?? upcoming[0]?.value ?? null },
    drift,
  };
}

// ── Whole catalog ──────────────────────────────────────────────────────────

export interface VerifyCatalogOptions {
  fetcher?: Fetcher | undefined;
  extractor?: AvailabilityExtractor | undefined;
  previous?: CatalogVerificationReport | undefined;
  now?: Date | undefined;
}

export interface EntryVerification {
  entry: CatalogVerificationEntry;
  rejections: string[];
}

function pageCheck(role: PageCheck["role"], page: FetchedPage): PageCheck {
  return {
    role,
    url: page.url,
    finalUrl: page.finalUrl,
    httpStatus: page.httpStatus,
    ok: page.ok,
    characterCount: page.text.length,
  };
}

export async function verifyOpportunity(
  opportunity: Opportunity,
  options: VerifyCatalogOptions = {},
): Promise<EntryVerification> {
  const fetcher = options.fetcher ?? fetch;
  const extractor = options.extractor ?? patternExtractor;
  const now = options.now ?? new Date();
  const checkedOn = now.toISOString().slice(0, 10);
  const registrationUrl = opportunity.registration.startUrl;
  const [official, registration] = await Promise.all([
    fetchPageText(opportunity.officialUrl, fetcher),
    registrationUrl === opportunity.officialUrl
      ? Promise.resolve(null)
      : fetchPageText(registrationUrl, fetcher),
  ]);

  const drift: CatalogDrift[] = [];
  for (const page of [official, registration]) {
    const problem = page ? pageProblem(page) : null;
    if (problem) drift.push(problem);
  }

  let observed: CatalogVerificationEntry["observed"] = { status: "unknown", deadline: null };
  let evidence: CatalogEvidence[] = [];
  let rejections: string[] = [];
  if (official.ok) {
    const grounded = groundExtraction(
      await extractor.extract({ url: official.url, text: official.text }),
      official.text,
    );
    rejections = grounded.rejections;
    const comparison = compareToCatalog(opportunity, grounded.accepted, official.url, checkedOn);
    observed = comparison.observed;
    drift.push(...comparison.drift);
    const cite = (field: CatalogEvidence["field"], findings: Finding<string>[]) =>
      findings.map((finding) => ({ field, value: finding.value, quote: finding.quote, url: official.url }));
    evidence = [
      ...cite("status", grounded.accepted.status),
      ...cite("deadline", grounded.accepted.deadlines),
      ...cite("cohort-date", grounded.accepted.cohortDates),
    ];
  }

  const previous = options.previous?.entries.find((item) => item.id === opportunity.id);
  return {
    entry: {
      id: opportunity.id,
      checkedAt: now.toISOString(),
      lastVerified: official.ok && drift.length === 0 ? checkedOn : (previous?.lastVerified ?? null),
      pages: [pageCheck("official", official), ...(registration ? [pageCheck("registration", registration)] : [])],
      observed,
      evidence,
      rejectedFindingCount: rejections.length,
      drift,
    },
    rejections,
  };
}

export async function verifyCatalog(
  catalog: Opportunity[],
  options: VerifyCatalogOptions = {},
) {
  const now = options.now ?? new Date();
  const results = await Promise.all(
    catalog.map((opportunity) => verifyOpportunity(opportunity, { ...options, now })),
  );
  const report = catalogVerificationReportSchema.parse({
    version: "buffalo-catalog-verification/v1",
    generatedAt: now.toISOString(),
    extractor: (options.extractor ?? patternExtractor).name,
    entries: results.map((result) => result.entry),
  });
  return {
    report,
    rejections: results.flatMap((result) =>
      result.rejections.map((message) => `${result.entry.id}: ${message}`),
    ),
  };
}
