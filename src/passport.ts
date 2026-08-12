import { createHash } from "node:crypto";

export const factSources = [
  "user-confirmed",
  "project-evidence",
  "generated-draft",
  "unverified-input",
] as const;

export type FactSource = (typeof factSources)[number];

export const artifactKinds = [
  "website",
  "repository",
  "deck",
  "document",
  "demo",
  "other",
] as const;

export type ArtifactKind = (typeof artifactKinds)[number];

export interface ProjectFacts {
  name: string;
  summary: string;
  problem?: string | undefined;
  solution?: string | undefined;
  customer?: string | undefined;
  businessModel?: string | undefined;
  industry?: string | undefined;
  stage?: string | undefined;
  location?: string | undefined;
  website?: string | undefined;
  repository?: string | undefined;
  evidenceUrls?: string[] | undefined;
  traction?: string | undefined;
  team?: string | undefined;
  fundingNeed?: string | undefined;
}

export interface ApplicantFacts {
  fullName?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  role?: string | undefined;
  city?: string | undefined;
  linkedIn?: string | undefined;
}

export interface EvidenceArtifact {
  kind: ArtifactKind;
  url: string;
  title?: string | undefined;
  note?: string | undefined;
}

export interface CandidateAnswer {
  key: string;
  suggestedUse: string;
  value: string;
  source: FactSource;
  evidence?: string[] | undefined;
  disclosure: "project" | "personal-contact" | "other";
}

export interface SupplementalClaim {
  key: string;
  label: string;
  value: string;
  source: FactSource;
  evidence?: string[] | undefined;
  disclosure?: "project" | "personal-contact" | "other" | undefined;
}

export interface PassportQuestion {
  id: string;
  prompt: string;
  category: "confirmation" | "contact" | "venture" | "goal";
  reason: string;
}

export interface BuildPassportInput {
  project: ProjectFacts;
  applicant?: ApplicantFacts | undefined;
  goals?: string[] | undefined;
  artifacts?: EvidenceArtifact[] | undefined;
  additionalFacts?: Record<string, string> | undefined;
  supplementalClaims?: SupplementalClaim[] | undefined;
  factsConfirmedByUser?: boolean | undefined;
}

export interface VenturePassport {
  version: "buffalo-venture-passport/v1";
  passportId: string;
  project: ProjectFacts;
  applicant?: ApplicantFacts | undefined;
  goals: string[];
  artifacts: EvidenceArtifact[];
  candidateAnswers: CandidateAnswer[];
  readiness: {
    status: "ready" | "needs-confirmation" | "needs-shared-answers";
    confirmedClaimCount: number;
    evidencedClaimCount: number;
    unverifiedClaimCount: number;
    missingQuestions: PassportQuestion[];
  };
  portability: {
    persisted: false;
    note: string;
  };
}

const personalLabels = /(?:name|email|phone|address|city|linkedin|contact)/iu;

function compact(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean))] as string[];
}

function factSource(
  confirmed: boolean | undefined,
  evidence?: string[],
): FactSource {
  if (evidence?.length) return "project-evidence";
  return confirmed ? "user-confirmed" : "unverified-input";
}

