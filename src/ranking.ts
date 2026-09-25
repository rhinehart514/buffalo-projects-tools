import type { CandidatePassport } from "./candidate.js";
import { passportEvidenceText, verifyQuotedMatches, type QuotedMatch } from "./fit.js";
import { containsTerm } from "./grounding.js";
import type { JobSector, JobWorkMode, LiveJob } from "./jobs.js";

export interface JobRankingPreferences {
  preferredWorkModes?: JobWorkMode[] | undefined;
  preferredSectors?: JobSector[] | undefined;
  preferredLocations?: string[] | undefined;
  requiredWords?: string[] | undefined;
  avoidWords?: string[] | undefined;
  excludeEmployers?: string[] | undefined;
  minAnnualPay?: number | undefined;
  limit?: number | undefined;
}

const ignored = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "or",
  "role",
  "the",
  "to",
  "with",
]);

function tokens(value: string): string[] {
  return [
    ...new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9+#.]+/gu)
        .filter((token) => token.length >= 2 && !ignored.has(token)),
    ),
  ];
}

function normalizedList(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean);
}

type StatementKind = "desired role" | "skill" | "evidence";

/** Score per distinct matched word; evidence claims explain but do not score. */
const statementWeights: Record<StatementKind, number> = {
  "desired role": 12,
  skill: 4,
  evidence: 0,
};

export interface EvidenceMatch extends QuotedMatch {
  kind: StatementKind;
  term: string;
  claimKey: string | null;
  jobField: string;
}

interface CandidateStatement {
  text: string;
  claimKey: string | null;
  kind: StatementKind;
}

function jobFields(job: LiveJob): Array<[string, string]> {
  return [
    ["title", job.title],
    ["employer", job.employer],
    ["location", job.location],
    ["sector", job.department],
    ["work mode", job.workplace],
    ["employment type", job.commitment],
  ];
}

/**
 * Pairs each candidate statement with the listing field that shares a word
 * with it. Both sides are quoted verbatim so the pairing can be checked.
 */
function evidenceMatches(statements: CandidateStatement[], job: LiveJob): EvidenceMatch[] {
  const fields = jobFields(job);
  const matches: EvidenceMatch[] = [];
  for (const statement of statements) {
    const searchable = statement.kind === "desired role" ? fields.slice(0, 1) : fields;
    for (const term of tokens(statement.text)) {
      const field = searchable.find(([, value]) => containsTerm(value, term));
      if (!field) continue;
      matches.push({
        claim: `${statement.kind} matches the job ${field[0]}: ${term}`,
        kind: statement.kind,
        term,
        claimKey: statement.claimKey,
        candidateQuote: statement.text,
        jobField: field[0],
        jobQuote: field[1],
      });
    }
  }
  return matches;
}

