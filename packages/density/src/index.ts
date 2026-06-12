import type { Project } from "@buffalo/schema";

export type DensityDimensionId =
  | "clarity"
  | "evidence"
  | "specificity"
  | "recency"
  | "skills"
  | "outcomes";

export type DensityStatus = "strong" | "medium" | "missing";

export interface DensityGap {
  id: string;
  dimension: DensityDimensionId;
  message: string;
  suggestedFix: string;
  line?: number;
}

export interface DensityDimensionReport {
  id: DensityDimensionId;
  label: string;
  question: string;
  status: DensityStatus;
  score: number;
  maxScore: number;
  gaps: DensityGap[];
}

export interface DensityReport {
  score: number;
  strengths: string[];
  gaps: string[];
  dimensions: DensityDimensionReport[];
  gapItems: DensityGap[];
  threshold: number;
  passes: boolean;
}

interface DensityCheck {
  id: DensityDimensionId;
  label: string;
  question: string;
  points: number;
  strength: string;
  gap: string;
  suggestedFix: string;
  passes: (project: Project) => boolean;
  partial?: (project: Project) => boolean;
}

const densityThreshold = 70;

function isPlaceholder(value: string | undefined | null): boolean {
  const text = value?.trim().toLowerCase() ?? "";

  return (
    !text ||
    text.startsWith("add ") ||
    text.startsWith("write one sentence") ||
    text.includes("add the strongest") ||
    text.includes("concrete action or artifact")
  );
}

function meaningfulText(value: string | undefined | null, minLength: number): boolean {
  const text = value?.trim() ?? "";

  return !isPlaceholder(text) && text.length >= minLength;
}

function meaningfulList(values: string[] | undefined, minimum: number): boolean {
  return (values?.filter((value) => !isPlaceholder(value)).length ?? 0) >= minimum;
}

const checks: DensityCheck[] = [
  {
    id: "clarity",
    label: "Clarity",
    question: "Can a reviewer understand the project quickly?",
    points: 15,
    strength: "Clear summary",
    gap: "Add a specific summary of what was built and why it matters.",
    suggestedFix:
      "Write one sentence explaining what the project does, who it is for, and what you did.",
    passes: (project: Project) => meaningfulText(project.description, 80),
    partial: (project: Project) => meaningfulText(project.description, 35),
  },
  {
    id: "evidence",
    label: "Evidence",
    question: "Can someone inspect that the work exists?",
    points: 15,
    strength: "Inspectable source",
    gap: "Add live work, a repository, screenshot, deck, notebook, or doc.",
    suggestedFix:
      "Add the strongest inspectable source: demo, screenshot, repo, doc, file, metric, or project link.",
    passes: (project: Project) =>
      Boolean(
        !isPlaceholder(project.projectUrl) ||
          !isPlaceholder(project.githubRepoUrl) ||
          !isPlaceholder(project.coverImageUrl) ||
          (project.evidence?.filter((item) => !isPlaceholder(item.source)).length ?? 0) > 0,
      ),
  },
  {
    id: "outcomes",
    label: "Outcomes",
    question: "Did the work produce a signal or outcome?",
    points: 15,
    strength: "Proof-backed claims",
    gap: "Add proof statements that explain what the project demonstrates.",
    suggestedFix:
      "Add one outcome, even if small: first user, demo shown, feedback received, issue solved, time saved, or lesson learned.",
    passes: (project: Project) => meaningfulList(project.proofStatements, 2),
    partial: (project: Project) => meaningfulList(project.proofStatements, 1),
  },
  {
    id: "skills",
    label: "Skills",
    question: "Are skills backed by evidence?",
    points: 15,
    strength: "Skills tied to evidence",
    gap: "Tie skills to concrete evidence, not just tags.",
    suggestedFix:
      "For each skill, attach a project action or artifact that shows it.",
    passes: (project: Project) =>
      (project.skillEvidence?.filter((item) => !isPlaceholder(item.evidence)).length ?? 0) > 0 ||
      meaningfulList(project.primarySkills, 3),
    partial: (project: Project) => meaningfulList(project.primarySkills, 1),
  },
  {
    id: "specificity",
    label: "Specificity",
    question: "Are claims concrete?",
    points: 10,
    strength: "Project type is legible",
    gap: "Choose a category so reviewers know how to read the work.",
    suggestedFix:
      "Replace broad claims with concrete contribution: what you did, what changed, and how you know.",
    passes: (project: Project) => Boolean(project.category),
  },
  {
    id: "recency",
    label: "Recency",
    question: "Does the work look alive or at least clearly dated?",
    points: 10,
    strength: "Progress stage is visible",
    gap: "Add the current project stage.",
    suggestedFix: "Add a milestone describing what changed most recently.",
    passes: (project: Project) => Boolean(project.stage),
  },
  {
    id: "clarity",
    label: "Clarity",
    question: "Can a reviewer understand the project quickly?",
    points: 10,
    strength: "Current ask is actionable",
    gap: "Add the next action you want from a reviewer.",
    suggestedFix:
      "Name the next action you want: feedback, referral, collaborator, mentor review, or interview discussion.",
    passes: (project: Project) => meaningfulText(project.currentAsk, 20),
    partial: (project: Project) => meaningfulText(project.currentAsk, 1),
  },
  {
    id: "recency",
    label: "Recency",
    question: "Does the work look alive or at least clearly dated?",
    points: 10,
    strength: "Recent enough to trust",
    gap: "Update the project so viewers know it is still alive.",
    suggestedFix: "Add a dated milestone or recent artifact.",
    passes: (project: Project) =>
      (project.milestones?.length ?? 0) > 0 ||
      Date.now() - project.lastActiveAt.getTime() <= 1000 * 60 * 60 * 24 * 45,
  },
];

