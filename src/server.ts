import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  buildCandidatePassport,
  matchCandidateAnswers,
  prepareJobApplications,
  rememberCandidateAnswers,
  reviewJobApplication,
  type CandidatePassport,
} from "./candidate.js";
import {
  getOpportunity,
  opportunities,
  opportunityKinds,
  projectStages,
} from "./catalog.js";
import { catalogVerification, verificationFor } from "./catalog-evidence.js";
import { exportApprovedMaterials } from "./export-materials.js";
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
import {
  prepareApplicationMaterials,
  reviewApplicationMaterials,
} from "./materials.js";
import { rankJobs } from "./ranking.js";
import { prepareRegistration, reviewSubmission } from "./registration.js";
import { importResume, resumeFormats, type ResumeEvidence } from "./resume.js";
import { runJobScout } from "./scout.js";
import {
  applicationStatuses,
  candidateBlockerKinds,
  deleteCandidateProfile,
  getApplicationLedger,
  getLocalStorageStatus,
  listCandidateProfiles,
  loadCandidateProfile,
  recordApplicationProgress,
  saveCandidateProfile,
  saveJobScout,
} from "./storage.js";

export const packageVersion = "2.0.1";

const factSources = [
  "user-confirmed",
  "resume-evidence",
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
  candidateFactsSource: z.enum(["resume-evidence", "unverified-input"]).optional(),
  factsConfirmedByUser: z
    .boolean()
    .optional()
    .describe("True only after the applicant confirms these exact facts."),
});

const reusableApplicationAnswerSchema = z.object({
  answerId: z.string().min(1),
  question: z.string().min(1),
  normalizedQuestion: z.string().min(1),
  answer: z.string(),
  source: z.literal("user-confirmed"),
  sensitivity: z.enum(["ordinary", "personal", "material"]),
  scope: z.enum(["all-jobs", "employer", "job"]),
  employer: z.string().optional(),
  jobId: z.string().optional(),
  evidence: z.array(z.string()).optional(),
  confirmedAt: z.string(),
});

const candidatePassportSchema = z.object({
  version: z.literal("buffalo-candidate-passport/v2"),
  passportId: z.string().min(1),
  updatedAt: z.string(),
  candidate: candidateFactsSchema,
  evidence: z.array(candidateEvidenceSchema),
  claims: z.array(candidateClaimSchema),
  applicationAnswers: z.array(reusableApplicationAnswerSchema),
  readiness: z.object({
    status: z.enum(["ready", "needs-confirmation", "needs-shared-answers"]),
    missingQuestions: z.array(
      z.object({ id: z.string(), prompt: z.string(), reason: z.string() }),
    ),
    unverifiedClaimCount: z.number().int().min(0),
  }),
  excludedFromPassport: z.array(z.string()),
  portability: z.object({
    persisted: z.boolean(),
    profileId: z.string().optional(),
    note: z.string(),
  }),
});

