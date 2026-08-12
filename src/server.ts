import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  buildCandidatePassport,
  prepareJobApplications,
  reviewJobApplication,
  type CandidatePassport,
} from "./candidate.js";
import {
  getOpportunity,
  opportunities,
  opportunityKinds,
  projectStages,
} from "./catalog.js";
import {
  jobOpportunityKinds,
  jobSectors,
  jobSourceTiers,
  jobWorkModes,
  resolveLiveJobs,
  searchLiveJobs,
  type LiveJob,
} from "./jobs.js";
import { searchOpportunities } from "./matcher.js";
import { prepareRegistration, reviewSubmission } from "./registration.js";

export const packageVersion = "1.1.0";

const factSources = [
  "user-confirmed",
  "project-evidence",
  "generated-draft",
  "unverified-input",
] as const;

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

const getInputSchema = z.object({ opportunityId: z.string().min(1) });

const projectFactsSchema = z.object({
  name: z.string().min(1),
  summary: z.string().min(1),
  stage: z.string().optional(),
  location: z.string().optional(),
  website: z.url().optional(),
  evidenceUrls: z.array(z.url()).optional(),
  traction: z.string().optional(),
  team: z.string().optional(),
});

const applicantFactsSchema = z.object({
  fullName: z.string().optional(),
  email: z.email().optional(),
  phone: z.string().optional(),
  role: z.string().optional(),
  city: z.string().optional(),
  linkedIn: z.url().optional(),
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
  source: z.enum(factSources),
  evidence: z.array(z.string()).optional(),
});

const reviewInputSchema = z.object({
  opportunityId: z.string().min(1),
  destinationUrl: z.url(),
  fields: z.array(proposedFieldSchema).min(1),
  unresolvedQuestions: z.array(z.string()).optional(),
});

const searchJobsInputSchema = z.object({
  query: z
    .string()
    .max(120)
    .optional()
    .describe("Role, employer, or Buffalo/WNY location text."),
  opportunityKind: z.enum(jobOpportunityKinds).optional(),
  sector: z.enum(jobSectors).optional(),
  workMode: z.enum(jobWorkModes).optional(),
  sourceTier: z.enum(jobSourceTiers).optional(),
  minPay: z.number().min(0).max(1_000_000_000).optional(),
  newSince: z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), "Must be a valid date")
    .optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const workHistorySchema = z.object({
  employer: z.string().min(1),
  title: z.string().min(1),
  location: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  current: z.boolean().optional(),
  responsibilities: z.array(z.string()).optional(),
});

const educationHistorySchema = z.object({
  school: z.string().min(1),
  degree: z.string().optional(),
  field: z.string().optional(),
  location: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const candidateFactsSchema = z.object({
  fullName: z.string().optional(),
  email: z.email().optional(),
  phone: z.string().optional(),
  streetAddress: z.string().optional(),
  city: z.string().optional(),
  stateOrRegion: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  linkedIn: z.url().optional(),
  github: z.url().optional(),
  portfolio: z.url().optional(),
  resumePath: z.string().optional(),
  resumeUrl: z.url().optional(),
  desiredRoles: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  workSummary: z.string().optional(),
  educationSummary: z.string().optional(),
  workHistory: z.array(workHistorySchema).optional(),
  educationHistory: z.array(educationHistorySchema).optional(),
  certifications: z.array(z.string()).optional(),
  workAuthorized: z.string().optional(),
  needsSponsorship: z.string().optional(),
  salaryExpectation: z.string().optional(),
  availableStart: z.string().optional(),
});

const candidateEvidenceSchema = z
  .object({
    kind: z.enum(["resume", "portfolio", "repository", "profile", "document"]),
    url: z.url().optional(),
    localPath: z.string().optional(),
    note: z.string().optional(),
  })
  .refine((value) => Boolean(value.url || value.localPath || value.note), {
    message: "Evidence needs a URL, local path, or note.",
  });

const candidateClaimSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.string(),
  source: z.enum(factSources),
  evidence: z.array(z.string()).optional(),
  sensitivity: z.enum(["ordinary", "personal", "material", "highly-sensitive"]),
});

const buildCandidatePassportInputSchema = z.object({
  candidate: candidateFactsSchema,
  evidence: z.array(candidateEvidenceSchema).optional(),
  supplementalClaims: z.array(candidateClaimSchema).optional(),
  factsConfirmedByUser: z
    .boolean()
    .optional()
    .describe("True only after the applicant confirms these exact facts."),
});

