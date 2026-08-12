import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getOpportunity,
  opportunities,
  opportunityKinds,
  projectStages,
} from "./catalog.js";
import { searchOpportunities } from "./matcher.js";
import { prepareRegistration, reviewSubmission } from "./registration.js";

export const packageVersion = "1.0.0";

const searchInputSchema = z.object({
  description: z
    .string()
    .min(1)
    .describe("Plain-language description of what the person is building."),
  goal: z
    .string()
    .optional()
    .describe("What they want next, such as mentoring, capital, a permit, or customers."),
  stage: z.enum(projectStages).optional(),
  kinds: z.array(z.enum(opportunityKinds)).max(7).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

const getInputSchema = z.object({
  opportunityId: z.string().min(1),
});

const projectFactsSchema = z.object({
  name: z.string().min(1),
  summary: z.string().min(1),
  stage: z.string().optional(),
  location: z.string().optional(),
  website: z.string().url().optional(),
  evidenceUrls: z.array(z.string().url()).optional(),
  traction: z.string().optional(),
  team: z.string().optional(),
});

const applicantFactsSchema = z.object({
  fullName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  role: z.string().optional(),
  city: z.string().optional(),
  linkedIn: z.string().url().optional(),
});

const prepareInputSchema = z.object({
  opportunityId: z.string().min(1),
  project: projectFactsSchema,
  applicant: applicantFactsSchema.optional(),
  additionalFacts: z.record(z.string(), z.string()).optional(),
  factsConfirmedByUser: z
    .boolean()
    .optional()
    .describe(
      "True only when the user directly provided or explicitly confirmed the packet facts. Omit or use false for model-inferred or imported facts.",
    ),
});

const proposedFieldSchema = z.object({
  label: z.string().min(1),
  value: z.string(),
  source: z.enum([
    "user-confirmed",
    "project-evidence",
    "generated-draft",
    "unverified-input",
  ]),
  evidence: z.array(z.string()).optional(),
});

const reviewInputSchema = z.object({
  opportunityId: z.string().min(1),
  destinationUrl: z.string().url(),
  fields: z.array(proposedFieldSchema).min(1),
  unresolvedQuestions: z.array(z.string()).optional(),
});

function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

export const toolHandlers = {
  search: (input: z.infer<typeof searchInputSchema>) => ({
    scope: "Buffalo and Western New York, plus reviewed New York State starting points",
    catalogReviewedThrough: opportunities
      .map((item) => item.reviewedAt)
      .sort()
      .at(-1),
    notice:
      "Matches are plausible starting points, not eligibility decisions. Verify current requirements and deadlines on each official site.",
    matches: searchOpportunities(input).map((match) => ({
      id: match.opportunity.id,
      name: match.opportunity.name,
      provider: match.opportunity.provider,
      summary: match.opportunity.summary,
      kinds: match.opportunity.kinds,
      availability: match.opportunity.availability,
      registrationMode: match.opportunity.registration.mode,
      officialUrl: match.opportunity.officialUrl,
      reviewedAt: match.opportunity.reviewedAt,
      reasons: match.reasons,
      caution: match.opportunity.caution,
    })),
  }),
  get: (input: z.infer<typeof getInputSchema>) => {
    const opportunity = getOpportunity(input.opportunityId);
    if (!opportunity) {
      throw new Error(`Unknown opportunity: ${input.opportunityId}`);
    }
    return opportunity;
  },
  prepare: (input: z.infer<typeof prepareInputSchema>) =>
    prepareRegistration(input),
  review: (input: z.infer<typeof reviewInputSchema>) => reviewSubmission(input),
};

const serverInstructions = [
  "Free, local, vendor-neutral Buffalo opportunity tools. No Buffalo Projects account, API key, or hosted dependency is required.",
  "Start with buffalo.search_opportunities, inspect a match with buffalo.get_opportunity, then use buffalo.prepare_registration.",
  "If this host has browser or computer-use tools, follow the returned browserHandoff to inspect and fill the live official form. Otherwise return its copy/paste packet.",
  "Never claim eligibility. Never invent facts. Never bypass CAPTCHA, identity checks, or authentication.",
  "Use buffalo.review_submission after filling. Always ask for explicit point-of-action approval immediately before final submission.",
].join(" ");

export function createBuffaloServer(): McpServer {
  const server = new McpServer(
    { name: "buffalo-projects-tools", version: packageVersion },
    { instructions: serverInstructions },
  );

  server.registerTool(
    "buffalo.search_opportunities",
    {
      title: "Find Buffalo opportunities",
      description:
        "Match a project against a small, reviewed catalog of official Buffalo, Western New York, and relevant New York State accelerators, capital, grants, permits, procurement, and business-help starting points. Returns plausible matches, never eligibility claims.",
      inputSchema: searchInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => jsonResult(toolHandlers.search(input)),
  );

  server.registerTool(
    "buffalo.get_opportunity",
    {
      title: "Inspect a Buffalo opportunity",
      description:
        "Return the reviewed official source, current-status note, registration route, browser allowlist, and caution for one catalog entry.",
      inputSchema: getInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => jsonResult(toolHandlers.get(input)),
  );

  server.registerTool(
    "buffalo.prepare_registration",
    {
      title: "Prepare an opportunity registration",
      description:
        "Build a source-labeled answer packet and a vendor-neutral browser/computer-use handoff for an official form. This tool does not open a browser or submit anything. A capable Claude, Codex, or other MCP host can use the handoff with its own browser tools; other hosts receive a copy/paste packet.",
      inputSchema: prepareInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => jsonResult(toolHandlers.prepare(input)),
  );

  server.registerTool(
    "buffalo.review_submission",
    {
      title: "Review a prepared submission",
      description:
        "Check the live destination against the opportunity allowlist, flag unsupported generated claims, sensitive disclosures, commitments, and unanswered questions, and produce the exact point-of-action approval prompt. This tool never submits.",
      inputSchema: reviewInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => jsonResult(toolHandlers.review(input)),
  );

  server.registerPrompt(
    "register-in-buffalo",
    {
      title: "Find and prepare a Buffalo application",
      description:
        "Find a fitting Buffalo/WNY opportunity and prepare its live registration safely.",
      argsSchema: {
        project: z.string().min(1),
        goal: z.string().optional(),
      },
    },
    ({ project, goal }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Project: ${project}`,
              goal ? `Goal: ${goal}` : "Goal: find the strongest relevant Buffalo/WNY starting point.",
              "Use buffalo.search_opportunities and explain the best match without claiming eligibility.",
              "After I choose, use buffalo.prepare_registration. Mark factsConfirmedByUser true only for facts I directly provided or confirmed.",
              "If browser or computer-use tools are available, follow the returned handoff and fill only supported facts. Otherwise give me the answer packet and official URL.",
              "Use buffalo.review_submission before asking me for explicit final-submit approval. Never submit based on this prompt alone.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}
