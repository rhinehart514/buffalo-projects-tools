// "Why you match" claims. Each one quotes the candidate's own resume or
// passport and the job's own text; code checks both quotes exist before the
// claim can be shown. Everything here runs locally on text the host already
// holds. Nothing is fetched or sent anywhere.

import type { CandidatePassport } from "./candidate.js";
import type { LiveJob } from "./jobs.js";
import { containsTerm, isQuoted } from "./grounding.js";

export interface QuotedMatch {
  claim: string;
  /** Exact text from the candidate's resume or passport. */
  candidateQuote: string;
  /** Exact text from the job description or listing. */
  jobQuote: string;
  /** When set, this word or phrase must appear in both quotes. */
  term?: string | undefined;
}

export interface DroppedMatch {
  index: number;
  reasons: string[];
}

export interface MatchVerification<T extends QuotedMatch> {
  verified: T[];
  droppedCount: number;
  dropped: DroppedMatch[];
}

const evidenceSources = new Set(["user-confirmed", "resume-evidence", "project-evidence"]);

/** Passport text a claim may quote: evidence-backed claim values only. */
export function passportEvidenceText(passport: CandidatePassport): string {
  return passport.claims
    .filter((claim) => evidenceSources.has(claim.source))
    .map((claim) => claim.value)
    .join("\n");
}

/** Job text a claim may quote: the listing fields plus the live description. */
export function jobSourceText(job: LiveJob, description = ""): string {
  return [job.title, job.employer, job.location, description].join("\n");
}

/**
 * Keeps a match only when both quotes are in their sources (after folding
 * whitespace, typography, and case) and any stated term is in both quotes.
 * Dropped matches are reported by index and reason, never by content.
 */
export function verifyQuotedMatches<T extends QuotedMatch>(
  matches: T[],
  sources: { candidate: string; job: string },
): MatchVerification<T> {
  const verified: T[] = [];
  const dropped: DroppedMatch[] = [];
  matches.forEach((match, index) => {
    const reasons = [
      ...(!match.claim.trim() ? ["claim is empty"] : []),
      ...(!isQuoted(match.candidateQuote, sources.candidate)
        ? ["candidateQuote is not in the candidate's resume or passport"]
        : []),
      ...(!isQuoted(match.jobQuote, sources.job)
        ? ["jobQuote is not in the job description or listing"]
        : []),
      ...(match.term !== undefined &&
      !(containsTerm(match.candidateQuote, match.term) && containsTerm(match.jobQuote, match.term))
        ? [`term "${match.term}" is not in both quotes`]
        : []),
    ];
    if (reasons.length > 0) dropped.push({ index, reasons });
    else verified.push(match);
  });
  return { verified, droppedCount: dropped.length, dropped };
}

export function verifyJobFit(input: {
  passport?: CandidatePassport | undefined;
  resumeText?: string | undefined;
  job: LiveJob;
  jobDescriptionText: string;
  matches: QuotedMatch[];
}) {
  const candidate = [
    input.resumeText ?? "",
    input.passport ? passportEvidenceText(input.passport) : "",
  ].join("\n");
  const result = verifyQuotedMatches(input.matches, {
    candidate,
    job: jobSourceText(input.job, input.jobDescriptionText),
  });
  return {
    version: "buffalo-job-fit/v1",
    job: {
      id: input.job.id,
      employer: input.job.employer,
      title: input.job.title,
      officialJobUrl: input.job.officialJobUrl,
    },
    verifiedMatches: result.verified,
    proposedCount: input.matches.length,
    droppedCount: result.droppedCount,
    dropped: result.dropped,
    instruction:
      "Explain fit using only verifiedMatches, showing both quotes. Do not show or restate dropped matches; fix a dropped match only by quoting the exact resume/passport and job text, then verify again.",
  };
}