const candidatePassportSchema = z.object({
  version: z.literal("buffalo-candidate-passport/v1"),
  passportId: z.string().min(1),
  candidate: candidateFactsSchema,
  evidence: z.array(candidateEvidenceSchema),
  claims: z.array(candidateClaimSchema),
  readiness: z.object({
    status: z.enum(["ready", "needs-confirmation", "needs-shared-answers"]),
    missingQuestions: z.array(
      z.object({ id: z.string(), prompt: z.string(), reason: z.string() }),
    ),
    unverifiedClaimCount: z.number().int().min(0),
  }),
  excludedFromPassport: z.array(z.string()),
  portability: z.object({
    persisted: z.literal(false),
    note: z.string(),
  }),
});

const prepareJobApplicationsInputSchema = z.object({
  jobIds: z
    .array(z.string().min(1))
    .min(1)
    .max(10)
    .describe("IDs returned by buffalo.search_jobs."),
  passport: candidatePassportSchema,
});

const reviewJobApplicationInputSchema = z.object({
  jobId: z.string().min(1).describe("A Buffalo Projects job ID."),
  destinationUrl: z.url(),
  fields: z.array(proposedFieldSchema).min(1),
  unresolvedQuestions: z.array(z.string()).optional(),
});

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

type Fetcher = typeof fetch;

async function resolveWithCache(
  ids: string[],
  cache: Map<string, LiveJob>,
  fetcher: Fetcher,
) {
  const missing = [...new Set(ids)].filter((id) => !cache.has(id));
  if (missing.length > 0) {
    for (const job of await resolveLiveJobs(missing, fetcher)) cache.set(job.id, job);
  }
  return ids.map((id) => {
    const job = cache.get(id);
    if (!job) throw new Error(`Buffalo Projects job is unavailable: ${id}`);
    return job;
  });
}

