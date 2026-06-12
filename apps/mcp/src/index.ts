import { createHash } from "node:crypto";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  createHttpProjectReadRepository,
  discoverProjectRoots,
  draftProject,
  hostedRequestError,
  HostedRequestError,
  scanCodebase,
  suggestEvidence,
  type DraftProjectInput,
  type SuggestEvidenceInput,
} from "@buffalo/core";
import { densityRubric } from "@buffalo/density";
import {
  appendMilestoneMarkdown,
  examplesForTemplate,
  projectExamples,
  projectTemplates,
} from "@buffalo/projectmd";
import { projectJsonSchema, projectSchema } from "@buffalo/schema";
import { profileCardHtml } from "./generated/profile-card-html.js";

export const buffaloMcpPackage = {
  name: "buffalo-projects-mcp",
  status: "stdio-server",
} as const;

const defaultHostedBaseUrl = "https://buffaloprojects.com";

/**
 * MCP Apps (SEP-1865, spec 2026-01-26) UI resource for the profile card that
 * hosts such as Claude and ChatGPT render inline when buffalo.get_velocity is
 * called. The HTML is generated at build time by scripts/build-app.mjs and is
 * fully self-contained (inline CSS/JS, no external fetches).
 */
export const profileCardResourceUri =
  "ui://buffalo-projects/profile-card.html";

const opportunityBoundary = {
  currentState:
    "Buffalo Projects provides read-only routing: it matches a builder against a public, aggregated corpus of Buffalo events and opportunities (grants, programs, fellowships, competitions) and surfaces what fits plus the gap to each target's own stated eligibility. It does NOT host opportunity supply, run a two-sided marketplace, make referrals, or guarantee access to mentors, recruiters, sponsors, grants, internships, or customers.",
  whatExists:
    "The MCP captures and organizes builder-side work signals (projects, work entries, evidence links, velocity summaries, resume-style briefs, vouch requests) and routes the builder to fitting public Buffalo targets (buffalo.match_targets / buffalo.list_opportunities).",
  futureUse:
    "Matching is discovery over public supply that already exists, not a seeded or guaranteed opportunity system; access, referrals, and placement are not provided.",
} as const;

export const buffaloResources = {
  "buffalo://schema/project": projectJsonSchema,
  "buffalo://templates/{type}": projectTemplates,
  "buffalo://examples/{type}": projectExamples,
  "buffalo://rubric": densityRubric,
} as const;

const templateTypeSchema = z.enum([
  "engineering",
  "lab",
  "business-case",
  "creative",
  "community",
  "hackathon",
  "generic",
]);

const inlineProjectInputSchema = z.object({
  project: z.record(z.string(), z.unknown()).optional(),
  markdown: z.string().optional(),
});

const draftProjectInputSchema = z.object({
  description: z.string().min(1),
  templateType: templateTypeSchema.optional(),
  context: z.string().optional(),
  builderId: z.string().optional(),
});

const suggestEvidenceInputSchema = inlineProjectInputSchema.extend({
  context: z.string().optional(),
});

const logMilestoneInputSchema = z.object({
  markdown: z.string().min(1),
  title: z.string().min(1),
  note: z.string().optional(),
  date: z.string().optional(),
});

const hostedReadInputSchema = z.object({
  baseUrl: z.string().url().optional(),
  token: z.string().optional(),
});

const authStatusInputSchema = hostedReadInputSchema.extend({
  verify: z.boolean().optional(),
});

const getProjectInputSchema = hostedReadInputSchema.extend({
  projectId: z.string().min(1),
});

