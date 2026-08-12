import { z } from "zod";

export const jobOpportunityKinds = [
  "job",
  "internship",
  "apprenticeship",
  "civil_service_job",
  "civil_service_exam",
  "training",
  "contract",
  "temporary",
  "unknown",
] as const;

export const jobSectors = [
  "education",
  "healthcare",
  "public_service",
  "arts_culture",
  "nonprofit_community",
  "finance_insurance",
  "professional_services",
  "technology",
  "manufacturing",
  "construction_trades",
  "energy_utilities",
  "logistics_transportation",
  "retail_hospitality_food",
  "media",
  "training_apprenticeship",
  "multi_sector_board",
  "unknown",
] as const;

export const jobWorkModes = ["onsite", "hybrid", "remote", "unknown"] as const;

export const jobSourceTiers = [
  "canonical-employer",
  "official-public",
  "official-program",
  "staffing-agency",
  "local-board",
  "secondary",
  "unknown",
] as const;

export type JobOpportunityKind = (typeof jobOpportunityKinds)[number];
export type JobSector = (typeof jobSectors)[number];
export type JobWorkMode = (typeof jobWorkModes)[number];
export type JobSourceTier = (typeof jobSourceTiers)[number];

export const buffaloJobsWebUrl = "https://buffaloprojects.com/jobs";
export const buffaloJobsApiUrl = "https://buffaloprojects.com/api/jobs";

export interface SearchJobsInput {
  query?: string | undefined;
  opportunityKind?: JobOpportunityKind | undefined;
  sector?: JobSector | undefined;
  workMode?: JobWorkMode | undefined;
  sourceTier?: JobSourceTier | undefined;
  minPay?: number | undefined;
  newSince?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export interface LiveJob {
  id: string;
  externalId: string | null;
  sourceId: string;
  provider: "buffalo-projects-job-board";
  employer: string;
  title: string;
  location: string;
  workplace: JobWorkMode;
  commitment: string;
  department: JobSector;
  salary: string | null;
  compensation: {
    original: string | null;
    currency: string | null;
    min: number | null;
    max: number | null;
    period: string;
    provenance: string;
    annualMin: number | null;
    annualMax: number | null;
  };
  opportunityKind: JobOpportunityKind;
  employmentType: string;
  sourceTier: JobSourceTier;
  freshness: string;
  officialJobUrl: string;
  applyUrl: string;
  publishedAt: string | null;
  deadline: string | null;
  updatedAt: string | null;
  fetchedAt: string;
  boardCheckedAt: string;
  source: {
    organization: string | null;
    sourceUrl: string | null;
    careersUrl: string | null;
    platform: string | null;
    verifiedAt: string | null;
  };
}

const nullableString = z.string().nullable();
const rawJobSchema = z.object({
  id: z.string().min(1),
  externalId: nullableString,
  sourceId: z.string().min(1),
  title: z.string().min(1),
  employer: nullableString,
  opportunityKind: z.enum(jobOpportunityKinds),
  sector: z.enum(jobSectors),
  workMode: z.enum(jobWorkModes),
  employmentType: z.string(),
  sourceTier: z.enum(jobSourceTiers),
  freshness: z.string(),
  checkedAt: z.string(),
  postedAt: nullableString,
  deadline: nullableString,
  url: z.url().nullable(),
  applicationUrl: z.url(),
  location: z.object({
    display: nullableString,
    city: nullableString,
    region: nullableString,
    country: nullableString,
    workMode: z.enum(jobWorkModes),
  }),
  compensation: z.object({
    original: nullableString,
    currency: nullableString,
    min: z.number().nullable(),
    max: z.number().nullable(),
    period: z.string(),
    provenance: z.string(),
    annualMin: z.number().nullable(),
    annualMax: z.number().nullable(),
  }),
  source: z.object({
    organization: nullableString,
    sourceUrl: z.url().nullable(),
    careersUrl: z.url().nullable(),
    platform: nullableString,
    verifiedAt: nullableString,
  }),
});

const jobsResponseSchema = z.object({
  jobs: z.array(rawJobSchema),
  pagination: z.object({
    limit: z.number().int(),
    cursor: nullableString,
    nextCursor: nullableString,
    hasMore: z.boolean(),
    totalMatching: z.number().int(),
  }),
  coverage: z
    .object({
      checkedAt: z.string(),
      cacheReadStatus: z.string(),
      cacheError: nullableString,
      healthySourceCount: z.number().int(),
      quarantinedSourceCount: z.number().int(),
      failedSourceCount: z.number().int(),
      staleSourceCount: z.number().int(),
      activePostingCount: z.number().int(),
      matchingPostingCount: z.number().int(),
      returnedPostingCount: z.number().int(),
    })
    .passthrough(),
});

type Fetcher = typeof fetch;
type RawJob = z.infer<typeof rawJobSchema>;

function isHttpUrl(value: string): boolean {
  const protocol = new URL(value).protocol;
  return protocol === "https:" || protocol === "http:";
}

function compensationText(compensation: RawJob["compensation"]): string | null {
  if (compensation.original?.trim()) return compensation.original.trim();
  const values = [compensation.min, compensation.max]
    .filter((value): value is number => typeof value === "number")
    .map((value) => new Intl.NumberFormat("en-US").format(value));
  if (values.length === 0) return null;
  return [compensation.currency ?? "USD", values.join("–"), compensation.period]
    .filter(Boolean)
    .join(" ");
}

function toLiveJob(raw: RawJob, fetchedAt: string): LiveJob {
  if (!isHttpUrl(raw.applicationUrl) || (raw.url && !isHttpUrl(raw.url))) {
    throw new Error(`Job ${raw.id} has a non-web application destination.`);
  }
  return {
    id: raw.id,
    externalId: raw.externalId,
    sourceId: raw.sourceId,
    provider: "buffalo-projects-job-board",
    employer: raw.employer?.trim() || raw.source.organization?.trim() || "Employer not listed",
    title: raw.title,
    location: raw.location.display?.trim() || "Location not listed",
    workplace: raw.workMode,
    commitment: raw.employmentType,
    department: raw.sector,
    salary: compensationText(raw.compensation),
    compensation: raw.compensation,
    opportunityKind: raw.opportunityKind,
    employmentType: raw.employmentType,
    sourceTier: raw.sourceTier,
    freshness: raw.freshness,
    officialJobUrl: raw.url ?? raw.applicationUrl,
    applyUrl: raw.applicationUrl,
    publishedAt: raw.postedAt,
    deadline: raw.deadline,
    updatedAt: null,
    fetchedAt,
    boardCheckedAt: raw.checkedAt,
    source: raw.source,
  };
}

function queryString(input: SearchJobsInput): string {
  const params = new URLSearchParams();
  if (input.query?.trim()) params.set("q", input.query.trim());
  if (input.opportunityKind) params.set("opportunityKind", input.opportunityKind);
  if (input.sector) params.set("sector", input.sector);
  if (input.workMode) params.set("workMode", input.workMode);
  if (input.sourceTier) params.set("sourceTier", input.sourceTier);
  if (typeof input.minPay === "number") params.set("minPay", String(input.minPay));
  if (input.newSince) params.set("newSince", input.newSince);
  if (input.cursor) params.set("cursor", input.cursor);
  params.set("limit", String(input.limit ?? 20));
  return params.toString();
}

async function readResponse(response: Response): Promise<unknown> {
  if (response.ok) return response.json();
  let detail = "";
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") detail = `: ${body.error}`;
  } catch {
    // The status remains useful when an upstream proxy returns non-JSON.
  }
  throw new Error(
    `Buffalo Projects job board returned ${response.status} ${response.statusText}${detail}`,
  );
}

