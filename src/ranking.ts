import type { CandidatePassport } from "./candidate.js";
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

export function rankJobs(
  passport: CandidatePassport,
  jobs: LiveJob[],
  preferences: JobRankingPreferences = {},
) {
  const desiredRoleTokens = tokens((passport.candidate.desiredRoles ?? []).join(" "));
  const skillTokens = tokens((passport.candidate.skills ?? []).join(" "));
  const evidenceClaims = passport.claims.filter(
    (claim) =>
      claim.source === "user-confirmed" ||
      claim.source === "resume-evidence" ||
      claim.source === "project-evidence",
  );
  const required = normalizedList(preferences.requiredWords);
  const avoided = normalizedList(preferences.avoidWords);
  const excludedEmployers = normalizedList(preferences.excludeEmployers);
  const preferredLocations = normalizedList(preferences.preferredLocations);

  const scored = jobs.map((job) => {
    const searchable = [
      job.title,
      job.employer,
      job.location,
      job.department,
      job.workplace,
      job.commitment,
    ]
      .join(" ")
      .toLowerCase();
    const reasons: string[] = [];
    const caveats: string[] = [];
    const blockers: string[] = [];
    let score = 0;

    for (const token of desiredRoleTokens) {
      if (tokens(job.title).includes(token)) {
        score += 12;
        reasons.push(`desired role matches title: ${token}`);
      }
    }
    for (const token of skillTokens) {
      if (searchable.includes(token)) {
        score += 4;
        reasons.push(`candidate skill appears in listing metadata: ${token}`);
      }
    }
    if (preferences.preferredWorkModes?.includes(job.workplace)) {
      score += 6;
      reasons.push(`preferred work mode: ${job.workplace}`);
    }
    if (preferences.preferredSectors?.includes(job.department)) {
      score += 5;
      reasons.push(`preferred sector: ${job.department}`);
    }
    if (
      preferredLocations.some((location) => job.location.toLowerCase().includes(location))
    ) {
      score += 5;
      reasons.push(`preferred location: ${job.location}`);
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
          reasons.push(`annual pay floor meets preference: ${floor}`);
        }
      } else {
        caveats.push("annual pay is not confirmed in the index");
      }
    }
    if (job.freshness !== "current") caveats.push(`freshness is ${job.freshness}`);
    if (job.employmentType === "unknown") caveats.push("employment type is not confirmed");

    const supportingClaimKeys = evidenceClaims
      .filter((claim) => tokens(claim.value).some((token) => searchable.includes(token)))
      .map((claim) => claim.key)
      .slice(0, 12);

    return {
      job,
      score,
      status: blockers.length > 0 ? ("excluded" as const) : ("candidate" as const),
      reasons: [...new Set(reasons)],
      caveats: [...new Set(caveats)],
      blockers,
      supportingClaimKeys,
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
      "This ranking uses Buffalo Projects listing metadata and applicant evidence, not a hiring or eligibility decision. Inspect each live job description before claiming fit or applying.",
    ranked,
    excluded: scored
      .filter((item) => item.status === "excluded")
      .map((item) => ({ job: item.job, blockers: item.blockers })),
    next:
      "Open the live descriptions for the ranked jobs, compare every material requirement to evidence, let the applicant remove roles, then prepare no more than the selected applications.",
  };
}
