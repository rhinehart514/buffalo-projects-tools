import {
  opportunities,
  type Opportunity,
  type OpportunityKind,
  type ProjectStage,
} from "./catalog.js";

export interface SearchInput {
  description: string;
  goal?: string | undefined;
  stage?: ProjectStage | undefined;
  kinds?: OpportunityKind[] | undefined;
  limit?: number | undefined;
}

export interface Match {
  opportunity: Opportunity;
  score: number;
  reasons: string[];
}

const ignoredWords = new Set([
  "about",
  "after",
  "also",
  "because",
  "before",
  "building",
  "could",
  "from",
  "have",
  "into",
  "project",
  "that",
  "their",
  "they",
  "this",
  "want",
  "with",
]);

function tokens(value: string): string[] {
  return [
    ...new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/u)
        .filter((token) => token.length >= 3 && !ignoredWords.has(token)),
    ),
  ];
}

function scoreOpportunity(input: SearchInput, opportunity: Opportunity): Match {
  const query = tokens(`${input.description} ${input.goal ?? ""}`);
  const signalText = opportunity.signals.join(" ").toLowerCase();
  const summaryText = `${opportunity.name} ${opportunity.summary}`.toLowerCase();
  const signalMatches = query.filter((token) => signalText.includes(token));
  const summaryMatches = query.filter((token) => summaryText.includes(token));
  const kindMatches = (input.kinds ?? []).filter((kind) =>
    opportunity.kinds.includes(kind),
  );
  const stageMatch = Boolean(
    input.stage &&
      (opportunity.stages.includes(input.stage) ||
        opportunity.stages.includes("any")),
  );

  const score =
    signalMatches.length * 4 +
    summaryMatches.length * 2 +
    kindMatches.length * 7 +
    (stageMatch ? 3 : 0);
  const reasons = [
    ...signalMatches.slice(0, 4).map((signal) => `project signal: ${signal}`),
    ...kindMatches.map((kind) => `requested kind: ${kind}`),
    ...(stageMatch && input.stage ? [`listed stage: ${input.stage}`] : []),
  ];

  return {
    opportunity,
    score,
    reasons: reasons.length > 0 ? reasons : ["broad Buffalo/WNY starting point"],
  };
}

export function searchOpportunities(input: SearchInput): Match[] {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 10);
  const matches = opportunities
    .map((opportunity) => scoreOpportunity(input, opportunity))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.opportunity.name.localeCompare(right.opportunity.name),
    );
  return matches.slice(0, limit);
}