const resumeEvidenceSchema = z.object({
  kind: z.literal("resume"),
  documentId: z.string().min(1),
  fileName: z.string().min(1),
  format: z.enum([...resumeFormats, "text-input"]),
  localPath: z.string().nullable(),
  byteLength: z.number().int().min(0),
  characterCount: z.number().int().min(0),
  pageCount: z.number().int().min(0).nullable(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  importedAt: z.string(),
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

const importResumeInputSchema = z.object({
  path: z.string().min(1).optional(),
  text: z.string().min(1).max(250_000).optional(),
  fileName: z.string().min(1).max(255).optional(),
});

const saveCandidatePassportInputSchema = z.object({
  profileId: z.string().min(1).max(100).optional(),
  label: z.string().min(1).max(100),
  passport: candidatePassportSchema,
  resume: resumeEvidenceSchema.nullable().optional(),
  consentToLocalStorage: z.boolean().describe(
    "True only after the applicant explicitly agrees to save private candidate memory on this machine.",
  ),
});

const profileIdInputSchema = z.object({ profileId: z.string().min(1).max(100) });

const rememberedAnswerInputSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  sensitivity: z.enum(["ordinary", "personal", "material"]),
  scope: z.enum(["all-jobs", "employer", "job"]).optional(),
  employer: z.string().optional(),
  jobId: z.string().optional(),
  evidence: z.array(z.string()).optional(),
  confirmedByUser: z.boolean(),
});

const rememberCandidateAnswersInputSchema = z
  .object({
    profileId: z.string().min(1).max(100).optional(),
    passport: candidatePassportSchema.optional(),
    answers: z.array(rememberedAnswerInputSchema).min(1).max(100),
  })
  .refine((value) => Boolean(value.profileId) !== Boolean(value.passport), {
    message: "Provide exactly one of profileId or passport.",
  });

const matchCandidateAnswersInputSchema = z.object({
  passport: candidatePassportSchema,
  questions: z.array(z.string().min(1)).min(1).max(100),
  employer: z.string().optional(),
  jobId: z.string().optional(),
});

const deleteCandidateProfileInputSchema = z.object({
  profileId: z.string().min(1).max(100),
  confirmedByUser: z.boolean(),
});

const rankingPreferencesSchema = z.object({
  preferredWorkModes: z.array(z.enum(jobWorkModes)).optional(),
  preferredSectors: z.array(z.enum(jobSectors)).optional(),
  preferredLocations: z.array(z.string()).optional(),
  requiredWords: z.array(z.string()).optional(),
  avoidWords: z.array(z.string()).optional(),
  excludeEmployers: z.array(z.string()).optional(),
  minAnnualPay: z.number().min(0).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

const rankJobsInputSchema = z.object({
  passport: candidatePassportSchema,
  jobIds: z.array(z.string().min(1)).min(1).max(50),
  preferences: rankingPreferencesSchema.optional(),
});

const prepareApplicationMaterialsInputSchema = z.object({
  passport: candidatePassportSchema,
  jobId: z.string().min(1),
  resume: resumeEvidenceSchema.nullable().optional(),
});

const proposedMaterialClaimSchema = z.object({
  text: z.string().min(1),
  evidenceKeys: z.array(z.string()).max(20),
});

const reviewApplicationMaterialsInputSchema = z.object({
  passport: candidatePassportSchema,
  jobId: z.string().min(1),
  originalResumeText: z.string().max(250_000),
  tailoredResumeText: z.string().max(250_000),
  coverLetter: z.string().max(50_000).optional(),
  proposedClaims: z.array(proposedMaterialClaimSchema).max(200),
});

const exportApprovedMaterialsInputSchema = z.object({
  profileId: z.string().min(1).max(100),
  jobId: z.string().min(1),
  originalResumeText: z.string().max(250_000),
  tailoredResumeText: z.string().min(1).max(250_000),
  coverLetter: z.string().max(50_000).optional(),
  proposedClaims: z.array(proposedMaterialClaimSchema).max(200),
  approvedByUser: z.boolean(),
});

const savedScoutFiltersSchema = searchJobsInputSchema.omit({
  cursor: true,
  newSince: true,
});

const saveJobScoutInputSchema = z.object({
  searchId: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  profileId: z.string().min(1).max(100).nullable().optional(),
  filters: savedScoutFiltersSchema,
});

const runJobScoutInputSchema = z.object({
  searchId: z.string().min(1).max(100),
  ranking: rankingPreferencesSchema.optional(),
});

const storedApplicationFieldSchema = z.object({
  label: z.string().min(1),
  value: z.string(),
  source: z.enum(factSources),
});

const checkpointSchema = z.object({
  kind: z.enum(candidateBlockerKinds),
  currentUrl: z.url(),
  completedFields: z.array(z.string()),
  remainingFields: z.array(z.string()),
  instruction: z.string().min(1),
});

const recordApplicationProgressInputSchema = z.object({
  profileId: z.string().min(1).max(100),
  jobId: z.string().min(1),
  status: z.enum(applicationStatuses),
  submittedAt: z.string().nullable().optional(),
  confirmationId: z.string().nullable().optional(),
  confirmationText: z.string().nullable().optional(),
  receiptUrl: z.url().nullable().optional(),
  receiptEmail: z.email().nullable().optional(),
  nextStep: z.string().nullable().optional(),
  followUpAt: z.string().nullable().optional(),
  resume: resumeEvidenceSchema.nullable().optional(),
  submittedFields: z.array(storedApplicationFieldSchema).max(300).optional(),
  checkpoint: checkpointSchema.nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
});

const getApplicationLedgerInputSchema = z.object({
  profileId: z.string().min(1).max(100).optional(),
  statuses: z.array(z.enum(applicationStatuses)).optional(),
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
    catalogCheckedAt: catalogVerification.generatedAt,
    notice:
      "Matches are plausible starting points, not eligibility decisions. verification.evidence quotes the official page text that code found for a status or deadline; an empty list means the page states neither. lastVerified is the last day the official page loaded and contradicted nothing in the catalog. Treat drift and never-verified entries as unconfirmed and check the official site.",
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
      verification: verificationFor(match.opportunity),
      reasons: match.reasons,
      caution: match.opportunity.caution,
    })),
  }),
  get: (input: z.infer<typeof getInputSchema>) => {
    const opportunity = getOpportunity(input.opportunityId);
    if (!opportunity) throw new Error(`Unknown opportunity: ${input.opportunityId}`);
    return { ...opportunity, verification: verificationFor(opportunity) };
  },
  prepare: (input: z.infer<typeof prepareInputSchema>) => prepareRegistration(input),
  review: (input: z.infer<typeof reviewInputSchema>) => reviewSubmission(input),
  searchJobs: (input: z.infer<typeof searchJobsInputSchema>, fetcher: Fetcher = fetch) =>
    searchLiveJobs(input, fetcher),
  buildCandidatePassport: (input: z.infer<typeof buildCandidatePassportInputSchema>) =>
    buildCandidatePassport(input),
  importResume: (input: z.infer<typeof importResumeInputSchema>) => importResume(input),
  rememberCandidateAnswers: (
    passport: CandidatePassport,
    answers: z.infer<typeof rememberedAnswerInputSchema>[],
  ) => rememberCandidateAnswers({ passport, answers }),
  matchCandidateAnswers: (
    input: z.infer<typeof matchCandidateAnswersInputSchema>,
  ) =>
    matchCandidateAnswers(input.passport as CandidatePassport, input.questions, {
      ...(input.employer ? { employer: input.employer } : {}),
      ...(input.jobId ? { jobId: input.jobId } : {}),
    }),
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
  "For jobs: look for a resume already attached or accessible to the host. If none is accessible, call buffalo.import_resume with no arguments and ask once for an upload; never make the applicant retype it.",
  "Import the resume, map explicit facts as resume-evidence, show the extraction once for corrections, then build the confirmed candidate passport.",
  "Candidate passport data is not sent to Buffalo Projects. Nothing persists unless the applicant explicitly opts into buffalo.save_candidate_passport; local memory rejects credentials, government IDs, banking data, and voluntary demographic answers.",
  "Search, rank a preliminary shortlist, inspect live descriptions, and let the applicant choose. Prepare no more than the selected applications.",
  "Inspect every selected employer application before asking one deduplicated set of missing questions. Fill complete drafts from confirmed facts and evidence only.",
  "Tailored resumes and cover letters require an evidence map and buffalo.review_application_materials before upload.",
  "Never invent qualifications or answers. Never auto-answer voluntary demographic questions. Never bypass CAPTCHA, identity checks, assessments, signatures, or authentication.",
  "For candidate-only controls, record a checkpoint, hand over that exact step, then resume. Call buffalo.review_job_application after filling each application and ask for point-of-action approval immediately before final submit.",
  "Record approved submissions, receipts, follow-ups, and outcomes in the local ledger only when the applicant chose local memory.",
  "Recurring scouting belongs to the host scheduler; buffalo.run_job_scout stores the last successful run and returns newer indexed jobs.",
  "Accelerator and business-help tools remain available through buffalo.search_opportunities and the registration workflow.",
].join(" ");