export const toolHandlers = {
  search: (input: z.infer<typeof searchInputSchema>) => ({
    scope: "Buffalo and Western New York, plus reviewed New York State starting points",
    catalogReviewedThrough: opportunities.map((item) => item.reviewedAt).sort().at(-1),
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
    if (!opportunity) throw new Error(`Unknown opportunity: ${input.opportunityId}`);
    return opportunity;
  },
  prepare: (input: z.infer<typeof prepareInputSchema>) => prepareRegistration(input),
  review: (input: z.infer<typeof reviewInputSchema>) => reviewSubmission(input),
  searchJobs: (input: z.infer<typeof searchJobsInputSchema>, fetcher: Fetcher = fetch) =>
    searchLiveJobs(input, fetcher),
  buildCandidatePassport: (input: z.infer<typeof buildCandidatePassportInputSchema>) =>
    buildCandidatePassport(input),
  prepareJobApplications: async (
    input: z.infer<typeof prepareJobApplicationsInputSchema>,
    fetcher: Fetcher = fetch,
  ) =>
    prepareJobApplications({
      passport: input.passport as CandidatePassport,
      jobs: await resolveLiveJobs(input.jobIds, fetcher),
    }),
  reviewJobApplication: async (
    input: z.infer<typeof reviewJobApplicationInputSchema>,
    fetcher: Fetcher = fetch,
  ) =>
    reviewJobApplication({
      job: (await resolveLiveJobs([input.jobId], fetcher))[0]!,
      destinationUrl: input.destinationUrl,
      fields: input.fields,
      ...(input.unresolvedQuestions
        ? { unresolvedQuestions: input.unresolvedQuestions }
        : {}),
    }),
};

const serverInstructions = [
  "Buffalo jobs come from the live public Buffalo Projects job index; users do not need to browse the board UI.",
  "For jobs: call buffalo.search_jobs, build a local passport with buffalo.build_candidate_passport, then call buffalo.prepare_job_applications with selected job IDs.",
  "Candidate passport data is not sent to Buffalo Projects. Browser execution belongs to the Claude, Codex, or other MCP host.",
  "Inspect every selected employer application before asking one deduplicated set of missing questions. Fill complete drafts from confirmed facts and evidence only.",
  "Never invent qualifications or answers. Never auto-answer voluntary demographic questions. Never bypass CAPTCHA, identity checks, assessments, signatures, or authentication.",
  "Call buffalo.review_job_application after filling each application. Show that exact application's fields and commitments and ask for point-of-action approval immediately before final submit.",
  "Accelerator and business-help tools remain available through buffalo.search_opportunities and the registration workflow.",
].join(" ");

export interface BuffaloServerOptions {
  fetcher?: Fetcher | undefined;
}

export function createBuffaloServer(options: BuffaloServerOptions = {}): McpServer {
  const fetcher = options.fetcher ?? fetch;
  const jobCache = new Map<string, LiveJob>();
  const server = new McpServer(
    { name: "buffalo-projects-tools", version: packageVersion },
    { instructions: serverInstructions },
  );

  server.registerTool(
    "buffalo.search_jobs",
    {
      title: "Search Buffalo Projects jobs",
      description:
        "Search the live public Buffalo Projects job index by role, employer, opportunity type, sector, work mode, source tier, pay, or recency. Returns official listing and application URLs; the user never needs to open the board UI.",
      inputSchema: searchJobsInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      const result = await toolHandlers.searchJobs(input, fetcher);
      for (const job of result.jobs) jobCache.set(job.id, job);
      return jsonResult(result);
    },
  );

  server.registerTool(
    "buffalo.build_candidate_passport",
    {
      title: "Build a reusable candidate passport",
      description:
        "Turn applicant-confirmed contact, resume, work, education, authorization, and evidence facts into a portable source-labeled passport. It stays in the MCP host and is not saved or sent to Buffalo Projects.",
      inputSchema: buildCandidatePassportInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => jsonResult(toolHandlers.buildCandidatePassport(input)),
  );

  server.registerTool(
    "buffalo.prepare_job_applications",
    {
      title: "Prepare complete job applications",
      description:
        "Resolve selected Buffalo Projects job IDs, merge reusable candidate facts, and return one host-browser handoff per official employer application. The host inspects all forms, asks missing questions once, uploads the resume, and fills drafts; this tool does not itself browse or submit.",
      inputSchema: prepareJobApplicationsInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      const jobs = await resolveWithCache(input.jobIds, jobCache, fetcher);
      return jsonResult(
        prepareJobApplications({
          passport: input.passport as CandidatePassport,
          jobs,
        }),
      );
    },
  );

  server.registerTool(
    "buffalo.review_job_application",
    {
      title: "Review a filled job application",
      description:
        "Verify the live destination for a Buffalo Projects job, flag invented or unconfirmed answers, sensitive and demographic fields, commitments, and unresolved questions, then produce the exact per-application approval prompt. This tool never submits.",
      inputSchema: reviewJobApplicationInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      const [job] = await resolveWithCache([input.jobId], jobCache, fetcher);
      return jsonResult(
        reviewJobApplication({
          job: job!,
          destinationUrl: input.destinationUrl,
          fields: input.fields,
          ...(input.unresolvedQuestions
            ? { unresolvedQuestions: input.unresolvedQuestions }
            : {}),
        }),
      );
    },
  );

  server.registerTool(
    "buffalo.search_opportunities",
    {
      title: "Find Buffalo opportunities",
      description:
        "Match a project against a reviewed catalog of official Buffalo, WNY, and relevant NYS accelerators, capital, grants, permits, procurement, and business-help starting points. Returns plausible matches, never eligibility claims.",
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
        "Build a source-labeled answer packet and a vendor-neutral browser/computer-use handoff for an official form. A capable MCP host can execute the handoff; text-only hosts receive a copy/paste packet.",
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
        "Check an opportunity destination, unsupported claims, disclosures, commitments, and unanswered questions, and produce the point-of-action approval prompt. This tool never submits.",
      inputSchema: reviewInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => jsonResult(toolHandlers.review(input)),
  );

  server.registerPrompt(
    "apply-to-buffalo-jobs",
    {
      title: "Find and apply to Buffalo jobs",
      description:
        "Search the Buffalo Projects job index and complete selected employer applications with the host browser.",
      argsSchema: {
        target: z.string().min(1),
        preferences: z.string().optional(),
      },
    },
    ({ target, preferences }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Target jobs: ${target}`,
              preferences ? `Preferences: ${preferences}` : "Preferences: Buffalo/WNY roles and fitting remote work.",
              "Use buffalo.search_jobs; do not make me browse the Buffalo Projects job board.",
              "Show a concise shortlist and let me select roles. Build or update my passport with buffalo.build_candidate_passport, marking only facts I directly confirmed as user-confirmed.",
              "Call buffalo.prepare_job_applications. Use your browser/computer tools to inspect every selected official employer form first, then ask me one deduplicated set of missing material questions.",
              "Upload my approved resume and fill every supported field. Do not infer qualifications, work authorization, sponsorship, salary, references, or voluntary demographic answers.",
              "Call buffalo.review_job_application for each completed draft. Show me the exact destination, answers, disclosures, and certifications and ask for approval immediately before submitting that application.",
              "After approved submission, capture the confirmation, application ID, timestamp, receipt URL or email, and next step. If blocked by login, CAPTCHA, assessment, identity check, or signature, hand me that exact step and continue afterward.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "register-in-buffalo",
    {
      title: "Find and prepare a Buffalo application",
      description: "Find a fitting Buffalo/WNY opportunity and prepare its registration safely.",
      argsSchema: { project: z.string().min(1), goal: z.string().optional() },
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