export function rankJobs(
  passport: CandidatePassport,
  jobs: LiveJob[],
  preferences: JobRankingPreferences = {},
) {
  const evidenceClaims = passport.claims.filter(
    (claim) =>
      claim.source === "user-confirmed" ||
      claim.source === "resume-evidence" ||
      claim.source === "project-evidence",
  );
  const statements: CandidateStatement[] = [
    ...(passport.candidate.desiredRoles ?? []).map((text) => ({
      text,
      claimKey: null,
      kind: "desired role" as const,
    })),
    ...(passport.candidate.skills ?? []).map((text) => ({
      text,
      claimKey: null,
      kind: "skill" as const,
    })),
    // Contact, authorization, and pay claims are not fit evidence; a name
    // like "Example Candidate" would otherwise "match" employer "Example Co".
    ...evidenceClaims
      .filter((claim) => claim.sensitivity === "ordinary")
      .map((claim) => ({ text: claim.value, claimKey: claim.key, kind: "evidence" as const })),
  ].filter((statement) => statement.text.trim());
  const candidateSource = [
    ...(passport.candidate.desiredRoles ?? []),
    ...(passport.candidate.skills ?? []),
    passportEvidenceText(passport),
  ].join("\n");
  const required = normalizedList(preferences.requiredWords);
  const avoided = normalizedList(preferences.avoidWords);
  const excludedEmployers = normalizedList(preferences.excludeEmployers);
  const preferredLocations = normalizedList(preferences.preferredLocations);

  const scored = jobs.map((job) => {
    const listingText = jobFields(job)
      .map(([, value]) => value)
      .join("\n");
    const searchable = listingText.toLowerCase();
    const verification = verifyQuotedMatches(evidenceMatches(statements, job), {
      candidate: candidateSource,
      job: listingText,
    });
    const preferenceReasons: string[] = [];
    const caveats: string[] = [];
    const blockers: string[] = [];
    let score = 0;

    const scoredTerms = new Set<string>();
    for (const match of verification.verified) {
      const key = `${match.kind}:${match.term}`;
      if (scoredTerms.has(key)) continue;
      scoredTerms.add(key);
      score += statementWeights[match.kind];
    }
    if (preferences.preferredWorkModes?.includes(job.workplace)) {
      score += 6;
      preferenceReasons.push(`preferred work mode: ${job.workplace}`);
    }
    if (preferences.preferredSectors?.includes(job.department)) {
      score += 5;
      preferenceReasons.push(`preferred sector: ${job.department}`);
    }
    if (
      preferredLocations.some((location) => job.location.toLowerCase().includes(location))
    ) {
      score += 5;
      preferenceReasons.push(`preferred location: ${job.location}`);
    }
    for (const word of required) {
      if (!searchable.includes(word)) blockers.push(`required term not observed: ${word}`);
      else score += 3;
    }
    for (const word of avoided) {
      if (searchable.includes(word)) blockers.push(`excluded term observed: ${word}`);
    }
    if (excludedEmployers.includes(job.employer.toLowerCase())) {
      blockers.push(`excluded employer: ${job.employer}`);
    }
    if (typeof preferences.minAnnualPay === "number") {
      const floor = job.compensation.annualMin;
      if (typeof floor === "number") {
        if (floor < preferences.minAnnualPay) {
          blockers.push(`annual pay floor ${floor} is below preference`);
        } else {
          score += 4;
          preferenceReasons.push(`annual pay floor meets preference: ${floor}`);
        }
      } else {
        caveats.push("annual pay is not confirmed in the index");
      }
    }
    if (job.freshness !== "current") caveats.push(`freshness is ${job.freshness}`);
    if (job.employmentType === "unknown") caveats.push("employment type is not confirmed");

    return {
      job,
      score,
      status: blockers.length > 0 ? ("excluded" as const) : ("candidate" as const),
      evidenceMatches: verification.verified.slice(0, 12),
      droppedMatchCount: verification.droppedCount,
      preferenceReasons,
      caveats: [...new Set(caveats)],
      blockers,
    };
  });

  const limit = Math.min(Math.max(preferences.limit ?? 5, 1), 10);
  const ranked = scored
    .filter((item) => item.status === "candidate")
    .sort(
      (left, right) =>
        right.score - left.score ||
        (right.job.publishedAt ?? "").localeCompare(left.job.publishedAt ?? ""),
    )
    .slice(0, limit)
    .map((item, index) => ({ rank: index + 1, ...item }));

  return {
    status: "preliminary-metadata-ranking" as const,
    notice:
      "This ranking uses Buffalo Projects listing metadata and applicant evidence, not a hiring or eligibility decision. Each evidence match quotes the candidate's passport and the listing; code checked both quotes. Inspect each live job description and use buffalo.verify_job_fit before claiming fit or applying.",
    ranked,
    excluded: scored
      .filter((item) => item.status === "excluded")
      .map((item) => ({ job: item.job, blockers: item.blockers })),
    next:
      "Open the live descriptions for the ranked jobs, verify every fit claim with buffalo.verify_job_fit, let the applicant remove roles, then prepare no more than the selected applications.",
  };
}
