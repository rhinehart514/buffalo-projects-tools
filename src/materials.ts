import type { CandidatePassport } from "./candidate.js";
import type { LiveJob } from "./jobs.js";
import type { ResumeEvidence } from "./resume.js";

export interface ProposedMaterialClaim {
  text: string;
  evidenceKeys: string[];
}

function meaningfulLines(value: string): string[] {
  return value
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 2);
}

function materialDiff(original: string, tailored: string) {
  const originalLines = meaningfulLines(original);
  const tailoredLines = meaningfulLines(tailored);
  const originalNormalized = new Set(originalLines.map((line) => line.toLowerCase()));
  const tailoredNormalized = new Set(tailoredLines.map((line) => line.toLowerCase()));
  const addedLines = tailoredLines.filter(
    (line) => !originalNormalized.has(line.toLowerCase()),
  );
  const removedLines = originalLines.filter(
    (line) => !tailoredNormalized.has(line.toLowerCase()),
  );
  return {
    originalLineCount: originalLines.length,
    tailoredLineCount: tailoredLines.length,
    addedLineCount: addedLines.length,
    removedLineCount: removedLines.length,
    addedLines: addedLines.slice(0, 100),
    removedLines: removedLines.slice(0, 100),
    truncated: addedLines.length > 100 || removedLines.length > 100,
  };
}

export function prepareApplicationMaterials(
  passport: CandidatePassport,
  job: LiveJob,
  resume: ResumeEvidence | null = null,
) {
  const supportedClaims = passport.claims.filter(
    (claim) =>
      claim.source === "user-confirmed" ||
      claim.source === "resume-evidence" ||
      claim.source === "project-evidence",
  );
  const unconfirmedClaims = passport.claims.filter(
    (claim) =>
      claim.source === "unverified-input" || claim.source === "generated-draft",
  );
  return {
    version: "buffalo-application-materials-brief/v1",
    job: {
      id: job.id,
      employer: job.employer,
      title: job.title,
      officialJobUrl: job.officialJobUrl,
      applyUrl: job.applyUrl,
    },
    resume,
    supportedClaims,
    unconfirmedClaimKeys: unconfirmedClaims.map((claim) => claim.key),
    hostTask: [
      "Read the live official job description before drafting.",
      "Create a tailored resume version and a short cover letter only when the application benefits from one.",
      "Keep employment titles, employers, dates, education, credentials, metrics, and qualifications factually identical to the supported claims and resume evidence.",
      "For every new or materially rewritten claim, attach one or more supported claim keys.",
      "Do not keyword-stuff, invent missing requirements, or hide gaps. List uncertain requirements separately.",
      "Call buffalo.review_application_materials with the original and tailored resume text, cover letter, and evidence map before using the materials.",
    ],
    finishedResult:
      "A tailored resume, optional cover letter, visible evidence map, original-to-tailored diff, and explicit applicant review—not an unreviewed rewrite.",
  };
}

export function reviewApplicationMaterials(input: {
  passport: CandidatePassport;
  job: LiveJob;
  originalResumeText: string;
  tailoredResumeText: string;
  coverLetter?: string | undefined;
  proposedClaims: ProposedMaterialClaim[];
}) {
  const claimsByKey = new Map(input.passport.claims.map((claim) => [claim.key, claim]));
  const unsupportedEvidenceKeys = [
    ...new Set(
      input.proposedClaims.flatMap((claim) =>
        claim.evidenceKeys.filter((key) => !claimsByKey.has(key)),
      ),
    ),
  ];
  const unconfirmedEvidenceKeys = [
    ...new Set(
      input.proposedClaims.flatMap((claim) =>
        claim.evidenceKeys.filter((key) => {
          const source = claimsByKey.get(key)?.source;
          return source === "unverified-input" || source === "generated-draft";
        }),
      ),
    ),
  ];
  const claimsWithoutEvidence = input.proposedClaims
    .filter((claim) => claim.text.trim() && claim.evidenceKeys.length === 0)
    .map((claim) => claim.text);
  const emptyClaims = input.proposedClaims.filter((claim) => !claim.text.trim()).length;
  const diff = materialDiff(input.originalResumeText, input.tailoredResumeText);
  const blockingReasons = [
    ...(unsupportedEvidenceKeys.length
      ? ["material claims cite keys that are not in the candidate passport"]
      : []),
    ...(unconfirmedEvidenceKeys.length
      ? ["material claims rely on generated or unconfirmed candidate facts"]
      : []),
    ...(claimsWithoutEvidence.length
      ? ["one or more new material claims have no evidence mapping"]
      : []),
    ...(!input.tailoredResumeText.trim() ? ["tailored resume is empty"] : []),
  ];
  return {
    decision:
      blockingReasons.length > 0
        ? ("blocked" as const)
        : ("ready-for-applicant-review" as const),
    job: {
      id: input.job.id,
      employer: input.job.employer,
      title: input.job.title,
    },
    evidenceReview: {
      proposedClaimCount: input.proposedClaims.length,
      emptyClaims,
      unsupportedEvidenceKeys,
      unconfirmedEvidenceKeys,
      claimsWithoutEvidence,
      blockingReasons,
    },
    diff,
    coverLetter: {
      included: Boolean(input.coverLetter?.trim()),
      characterCount: input.coverLetter?.trim().length ?? 0,
    },
    approvalPrompt:
      `Review the tailored resume diff${input.coverLetter?.trim() ? " and cover letter" : ""} for ${input.job.title} at ${input.job.employer}. ` +
      "Confirm that every claim remains accurate before these materials are uploaded. Material preparation approval is separate from final application submission approval.",
  };
}