const matchTargetsInputSchema = hostedReadInputSchema.extend({
  tags: z.string().min(1).optional(),
  stage: z.enum(["student", "early-founder", "any"]).optional(),
  geography: z.enum(["wny-local", "ny-state", "national"]).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const saveWorkInputSchema = hostedReadInputSchema.extend({
  title: z.string().min(1).max(200),
  note: z.string().max(4000).optional(),
  projectId: z.string().min(1).optional(),
  sourceUrl: z.string().url().optional(),
  operationId: z.string().min(1).optional(),
  visibility: z.enum(["private", "public"]).optional(),
});

const listWorkInputSchema = hostedReadInputSchema.extend({
  projectId: z.string().min(1).optional(),
  source: z.enum(["manual", "github", "mcp", "cli", "agent"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const velocityInputSchema = hostedReadInputSchema.extend({
  projectId: z.string().min(1).optional(),
  days: z.number().int().min(1).max(90).optional(),
});

const requestVouchInputSchema = hostedReadInputSchema.extend({
  projectId: z.string().min(1).optional(),
  note: z.string().max(200).optional(),
  expiresInDays: z.number().int().min(1).max(90).optional(),
});

const scanRepoInputSchema = hostedReadInputSchema.extend({
  cwd: z.string().optional(),
  sinceDays: z.number().int().positive().optional(),
  maxCandidates: z.number().int().positive().optional(),
  ignoreKeys: z.array(z.string()).optional(),
});

const findProjectsInputSchema = hostedReadInputSchema.extend({
  roots: z.array(z.string().min(1)).min(1).max(12).optional(),
  sinceDays: z.number().int().positive().optional(),
  maxCandidatesPerRoot: z.number().int().positive().optional(),
  maxCandidates: z.number().int().positive().max(100).optional(),
  ignoreKeys: z.array(z.string()).optional(),
});

const previewProjectWritesInputSchema = z.object({
  projects: z
    .array(
      z.object({
        title: z.string().min(1).max(500),
        description: z.string().max(2000).optional(),
        primarySkills: z.array(z.string()).optional(),
        githubRepoUrl: z.string().url().optional(),
        evidenceUrls: z.array(z.string().url()).optional(),
        sourceKey: z.string().optional(),
      }),
    )
    .min(1)
    .max(25),
});

const ignoreProjectsInputSchema = hostedReadInputSchema.extend({
  keys: z.array(z.string().min(1)).min(1).max(100),
});

const refreshProjectsInputSchema = findProjectsInputSchema.extend({
  projectId: z.string().min(1).optional(),
});

const buildResumeBriefInputSchema = findProjectsInputSchema.extend({
  audience: z
    .enum(["recruiter", "mentor", "investor", "technical-reviewer", "general"])
    .optional(),
});

const buildEvidenceGraphInputSchema = findProjectsInputSchema.extend({
  includeResumeBrief: z.boolean().optional(),
});

const addProjectsInputSchema = hostedReadInputSchema.extend({
  projects: z
    .array(
      z.object({
        title: z.string().min(1).max(500),
        description: z.string().max(2000).optional(),
        primarySkills: z.array(z.string()).optional(),
        githubRepoUrl: z.string().url().optional(),
        evidenceUrls: z.array(z.string().url()).optional(),
        sourceKey: z.string().optional(),
      }),
    )
    .min(1)
    .max(25),
});

const updateProjectInputSchema = hostedReadInputSchema.extend({
  projectId: z.string().min(1),
  description: z.string().max(2000).optional(),
  primarySkills: z.array(z.string()).optional(),
  currentAsk: z.string().max(500).optional(),
  proofStatements: z.array(z.string()).optional(),
  githubRepoUrl: z.string().url().optional(),
  evidenceUrls: z.array(z.string().url()).optional(),
});

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

// Lead a tool result with a short, human-readable confirmation (the demo's
// "✓ page updated · live at …" register) and keep the structured JSON as a
// second block, so the co-pilot has something legible to relay AND the full
// data to act on. summary is optional — callers without one are unchanged.
function content(value: unknown, summary?: string) {
  const blocks: { type: "text"; text: string }[] = [];
  if (summary) {
    blocks.push({ type: "text" as const, text: summary });
  }
  blocks.push({ type: "text" as const, text: jsonText(value) });
  return { content: blocks };
}

function resourceContents(uri: string, value: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: jsonText(value),
      },
    ],
  };
}

function evidenceInput(
  input: z.infer<typeof suggestEvidenceInputSchema>,
): SuggestEvidenceInput {
  return {
    markdown: input.markdown,
    context: input.context,
    project: input.project ? projectSchema.parse(input.project) : undefined,
  };
}

function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function hostedReadConfig(input: z.infer<typeof hostedReadInputSchema>) {
  const baseUrl =
    input.baseUrl ?? process.env["BUFFALO_BASE_URL"] ?? defaultHostedBaseUrl;
  const token = input.token ?? process.env["BUFFALO_TOKEN"];

  if (!token) {
    throw new Error(
      [
        "Buffalo hosted tools need a connected builder account.",
        "Run buffalo.auth_status for setup instructions, or set BUFFALO_TOKEN=bp_... in this MCP server's environment.",
        `Create an API key from ${baseUrl.replace(/\/+$/g, "")}/app/settings.`,
        "Local read-only tools such as buffalo.find_projects and buffalo.build_resume_brief work without login.",
        opportunityBoundary.currentState,
      ].join(" "),
    );
  }

  return { baseUrl, token };
}

async function authStatus(input: z.infer<typeof authStatusInputSchema>) {
  const baseUrl =
    input.baseUrl ?? process.env["BUFFALO_BASE_URL"] ?? defaultHostedBaseUrl;
  const token = input.token ?? process.env["BUFFALO_TOKEN"];
  const tokenSource = input.token
    ? "input"
    : process.env["BUFFALO_TOKEN"]
      ? "env:BUFFALO_TOKEN"
      : null;
  const host = baseUrl.replace(/\/+$/g, "");
  const instructions = {
    cliLogin: "buffalo login",
    mcpToken:
      "Create a Buffalo Projects API key, then set BUFFALO_TOKEN=bp_... in the buffalo-projects-mcp server config.",
    settingsUrl: `${host}/app/settings`,
    baseUrlEnv: `BUFFALO_BASE_URL=${host}`,
    codexAndClaudeServerName: buffaloMcpPackage.name,
  };
  const capabilityBoundary = opportunityBoundary;

  if (!token) {
    return {
      ok: false,
      authenticated: false,
      baseUrl: host,
      tokenSource,
      localTools: "ready",
      hostedTools: "needs-token",
      verification: {
        checked: false,
        reason: "No BUFFALO_TOKEN or input token was provided.",
      },
      instructions,
      capabilityBoundary,
    };
  }

  if (input.verify === false) {
    return {
      ok: true,
      authenticated: true,
      baseUrl: host,
      tokenSource,
      localTools: "ready",
      hostedTools: "configured",
      verification: {
        checked: false,
        reason: "Verification was skipped by request.",
      },
      instructions,
      capabilityBoundary,
    };
  }

  try {
    const projects = await createHttpProjectReadRepository({
      baseUrl: host,
      token,
    }).list();
    return {
      ok: true,
      authenticated: true,
      baseUrl: host,
      tokenSource,
      localTools: "ready",
      hostedTools: "verified",
      verification: {
        checked: true,
        ok: true,
        visibleProjectCount: projects.length,
      },
      instructions,
      capabilityBoundary,
    };
  } catch (error) {
    const kind = error instanceof HostedRequestError ? error.kind : "unknown";
    // Map the failure to a status the co-pilot can act on, instead of the old
    // ambiguous "token-present-but-not-verified" that hid firewall blocks behind
    // what looked like an auth problem.
    const hostedTools =
      kind === "firewall"
        ? "blocked-by-firewall"
        : kind === "unauthorized"
          ? "token-invalid"
          : kind === "rate_limited"
            ? "rate-limited"
            : "token-present-but-not-verified";
    return {
      // Only an explicit 401/403 proves the token itself is bad. A firewall
      // block or transient rate-limit means the request never reached the app —
      // the token may be perfectly valid — so don't report it as an auth error.
      ok: false,
      authenticated: false,
      baseUrl: host,
      tokenSource,
      localTools: "ready",
      hostedTools,
      verification: {
        checked: true,
        ok: false,
        kind,
        error: error instanceof Error ? error.message : "Unknown auth error.",
      },
      instructions,
      capabilityBoundary,
    };
  }
}

function hostedProjectRepository(input: z.infer<typeof hostedReadInputSchema>) {
  return createHttpProjectReadRepository(hostedReadConfig(input));
}

function maybeHostedReadConfig(input: z.infer<typeof hostedReadInputSchema>) {
  try {
    return hostedReadConfig(input);
  } catch {
    return null;
  }
}

function normalizeHostUrl(raw: string | undefined | null): string | undefined {
  if (!raw) {
    return undefined;
  }
  const value = raw.trim().replace(/^git\+/, "");
  const ssh = /^git@github\.com:(.+?)(?:\.git)?$/.exec(value);
  if (ssh?.[1]) {
    return `https://github.com/${ssh[1]}`.toLowerCase();
  }
  const https = /^https?:\/\/github\.com\/(.+?)(?:\.git)?$/i.exec(value);
  if (https?.[1]) {
    return `https://github.com/${https[1]}`.toLowerCase();
  }
  return value.replace(/\/+$/g, "").toLowerCase();
}

function sourceKeyForRoot(path: string): string {
  return `root:${createHash("sha256").update(path).digest("hex").slice(0, 12)}`;
}

function redactedRootLabel(path: string): string {
  const home = homedir();
  if (path === home) {
    return "~";
  }
  if (path.startsWith(`${home}/`)) {
    const rel = relative(home, path);
    const parts = rel.split("/");
    return `~/${parts.slice(Math.max(0, parts.length - 2)).join("/")}`;
  }
  return basename(path) || path;
}

function isUnsafeScanRoot(path: string): string | null {
  const home = homedir();
  if (path === "/" || /^[A-Z]:\\?$/i.test(path)) {
    return "Refusing to scan a whole filesystem root.";
  }
  if (path === home) {
    return "Refusing to scan the entire home folder. Pass narrower approved roots such as ~/Projects or ~/Developer.";
  }
  const rel = path.startsWith(`${home}/`) ? relative(home, path) : path;
  const parts = rel.split(/[\\/]+/).filter(Boolean);
  if (
    parts.some((part) =>
      [".ssh", ".gnupg", ".aws", "Library", "Mail"].includes(part),
    )
  ) {
    return "Refusing to scan a sensitive system, credential, or mail folder.";
  }
  return null;
}

function realScanRoot(path: string): { path: string; error?: string } {
  const expanded = path.startsWith("~/")
    ? join(homedir(), path.slice(2))
    : path;
  const absolute = resolve(expanded);
  if (!existsSync(absolute)) {
    return { path: absolute, error: "Root does not exist." };
  }
  try {
    const real = realpathSync(absolute);
    return { path: real, error: isUnsafeScanRoot(real) ?? undefined };
  } catch {
    return { path: absolute, error: "Root is not readable." };
  }
}

// Discovery is shared with the CLI via @buffalo/core so the two never drift on
// "which folders here are projects?". When a root has no project-shaped
// children at all, fall back to scanning the root itself.
function projectLikeDirs(root: string): string[] {
  const found = discoverProjectRoots(root);
  return found.length > 0 ? found : [root];
}

async function readRemoteIgnoreKeys(
  input: z.infer<typeof hostedReadInputSchema>,
): Promise<string[]> {
  const config = maybeHostedReadConfig(input);
  if (!config) {
    return [];
  }
  try {
    const response = await fetch(
      `${config.baseUrl.replace(/\/+$/g, "")}/api/builder/me/scan-ignore`,
      { headers: { authorization: `Bearer ${config.token}` } },
    );
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as { keys?: unknown };
    return Array.isArray(data.keys)
      ? data.keys.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return [];
  }
}

function projectWritePreview(
  projects: z.infer<typeof previewProjectWritesInputSchema>["projects"],
) {
  return {
    count: projects.length,
    privacy: "link",
    willSend: projects.map((project) => ({
      title: project.title,
      description: project.description ?? "",
      primarySkills: project.primarySkills ?? [],
      githubRepoUrl: project.githubRepoUrl ?? null,
      evidenceUrls: project.evidenceUrls ?? [],
      sourceKey: project.sourceKey ?? null,
    })),
    willNotSend: [
      "absolute local filesystem paths",
      "file contents",
      "environment variables",
      "secrets or hidden credential folders",
    ],
  };
}

function topCounts(values: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function audienceFrame(
  audience: z.infer<typeof buildResumeBriefInputSchema>["audience"],
) {
  if (audience === "technical-reviewer") {
    return "technical reviewer";
  }
  if (audience === "investor") {
    return "ecosystem or opportunity reviewer";
  }
  return audience ?? "general";
}

async function existingProjectSignals(
  input: z.infer<typeof hostedReadInputSchema>,
) {
  try {
    const projects = await hostedProjectRepository(input).list();
    return {
      projects,
      existingRepoUrls: projects
        .map((p) => p.githubRepoUrl)
        .filter((u): u is string => Boolean(u)),
      existingTitles: projects.map((p) => p.title),
    };
  } catch {
    return { projects: [], existingRepoUrls: [], existingTitles: [] };
  }
}

async function findMachineProjects(
  input: z.infer<typeof findProjectsInputSchema>,
) {
  const roots = input.roots ??
    process.env["BUFFALO_SCAN_ROOTS"]
      ?.split(",")
      .map((root) => root.trim()) ?? [
      process.env["BUFFALO_SCAN_CWD"] ?? process.cwd(),
    ];
  const resolved = roots.map(realScanRoot);
  const refusedRoots = resolved
    .filter((root) => root.error)
    .map((root) => ({
      root: redactedRootLabel(root.path),
      reason: root.error,
    }));
  const allowedRoots = resolved
    .filter((root) => !root.error)
    .map((root) => root.path);
  const remoteIgnoreKeys = await readRemoteIgnoreKeys(input);
  const ignoreKeys = [
    ...new Set([...(input.ignoreKeys ?? []), ...remoteIgnoreKeys]),
  ];
  const { existingRepoUrls, existingTitles } =
    await existingProjectSignals(input);

  const scans = [];
  for (const root of allowedRoots) {
    for (const target of projectLikeDirs(root)) {
      try {
        const result = await scanCodebase({
          cwd: target,
          sinceDays: input.sinceDays,
          maxCandidates: input.maxCandidatesPerRoot ?? 25,
          existingRepoUrls,
          existingTitles,
          ignoreKeys,
        });
        scans.push({
          root,
          target,
          result,
        });
      } catch {
        scans.push({
          root,
          target,
          result: null,
        });
      }
    }
  }

  const seen = new Set<string>();
  const candidates = scans.flatMap((scan) => {
    if (!scan.result) {
      return [];
    }
    return scan.result.candidates
      .map((candidate) => {
        const rootKey = sourceKeyForRoot(scan.target);
        const key = `${rootKey}:${candidate.key}`;
        const dedupeKey = [
          normalizeHostUrl(candidate.githubRepoUrl) ?? "no-repo",
          candidate.key,
          candidate.sourcePaths.join(","),
        ].join(":");
        if (seen.has(dedupeKey)) {
          return null;
        }
        seen.add(dedupeKey);
        return {
          ...candidate,
          key,
          sourceKey: key,
          localRoot: redactedRootLabel(scan.target),
          addProjectInput: {
            title: candidate.title,
            description: candidate.resumeSummary ?? candidate.summary,
            primarySkills: candidate.skills,
            githubRepoUrl: candidate.githubRepoUrl,
            evidenceUrls: candidate.evidenceUrls,
            sourceKey: key,
          },
        };
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> =>
        Boolean(candidate),
      );
  });
  candidates.sort((a, b) => b.activity - a.activity);
  const capped = candidates.slice(0, input.maxCandidates ?? 50);
  const skippedByReason = new Map<string, number>();
  for (const skip of scans.flatMap((scan) => scan.result?.skipped ?? [])) {
    skippedByReason.set(
      skip.reason,
      (skippedByReason.get(skip.reason) ?? 0) + skip.count,
    );
  }
  const skipped = [...skippedByReason.entries()].map(([reason, count]) => ({
    reason,
    count,
  }));
  if (candidates.length > capped.length) {
    skipped.push({
      reason: "over-cap",
      count: candidates.length - capped.length,
    });
  }
  return {
    scannedAt: new Date().toISOString(),
    approval: {
      note: input.roots
        ? "Scanned only the approved roots provided in this call."
        : "No roots were provided; scanned BUFFALO_SCAN_ROOTS/BUFFALO_SCAN_CWD or the MCP server cwd only.",
      scannedRoots: allowedRoots.map(redactedRootLabel),
      refusedRoots,
      ignoredKeysLoaded: ignoreKeys.length,
    },
    candidates: capped,
    skipped,
    preview: projectWritePreview(
      capped.map((candidate) => candidate.addProjectInput),
    ),
    nextStep:
      "Show this preview to the builder. Only call buffalo.add_projects for candidates they explicitly approve.",
  };
}

async function buildResumeBrief(
  input: z.infer<typeof buildResumeBriefInputSchema>,
) {
  const inventory = await findMachineProjects(input);
  const candidates = inventory.candidates;
  const skills = topCounts(
    candidates.flatMap((candidate) => candidate.skills),
    12,
  );
  const languages = topCounts(
    candidates.flatMap((candidate) => candidate.languages),
    6,
  );
  const totalRecentCommits = candidates.reduce(
    (sum, candidate) => sum + candidate.recency.commitCount,
    0,
  );
  const activeProjects = candidates.filter(
    (candidate) => candidate.recency.commitCount > 0,
  ).length;
  const audience = audienceFrame(input.audience);
  const strongest = candidates.slice(0, 6);
  // Aggregate the real accomplishment signal (commit subjects) across the
  // strongest projects, deduped — this is what the co-pilot synthesizes from.
  const recentWork = [
    ...new Set(strongest.flatMap((candidate) => candidate.recentWork ?? [])),
  ].slice(0, 10);
  const headline =
    skills.length > 0
      ? `Builder shipping ${activeProjects || candidates.length} active project${
          (activeProjects || candidates.length) === 1 ? "" : "s"
        } across ${joinForBrief(skills.slice(0, 4))}.`
      : `Builder with ${candidates.length} local project candidate${
          candidates.length === 1 ? "" : "s"
        } ready to organize.`;
  const profileSummary = [
    headline,
    totalRecentCommits > 0
      ? `Local evidence shows ${totalRecentCommits} recent commit${
          totalRecentCommits === 1 ? "" : "s"
        } across approved roots.`
      : "Local evidence is present, but recent commit activity was not detected in the scan window.",
    `The brief is shaped for a ${audience} and uses synthesized metadata rather than raw source files.`,
  ].join(" ");

  return {
    scannedAt: inventory.scannedAt,
    audience,
    headline,
    profileSummary,
    coreSkills: skills,
    languages,
    recentWork,
    projectHighlights: strongest.map((candidate) => ({
      title: candidate.title,
      summary: candidate.resumeSummary ?? candidate.summary,
      bullets: candidate.resumeBullets ?? [],
      // Raw synthesis fuel: actual shipped work + README prose. The co-pilot
      // turns these into polished, accomplishment-first bullets (see synthesis).
      recentWork: candidate.recentWork ?? [],
      readmeExcerpt: candidate.localSignals?.readmeExcerpt ?? null,
      evidence: {
        githubRepoUrl: candidate.githubRepoUrl ?? null,
        evidenceUrls: candidate.evidenceUrls,
        recentCommits: candidate.recency.commitCount,
      },
      sourceKey: candidate.sourceKey,
      localRoot: candidate.localRoot,
    })),
    resumeBullets: [
      skills.length ? `Builds with ${joinForBrief(skills.slice(0, 6))}.` : null,
      activeProjects
        ? `Maintains ${activeProjects} recently active project${
            activeProjects === 1 ? "" : "s"
          } across approved local roots.`
        : null,
      totalRecentCommits
        ? `Shows ${totalRecentCommits} recent commit${
            totalRecentCommits === 1 ? "" : "s"
          } of shipping activity.`
        : null,
      strongest.some(
        (candidate) => candidate.githubRepoUrl || candidate.evidenceUrls.length,
      )
        ? "Connects work to inspectable repositories or external evidence."
        : null,
    ].filter((bullet): bullet is string => Boolean(bullet)),
    privacy: {
      scannedRoots: inventory.approval.scannedRoots,
      refusedRoots: inventory.approval.refusedRoots,
      readPolicy:
        "Uses approved roots and bounded project metadata. Does not return raw source files, secrets, environment variables, or absolute local filesystem paths.",
      writePolicy:
        "This tool is read-only. Use buffalo.preview_project_writes before any project creation.",
    },
    capabilityBoundary: opportunityBoundary,
    synthesis: {
      role: "You are turning raw local signal into a builder's resume/proof bullets.",
      instruction:
        "For each project highlight, use recentWork (real commit subjects), readmeExcerpt, and skills to write 3-5 punchy bullets that LEAD with what was built and its outcome/impact. Group related commits into one accomplishment. Do NOT pad with commit counts, alphabetical tech lists, or filler like 'has a test workflow'. Keep each bullet to one concrete, verifiable line. Never invent metrics or claims the signal does not support. Finish with a one-sentence headline of what this builder ships. The `bullets` already on each highlight are a deterministic fallback — replace them with your synthesis.",
      rules: [
        "Accomplishment first: 'Built X that does Y', not 'made N commits'.",
        "Only claims grounded in recentWork / readmeExcerpt / evidence — no fabrication.",
        "One line per bullet; cut generic tech-stack and workflow filler.",
      ],
    },
    nextStep:
      "Synthesize accomplishment-first bullets per the `synthesis` block using each highlight's recentWork + readmeExcerpt, show them to the builder, then use approved projectHighlights to update Buffalo project descriptions or resume copy.",
  };
}

function evidenceId(value: string): string {
  return `ev_${createHash("sha256").update(value).digest("hex").slice(0, 12)}`;
}

function candidateEvidenceItems(
  candidate: Awaited<
    ReturnType<typeof findMachineProjects>
  >["candidates"][number],
) {
  const items = [];
  if (candidate.githubRepoUrl) {
    items.push({
      id: evidenceId(
        `${candidate.sourceKey}:github:${candidate.githubRepoUrl}`,
      ),
      type: "github-repo",
      label: "GitHub repository",
      url: candidate.githubRepoUrl,
      projectTitle: candidate.title,
      sourceKey: candidate.sourceKey,
      public: true,
    });
  }
  for (const url of candidate.evidenceUrls) {
    items.push({
      id: evidenceId(`${candidate.sourceKey}:url:${url}`),
      type: "external-url",
      label: "External evidence link",
      url,
      projectTitle: candidate.title,
      sourceKey: candidate.sourceKey,
      public: true,
    });
  }
  if (candidate.recency.commitCount > 0) {
    items.push({
      id: evidenceId(
        `${candidate.sourceKey}:commits:${candidate.recency.commitCount}`,
      ),
      type: "local-git-signal",
      label: `${candidate.recency.commitCount} recent commit${
        candidate.recency.commitCount === 1 ? "" : "s"
      }`,
      projectTitle: candidate.title,
      sourceKey: candidate.sourceKey,
      public: false,
    });
  }
  const sourceFileCount = candidate.localSignals?.sourceFileCount ?? 0;
  if (sourceFileCount > 0) {
    items.push({
      id: evidenceId(`${candidate.sourceKey}:source-files:${sourceFileCount}`),
      type: "local-structure-signal",
      label: `${sourceFileCount} source file${sourceFileCount === 1 ? "" : "s"}`,
      projectTitle: candidate.title,
      sourceKey: candidate.sourceKey,
      public: false,
    });
  }
  for (const manifest of candidate.localSignals?.manifests ?? []) {
    items.push({
      id: evidenceId(`${candidate.sourceKey}:manifest:${manifest}`),
      type: "local-manifest-signal",
      label: manifest,
      projectTitle: candidate.title,
      sourceKey: candidate.sourceKey,
      public: false,
    });
  }
  return items;
}

function confidenceForCandidate(
  candidate: Awaited<
    ReturnType<typeof findMachineProjects>
  >["candidates"][number],
) {
  const publicEvidence =
    (candidate.githubRepoUrl ? 1 : 0) + candidate.evidenceUrls.length;
  const sourceFiles = candidate.localSignals?.sourceFileCount ?? 0;
  if (publicEvidence > 0 && candidate.recency.commitCount >= 5) {
    return "high";
  }
  if (
    publicEvidence > 0 ||
    candidate.recency.commitCount > 0 ||
    sourceFiles >= 5
  ) {
    return "medium";
  }
  return "low";
}

function projectProofGaps(
  candidate: Awaited<
    ReturnType<typeof findMachineProjects>
  >["candidates"][number],
) {
  const gaps: Array<{
    id: string;
    projectTitle: string;
    sourceKey: string;
    severity: "high" | "medium" | "low";
    gapType:
      | "public-evidence"
      | "outcome"
      | "role"
      | "recency"
      | "validation"
      | "summary";
    message: string;
    nextAction: string;
    whyItMatters: string;
  }> = [];
  const hasPublicEvidence =
    Boolean(candidate.githubRepoUrl) || candidate.evidenceUrls.length > 0;
  const summary =
    `${candidate.summary} ${candidate.resumeSummary ?? ""}`.toLowerCase();
  const bullets = (candidate.resumeBullets ?? []).join(" ").toLowerCase();
  const text = `${summary} ${bullets}`;
  const sourceFiles = candidate.localSignals?.sourceFileCount ?? 0;

  if (!hasPublicEvidence) {
    gaps.push({
      id: evidenceId(`${candidate.sourceKey}:gap:public-evidence`),
      projectTitle: candidate.title,
      sourceKey: candidate.sourceKey,
      severity: "high",
      gapType: "public-evidence",
      message:
        "This project has local signals but no public proof link attached.",
      nextAction:
        "Add a GitHub repo, live demo, screenshot, write-up, or other inspectable evidence URL before using it externally.",
      whyItMatters:
        "External reviewers need something they can inspect without seeing local files.",
    });
  }

  if (
    !/\b(user|users|customer|customers|student|students|team|teams|saved|grew|launched|shipped|reduced|increased|used by)\b/.test(
      text,
    )
  ) {
    gaps.push({
      id: evidenceId(`${candidate.sourceKey}:gap:outcome`),
      projectTitle: candidate.title,
      sourceKey: candidate.sourceKey,
      severity: "medium",
      gapType: "outcome",
      message:
        "The project summary does not clearly state who benefited or what changed.",
      nextAction:
        "Add one outcome sentence: who used it, what improved, what shipped, or what decision it enabled.",
      whyItMatters:
        "Opportunity reviewers can evaluate shipped impact faster when the outcome is explicit.",
    });
  }

  if (
    !/\b(i|my|owned|led|built|designed|implemented|shipped|maintained|created)\b/.test(
      text,
    )
  ) {
    gaps.push({
      id: evidenceId(`${candidate.sourceKey}:gap:role`),
      projectTitle: candidate.title,
      sourceKey: candidate.sourceKey,
      severity: "medium",
      gapType: "role",
      message:
        "The builder's specific role is not obvious from the safe summary.",
      nextAction:
        "Add a role line that names what the builder personally owned, built, or decided.",
      whyItMatters:
        "Evidence is stronger when reviewers can separate individual contribution from project context.",
    });
  }

  if (candidate.recency.commitCount === 0 && sourceFiles > 0) {
    gaps.push({
      id: evidenceId(`${candidate.sourceKey}:gap:recency`),
      projectTitle: candidate.title,
      sourceKey: candidate.sourceKey,
      severity: "low",
      gapType: "recency",
      message:
        "The scan found project structure but no recent commit activity in the selected window.",
      nextAction:
        "Log a recent work entry or widen the scan window if this project is still active.",
      whyItMatters:
        "Work velocity is clearer when recent activity and milestones are visible.",
    });
  }

  if (hasPublicEvidence && candidate.recency.commitCount > 0) {
    gaps.push({
      id: evidenceId(`${candidate.sourceKey}:gap:validation`),
      projectTitle: candidate.title,
      sourceKey: candidate.sourceKey,
      severity: "low",
      gapType: "validation",
      message:
        "This project has evidence; the next credibility layer is validation.",
      nextAction:
        "Ask a mentor, teammate, user, or organizer to vouch for a specific claim after the project is added.",
      whyItMatters:
        "Vouches turn self-reported work into externally validated work.",
    });
  }

  if ((candidate.resumeSummary ?? candidate.summary).length < 80) {
    gaps.push({
      id: evidenceId(`${candidate.sourceKey}:gap:summary`),
      projectTitle: candidate.title,
      sourceKey: candidate.sourceKey,
      severity: "low",
      gapType: "summary",
      message: "The project summary is thin.",
      nextAction:
        "Expand the summary with the problem, shipped artifact, stack, and current status.",
      whyItMatters:
        "A denser summary helps agents and people route attention without guessing.",
    });
  }

  return gaps;
}

async function buildEvidenceGraph(
  input: z.infer<typeof buildEvidenceGraphInputSchema>,
) {
  const inventory = await findMachineProjects(input);
  const evidence = inventory.candidates.flatMap(candidateEvidenceItems);
  const skills = topCounts(
    inventory.candidates.flatMap((candidate) => candidate.skills),
    30,
  ).map((skill) => {
    const projects = inventory.candidates.filter((candidate) =>
      candidate.skills.includes(skill),
    );
    const evidenceCount = projects
      .flatMap(candidateEvidenceItems)
      .filter((item) => item.public || item.type.includes("local")).length;
    return {
      name: skill,
      projectCount: projects.length,
      evidenceCount,
      confidence: projects.some(
        (project) => confidenceForCandidate(project) === "high",
      )
        ? "high"
        : projects.some(
              (project) => confidenceForCandidate(project) === "medium",
            )
          ? "medium"
          : "low",
      projects: projects.map((project) => ({
        title: project.title,
        sourceKey: project.sourceKey,
      })),
    };
  });
  const projects = inventory.candidates.map((candidate) => {
    const projectEvidence = candidateEvidenceItems(candidate);
    return {
      title: candidate.title,
      sourceKey: candidate.sourceKey,
      localRoot: candidate.localRoot,
      summary: candidate.resumeSummary ?? candidate.summary,
      skills: candidate.skills,
      languages: candidate.languages,
      confidence: confidenceForCandidate(candidate),
      claims: [
        {
          id: evidenceId(`${candidate.sourceKey}:claim:summary`),
          text: candidate.resumeSummary ?? candidate.summary,
          confidence: confidenceForCandidate(candidate),
          evidenceIds: projectEvidence.map((item) => item.id),
        },
        ...candidate.skills.slice(0, 8).map((skill) => ({
          id: evidenceId(`${candidate.sourceKey}:claim:skill:${skill}`),
          text: `Shows ${skill} through ${candidate.title}.`,
          confidence: confidenceForCandidate(candidate),
          evidenceIds: projectEvidence.map((item) => item.id),
        })),
      ],
      evidenceIds: projectEvidence.map((item) => item.id),
      workSignals: {
        recentCommits: candidate.recency.commitCount,
        lastCommitAt: candidate.recency.lastCommitAt,
        sourceFileCount: candidate.localSignals?.sourceFileCount ?? 0,
        manifests: candidate.localSignals?.manifests ?? [],
        scripts: candidate.localSignals?.scripts ?? [],
      },
      publicEvidenceCount: projectEvidence.filter((item) => item.public).length,
    };
  });
  const proofGaps = inventory.candidates.flatMap(projectProofGaps);
  const resumeBrief = input.includeResumeBrief
    ? await buildResumeBrief(input)
    : undefined;

  return {
    graphVersion: "builder-evidence-graph/v0",
    scannedAt: inventory.scannedAt,
    summary: {
      projectCount: projects.length,
      skillCount: skills.length,
      evidenceCount: evidence.length,
      publicEvidenceCount: evidence.filter((item) => item.public).length,
      proofGapCount: proofGaps.length,
    },
    projects,
    skills,
    evidence,
    proofGaps,
    resumeBrief,
    privacy: {
      scannedRoots: inventory.approval.scannedRoots,
      refusedRoots: inventory.approval.refusedRoots,
      readPolicy:
        "Uses approved roots and bounded project metadata. Does not return raw source files, secrets, environment variables, or absolute local filesystem paths.",
      writePolicy:
        "This tool is read-only. Use buffalo.preview_project_writes and explicit builder approval before creating or updating projects.",
    },
    capabilityBoundary: opportunityBoundary,
    nextStep:
      "Review the graph with the builder, resolve high-severity proof gaps, then add approved projects or work entries.",
  };
}

function joinForBrief(items: string[]): string {
  if (items.length <= 1) {
    return items[0] ?? "";
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

async function refreshProjectSuggestions(
  input: z.infer<typeof refreshProjectsInputSchema>,
) {
  const { projects } = await existingProjectSignals(input);
  const targetProjects = input.projectId
    ? projects.filter((project) => project.id === input.projectId)
    : projects;
  const inventory = await findMachineProjects(input);
  const candidates = inventory.candidates;
  const matches = targetProjects
    .map((project) => {
      const projectRepo = normalizeHostUrl(project.githubRepoUrl);
      const projectTitle = project.title.trim().toLowerCase();
      const candidate = candidates.find((item) => {
        const candidateRepo = normalizeHostUrl(item.githubRepoUrl);
        return (
          (projectRepo && candidateRepo && projectRepo === candidateRepo) ||
          item.title.trim().toLowerCase() === projectTitle
        );
      });
      if (!candidate) {
        return null;
      }
      const suggestedUpdates: Record<string, unknown> = {};
      if (!project.description?.trim() && candidate.summary) {
        suggestedUpdates["description"] = candidate.summary;
      }
      if (
        (project.primarySkills?.length ?? 0) === 0 &&
        candidate.skills.length
      ) {
        suggestedUpdates["primarySkills"] = candidate.skills;
      }
      if (!project.githubRepoUrl && candidate.githubRepoUrl) {
        suggestedUpdates["githubRepoUrl"] = candidate.githubRepoUrl;
      }
      const existingEvidence = new Set(
        project.evidenceBindings?.customUrls ?? [],
      );
      const newEvidence = candidate.evidenceUrls.filter(
        (url) => !existingEvidence.has(url),
      );
      if (newEvidence.length) {
        suggestedUpdates["evidenceUrls"] = newEvidence;
      }
      return {
        projectId: project.id,
        title: project.title,
        matchedCandidate: {
          sourceKey: candidate.sourceKey,
          localRoot: candidate.localRoot,
          activity: candidate.activity,
          recency: candidate.recency,
        },
        suggestedUpdates,
        suggestedWorkEntry:
          candidate.recency.commitCount > 0
            ? {
                title: `Updated ${project.title}`,
                projectId: project.id,
                note: `${candidate.recency.commitCount} recent commit(s) detected in ${candidate.localRoot}. Confirm what shipped before saving.`,
                visibility: "private",
              }
            : null,
      };
    })
    .filter((match): match is NonNullable<typeof match> => Boolean(match));

  const matchedProjectIds = new Set(matches.map((match) => match.projectId));
  return {
    scannedAt: inventory.scannedAt,
    approval: inventory.approval,
    matches,
    unmatchedProjects: targetProjects
      .filter((project) => !matchedProjectIds.has(project.id))
      .map((project) => ({
        projectId: project.id,
        title: project.title,
        reason: "No matching local candidate found by repo URL or title.",
      })),
    newCandidates: candidates
      .filter((candidate) => !candidate.dedupe)
      .map((candidate) => candidate.addProjectInput),
    nextStep:
      "Review suggestedUpdates and suggestedWorkEntry with the builder before calling buffalo.update_project or buffalo.save_work.",
  };
}

function stableWorkOperationId(input: z.infer<typeof saveWorkInputSchema>) {
  if (input.operationId?.trim()) {
    return input.operationId.trim();
  }
  const day = localDateString();
  const stable = [
    "mcp",
    day,
    input.projectId ?? "unlinked",
    input.title.trim(),
    input.note?.trim() ?? "",
    input.sourceUrl ?? "",
  ].join("\n");
  return `mcp:${createHash("sha256").update(stable).digest("hex").slice(0, 24)}`;
}

function sourceBucket(source: string | undefined): string {
  if (source === "github_commit" || source === "github_release") {
    return "github";
  }
  if (source === "mcp" || source === "cli" || source === "agent") {
    return source;
  }
  return "manual";
}

function entryDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value && typeof value === "object" && "seconds" in value) {
    const seconds = Number((value as { seconds?: unknown }).seconds);
    return Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
  }
  return null;
}

function summarizeVelocity(
  entries: Array<Record<string, unknown>>,
  days: number,
) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = entries.filter((entry) => {
    const date =
      entryDate(entry["occurredAt"]) ?? entryDate(entry["createdAt"]);
    return date ? date.getTime() >= cutoff : true;
  });
  const bySource: Record<string, number> = {
    github: 0,
    mcp: 0,
    cli: 0,
    agent: 0,
    manual: 0,
  };
  const byDay: Record<string, number> = {};
  for (const entry of recent) {
    const bucket = sourceBucket(String(entry["source"] ?? "manual"));
    bySource[bucket] = (bySource[bucket] ?? 0) + 1;
    const date =
      typeof entry["dateKey"] === "string"
        ? entry["dateKey"]
        : (entryDate(entry["occurredAt"]) ?? entryDate(entry["createdAt"]))
            ?.toISOString()
            .slice(0, 10);
    if (date) {
      byDay[date] = (byDay[date] ?? 0) + 1;
    }
  }
  const activeDays = Object.keys(byDay).length;
  return {
    days,
    totalEntries: recent.length,
    activeDays,
    averagePerActiveDay: activeDays
      ? Number((recent.length / activeDays).toFixed(2))
      : 0,
    bySource,
    byDay,
    latest: recent.slice(0, 5).map((entry) => ({
      id: entry["id"],
      title: entry["title"],
      source: entry["source"],
      projectId: entry["projectId"],
      visibility: entry["visibility"],
      dateKey: entry["dateKey"],
    })),
  };
}

/**
 * Best-effort builder identity for the velocity result (and its rendered
 * profile card). Reads the authenticated builder + vouch list from the
 * hosted API; on any failure returns null and the velocity summary ships
 * without identity. Only fields that actually exist are included — the
 * profile card renders missing fields as nothing.
 */
async function fetchVelocityBuilder(
  input: z.infer<typeof hostedReadInputSchema>,
) {
  const config = maybeHostedReadConfig(input);
  if (!config) {
    return null;
  }
  const host = config.baseUrl.replace(/\/+$/g, "");
  const headers = { authorization: `Bearer ${config.token}` };
  try {
    const [meResponse, vouchesResponse] = await Promise.all([
      fetch(`${host}/api/builder/me`, { headers }),
      fetch(`${host}/api/builder/vouches`, { headers }),
    ]);
    if (!meResponse.ok) {
      return null;
    }
    const me = (await meResponse.json()) as {
      builder?: {
        name?: unknown;
        handle?: unknown;
        oneLiner?: unknown;
      } | null;
    };
    if (!me.builder) {
      return null;
    }
    const text = (value: unknown) =>
      typeof value === "string" && value.trim() ? value.trim() : undefined;
    const name = text(me.builder.name);
    const handle = text(me.builder.handle);
    const headline = text(me.builder.oneLiner);
    let vouchCount: number | undefined;
    if (vouchesResponse.ok) {
      const data = (await vouchesResponse.json()) as { vouches?: unknown };
      if (Array.isArray(data.vouches)) {
        vouchCount = data.vouches.length;
      }
    }
    if (!name && !handle && !headline && vouchCount === undefined) {
      return null;
    }
    return {
      ...(name ? { name } : {}),
      ...(handle ? { handle } : {}),
      ...(headline ? { headline } : {}),
      ...(handle ? { profileUrl: `${host}/b/${handle}` } : {}),
      ...(vouchCount !== undefined ? { vouchCount } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * GET the hosted /api/targets endpoint for the connected builder. When authed
 * with a Bearer token the route derives the match context from the builder's
 * own record and returns ranked Buffalo targets (events, grants, programs); it
 * also accepts optional tags/stage/geography/limit overrides. Shared by
 * buffalo.match_targets and buffalo.list_opportunities so the two never drift
 * on how targets are read.
 */
async function fetchTargets(input: z.infer<typeof matchTargetsInputSchema>) {
  const { baseUrl, token } = hostedReadConfig(input);
  const params = new URLSearchParams();
  if (input.tags) {
    params.set("tags", input.tags);
  }
  if (input.stage) {
    params.set("stage", input.stage);
  }
  if (input.geography) {
    params.set("geography", input.geography);
  }
  if (input.limit !== undefined) {
    params.set("limit", String(input.limit));
  }
  const query = params.toString();
  const response = await fetch(
    `${baseUrl.replace(/\/+$/g, "")}/api/targets${query ? `?${query}` : ""}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw hostedRequestError(
      response,
      "match Buffalo targets for your record",
      detail || undefined,
    );
  }
  const data = (await response.json()) as {
    matches?: Array<Record<string, unknown>>;
  };
  return Array.isArray(data.matches) ? data.matches : [];
}

export function readBuffaloResource(uri: string): unknown {
  if (uri === "buffalo://schema/project") {
    return projectJsonSchema;
  }

  if (uri === "buffalo://rubric") {
    return densityRubric;
  }

  const templateMatch = /^buffalo:\/\/templates\/([^/]+)$/.exec(uri);

  if (templateMatch) {
    const templateType = templateMatch[1] as keyof typeof projectTemplates;

    return projectTemplates[templateType] ?? null;
  }

  const examplesMatch = /^buffalo:\/\/examples\/([^/]+)$/.exec(uri);

  if (examplesMatch) {
    return examplesForTemplate(
      examplesMatch[1] as keyof typeof projectTemplates,
    );
  }

  return null;
}

export const buffaloPrompts = {
  "buffalo:onboarding":
    "Check buffalo.auth_status first. If hosted tools are not verified, explain that local project discovery still works and guide the builder to run buffalo login for CLI or add BUFFALO_TOKEN to the buffalo-projects-mcp config for MCP writes. Be explicit that Buffalo Projects routes builders to a public corpus of Buffalo targets (discovery via buffalo.match_targets) but has no seeded marketplace, hosted opportunity supply, referrals, or guaranteed opportunities.",
  "buffalo:first-run-inventory":
    "Ask the builder which local roots are approved to scan, run buffalo.find_projects, show the redacted preview, and only create link-only projects they approve.",
  "buffalo:first-work-record":
    "Turn one approved repo into a private Buffalo work-record preview. Scan the repo, summarize what it is, show recent work, source signals, missing evidence/proof gaps, next best proof, and a privacy receipt. Do not save or publish anything until the builder approves a specific hosted write.",
  "buffalo:resume-brief":
    "Build a resume-quality brief from approved local project metadata. Synthesize strengths, project highlights, and skills without dumping raw files. This is builder-side evidence preparation only; opportunity routing lives in buffalo.match_targets, not here.",
  "buffalo:evidence-graph":
    "Build the builder-side evidence graph from approved local metadata. Connect projects, skills, claims, evidence, and proof gaps; this is builder-side only — opportunity routing lives in buffalo.match_targets, not in this graph.",
  "buffalo:intake":
    "Guide a student from rough notes to a Buffalo project draft. Ask for evidence before polish.",
  "buffalo:post-hackathon":
    "Capture the minimum durable project record after an event: what shipped, who did what, and what proof survived.",
  "buffalo:prep-for-recruiter":
    "Strengthen an existing project for external review by improving clarity, evidence, outcomes, and current ask.",
  "buffalo:weekly-update":
    "Ask what shipped, what changed, what evidence appeared, and what milestone should be logged.",
} as const;

export const buffaloTools = {
  "buffalo.auth_status": {
    description:
      "Check whether Buffalo MCP has a connected builder account for hosted reads/writes, return setup instructions, and state the current capability boundary: routing/matching against a public Buffalo target corpus exists (buffalo.match_targets), but there is no seeded marketplace, hosted supply, referrals, or guaranteed opportunities.",
    handler: (input: z.infer<typeof authStatusInputSchema>) =>
      authStatus(input),
  },
  "buffalo.draft_project": {
    description:
      "Create a structured Buffalo project draft from a conversational description and optional context.",
    handler: (input: DraftProjectInput) => draftProject(input),
  },
  "buffalo.suggest_evidence": {
    description:
      "Suggest inspectable evidence from agent context without attaching or publishing anything.",
    handler: (input: SuggestEvidenceInput) => suggestEvidence(input),
  },
  "buffalo.log_milestone": {
    description:
      "Return project.md with a dated milestone appended, for preview. Show the edit to the builder, then persist it with buffalo.save_work.",
    handler: (input: z.infer<typeof logMilestoneInputSchema>) => ({
      markdown: appendMilestoneMarkdown(input.markdown, {
        title: input.title,
        note: input.note,
        date: input.date ?? localDateString(),
      }),
    }),
  },
  "buffalo.save_work": {
    description:
      "Persist a logged work entry to the authenticated builder's Buffalo work log. Includes retry-safe idempotency and optional sourceUrl. Requires token/baseUrl or BUFFALO_TOKEN/BUFFALO_BASE_URL.",
    handler: async (input: z.infer<typeof saveWorkInputSchema>) => {
      const { baseUrl, token } = hostedReadConfig(input);
      const response = await fetch(
        `${baseUrl.replace(/\/+$/g, "")}/api/builder/work-entries`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            title: input.title,
            annotation: input.note,
            projectId: input.projectId,
            source: "mcp",
            operationId: stableWorkOperationId(input),
            sourceUrl: input.sourceUrl,
            visibility: input.visibility,
          }),
        },
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw hostedRequestError(
          response,
          "save your work entry",
          detail || undefined,
        );
      }
      const data = (await response.json()) as {
        entry: unknown;
        handle?: string | null;
      };
      const host = baseUrl.replace(/^https?:\/\//, "").replace(/\/+$/g, "");
      return {
        entry: data.entry,
        handle: data.handle ?? null,
        url: data.handle ? `${host}/b/${data.handle}` : null,
      };
    },
  },
  "buffalo.list_work": {
    description:
      "Read the authenticated builder's recent work log entries. Use this before deciding what to update, summarize, or ask validation for.",
    handler: async (input: z.infer<typeof listWorkInputSchema>) => {
      const { baseUrl, token } = hostedReadConfig(input);
      const params = new URLSearchParams();
      params.set("limit", String(input.limit ?? 50));
      if (input.projectId) {
        params.set("projectId", input.projectId);
      }
      const response = await fetch(
        `${baseUrl.replace(/\/+$/g, "")}/api/builder/work-entries?${params.toString()}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw hostedRequestError(
          response,
          "read your work entries",
          detail || undefined,
        );
      }
      const data = (await response.json()) as {
        entries: Array<Record<string, unknown>>;
      };
      const entries = input.source
        ? data.entries.filter(
            (entry) => sourceBucket(String(entry["source"])) === input.source,
          )
        : data.entries;
      return { entries, count: entries.length };
    },
  },
  "buffalo.get_velocity": {
    description:
      "Summarize recent work velocity by source, active day, and latest entries from the authenticated builder's work log. In hosts that support MCP Apps, the result also renders as an inline Buffalo Projects profile card.",
    handler: async (input: z.infer<typeof velocityInputSchema>) => {
      const [listed, builder] = await Promise.all([
        buffaloTools["buffalo.list_work"].handler({
          ...input,
          limit: 100,
        }),
        fetchVelocityBuilder(input),
      ]);
      const summary = summarizeVelocity(
        listed.entries as Array<Record<string, unknown>>,
        input.days ?? 30,
      );
      return builder ? { ...summary, builder } : summary;
    },
  },
  "buffalo.request_vouch": {
    description:
      "Create a vouch request link for the authenticated builder or a specific project. Use after meaningful work is logged and the builder wants external validation.",
    handler: async (input: z.infer<typeof requestVouchInputSchema>) => {
      const { baseUrl, token } = hostedReadConfig(input);
      const response = await fetch(
        `${baseUrl.replace(/\/+$/g, "")}/api/builder/me/vouch-tokens`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            projectId: input.projectId,
            note: input.note,
            expiresInDays: input.expiresInDays,
          }),
        },
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw hostedRequestError(
          response,
          "create the vouch link",
          detail || undefined,
        );
      }
      return (await response.json()) as {
        token: string;
        url: string;
        expiresAt: string;
      };
    },
  },
  "buffalo.list_projects": {
    description:
      "Read the authenticated student's Buffalo projects from the hosted API. Requires token/baseUrl or BUFFALO_TOKEN/BUFFALO_BASE_URL.",
    handler: async (input: z.infer<typeof hostedReadInputSchema>) => ({
      projects: await hostedProjectRepository(input).list(),
    }),
  },
  "buffalo.get_project": {
    description:
      "Read one authenticated Buffalo project by ID from the hosted API. Requires token/baseUrl or BUFFALO_TOKEN/BUFFALO_BASE_URL.",
    handler: async (input: z.infer<typeof getProjectInputSchema>) => ({
      project: await hostedProjectRepository(input).get(input.projectId),
    }),
  },
  "buffalo.match_targets": {
    description:
      "Route the connected builder to the Buffalo opportunities and events that fit their record. Call this when the builder asks what to apply to, what is next, or where they fit in Buffalo. Matches the builder's own record (skills, stage, geography) against each target's stated eligibility and returns ranked targets with the reasons they fit and any gap to the target's own stated bar — never a quality score of the builder. Optionally narrow with tags, stage, or geography. Requires token/baseUrl or BUFFALO_TOKEN/BUFFALO_BASE_URL.",
    handler: async (input: z.infer<typeof matchTargetsInputSchema>) => {
      const matches = await fetchTargets(input);
      return { matches, count: matches.length };
    },
  },
  "buffalo.list_opportunities": {
    description:
      "List the Buffalo opportunity and event corpus the connected builder can act on — grants, programs, hackathons, fellowships, and recurring rooms. Call this when the builder's agent wants to read what exists in Buffalo before deciding where to route or apply. Returns the same matched targets as buffalo.match_targets so the agent reads the full surface in one read. Requires token/baseUrl or BUFFALO_TOKEN/BUFFALO_BASE_URL.",
    handler: async (input: z.infer<typeof matchTargetsInputSchema>) => {
      const opportunities = await fetchTargets(input);
      return { opportunities, count: opportunities.length };
    },
  },
  "buffalo.scan_repo": {
    description:
      "Scan one local codebase and propose the distinct projects worth adding to the builder's Buffalo page. Read-only. Detects coherent efforts; does NOT judge quality. cwd resolves from the cwd arg, BUFFALO_SCAN_CWD, or the server's working directory.",
    handler: async (input: z.infer<typeof scanRepoInputSchema>) => {
      const cwd = input.cwd ?? process.env["BUFFALO_SCAN_CWD"] ?? process.cwd();
      let existingRepoUrls: string[] = [];
      let existingTitles: string[] = [];
      const remoteIgnoreKeys = await readRemoteIgnoreKeys(input);
      try {
        const projects = await hostedProjectRepository(input).list();
        existingRepoUrls = projects
          .map((p) => p.githubRepoUrl)
          .filter((u): u is string => Boolean(u));
        existingTitles = projects.map((p) => p.title);
      } catch {
        // Dedupe is best-effort: no creds or fetch failed → scan without it.
      }
      return scanCodebase({
        cwd,
        sinceDays: input.sinceDays,
        maxCandidates: input.maxCandidates,
        existingRepoUrls,
        existingTitles,
        ignoreKeys: [
          ...new Set([...(input.ignoreKeys ?? []), ...remoteIgnoreKeys]),
        ],
      });
    },
  },
  "buffalo.find_projects": {
    description:
      "Scan approved local roots for project-like repos/folders, dedupe against the builder's Buffalo account, apply the remote never-list, and return a redacted preview. Read-only; do not call buffalo.add_projects until the builder approves specific candidates.",
    handler: (input: z.infer<typeof findProjectsInputSchema>) =>
      findMachineProjects(input),
  },
  "buffalo.preview_project_writes": {
    description:
      "Show exactly what project fields would be sent to Buffalo before calling buffalo.add_projects. Redacts local filesystem paths and confirms file contents/secrets are not sent.",
    handler: (input: z.infer<typeof previewProjectWritesInputSchema>) =>
      projectWritePreview(input.projects),
  },
  "buffalo.refresh_projects": {
    description:
      "Read hosted projects, rescan approved local roots, and propose project updates or private work entries. Read-only; review with the builder before saving updates.",
    handler: (input: z.infer<typeof refreshProjectsInputSchema>) =>
      refreshProjectSuggestions(input),
  },
  "buffalo.build_resume_brief": {
    description:
      "Build a resume-quality builder brief from approved local project metadata and git/package signals. Read-only. Returns synthesized summaries and bullets, not raw source file contents.",
    handler: (input: z.infer<typeof buildResumeBriefInputSchema>) =>
      buildResumeBrief(input),
  },
  "buffalo.build_evidence_graph": {
    description:
      "Build the builder-side evidence graph from approved local metadata: projects, skills, claims, evidence, confidence, and proof gaps. Read-only builder-side evidence; opportunity routing lives in buffalo.match_targets, not in this graph.",
    handler: (input: z.infer<typeof buildEvidenceGraphInputSchema>) =>
      buildEvidenceGraph(input),
  },
  "buffalo.ignore_projects": {
    description:
      "Add candidate source keys to the builder's remote never-list so they do not reappear in future MCP or CLI scans. Requires token/baseUrl or BUFFALO_TOKEN/BUFFALO_BASE_URL.",
    handler: async (input: z.infer<typeof ignoreProjectsInputSchema>) => {
      const { baseUrl, token } = hostedReadConfig(input);
      const response = await fetch(
        `${baseUrl.replace(/\/+$/g, "")}/api/builder/me/scan-ignore`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ keys: input.keys }),
        },
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw hostedRequestError(
          response,
          "update your ignored project keys",
          detail || undefined,
        );
      }
      return (await response.json()) as { keys: string[] };
    },
  },
  "buffalo.add_projects": {
    description:
      "Persist chosen scan candidates as link-only Buffalo projects (publishing stays explicit). Accepts free-form title/description so the co-pilot can refine the scan output. Returns new project IDs and the workspace URL to finish + publish each. Requires token/baseUrl or BUFFALO_TOKEN/BUFFALO_BASE_URL.",
    handler: async (input: z.infer<typeof addProjectsInputSchema>) => {
      const { baseUrl, token } = hostedReadConfig(input);
      const host = baseUrl.replace(/\/+$/g, "");
      const created: { title: string; projectId: string; url: string }[] = [];
      for (const project of input.projects) {
        const response = await fetch(`${host}/api/builder/projects`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            title: project.title,
            description: project.description,
            privacy: "link",
            primarySkills: project.primarySkills,
            githubRepoUrl: project.githubRepoUrl,
            evidenceBindings: project.evidenceUrls
              ? { customUrls: project.evidenceUrls }
              : undefined,
          }),
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw hostedRequestError(
            response,
            `create "${project.title}"`,
            detail || undefined,
          );
        }
        const data = (await response.json()) as { project: { id: string } };
        created.push({
          title: project.title,
          projectId: data.project.id,
          url: `${host}/app/${data.project.id}`,
        });
      }
      return { created };
    },
  },
  "buffalo.update_project": {
    description:
      "Add builder-provided detail to an existing Buffalo project — description, skills, current ask, proof statements, evidence links, repo URL. Nothing is scored or gated. Requires token/baseUrl or BUFFALO_TOKEN/BUFFALO_BASE_URL.",
    handler: async (input: z.infer<typeof updateProjectInputSchema>) => {
      const { baseUrl, token } = hostedReadConfig(input);
      const host = baseUrl.replace(/\/+$/g, "");
      const body: Record<string, unknown> = {};
      if (input.description !== undefined) {
        body["description"] = input.description;
      }
      if (input.primarySkills) {
        body["primarySkills"] = input.primarySkills;
      }
      if (input.currentAsk !== undefined) {
        body["currentAsk"] = input.currentAsk;
      }
      if (input.proofStatements) {
        body["proofStatements"] = input.proofStatements;
      }
      if (input.githubRepoUrl) {
        body["githubRepoUrl"] = input.githubRepoUrl;
      }
      if (input.evidenceUrls) {
        body["evidenceBindings"] = { customUrls: input.evidenceUrls };
      }
      const response = await fetch(
        `${host}/api/builder/projects/${input.projectId}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw hostedRequestError(
          response,
          "update the project",
          detail || undefined,
        );
      }
      return (await response.json()) as { project: unknown };
    },
  },
} as const;

export function createBuffaloMcpServer(): McpServer {
  const server = new McpServer({
    name: "buffalo-projects-mcp",
    version: "0.1.2",
  });

  server.registerTool(
    "buffalo.auth_status",
    {
      title: "Check Buffalo account connection",
      description: buffaloTools["buffalo.auth_status"].description,
      inputSchema: authStatusInputSchema,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      const result = await buffaloTools["buffalo.auth_status"].handler(input);
      return content(
        result,
        result.authenticated
          ? "✓ Buffalo account connection is ready for hosted tools."
          : "Buffalo local tools are ready; hosted tools need BUFFALO_TOKEN.",
      );
    },
  );

  server.registerTool(
    "buffalo.draft_project",
    {
      title: "Draft Buffalo project",
      description: buffaloTools["buffalo.draft_project"].description,
      inputSchema: draftProjectInputSchema,
    },
    async (input) => {
      const drafted = draftProject(input);
      const title = drafted.project?.title ?? "your project";
      return content(
        drafted,
        `✓ drafted "${title}" (${drafted.project?.templateType ?? "generic"} template). Show it to the builder, then persist with buffalo.save_work.`,
      );
    },
  );

  server.registerTool(
    "buffalo.suggest_evidence",
    {
      title: "Suggest Buffalo evidence",
      description: buffaloTools["buffalo.suggest_evidence"].description,
      inputSchema: suggestEvidenceInputSchema,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => content(suggestEvidence(evidenceInput(input))),
  );

  server.registerTool(
    "buffalo.log_milestone",
    {
      title: "Log Buffalo milestone",
      description: buffaloTools["buffalo.log_milestone"].description,
      inputSchema: logMilestoneInputSchema,
      annotations: {
        readOnlyHint: false,
      },
    },
    async (input) =>
      content(
        buffaloTools["buffalo.log_milestone"].handler(input),
        `✓ milestone "${input.title}" added to the project draft. Show the edit to the builder, then persist with buffalo.save_work.`,
      ),
  );

  server.registerTool(
    "buffalo.save_work",
    {
      title: "Save Buffalo work entry",
      description: buffaloTools["buffalo.save_work"].description,
      inputSchema: saveWorkInputSchema,
      annotations: {
        readOnlyHint: false,
      },
    },
    async (input) => {
      const saved = await buffaloTools["buffalo.save_work"].handler(input);
      return content(
        saved,
        saved.url
          ? `✓ saved to your work log — live at ${saved.url}`
          : "✓ saved to your work log. Your page is updated.",
      );
    },
  );

  server.registerTool(
    "buffalo.list_work",
    {
      title: "List Buffalo work entries",
      description: buffaloTools["buffalo.list_work"].description,
      inputSchema: listWorkInputSchema,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      const listed = await buffaloTools["buffalo.list_work"].handler(input);
      return content(listed, `${listed.count} work entries found.`);
    },
  );

  // MCP Apps tool: identical text/JSON result for every host, plus
  // structuredContent and a ui:// resource reference so MCP Apps hosts
  // (Claude, ChatGPT, VS Code, …) render the profile card inline. Hosts
  // without MCP Apps support ignore the _meta and use the text blocks.
  registerAppTool(
    server,
    "buffalo.get_velocity",
    {
      title: "Get Buffalo work velocity",
      description: buffaloTools["buffalo.get_velocity"].description,
      inputSchema: velocityInputSchema,
      annotations: {
        readOnlyHint: true,
      },
      _meta: {
        ui: {
          resourceUri: profileCardResourceUri,
          visibility: ["model", "app"],
        },
      },
    },
    async (input) => {
      const velocity = await buffaloTools["buffalo.get_velocity"].handler(
        velocityInputSchema.parse(input ?? {}),
      );
      return {
        ...content(
          velocity,
          `${velocity.totalEntries} work entries across ${velocity.activeDays} active day(s).`,
        ),
        structuredContent: velocity,
      };
    },
  );

  registerAppResource(
    server,
    "buffalo-profile-card",
    profileCardResourceUri,
    {
      title: "Buffalo Projects profile card",
      description:
        "Inline profile card for buffalo.get_velocity: builder identity, work-velocity heatmap, latest entry, vouches, and a link to the public record.",
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          // Self-contained view: no external scripts, styles, or network.
          csp: { connectDomains: [], resourceDomains: [] },
          prefersBorder: false,
        },
      },
    },
    async () => ({
      contents: [
        {
          uri: profileCardResourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: profileCardHtml,
        },
      ],
    }),
  );

  server.registerTool(
    "buffalo.request_vouch",
    {
      title: "Request Buffalo vouch",
      description: buffaloTools["buffalo.request_vouch"].description,
      inputSchema: requestVouchInputSchema,
      annotations: {
        readOnlyHint: false,
      },
    },
    async (input) => {
      const result = await buffaloTools["buffalo.request_vouch"].handler(input);
      return content(result, `✓ vouch link created — ${result.url}`);
    },
  );

  server.registerTool(
    "buffalo.list_projects",
    {
      title: "List Buffalo projects",
      description: buffaloTools["buffalo.list_projects"].description,
      inputSchema: hostedReadInputSchema,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      const listed = await buffaloTools["buffalo.list_projects"].handler(input);
      return content(
        listed,
        `${listed.projects.length} project(s) on your Buffalo page.`,
      );
    },
  );

  server.registerTool(
    "buffalo.get_project",
    {
      title: "Get Buffalo project",
      description: buffaloTools["buffalo.get_project"].description,
      inputSchema: getProjectInputSchema,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) =>
      content(await buffaloTools["buffalo.get_project"].handler(input)),
  );

  server.registerTool(
    "buffalo.match_targets",
    {
      title: "Match Buffalo targets",
      description: buffaloTools["buffalo.match_targets"].description,
      inputSchema: matchTargetsInputSchema,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      const result = await buffaloTools["buffalo.match_targets"].handler(input);
      return content(
        result,
        `${result.count} Buffalo target(s) matched to your record.`,
      );
    },
  );

  server.registerTool(
    "buffalo.list_opportunities",
    {
      title: "List Buffalo opportunities",
      description: buffaloTools["buffalo.list_opportunities"].description,
      inputSchema: matchTargetsInputSchema,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      const result =
        await buffaloTools["buffalo.list_opportunities"].handler(input);
      return content(
        result,
        `${result.count} Buffalo opportunit${result.count === 1 ? "y" : "ies"} available to read.`,
      );
    },
  );

  server.registerTool(
    "buffalo.scan_repo",
    {
      title: "Scan codebase for projects",
      description: buffaloTools["buffalo.scan_repo"].description,
      inputSchema: scanRepoInputSchema,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      const result = await buffaloTools["buffalo.scan_repo"].handler(input);
      const workspaces = result.candidates.filter(
        (c) => c.groupingKind === "workspace-package",
      ).length;
      return content(
        result,
        `✓ found ${result.candidates.length} candidate project(s)${
          workspaces ? ` (${workspaces} workspace packages)` : ""
        } in ${result.cwd}. Review with the builder, then add the chosen ones with buffalo.add_projects.`,
      );
    },
  );

  server.registerTool(
    "buffalo.find_projects",
    {
      title: "Find Buffalo projects on machine",
      description: buffaloTools["buffalo.find_projects"].description,
      inputSchema: findProjectsInputSchema,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      const result = await buffaloTools["buffalo.find_projects"].handler(input);
      return content(
        result,
        `✓ found ${result.candidates.length} candidate project(s) across ${result.approval.scannedRoots.length} approved root(s). Show the preview before adding anything.`,
      );
    },
  );

  server.registerTool(
    "buffalo.preview_project_writes",
    {
      title: "Preview Buffalo project writes",
      description: buffaloTools["buffalo.preview_project_writes"].description,
      inputSchema: previewProjectWritesInputSchema,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      const preview =
        buffaloTools["buffalo.preview_project_writes"].handler(input);
      return content(
        preview,
        `Preview ready: ${preview.count} link-only project(s), no local paths or file contents included.`,
      );
    },
  );

  server.registerTool(
    "buffalo.refresh_projects",
    {
      title: "Refresh Buffalo projects",
      description: buffaloTools["buffalo.refresh_projects"].description,
      inputSchema: refreshProjectsInputSchema,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      const result =
        await buffaloTools["buffalo.refresh_projects"].handler(input);
      return content(
        result,
        `✓ matched ${result.matches.length} existing project(s); review suggestions before saving.`,
      );
    },
  );

  server.registerTool(
    "buffalo.build_resume_brief",
    {
      title: "Build Buffalo resume brief",
      description: buffaloTools["buffalo.build_resume_brief"].description,
      inputSchema: buildResumeBriefInputSchema,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      const result =
        await buffaloTools["buffalo.build_resume_brief"].handler(input);
      return content(
        result,
        `Resume brief ready: ${result.projectHighlights.length} project highlight(s), ${result.coreSkills.length} core skill(s), no raw file contents.`,
      );
    },
  );

  server.registerTool(
    "buffalo.build_evidence_graph",
    {
      title: "Build Buffalo evidence graph",
      description: buffaloTools["buffalo.build_evidence_graph"].description,
      inputSchema: buildEvidenceGraphInputSchema,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => {
      const result =
        await buffaloTools["buffalo.build_evidence_graph"].handler(input);
      return content(
        result,
        `Evidence graph ready: ${result.summary.projectCount} project(s), ${result.summary.skillCount} skill(s), ${result.summary.proofGapCount} proof gap(s). This is builder-side evidence; use buffalo.match_targets for opportunity routing.`,
      );
    },
  );

  server.registerTool(
    "buffalo.ignore_projects",
    {
      title: "Ignore Buffalo project candidates",
      description: buffaloTools["buffalo.ignore_projects"].description,
      inputSchema: ignoreProjectsInputSchema,
      annotations: {
        readOnlyHint: false,
      },
    },
    async (input) => {
      const result =
        await buffaloTools["buffalo.ignore_projects"].handler(input);
      return content(
        result,
        `✓ ignored ${input.keys.length} candidate key(s) for future scans.`,
      );
    },
  );

  server.registerTool(
    "buffalo.add_projects",
    {
      title: "Add Buffalo projects",
      description: buffaloTools["buffalo.add_projects"].description,
      inputSchema: addProjectsInputSchema,
      annotations: {
        readOnlyHint: false,
      },
    },
    async (input) => {
      const result = await buffaloTools["buffalo.add_projects"].handler(input);
      const lines = result.created
        .map((c) => `  • ${c.title} → ${c.url}`)
        .join("\n");
      return content(
        result,
        `✓ added ${result.created.length} project(s) (link-only — finish + publish in your workspace):\n${lines}`,
      );
    },
  );

  server.registerTool(
    "buffalo.update_project",
    {
      title: "Add detail to a Buffalo project",
      description: buffaloTools["buffalo.update_project"].description,
      inputSchema: updateProjectInputSchema,
      annotations: {
        readOnlyHint: false,
      },
    },
    async (input) =>
      content(
        await buffaloTools["buffalo.update_project"].handler(input),
        `✓ updated project ${input.projectId}.`,
      ),
  );

  server.registerResource(
    "project-schema",
    "buffalo://schema/project",
    {
      title: "Buffalo project JSON Schema",
      description: "Current Buffalo project data shape.",
      mimeType: "application/json",
    },
    async (uri) => resourceContents(uri.href, projectJsonSchema),
  );

  server.registerResource(
    "density-rubric",
    "buffalo://rubric",
    {
      title: "Buffalo density rubric",
      description: "Machine-readable density dimensions and suggested fixes.",
      mimeType: "application/json",
    },
    async (uri) => resourceContents(uri.href, densityRubric),
  );

  server.registerResource(
    "project-template",
    new ResourceTemplate("buffalo://templates/{type}", {
      list: async () => ({
        resources: Object.keys(projectTemplates).map((type) => ({
          name: `template-${type}`,
          uri: `buffalo://templates/${type}`,
          title: `Buffalo ${type} template`,
          mimeType: "application/json",
        })),
      }),
    }),
    {
      title: "Buffalo project template",
      description: "Template definition for a project discipline.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      resourceContents(
        uri.href,
        projectTemplates[variables["type"] as keyof typeof projectTemplates] ??
          null,
      ),
  );

  server.registerResource(
    "project-examples",
    new ResourceTemplate("buffalo://examples/{type}", {
      list: async () => ({
        resources: Object.keys(projectExamples).map((type) => ({
          name: `examples-${type}`,
          uri: `buffalo://examples/${type}`,
          title: `Buffalo ${type} examples`,
          mimeType: "application/json",
        })),
      }),
    }),
    {
      title: "Buffalo project examples",
      description: "Curated high-density example projects for a discipline.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      resourceContents(
        uri.href,
        examplesForTemplate(variables["type"] as keyof typeof projectTemplates),
      ),
  );

  server.registerPrompt(
    "buffalo:first-run-inventory",
    {
      title: "First-run machine inventory",
      description: buffaloPrompts["buffalo:first-run-inventory"],
      argsSchema: {
        roots: z.array(z.string()).optional(),
      },
    },
    ({ roots }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Help me find existing work on this machine and organize it into Buffalo Projects.",
              roots?.length
                ? `Approved roots: ${roots.join(", ")}.`
                : "First ask me which local roots are approved to scan, such as ~/Projects, ~/Developer, or a specific repo.",
              "Run buffalo.find_projects only on approved roots.",
              "Show the redacted preview and what would be sent before creating anything.",
              "Create link-only projects only after I approve specific candidates.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "buffalo:first-work-record",
    {
      title: "First private work record",
      description: buffaloPrompts["buffalo:first-work-record"],
      argsSchema: {
        root: z.string().optional(),
      },
    },
    ({ root }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Use Buffalo to turn this repo into a private work-record preview.",
              root
                ? `Approved root: ${root}.`
                : "First confirm the approved repo/root to scan.",
              "Run buffalo.scan_repo on the approved repo/root.",
              "Then build a concise record: project title, what it is, recent work, evidence/source signals, missing evidence, and next best proof.",
              "Include a privacy receipt: local metadata only, no raw source dump, no secrets, no hosted write by default.",
              "Ask before calling buffalo.add_projects, buffalo.save_work, or any hosted write.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "buffalo:resume-brief",
    {
      title: "Buffalo resume brief",
      description: buffaloPrompts["buffalo:resume-brief"],
      argsSchema: {
        roots: z.array(z.string()).optional(),
        audience: z
          .enum([
            "recruiter",
            "mentor",
            "investor",
            "technical-reviewer",
            "general",
          ])
          .optional(),
      },
    },
    ({ roots, audience }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Help me understand my work well enough to produce resume-quality project/profile copy.",
              roots?.length
                ? `Approved roots: ${roots.join(", ")}.`
                : "First ask which local roots are approved to scan.",
              audience
                ? `Audience: ${audience}.`
                : "Pick a general audience unless I specify one.",
              "Run buffalo.build_resume_brief on approved roots.",
              "Synthesize strengths and project highlights; do not dump raw files, secrets, or absolute local paths.",
              "Before saving anything to Buffalo, show me exactly what would be sent.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "buffalo:evidence-graph",
    {
      title: "Buffalo evidence graph",
      description: buffaloPrompts["buffalo:evidence-graph"],
      argsSchema: {
        roots: z.array(z.string()).optional(),
      },
    },
    ({ roots }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Build my builder-side evidence graph from approved local work metadata.",
              roots?.length
                ? `Approved roots: ${roots.join(", ")}.`
                : "First ask which local roots are approved to scan.",
              "Run buffalo.build_evidence_graph on approved roots.",
              "Explain projects, skills, claims, evidence, confidence, and proof gaps.",
              "Be explicit that Buffalo Projects routes to public Buffalo targets (discovery via buffalo.match_targets) but does not host opportunity supply, make referrals, or guarantee opportunities.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "buffalo:intake",
    {
      title: "Buffalo intake",
      description: buffaloPrompts["buffalo:intake"],
      argsSchema: {
        templateType: templateTypeSchema.optional(),
        notes: z.string().optional(),
      },
    },
    ({ templateType, notes }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Help me draft a Buffalo project page from scratch.",
              templateType
                ? `Template type: ${templateType}.`
                : "Start by choosing the best template type.",
              notes
                ? `Existing notes: ${notes}`
                : "Ask for the minimum details needed before drafting.",
              "Do not publish or attach evidence without explicit confirmation.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "buffalo:post-hackathon",
    {
      title: "Post-hackathon capture",
      description: buffaloPrompts["buffalo:post-hackathon"],
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Capture a hackathon project quickly: what shipped, what I did, what proof exists, and what milestone should be preserved. Keep it forgiving and do not publish.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "buffalo:prep-for-recruiter",
    {
      title: "Prep project for recruiter",
      description: buffaloPrompts["buffalo:prep-for-recruiter"],
      argsSchema: {
        projectMarkdown: z.string().optional(),
      },
    },
    ({ projectMarkdown }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Strengthen this Buffalo project for recruiter review.",
              "Focus on clarity, inspectable evidence, outcomes, skills backed by evidence, and a concrete current ask.",
              projectMarkdown
                ? `Project markdown:\n${projectMarkdown}`
                : "Ask me for the current project draft first.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "buffalo:weekly-update",
    {
      title: "Weekly Buffalo update",
      description: buffaloPrompts["buffalo:weekly-update"],
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Help me log a weekly Buffalo project update: what shipped, what changed, what evidence appeared, what is stuck, and what milestone should be added.",
          },
        },
      ],
    }),
  );

  return server;
}

export async function runStdioServer(): Promise<void> {
  const server = createBuffaloMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

// Run when invoked as a bin. A raw `import.meta.url === file://argv[1]` check
// breaks under a global/npx symlink (e.g. Claude Code launching the server via
// `npx buffalo-projects-mcp@latest`), so compare real paths.
function invokedAsBin(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedAsBin()) {
  await runStdioServer();
}
