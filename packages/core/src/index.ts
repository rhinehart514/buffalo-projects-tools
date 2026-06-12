import { scoreProjectDensity, type DensityReport } from "@buffalo/density";
import {
  projectMarkdownLineHint,
  projectFromMarkdown,
  projectTemplates,
  projectToMarkdown,
} from "@buffalo/projectmd";
import {
  projectSchema,
  type Profile,
  type Project,
  type ProjectEvidence,
  type ProjectTemplateType,
  type Vouch,
} from "@buffalo/schema";

// Codebase scan engine (filesystem + git, deterministic, no quality scoring).
export * from "./scan.js";

// Hosted request failures fall into a few distinct buckets that each need a
// different fix. A bare "failed with 429" sends people chasing rate limits when
// the real cause is usually a Vercel firewall challenge at the edge — that
// returns 429 + `x-vercel-mitigated` *before* the request reaches the app, so
// the API key is irrelevant. Classify the response so the co-pilot can tell the
// builder what is actually wrong and how to fix it.
export type HostedFailureKind =
  | "firewall"
  | "unauthorized"
  | "rate_limited"
  | "server"
  | "unknown";

export class HostedRequestError extends Error {
  readonly kind: HostedFailureKind;
  readonly status: number;
  constructor(kind: HostedFailureKind, status: number, message: string) {
    super(message);
    this.name = "HostedRequestError";
    this.kind = kind;
    this.status = status;
  }
}

// Accepts anything Response-shaped (status + headers.get), so it also works with
// the fetch mocks used in tests.
export function hostedRequestError(
  response: { status: number; headers: { get(name: string): string | null } },
  action: string,
  detail?: string,
): HostedRequestError {
  const status = response.status;
  const suffix = detail ? ` Server said: ${detail}` : "";
  // A Vercel firewall challenge returns 429 WITH this header before the app
  // runs, so this branch must come ahead of the plain 429 branch.
  const mitigated = response.headers.get("x-vercel-mitigated");
  if (mitigated) {
    return new HostedRequestError(
      "firewall",
      status,
      `Blocked by the Vercel firewall before reaching Buffalo (x-vercel-mitigated: ${mitigated}) while trying to ${action}. This is NOT your API key — a bot-protection rule is challenging non-browser clients. Fix it on the Buffalo side: set the project's bot_protection managed rule to "log", or add a System Bypass rule for /api/*.${suffix}`,
    );
  }
  if (status === 401 || status === 403) {
    return new HostedRequestError(
      "unauthorized",
      status,
      `Buffalo rejected the API key (HTTP ${status}) while trying to ${action}. The bp_ token is missing, invalid, or expired — mint a fresh key at /app/settings and set BUFFALO_TOKEN.${suffix}`,
    );
  }
  if (status === 429) {
    return new HostedRequestError(
      "rate_limited",
      status,
      `Buffalo rate-limited the request (HTTP 429) while trying to ${action}. Wait a few seconds and retry.${suffix}`,
    );
  }
  if (status >= 500) {
    return new HostedRequestError(
      "server",
      status,
      `Buffalo had a server error (HTTP ${status}) while trying to ${action}. Retry shortly; if it persists the hosted API may be down.${suffix}`,
    );
  }
  return new HostedRequestError(
    "unknown",
    status,
    `Could not ${action}: hosted request failed with HTTP ${status}.${suffix}`,
  );
}

export interface ProjectRepository {
  listByBuilder(builderId: string): Promise<Project[]>;
  getBySlug(builderHandle: string, slug: string): Promise<Project | null>;
  save(project: Project): Promise<Project>;
}

export interface ProfileRepository {
  getByHandle(handle: string): Promise<Profile | null>;
  save(profile: Profile): Promise<Profile>;
}

export interface VouchRepository {
  listForProject(projectId: string): Promise<Vouch[]>;
}

export interface DensityService {
  score(project: Project): DensityReport;
}

export interface BuffaloServices {
  projects: ProjectRepository;
  profiles: ProfileRepository;
  vouches: VouchRepository;
  density: DensityService;
}

