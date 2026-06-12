import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  buffaloPrompts,
  buffaloTools,
  createBuffaloMcpServer,
  profileCardResourceUri,
  readBuffaloResource,
} from "./index.js";
import { createServer, type IncomingMessage } from "node:http";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const draft = buffaloTools["buffalo.draft_project"].handler({
  description:
    "I built a campus lab inventory tracker with a demo at https://github.com/example/lab-inventory.",
  templateType: "engineering",
  context: "The repo includes screenshots and a working prototype.",
});

assert(
  draft.project.templateType === "engineering",
  "draft_project kept template type",
);
assert(
  draft.markdown.includes("# I built a campus lab inventory tracker"),
  "draft_project returned markdown",
);

const suggestions = buffaloTools["buffalo.suggest_evidence"].handler({
  markdown: draft.markdown,
  context:
    "The latest demo is at https://loom.com/share/buffalo-demo and the repo has a merged pull request.",
});

assert(
  suggestions.some((item) => item.source.includes("loom.com")),
  "suggest_evidence found context URL",
);
const milestone = buffaloTools["buffalo.log_milestone"].handler({
  markdown: draft.markdown,
  title: "Shipped prototype",
  date: "2026-05-17",
});
assert(
  milestone.markdown.includes("Shipped prototype"),
  "log_milestone returned edited markdown",
);

const scan = await buffaloTools["buffalo.scan_repo"].handler({
  cwd: process.cwd(),
});
assert(scan.candidates.length >= 1, "scan_repo found at least one candidate");
assert(
  scan.candidates.every((c) => typeof c.key === "string" && c.key.length > 0),
  "scan_repo candidates have stable keys",
);
const inventory = await buffaloTools["buffalo.find_projects"].handler({
  roots: [process.cwd()],
  maxCandidates: 10,
});
assert(
  inventory.candidates.length >= 1,
  "find_projects found at least one candidate",
);
assert(
  inventory.approval.scannedRoots.length >= 1,
  "find_projects records approved roots",
);
assert(
  inventory.preview.willNotSend.includes("file contents"),
  "find_projects returns a privacy preview",
);
assert(
  inventory.candidates.some((candidate) => candidate.resumeSummary),
  "find_projects returns resume-style summaries",
);
const preview = buffaloTools["buffalo.preview_project_writes"].handler({
  projects: [inventory.candidates[0]!.addProjectInput],
});
assert(preview.count === 1, "preview_project_writes counts projects");
assert(
  preview.willNotSend.includes("absolute local filesystem paths"),
  "preview_project_writes redacts local paths",
);
const resumeBrief = await buffaloTools["buffalo.build_resume_brief"].handler({
  roots: [process.cwd()],
  maxCandidates: 10,
  audience: "recruiter",
});
assert(
  resumeBrief.projectHighlights.length >= 1,
  "build_resume_brief returns project highlights",
);
assert(
  resumeBrief.privacy.readPolicy.includes("raw source files"),
  "build_resume_brief returns privacy policy",
);
assert(
  resumeBrief.capabilityBoundary.currentState.includes("two-sided marketplace"),
  "build_resume_brief states the opportunity boundary",
);
const evidenceGraph = await buffaloTools[
  "buffalo.build_evidence_graph"
].handler({
  roots: [process.cwd()],
  maxCandidates: 10,
});
assert(
  evidenceGraph.summary.projectCount >= 1,
  "build_evidence_graph returns projects",
);
assert(
  evidenceGraph.summary.evidenceCount >= 1,
  "build_evidence_graph returns evidence",
);
assert(
  evidenceGraph.capabilityBoundary.currentState.includes(
    "two-sided marketplace",
  ),
  "build_evidence_graph states the opportunity boundary",
);
const unauthenticatedStatus = await buffaloTools["buffalo.auth_status"].handler(
  {
    baseUrl: "https://buffaloprojects.com",
  },
);
assert(
  unauthenticatedStatus.localTools === "ready",
  "auth_status keeps local tools available without a token",
);
assert(
  unauthenticatedStatus.hostedTools === "needs-token",
  "auth_status asks for hosted auth without a token",
);
assert(
  unauthenticatedStatus.capabilityBoundary.currentState.includes(
    "two-sided marketplace",
  ),
  "auth_status states the opportunity boundary",
);