export const densityRubric = checks.map((check) => ({
  id: check.id,
  label: check.label,
  question: check.question,
  points: check.points,
  strength: check.strength,
  gap: check.gap,
  suggestedFix: check.suggestedFix,
}));

export function scoreProjectDensity(project: Project): DensityReport {
  const strengths: string[] = [];
  const gaps: string[] = [];
  const dimensionMap = new Map<DensityDimensionId, DensityDimensionReport>();
  let score = 0;

  for (const check of checks) {
    const passed = check.passes(project);
    const partial = !passed && check.partial?.(project) === true;
    const earned = passed ? check.points : partial ? Math.floor(check.points / 2) : 0;
    score += earned;

    const existing = dimensionMap.get(check.id) ?? {
      id: check.id,
      label: check.label,
      question: check.question,
      status: "missing" as DensityStatus,
      score: 0,
      maxScore: 0,
      gaps: [],
    };

    existing.score += earned;
    existing.maxScore += check.points;

    if (check.passes(project)) {
      strengths.push(check.strength);
    } else {
      gaps.push(check.gap);
      existing.gaps.push({
        id: `${check.id}-${existing.gaps.length + 1}`,
        dimension: check.id,
        message: check.gap,
        suggestedFix: check.suggestedFix,
      });
    }

    dimensionMap.set(check.id, existing);
  }

  const dimensions: DensityDimensionReport[] = [...dimensionMap.values()].map((dimension) => {
    const ratio = dimension.maxScore > 0 ? dimension.score / dimension.maxScore : 0;
    const status: DensityStatus =
      ratio >= 0.8 ? "strong" : ratio >= 0.45 ? "medium" : "missing";

    return {
      ...dimension,
      status,
    };
  });
  const normalizedScore = Math.max(0, Math.min(100, score));
  const gapItems = dimensions.flatMap((dimension) => dimension.gaps);

  return {
    score: normalizedScore,
    strengths,
    gaps,
    dimensions,
    gapItems,
    threshold: densityThreshold,
    passes: normalizedScore >= densityThreshold,
  };
}