export type ProjectSyncStateName =
  | "missing"
  | "untracked"
  | "local-only"
  | "remote-only"
  | "synced"
  | "diverged";

export interface ProjectSyncState {
  projectId: string;
  syncState: ProjectSyncStateName;
  lastPushedHash: string | null;
  lastPulledHash?: string | null;
  localHash: string | null;
  remotePath?: string;
  remoteHash?: string | null;
}

export interface ProjectSyncStatusInput {
  hasProject: boolean;
  hasMetadata: boolean;
  localHash: string | null;
  remoteHash: string | null;
}

export interface SyncDecision {
  ok: boolean;
  error?: string;
}

export interface ProjectRemoteSnapshot {
  markdown: string;
  hash: string;
  url?: string;
  updatedAt?: string;
}

export interface ProjectMarkdownSyncRepository {
  read(): Promise<ProjectRemoteSnapshot | null>;
  write(
    markdown: string,
    options?: {
      force?: boolean;
      lastPulledHash?: string | null;
    },
  ): Promise<ProjectRemoteSnapshot>;
}

export interface HttpProjectSyncRepositoryOptions {
  baseUrl: string;
  projectId: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface HttpProjectReadRepositoryOptions {
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface ProjectReadRepository {
  list(): Promise<Project[]>;
  get(projectId: string): Promise<Project | null>;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function projectSyncEndpoint(baseUrl: string, projectId: string): string {
  return `${baseUrl.replace(/\/+$/g, "")}/api/buffalo/projects/${encodeURIComponent(
    projectId,
  )}/project-md`;
}

function projectReadEndpoint(baseUrl: string, projectId?: string): string {
  const root = `${baseUrl.replace(/\/+$/g, "")}/api/builder/projects`;

  return projectId ? `${root}/${encodeURIComponent(projectId)}` : root;
}

function snapshotFromJson(value: unknown): ProjectRemoteSnapshot {
  const data = value as Partial<ProjectRemoteSnapshot>;

  if (typeof data.markdown !== "string" || typeof data.hash !== "string") {
    throw new Error("Hosted sync response did not include markdown and hash.");
  }

  return {
    markdown: data.markdown,
    hash: data.hash,
    url: data.url,
    updatedAt: data.updatedAt,
  };
}

export function createHttpProjectSyncRepository(
  options: HttpProjectSyncRepositoryOptions,
): ProjectMarkdownSyncRepository {
  const fetcher = options.fetchImpl ?? fetch;
  const endpoint = projectSyncEndpoint(
    options.baseUrl,
    trimSlashes(options.projectId),
  );
  const headers = {
    "content-type": "application/json",
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
  };

  return {
    async read() {
      const response = await fetcher(endpoint, {
        method: "GET",
        headers,
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw hostedRequestError(response, "read the hosted project markdown");
      }

      return snapshotFromJson(await response.json());
    },

    async write(markdown, writeOptions = {}) {
      const response = await fetcher(endpoint, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          markdown,
          force: writeOptions.force === true,
          lastPulledHash: writeOptions.lastPulledHash ?? null,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw hostedRequestError(
          response,
          "write the hosted project markdown",
          body || undefined,
        );
      }

      return snapshotFromJson(await response.json());
    },
  };
}

// The hosted API serializes empty project fields as `null` (Firestore's
// convention for "no value"), but projectSchema models absent fields as
// optional — and Zod's `.optional()` accepts `undefined`, not `null`. Convert
// top-level nulls to undefined at the wire boundary so sparse projects (the
// "never-empty record" whose columns are mostly still blank) parse cleanly
// instead of throwing on every empty field.
function normalizeProjectWire(project: unknown): unknown {
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    return project;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(
    project as Record<string, unknown>,
  )) {
    out[key] = value === null ? undefined : value;
  }
  return out;
}

export function createHttpProjectReadRepository(
  options: HttpProjectReadRepositoryOptions,
): ProjectReadRepository {
  const fetcher = options.fetchImpl ?? fetch;
  const headers = {
    "content-type": "application/json",
    ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
  };

  return {
    async list() {
      const response = await fetcher(projectReadEndpoint(options.baseUrl), {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        throw hostedRequestError(response, "list your Buffalo projects");
      }

      const data = (await response.json()) as { projects?: unknown[] };
      return (data.projects ?? []).map((project) =>
        projectSchema.parse(normalizeProjectWire(project)),
      );
    },

    async get(projectId) {
      const response = await fetcher(
        projectReadEndpoint(options.baseUrl, trimSlashes(projectId)),
        {
          method: "GET",
          headers,
        },
      );

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw hostedRequestError(response, "read this Buffalo project");
      }

      const data = (await response.json()) as { project?: unknown };

      return data.project
        ? projectSchema.parse(normalizeProjectWire(data.project))
        : null;
    },
  };
}

export function classifyProjectSyncState(
  input: ProjectSyncStatusInput,
): ProjectSyncStateName {
  if (!input.hasProject && input.remoteHash) {
    return "remote-only";
  }

  if (!input.hasProject) {
    return "missing";
  }

  if (!input.hasMetadata) {
    return "untracked";
  }

  if (input.remoteHash && input.remoteHash === input.localHash) {
    return "synced";
  }

  if (input.remoteHash) {
    return "diverged";
  }

  return "local-only";
}

export function decideProjectPush(input: {
  remoteHash: string | null;
  lastPulledHash: string | null | undefined;
  force?: boolean;
}): SyncDecision {
  if (
    input.remoteHash &&
    input.remoteHash !== (input.lastPulledHash ?? null) &&
    !input.force
  ) {
    return {
      ok: false,
      error:
        "Remote changed since the last pull. Re-run with --force to overwrite deliberately.",
    };
  }

  return { ok: true };
}

export function decideProjectPull(input: {
  localHash: string | null;
  recordedLocalHash: string | null | undefined;
  hasLocalProject: boolean;
  force?: boolean;
}): SyncDecision {
  if (
    input.hasLocalProject &&
    input.localHash &&
    !input.recordedLocalHash &&
    !input.force
  ) {
    return {
      ok: false,
      error:
        "Local project.md is not tracked by Buffalo yet. Re-run with --force to overwrite deliberately.",
    };
  }

  if (
    input.hasLocalProject &&
    input.localHash &&
    input.recordedLocalHash &&
    input.localHash !== input.recordedLocalHash &&
    !input.force
  ) {
    return {
      ok: false,
      error:
        "Local project.md has untracked changes. Re-run with --force to overwrite deliberately.",
    };
  }

  return { ok: true };
}

export interface DraftProjectInput {
  description: string;
  templateType?: ProjectTemplateType;
  context?: string;
  builderId?: string;
  now?: Date;
}

export interface DraftProjectResult {
  project: Project;
  markdown: string;
  prompts: string[];
}

export interface CheckDensityInput {
  project?: Project;
  markdown?: string;
}

export interface EvidenceSuggestion {
  id: string;
  type: ProjectEvidence["type"];
  source: string;
  caption: string;
  confidence: number;
  reason: string;
}

export interface SuggestEvidenceInput {
  project?: Project;
  markdown?: string;
  context?: string;
}

function compact(value: string | undefined | null): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function titleFromDescription(description: string): string {
  const firstSentence =
    compact(description).split(/[.!?]/)[0] ?? "Untitled project";
  const words = firstSentence.split(/\s+/).slice(0, 8).join(" ");

  return words || "Untitled project";
}

function extractUrls(value: string): string[] {
  return [...value.matchAll(/https?:\/\/[^\s)]+/g)].map(
    (match) => match[0] ?? "",
  );
}

function inferEvidenceType(source: string): ProjectEvidence["type"] {
  const lower = source.toLowerCase();

  if (lower.includes("github.com")) {
    return "repo";
  }
  if (lower.includes("loom.com")) {
    return "loom";
  }
  if (lower.endsWith(".pdf")) {
    return "pdf";
  }
  if (/\.(png|jpg|jpeg|gif|webp)$/i.test(lower)) {
    return "screenshot";
  }

  return "link";
}

function projectFromInput(
  input: CheckDensityInput | SuggestEvidenceInput,
): Project {
  if (input.project) {
    return projectSchema.parse(input.project);
  }

  if (input.markdown) {
    return projectSchema.parse(projectFromMarkdown(input.markdown));
  }

  throw new Error("Expected either project or markdown input.");
}

export function draftProject(input: DraftProjectInput): DraftProjectResult {
  const now = input.now ?? new Date();
  const templateType = input.templateType ?? "generic";
  const template = projectTemplates[templateType];
  const description = compact(input.description);
  const context = compact(input.context);
  const title = titleFromDescription(description || context);
  const evidence = extractUrls(`${description} ${context}`).map(
    (source, index) => ({
      id: `evidence-${index + 1}`,
      type: inferEvidenceType(source),
      source,
      caption: "Source mentioned during intake.",
      createdAt: now,
    }),
  );
  const project = projectSchema.parse({
    id:
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "local-project",
    builderId: input.builderId ?? "local-builder",
    title,
    description:
      description || "Add a direct summary of what this project does.",
    templateType,
    privacy: "private",
    stage: "planning",
    category: template.category,
    proofStatements: [],
    primarySkills: [],
    skillEvidence: [],
    evidence,
    milestones: [
      {
        id: "milestone-1",
        date: localDateString(now),
        title: "Drafted project record",
      },
    ],
    evidenceBindings: {
      customUrls: evidence.map((item) => item.source),
    },
    createdAt: now,
    lastActiveAt: now,
  });

  return {
    project,
    markdown: projectToMarkdown(project),
    prompts: template.prompts,
  };
}

export function checkDensity(input: CheckDensityInput): DensityReport {
  const report = scoreProjectDensity(projectFromInput(input));

  if (!input.markdown) {
    return report;
  }

  const dimensions = report.dimensions.map((dimension) => ({
    ...dimension,
    gaps: dimension.gaps.map((gap) => ({
      ...gap,
      line:
        gap.line ??
        projectMarkdownLineHint(input.markdown ?? "", gap.dimension),
    })),
  }));
  const gapItems = dimensions.flatMap((dimension) => dimension.gaps);

  return {
    ...report,
    dimensions,
    gapItems,
  };
}

export function suggestEvidence(
  input: SuggestEvidenceInput,
): EvidenceSuggestion[] {
  const project = projectFromInput(input);
  const existingSources = new Set(
    [
      project.projectUrl,
      project.githubRepoUrl,
      project.coverImageUrl,
      ...(project.evidence?.map((item) => item.source) ?? []),
    ].filter(Boolean),
  );
  const suggestions: EvidenceSuggestion[] = [];
  const context = input.context ?? input.markdown ?? "";

  for (const source of extractUrls(context)) {
    if (existingSources.has(source)) {
      continue;
    }

    suggestions.push({
      id: `suggestion-${suggestions.length + 1}`,
      type: inferEvidenceType(source),
      source,
      caption: "Potential evidence found in the provided context.",
      confidence:
        source.includes("github.com") || source.includes("loom.com")
          ? 0.86
          : 0.68,
      reason:
        "The source is an inspectable URL that is not already attached to the project.",
    });
  }

  if (
    !project.githubRepoUrl &&
    /commit|pull request|repository|github/i.test(context)
  ) {
    suggestions.push({
      id: `suggestion-${suggestions.length + 1}`,
      type: "repo",
      source: "current repository",
      caption: "Attach the working repository or relevant pull request.",
      confidence: 0.72,
      reason:
        "The context mentions repo activity but the project has no repository evidence.",
    });
  }

  if (
    (project.milestones?.length ?? 0) === 0 &&
    /finished|shipped|built|launched/i.test(context)
  ) {
    suggestions.push({
      id: `suggestion-${suggestions.length + 1}`,
      type: "metric",
      source: "work-session milestone",
      caption: "Log the completed work as a dated milestone.",
      confidence: 0.62,
      reason:
        "The context includes completion language but the project has no milestones.",
    });
  }

  return suggestions;
}