const hostedProject = {
  ...draft.project,
  id: "project-1",
  builderId: "builder-1",
  createdAt: draft.project.createdAt.toISOString(),
  lastActiveAt: draft.project.lastActiveAt.toISOString(),
};
const hostedMcpProject = {
  ...hostedProject,
  id: "project-mcp",
  title: "buffalo-projects-mcp",
  description: "",
  githubRepoUrl: "https://github.com/rhinehart514/Buffalo-Projects",
  primarySkills: [],
};
const today = new Date().toISOString().slice(0, 10);
let savedWorkPayload: Record<string, unknown> = {};
let vouchPayload: Record<string, unknown> = {};
let ignoredKeysPayload: string[] = [];

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
    string,
    unknown
  >;
}

const hostedServer = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");

  if (request.headers.authorization !== "Bearer bp_smoke") {
    response.statusCode = 401;
    response.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname === "/api/builder/projects") {
    if (request.method === "POST") {
      response.statusCode = 201;
      response.end(JSON.stringify({ project: { id: "new-1", slug: "new-1" } }));
      return;
    }
    response.end(
      JSON.stringify({ projects: [hostedProject, hostedMcpProject] }),
    );
    return;
  }

  if (url.pathname === "/api/builder/projects/project-1") {
    response.end(JSON.stringify({ project: hostedProject }));
    return;
  }

  if (url.pathname === "/api/builder/work-entries") {
    if (request.method === "POST") {
      savedWorkPayload = await readJsonBody(request);
      response.statusCode = 201;
      response.end(
        JSON.stringify({
          handle: "smoke-builder",
          entry: {
            id: "work-1",
            projectId: savedWorkPayload["projectId"],
            source: savedWorkPayload["source"],
            title: savedWorkPayload["title"],
            annotation: savedWorkPayload["annotation"],
            visibility: savedWorkPayload["visibility"],
            dateKey: today,
            occurredAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        }),
      );
      return;
    }

    response.end(
      JSON.stringify({
        entries: [
          {
            id: "work-1",
            projectId: "project-1",
            source: "mcp",
            title: "Shipped MCP smoke path",
            visibility: "private",
            dateKey: today,
          },
          {
            id: "work-2",
            projectId: "project-1",
            source: "github_commit",
            title: "Wire velocity view",
            visibility: "public",
            dateKey: today,
          },
        ],
      }),
    );
    return;
  }

  if (url.pathname === "/api/builder/me") {
    response.end(
      JSON.stringify({
        builder: {
          name: "Smoke Builder",
          handle: "smoke-builder",
          oneLiner: "Ships small tools weekly.",
        },
      }),
    );
    return;
  }

  if (url.pathname === "/api/builder/vouches") {
    response.end(
      JSON.stringify({ vouches: [{ id: "vouch-1" }, { id: "vouch-2" }] }),
    );
    return;
  }

  if (url.pathname === "/api/builder/me/vouch-tokens") {
    vouchPayload = await readJsonBody(request);
    response.statusCode = 201;
    response.end(
      JSON.stringify({
        token: "vouch-smoke",
        url: "https://buffaloprojects.com/vouch/vouch-smoke",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    );
    return;
  }

  if (url.pathname === "/api/targets") {
    response.end(
      JSON.stringify({
        matches: [
          {
            target: {
              id: "grant-1",
              name: "Buffalo Builder Grant",
              kind: "opportunity",
              status: "open",
            },
            reasons: ["Matches your stage and Buffalo geography."],
            gap: null,
          },
        ],
      }),
    );
    return;
  }

  if (url.pathname === "/api/builder/me/scan-ignore") {
    if (request.method === "PUT") {
      const body = await readJsonBody(request);
      ignoredKeysPayload = Array.isArray(body["keys"])
        ? body["keys"].filter((key): key is string => typeof key === "string")
        : [];
      response.end(JSON.stringify({ keys: ignoredKeysPayload }));
      return;
    }
    response.end(JSON.stringify({ keys: ignoredKeysPayload }));
    return;
  }

  response.statusCode = 404;
  response.end(JSON.stringify({ error: "Not found" }));
});
const hostedBaseUrl = await new Promise<string>((resolve) => {
  hostedServer.listen(0, "127.0.0.1", () => {
    const address = hostedServer.address();

    if (!address || typeof address === "string") {
      throw new Error("Smoke server did not start.");
    }

    resolve(`http://127.0.0.1:${address.port}`);
  });
});
const authenticatedStatus = await buffaloTools["buffalo.auth_status"].handler({
  baseUrl: hostedBaseUrl,
  token: "bp_smoke",
});
const listed = await buffaloTools["buffalo.list_projects"].handler({
  baseUrl: hostedBaseUrl,
  token: "bp_smoke",
});
const fetched = await buffaloTools["buffalo.get_project"].handler({
  baseUrl: hostedBaseUrl,
  token: "bp_smoke",
  projectId: "project-1",
});
const added = await buffaloTools["buffalo.add_projects"].handler({
  baseUrl: hostedBaseUrl,
  token: "bp_smoke",
  projects: [{ title: "Lab Inventory", description: "A scanned project." }],
});
const savedWork = await buffaloTools["buffalo.save_work"].handler({
  baseUrl: hostedBaseUrl,
  token: "bp_smoke",
  projectId: "project-1",
  title: "Shipped MCP smoke path",
  note: "The agent captured a concrete work entry.",
  sourceUrl: "https://github.com/rhinehart514/Buffalo-Projects/pull/1",
  visibility: "private",
});
const listedWork = await buffaloTools["buffalo.list_work"].handler({
  baseUrl: hostedBaseUrl,
  token: "bp_smoke",
  projectId: "project-1",
  source: "mcp",
});
const velocity = await buffaloTools["buffalo.get_velocity"].handler({
  baseUrl: hostedBaseUrl,
  token: "bp_smoke",
  projectId: "project-1",
  days: 7,
});
const vouch = await buffaloTools["buffalo.request_vouch"].handler({
  baseUrl: hostedBaseUrl,
  token: "bp_smoke",
  projectId: "project-1",
  note: "Please validate this work.",
  expiresInDays: 7,
});
const refresh = await buffaloTools["buffalo.refresh_projects"].handler({
  baseUrl: hostedBaseUrl,
  token: "bp_smoke",
  roots: [process.cwd()],
  maxCandidates: 10,
});
const ignored = await buffaloTools["buffalo.ignore_projects"].handler({
  baseUrl: hostedBaseUrl,
  token: "bp_smoke",
  keys: [inventory.candidates[0]!.sourceKey],
});
const matchedTargets = await buffaloTools["buffalo.match_targets"].handler({
  baseUrl: hostedBaseUrl,
  token: "bp_smoke",
  stage: "student",
});
const listedOpportunities = await buffaloTools[
  "buffalo.list_opportunities"
].handler({
  baseUrl: hostedBaseUrl,
  token: "bp_smoke",
});

// ── MCP Apps (SEP-1865) wire-format checks ──────────────────────────
// Run a real client against the real server in-process and verify what an
// MCP Apps host (Claude/ChatGPT) would see: the tool advertises its ui://
// resource, the resource serves the self-contained HTML view, and the tool
// result carries both plain text (graceful degradation) and
// structuredContent (what the card renders).
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const appsServer = createBuffaloMcpServer();
const appsClient = new Client({ name: "smoke-client", version: "0.0.0" });
await Promise.all([
  appsServer.connect(serverTransport),
  appsClient.connect(clientTransport),
]);

const listedTools = await appsClient.listTools();
const velocityTool = listedTools.tools.find(
  (tool) => tool.name === "buffalo.get_velocity",
);
assert(velocityTool, "buffalo.get_velocity is listed");
const velocityToolUi = velocityTool._meta?.["ui"] as
  | { resourceUri?: string }
  | undefined;
assert(
  velocityToolUi?.resourceUri === profileCardResourceUri,
  "buffalo.get_velocity declares its MCP App view via _meta.ui.resourceUri",
);
assert(
  velocityTool._meta?.["ui/resourceUri"] === profileCardResourceUri,
  "buffalo.get_velocity keeps the legacy ui/resourceUri key for older hosts",
);

const listedResources = await appsClient.listResources();
const cardResource = listedResources.resources.find(
  (resource) => resource.uri === profileCardResourceUri,
);
assert(cardResource, "profile card ui:// resource is listed");
assert(
  cardResource.mimeType === "text/html;profile=mcp-app",
  "profile card resource uses the MCP Apps MIME type",
);

const readCard = await appsClient.readResource({
  uri: profileCardResourceUri,
});
const cardContent = readCard.contents[0];
assert(
  cardContent !== undefined &&
    cardContent.mimeType === "text/html;profile=mcp-app" &&
    "text" in cardContent &&
    typeof cardContent.text === "string",
  "profile card resource read returns HTML text with the MCP Apps MIME type",
);
const cardHtml = (cardContent as { text: string }).text;
assert(
  cardHtml.includes("Buffalo Projects") &&
    cardHtml.includes("heatmap") &&
    !/\bsrc=["']https?:/.test(cardHtml),
  "profile card HTML is self-contained Buffalo Projects markup",
);
// Parse the inline bundle the way a browser would. This catches whole-script
// corruption (e.g. `$&`-style substitution artifacts from templating) that
// string-presence checks sail past — a card that does not parse renders as a
// blank iframe in every host.
{
  const scriptMatch = cardHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert(scriptMatch?.[1], "profile card HTML contains its inline bundle");
  try {
    new Function(scriptMatch[1].replaceAll("<\\/script", "</script"));
  } catch (error) {
    assert(
      false,
      `profile card inline bundle is not parseable JavaScript: ${String(error)}`,
    );
  }
}

const appsVelocityResult = await appsClient.callTool({
  name: "buffalo.get_velocity",
  arguments: { baseUrl: hostedBaseUrl, token: "bp_smoke", days: 7 },
});
const appsVelocity = appsVelocityResult.structuredContent as {
  totalEntries?: number;
  byDay?: Record<string, number>;
  builder?: { handle?: string; profileUrl?: string; vouchCount?: number };
};
assert(
  Array.isArray(appsVelocityResult.content) &&
    appsVelocityResult.content.some((block) => block.type === "text"),
  "get_velocity keeps plain text content for hosts without MCP Apps",
);
assert(
  appsVelocity?.totalEntries === 2,
  "get_velocity structuredContent carries the velocity summary",
);
assert(
  (appsVelocity.byDay?.[today] ?? 0) === 2,
  "get_velocity structuredContent carries real day counts for the heatmap",
);
assert(
  appsVelocity.builder?.handle === "smoke-builder" &&
    appsVelocity.builder?.profileUrl === `${hostedBaseUrl}/b/smoke-builder` &&
    appsVelocity.builder?.vouchCount === 2,
  "get_velocity structuredContent carries builder identity and vouch count",
);
await appsClient.close();
await appsServer.close();

hostedServer.close();

assert(listed.projects.length >= 1, "list_projects returned hosted projects");
assert(
  authenticatedStatus.hostedTools === "verified",
  "auth_status verifies hosted auth",
);
assert(
  fetched.project?.id === "project-1",
  "get_project returned hosted project",
);
assert(added.created.length === 1, "add_projects created a project");
assert(
  added.created[0]?.url.includes("/app/new-1"),
  "add_projects returned the workspace URL",
);
assert(
  savedWork.handle === "smoke-builder",
  "save_work returned builder handle",
);
assert(
  savedWork.url?.includes("/b/smoke-builder"),
  "save_work returned page URL",
);
assert(savedWorkPayload["source"] === "mcp", "save_work writes MCP source");
const savedOperationId = savedWorkPayload["operationId"];
assert(
  typeof savedOperationId === "string" && savedOperationId.startsWith("mcp:"),
  "save_work sends stable operation id",
);
assert(
  savedWorkPayload["sourceUrl"] ===
    "https://github.com/rhinehart514/Buffalo-Projects/pull/1",
  "save_work sends sourceUrl",
);
assert(listedWork.count === 1, "list_work filters by source");
assert(velocity.totalEntries === 2, "get_velocity counts recent work entries");
assert(velocity.bySource["github"] === 1, "get_velocity buckets GitHub work");
assert(vouch.token === "vouch-smoke", "request_vouch returned token");
assert(
  vouchPayload["projectId"] === "project-1",
  "request_vouch sends project id",
);
assert(refresh.matches.length >= 1, "refresh_projects matched hosted project");
assert(
  ignored.keys.includes(inventory.candidates[0]!.sourceKey),
  "ignore_projects returned ignored key",
);
assert(
  matchedTargets.count === 1 &&
    matchedTargets.matches[0]?.["target"] !== undefined,
  "match_targets routes the builder to hosted targets",
);
assert(
  listedOpportunities.count === 1 &&
    listedOpportunities.opportunities[0]?.["target"] !== undefined,
  "list_opportunities returns the hosted opportunity corpus",
);

assert(
  readBuffaloResource("buffalo://schema/project"),
  "schema resource is readable",
);
assert(readBuffaloResource("buffalo://rubric"), "rubric resource is readable");
assert(
  readBuffaloResource("buffalo://templates/engineering"),
  "template resource is readable",
);
assert(
  Array.isArray(readBuffaloResource("buffalo://examples/engineering")),
  "examples resource is readable",
);
assert(
  buffaloPrompts["buffalo:intake"].includes("draft"),
  "intake prompt is registered",
);
assert(
  buffaloPrompts["buffalo:first-work-record"].includes("private"),
  "first work record prompt is registered",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      tools: Object.keys(buffaloTools),
      prompts: Object.keys(buffaloPrompts),
      suggestions: suggestions.length,
      matchedTargets: matchedTargets.count,
      listedOpportunities: listedOpportunities.count,
      hostedProjects: listed.projects.length,
      hostedWorkEntries: listedWork.count,
      velocityEntries: velocity.totalEntries,
      resumeHighlights: resumeBrief.projectHighlights.length,
    },
    null,
    2,
  ),
);