function passportId(input: BuildPassportInput): string {
  const identity = [
    input.project.name.trim().toLowerCase(),
    input.project.website?.trim().toLowerCase() ?? "",
    input.project.repository?.trim().toLowerCase() ?? "",
    input.project.summary.trim().toLowerCase(),
  ].join("\n");

  return `bvp_${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
}

function missingQuestions(input: BuildPassportInput, claims: CandidateAnswer[]) {
  const questions: PassportQuestion[] = [];

  if (claims.some((claim) => claim.source === "unverified-input")) {
    questions.push({
      id: "confirm-passport-facts",
      prompt:
        "Please confirm or correct the venture passport facts before they are entered into any form.",
      category: "confirmation",
      reason: "One or more facts came from unconfirmed input.",
    });
  }
  if (!input.applicant?.fullName?.trim()) {
    questions.push({
      id: "applicant-full-name",
      prompt: "What full name should appear as the applicant?",
      category: "contact",
      reason: "Common contact field across applications.",
    });
  }
  if (!input.applicant?.email?.trim()) {
    questions.push({
      id: "applicant-email",
      prompt: "What email address should receive application confirmations?",
      category: "contact",
      reason: "Common contact and receipt field across applications.",
    });
  }
  if (!input.project.location?.trim()) {
    questions.push({
      id: "venture-location",
      prompt: "Where is the venture or primary team currently located?",
      category: "venture",
      reason: "Programs often use geography when reviewing fit.",
    });
  }
  if (!input.project.stage?.trim()) {
    questions.push({
      id: "venture-stage",
      prompt: "What stage best describes the venture today?",
      category: "venture",
      reason: "Programs commonly ask about current stage.",
    });
  }
  if (!(input.goals ?? []).some((goal) => goal.trim())) {
    questions.push({
      id: "current-goal",
      prompt: "What help or outcome are you seeking from Buffalo programs right now?",
      category: "goal",
      reason: "Used to choose and tailor plausible opportunity matches.",
    });
  }

  return questions;
}

export function candidateAnswersFromFacts(
  input: BuildPassportInput,
): CandidateAnswer[] {
  const answers: CandidateAnswer[] = [];
  const push = (
    key: string,
    suggestedUse: string,
    value: string | undefined,
    disclosure: CandidateAnswer["disclosure"],
    evidence?: string[],
  ) => {
    if (!value?.trim()) return;
    answers.push({
      key,
      suggestedUse,
      value: value.trim(),
      source: factSource(input.factsConfirmedByUser, evidence),
      ...(evidence?.length ? { evidence: compact(evidence) } : {}),
      disclosure,
    });
  };

  push("project.name", "project or company name", input.project.name, "project");
  push(
    "project.summary",
    "project, company, or venture description",
    input.project.summary,
    "project",
  );
  push("project.problem", "problem", input.project.problem, "project");
  push("project.solution", "solution", input.project.solution, "project");
  push("project.customer", "target customer", input.project.customer, "project");
  push(
    "project.businessModel",
    "business model",
    input.project.businessModel,
    "project",
  );
  push("project.industry", "industry", input.project.industry, "project");
  push("project.stage", "project stage", input.project.stage, "project");
  push(
    "project.location",
    "project or business location",
    input.project.location,
    "project",
  );
  push("project.website", "project website", input.project.website, "project");
  push(
    "project.repository",
    "project repository",
    input.project.repository,
    "project",
  );
  push(
    "project.traction",
    "traction, milestones, or evidence",
    input.project.traction,
    "project",
    input.project.evidenceUrls,
  );
  push("project.team", "team", input.project.team, "project");
  push(
    "project.fundingNeed",
    "funding need or planned use",
    input.project.fundingNeed,
    "project",
  );

  for (const [key, value] of Object.entries(input.applicant ?? {})) {
    push(`applicant.${key}`, key, value, "personal-contact");
  }
  for (const [label, value] of Object.entries(input.additionalFacts ?? {})) {
    push(
      `additional.${label.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}`,
      label,
      value,
      personalLabels.test(label) ? "personal-contact" : "other",
    );
  }
  for (const [index, goal] of (input.goals ?? []).entries()) {
    push(`goal.${index + 1}`, "current goal", goal, "project");
  }
  for (const claim of input.supplementalClaims ?? []) {
    const evidence = compact(claim.evidence ?? []);
    const normalizedSource =
      claim.source === "project-evidence" && evidence.length === 0
        ? "unverified-input"
        : claim.source;
    if (!claim.value.trim()) continue;
    answers.push({
      key: claim.key,
      suggestedUse: claim.label,
      value: claim.value.trim(),
      source: normalizedSource,
      ...(evidence.length ? { evidence } : {}),
      disclosure: claim.disclosure ?? "other",
    });
  }

  const seen = new Set<string>();
  return answers.filter((answer) => {
    const identity = `${answer.key}\u0000${answer.value}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function buildVenturePassport(
  input: BuildPassportInput,
): VenturePassport {
  const candidateAnswers = candidateAnswersFromFacts(input);
  const questions = missingQuestions(input, candidateAnswers);
  const unverifiedClaimCount = candidateAnswers.filter(
    (answer) =>
      answer.source === "unverified-input" ||
      answer.source === "generated-draft",
  ).length;
  const status =
    unverifiedClaimCount > 0
      ? "needs-confirmation"
      : questions.length > 0
        ? "needs-shared-answers"
        : "ready";

  return {
    version: "buffalo-venture-passport/v1",
    passportId: passportId(input),
    project: input.project,
    ...(input.applicant ? { applicant: input.applicant } : {}),
    goals: compact(input.goals ?? []),
    artifacts: input.artifacts ?? [],
    candidateAnswers,
    readiness: {
      status,
      confirmedClaimCount: candidateAnswers.filter(
        (answer) => answer.source === "user-confirmed",
      ).length,
      evidencedClaimCount: candidateAnswers.filter(
        (answer) => answer.source === "project-evidence",
      ).length,
      unverifiedClaimCount,
      missingQuestions: questions,
    },
    portability: {
      persisted: false,
      note: "Portable JSON returned to the MCP host. This server does not save or transmit it.",
    },
  };
}