export interface BuffaloServerOptions {
  fetcher?: Fetcher | undefined;
  dataDir?: string | undefined;
}

export function createBuffaloServer(options: BuffaloServerOptions = {}): McpServer {
  const fetcher = options.fetcher ?? fetch;
  const dataDir = options.dataDir;
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
    "buffalo.import_resume",
    {
      title: "Import a resume",
      description:
        "Read an applicant-provided PDF, DOCX, TXT, Markdown file, or already extracted text locally. If no resume is accessible, returns the single upload request the host should ask. It never uploads or persists the resume.",
      inputSchema: importResumeInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => jsonResult(await toolHandlers.importResume(input)),
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
    "buffalo.save_candidate_passport",
    {
      title: "Save candidate memory locally",
      description:
        "After explicit applicant consent, save the approved passport, remembered answers, and optional resume metadata in an owner-only local data file. Resume text and file contents are not copied into storage.",
      inputSchema: saveCandidatePassportInputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) =>
      jsonResult(
        await saveCandidateProfile(
          {
            ...(input.profileId ? { profileId: input.profileId } : {}),
            label: input.label,
            passport: input.passport as CandidatePassport,
            ...(input.resume !== undefined
              ? { resume: input.resume as ResumeEvidence | null }
              : {}),
            consentToLocalStorage: input.consentToLocalStorage,
          },
          dataDir,
        ),
      ),
  );

  server.registerTool(
    "buffalo.list_candidate_profiles",
    {
      title: "List local candidate profiles",
      description:
        "List metadata for locally saved candidate profiles without returning their private facts.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      jsonResult({
        profiles: await listCandidateProfiles(dataDir),
        storage: await getLocalStorageStatus(dataDir),
      }),
  );

  server.registerTool(
    "buffalo.load_candidate_passport",
    {
      title: "Load local candidate memory",
      description:
        "Load one applicant-approved passport and resume metadata from this machine by profile ID.",
      inputSchema: profileIdInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => jsonResult(await loadCandidateProfile(input.profileId, dataDir)),
  );

  server.registerTool(
    "buffalo.remember_candidate_answers",
    {
      title: "Remember confirmed application answers",
      description:
        "Merge applicant-confirmed reusable answers into an in-memory passport or saved local profile. Exact job/employer scoping is preserved. Credentials, IDs, banking data, and voluntary demographic answers are rejected.",
      inputSchema: rememberCandidateAnswersInputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      if (input.profileId) {
        const profile = await loadCandidateProfile(input.profileId, dataDir);
        const passport = toolHandlers.rememberCandidateAnswers(
          profile.passport,
          input.answers,
        );
        return jsonResult(
          await saveCandidateProfile(
            {
              profileId: profile.profileId,
              label: profile.label,
              passport,
              resume: profile.resume,
              consentToLocalStorage: true,
            },
            dataDir,
          ),
        );
      }
      return jsonResult(
        toolHandlers.rememberCandidateAnswers(
          input.passport as CandidatePassport,
          input.answers,
        ),
      );
    },
  );

  server.registerTool(
    "buffalo.match_candidate_answers",
    {
      title: "Match remembered application answers",
      description:
        "Match live application questions against applicant-confirmed memory, honoring all-jobs, employer, and exact-job scope. Unmatched questions are returned for one deduplicated question pass.",
      inputSchema: matchCandidateAnswersInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) => jsonResult(toolHandlers.matchCandidateAnswers(input)),
  );

  server.registerTool(
    "buffalo.delete_candidate_profile",
    {
      title: "Delete local candidate memory",
      description:
        "Permanently delete a local candidate profile together with its saved scouts and application ledger after explicit confirmation.",
      inputSchema: deleteCandidateProfileInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) =>
      jsonResult(
        await deleteCandidateProfile(
          input.profileId,
          input.confirmedByUser,
          dataDir,
        ),
      ),
  );

  server.registerTool(
    "buffalo.rank_jobs",
    {
      title: "Rank a Buffalo job batch",
      description:
        "Produce a preliminary evidence-aware shortlist from Buffalo Projects IDs, candidate preferences, and listing metadata. It never claims eligibility or hiring fit; live descriptions still require inspection.",
      inputSchema: rankJobsInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      const jobs = await resolveWithCache(input.jobIds, jobCache, fetcher);
      return jsonResult(
        rankJobs(
          input.passport as CandidatePassport,
          jobs,
          input.preferences ?? {},
        ),
      );
    },
  );

  server.registerTool(
    "buffalo.prepare_application_materials",
    {
      title: "Prepare evidence-aware application materials",
      description:
        "Return the supported claim set and host instructions for a tailored resume and optional cover letter for one current Buffalo Projects job.",
      inputSchema: prepareApplicationMaterialsInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      const [job] = await resolveWithCache([input.jobId], jobCache, fetcher);
      return jsonResult(
        prepareApplicationMaterials(
          input.passport as CandidatePassport,
          job!,
          (input.resume as ResumeEvidence | null | undefined) ?? null,
        ),
      );
    },
  );

  server.registerTool(
    "buffalo.review_application_materials",
    {
      title: "Review tailored resume and cover letter",
      description:
        "Compare original and tailored resume text, validate each proposed claim's passport evidence keys, block unconfirmed or missing evidence, and return the applicant-review prompt.",
      inputSchema: reviewApplicationMaterialsInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      const [job] = await resolveWithCache([input.jobId], jobCache, fetcher);
      return jsonResult(
        reviewApplicationMaterials({
          passport: input.passport as CandidatePassport,
          job: job!,
          originalResumeText: input.originalResumeText,
          tailoredResumeText: input.tailoredResumeText,
          ...(input.coverLetter ? { coverLetter: input.coverLetter } : {}),
          proposedClaims: input.proposedClaims,
        }),
      );
    },
  );

  server.registerTool(
    "buffalo.export_approved_materials",
    {
      title: "Export approved resume and cover letter PDFs",
      description:
        "After the evidence review passes and the applicant approves the diff, create owner-only local PDF files plus an evidence manifest for upload to one selected job.",
      inputSchema: exportApprovedMaterialsInputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const [job] = await resolveWithCache([input.jobId], jobCache, fetcher);
      return jsonResult(
        await exportApprovedMaterials(
          {
            profileId: input.profileId,
            job: job!,
            originalResumeText: input.originalResumeText,
            tailoredResumeText: input.tailoredResumeText,
            ...(input.coverLetter ? { coverLetter: input.coverLetter } : {}),
            proposedClaims: input.proposedClaims,
            approvedByUser: input.approvedByUser,
          },
          dataDir,
        ),
      );
    },
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
    "buffalo.save_job_scout",
    {
      title: "Save a recurring Buffalo job search",
      description:
        "Save job-board filters and an optional candidate profile locally. A host scheduler can later call buffalo.run_job_scout; this MCP does not install a background service.",
      inputSchema: saveJobScoutInputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) =>
      jsonResult(
        await saveJobScout(
          {
            searchId: input.searchId,
            name: input.name,
            ...(input.profileId !== undefined ? { profileId: input.profileId } : {}),
            filters: input.filters,
          },
          dataDir,
        ),
      ),
  );

  server.registerTool(
    "buffalo.run_job_scout",
    {
      title: "Run a saved Buffalo job scout",
      description:
        "Search for jobs added since this scout's last successful run, optionally rank them against its local candidate profile, and advance the local scout checkpoint. Scheduling and notifications belong to the host.",
      inputSchema: runJobScoutInputSchema,
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input) => {
      const result = await runJobScout(
        {
          searchId: input.searchId,
          ...(input.ranking ? { ranking: input.ranking } : {}),
        },
        { fetcher, ...(dataDir ? { dataDir } : {}) },
      );
      for (const job of result.jobs) jobCache.set(job.id, job);
      return jsonResult(result);
    },
  );

  server.registerTool(
    "buffalo.record_application_progress",
    {
      title: "Record application progress or receipt",
      description:
        "Update the opt-in local application ledger, including exact-step login/CAPTCHA/assessment/signature checkpoints, submitted fields, confirmations, receipts, follow-ups, and outcomes. Prohibited sensitive and demographic fields are never stored.",
      inputSchema: recordApplicationProgressInputSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const [job] = await resolveWithCache([input.jobId], jobCache, fetcher);
      const entry = await recordApplicationProgress(
        {
          profileId: input.profileId,
          job: job!,
          status: input.status,
          ...(input.submittedAt !== undefined ? { submittedAt: input.submittedAt } : {}),
          ...(input.confirmationId !== undefined
            ? { confirmationId: input.confirmationId }
            : {}),
          ...(input.confirmationText !== undefined
            ? { confirmationText: input.confirmationText }
            : {}),
          ...(input.receiptUrl !== undefined ? { receiptUrl: input.receiptUrl } : {}),
          ...(input.receiptEmail !== undefined
            ? { receiptEmail: input.receiptEmail }
            : {}),
          ...(input.nextStep !== undefined ? { nextStep: input.nextStep } : {}),
          ...(input.followUpAt !== undefined ? { followUpAt: input.followUpAt } : {}),
          ...(input.resume !== undefined
            ? { resume: input.resume as ResumeEvidence | null }
            : {}),
          ...(input.submittedFields ? { submittedFields: input.submittedFields } : {}),
          ...(input.checkpoint !== undefined ? { checkpoint: input.checkpoint } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
        dataDir,
      );
      return jsonResult({
        entry,
        takeover: entry.checkpoint
          ? {
              status: "candidate-action-needed",
              currentUrl: entry.checkpoint.currentUrl,
              instruction: entry.checkpoint.instruction,
              resumeAfter:
                "After the applicant completes this exact control, inspect the same live page again, continue remaining fields, clear the checkpoint with a new progress update, and proceed to review.",
            }
          : null,
      });
    },
  );

  server.registerTool(
    "buffalo.get_application_ledger",
    {
      title: "Read the local application ledger",
      description:
        "Return saved application status, receipts, candidate-only checkpoints, follow-up dates, and outcomes for an opted-in local profile.",
      inputSchema: getApplicationLedgerInputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) =>
      jsonResult({
        applications: await getApplicationLedger(
          {
            ...(input.profileId ? { profileId: input.profileId } : {}),
            ...(input.statuses?.length ? { statuses: input.statuses } : {}),
          },
          dataDir,
        ),
      }),
  );

  server.registerTool(
    "buffalo.search_opportunities",
    {
      title: "Find Buffalo opportunities",
      description:
        "Match a project against a reviewed catalog of official Buffalo, WNY, and relevant NYS accelerators, capital, grants, permits, procurement, and business-help starting points. Returns plausible matches with last-verified dates and quoted official-page evidence, never eligibility claims.",
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
        "Return the reviewed official source, current-status note, quoted verification evidence and drift, registration route, browser allowlist, and caution for one catalog entry.",
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
              "First check whether a readable resume is already attached or accessible. If yes, call buffalo.import_resume with its local path or extracted text. If no, call buffalo.import_resume with no arguments and ask me once to upload/select it; never make me retype it.",
              "Map only explicit resume facts with candidateFactsSource=resume-evidence. Show me the extracted passport once for corrections, then rebuild it with factsConfirmedByUser=true. Load existing local candidate memory first when I have opted into it.",
              "Use buffalo.search_jobs; do not make me browse the Buffalo Projects job board. Use buffalo.rank_jobs for a preliminary best-five shortlist, inspect each live description, explain evidence and gaps, and let me remove roles.",
              "For each selected role, use buffalo.prepare_application_materials. Draft a tailored resume and cover letter only from supported claims, attach evidence keys to every material rewrite, show the diff, and call buffalo.review_application_materials. After I approve that diff, call buffalo.export_approved_materials to create the exact PDFs for upload.",
              "Call buffalo.prepare_job_applications. Inspect every selected employer form first, match saved answers, then ask me one deduplicated set of genuinely missing material questions. Remember only answers I confirm and only if I opted into local storage.",
              "Upload my approved materials and fill every supported field. Do not infer qualifications, employment dates, education, work authorization, sponsorship, salary, references, or voluntary demographic answers.",
              "If blocked by login, CAPTCHA, assessment, identity check, signature, or a voluntary demographic section, record the exact checkpoint, hand me that one step, and resume afterward.",
              "Call buffalo.review_job_application for each completed draft. Show me the exact destination, answers, disclosures, and certifications and ask for approval immediately before submitting that application.",
              "After approved submission, capture and record the confirmation, application ID, timestamp, receipt URL/email, next step, and follow-up date in the local ledger only if I opted into it.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "scout-buffalo-jobs",
    {
      title: "Run a recurring Buffalo job scout",
      description:
        "Run a saved Buffalo Projects job search from its last checkpoint and return a ranked new-job shortlist.",
      argsSchema: { searchId: z.string().min(1) },
    },
    ({ searchId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Saved scout: ${searchId}`,
              "Call buffalo.run_job_scout. Return only jobs added since the last successful run.",
              "If a candidate profile is attached, use its evidence-aware ranking and show the strongest five with reasons, gaps, pay, work mode, and official URLs.",
              "Do not auto-apply from a scheduled run. Ask me which roles to advance, then use the full apply-to-buffalo-jobs workflow.",
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