export async function searchLiveJobs(
  input: SearchJobsInput,
  fetcher: Fetcher = fetch,
) {
  const fetchedAt = new Date().toISOString();
  const response = await fetcher(`${buffaloJobsApiUrl}?${queryString(input)}`, {
    headers: {
      accept: "application/json",
      "user-agent":
        "buffalo-projects-tools/1.1 (+https://github.com/rhinehart514/buffalo-projects-tools)",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const parsed = jobsResponseSchema.safeParse(await readResponse(response));
  if (!parsed.success) {
    throw new Error("Buffalo Projects job board returned an unexpected response shape.");
  }

  return {
    source: {
      name: "Buffalo Projects live job index",
      webUrl: buffaloJobsWebUrl,
      apiUrl: buffaloJobsApiUrl,
      accountRequired: false,
    },
    notice:
      "These are current index records, not guarantees that an employer will accept an application. Confirm the live employer page before filling.",
    fetchedAt,
    jobs: parsed.data.jobs.map((job) => toLiveJob(job, fetchedAt)),
    pagination: parsed.data.pagination,
    coverage: parsed.data.coverage,
  };
}

export async function resolveLiveJobs(
  jobIds: string[],
  fetcher: Fetcher = fetch,
): Promise<LiveJob[]> {
  const ids = [...new Set(jobIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) throw new Error("Select at least one Buffalo Projects job.");
  if (ids.length > 50) throw new Error("Resolve no more than 50 jobs at a time.");

  const wanted = new Set(ids);
  const found = new Map<string, LiveJob>();
  let cursor: string | undefined;

  for (let page = 0; page < 25 && found.size < wanted.size; page += 1) {
    const result = await searchLiveJobs({ limit: 50, ...(cursor ? { cursor } : {}) }, fetcher);
    for (const job of result.jobs) {
      if (wanted.has(job.id)) found.set(job.id, job);
    }
    if (!result.pagination.hasMore || !result.pagination.nextCursor) break;
    cursor = result.pagination.nextCursor;
  }

  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new Error(
      `These Buffalo Projects jobs are no longer in the active index: ${missing.join(", ")}. Search again before applying.`,
    );
  }
  return ids.map((id) => found.get(id)!);
}
