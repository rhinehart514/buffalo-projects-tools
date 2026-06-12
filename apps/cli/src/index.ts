import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { realpathSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as clack from "@clack/prompts";
import {
  candidateToProjectInput,
  checkDensity,
  classifyProjectSyncState,
  createHttpProjectReadRepository,
  createHttpProjectSyncRepository,
  decideProjectPull,
  decideProjectPush,
  hostedRequestError,
  scanProjects,
  type ProjectSyncState,
  type ScanCandidate,
} from "@buffalo/core";
import {
  appendEvidenceMarkdown,
  appendMilestoneMarkdown,
  blankMarkdownFromExample,
  createProjectMarkdownTemplate,
  examplesForTemplate,
  findProjectExample,
  projectFromMarkdown,
  projectTemplateTypes,
} from "@buffalo/projectmd";
import { projectSchema, type ProjectTemplateType } from "@buffalo/schema";
// @buffalo/ui pulls in react-dom (~1MB) for HTML rendering. It's only used by
// `buffalo preview`, so it's lazy-imported there (see previewProject) to keep
// it out of the hot `scan`/`log` path and the eager bundle.

const execFileAsync = promisify(execFile);
const defaultHostedBaseUrl = "https://buffaloprojects.com";

interface CliOptions {
  json: boolean;
  force: boolean;
  template?: ProjectTemplateType;
  caption?: string;
  milestone?: string;
  note?: string;
  days?: number;
  remote?: string;
  from?: string;
  accept?: string;
  project?: string;
  tags?: string;
  event?: string;
  push: boolean;
  dryRun: boolean;
  yes: boolean;
  save: boolean;
  markdown: boolean;
  daysSet: boolean;
}

interface BuffaloConfig {
  defaultVisibility?: "private" | "link" | "public";
  defaultTemplate?: ProjectTemplateType;
  editor?: string;
  /**
   * Legacy fallback for early local builds. New logins store tokens in the OS keychain.
   */
  token?: string;
  syncBaseUrl?: string;
  /**
   * The target the builder is currently building toward, set by `buffalo aim`.
   * Stored locally only — hosted persistence of aims is a future step.
   */
  aimedTargetId?: string;
}

const keychainService = "buffalo-cli";
const keychainAccount = "buffalo-token";

function usage(): string {
  return [
    "Buffalo CLI",
    "",
    "Usage:",
    "  buffalo init [--template <type>] [--json]",
    "  buffalo new --from <example-id> [--json]",
    "  buffalo login [--json]",
    "  buffalo auth [--json]",
    "  buffalo config [get <key> | set <key> <value>] [--json]",
    "  buffalo lint [project.md] [--json]",
    "  buffalo add evidence <file-or-url> [--caption <text>] [--milestone <id>] [--json]",
    "  buffalo add milestone <title> [--note <text>] [--json]",
    "  buffalo log <what you shipped> [--note <text>] [--project <id>] [--json]",
    "  buffalo record [--days <n>] [--save] [--markdown] [--json]",
    "  buffalo export mentor-update|profile-draft|json [--json]",
    "  buffalo targets [--tags <a,b>] [--event <id>] [--json]",
    "  buffalo aim <targetId> [--json]",
    "  buffalo scan [--days <n>] [--dry-run] [--yes] [--json]",
    "  buffalo capture [--days <n>] [--accept <id,id|all>] [--json]",
    "  buffalo diff [--remote <path>] [--json]",
    "  buffalo preview [--json]",
    "  buffalo push [--remote <path>] [--force] [--json]",
    "  buffalo pull [--remote <path>] [--force] [--json]",
    "  buffalo status [--json]",
    "  buffalo ci [--push] [--json]",
    "  buffalo examples <type> [--json]",
    "",
    `Template types: ${projectTemplateTypes.join(", ")}`,
  ].join("\n");
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

// ── Human-friendly terminal output ─────────────────────────────────────
// Calm, legible confirmations that mirror the landing demo: a ✓ for done,
// the work itself, then the live page URL as the payoff. Plain text only —
// no ANSI/color, so it stays readable when piped or in CI. The --json
// branch is never routed through here, so machine output is unchanged.

function ok(title: string, details: string[] = []): void {
  console.log(`\n  ✓ ${title}`);
  for (const detail of details) {
    console.log(`    ${detail}`);
  }
}

/** Strip protocol/trailing slash so a URL reads cleanly on a terminal line. */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/** Optional public profile URL — returned only as a shareable output pointer. */
function publicPageUrl(baseUrl: string, handle: string): string {
  return `${displayUrl(baseUrl)}/b/${handle}`;
}

function loginRequiredMessage(): string {
  return [
    "Not logged in.",
    "Run `buffalo login` to connect your Buffalo Projects account, or set BUFFALO_TOKEN for CI/MCP.",
  ].join(" ");
}

/**
 * A hosted-command failure that already carries a human next action. Thrown
 * instead of a bare `Error` so the top-level handler can emit structured
 * `{ ok, error, next }` JSON (and a clean two-line message in text mode) rather
 * than dumping a raw API body like `{"error":"Unauthorized"}` as the error
 * string — which then got double-encoded under `--json`.
 */
class CliActionError extends Error {
  readonly next?: string;
  readonly status?: number;
  readonly baseUrl?: string;
  constructor(opts: {
    error: string;
    next?: string;
    status?: number;
    baseUrl?: string;
  }) {
    super(opts.error);
    this.name = "CliActionError";
    this.next = opts.next;
    this.status = opts.status;
    this.baseUrl = opts.baseUrl;
  }
}

/** No usable token in env, keychain, or config — nothing was even attempted. */
function notConnectedError(baseUrl?: string): CliActionError {
  return new CliActionError({
    error: "Not connected to Buffalo Projects.",
    next: "Run `buffalo login` or set BUFFALO_TOKEN.",
    baseUrl: baseUrl ? displayUrl(baseUrl) : undefined,
  });
}

/**
 * Map a failed hosted response to a structured CLI error with a next action.
 * Reuses @buffalo/core's classifier (firewall / unauthorized / rate-limit /
 * server) so the CLI, MCP, and docs describe the same failure the same way. A
 * rejected token reads as "Not connected" because that is what it means to the
 * builder — their saved login no longer works.
 */
function hostedActionError(
  response: { status: number; headers: { get(name: string): string | null } },
  action: string,
  baseUrl: string,
  detail?: string,
): CliActionError {
  const classified = hostedRequestError(response, action, detail);
  const host = displayUrl(baseUrl);
  if (classified.kind === "unauthorized") {
    return new CliActionError({
      error: "Not connected to Buffalo Projects.",
      next: "Your saved login was rejected — run `buffalo login` again or set a fresh BUFFALO_TOKEN.",
      status: classified.status,
      baseUrl: host,
    });
  }
  const next =
    classified.kind === "firewall"
      ? 'A bot-protection rule is blocking API clients — set Buffalo\'s bot_protection rule to "log" (see the MCP README), then retry.'
      : classified.kind === "rate_limited"
        ? "Wait a few seconds and retry."
        : classified.kind === "server"
          ? "Buffalo had a server error — retry shortly."
          : "Retry shortly; if it persists, check your connection and Buffalo status.";
  return new CliActionError({
    error: classified.message,
    next,
    status: classified.status,
    baseUrl: host,
  });
}

function usageResult(message = "Invalid Buffalo CLI command or arguments.") {
  return {
    ok: false,
    error: message,
    usage: usage(),
  };
}

function printUsageError(options: CliOptions, message?: string): void {
  const result = usageResult(message);

  options.json ? printJson(result) : console.error(result.usage);
}

function optionValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);

  return index === -1 ? undefined : argv[index + 1];
}

function parseOptions(argv: string[]): CliOptions {
  const template = optionValue(argv, "--template");

  return {
    json: argv.includes("--json"),
    force: argv.includes("--force"),
    template:
      template && projectTemplateTypes.includes(template as ProjectTemplateType)
        ? (template as ProjectTemplateType)
        : undefined,
    caption: optionValue(argv, "--caption"),
    milestone: optionValue(argv, "--milestone"),
    note: optionValue(argv, "--note"),
    days: Number(optionValue(argv, "--days") ?? 7),
    remote: optionValue(argv, "--remote"),
    from: optionValue(argv, "--from"),
    accept: optionValue(argv, "--accept"),
    project: optionValue(argv, "--project"),
    tags: optionValue(argv, "--tags"),
    event: optionValue(argv, "--event"),
    push: argv.includes("--push"),
    dryRun: argv.includes("--dry-run"),
    yes: argv.includes("--yes"),
    save: argv.includes("--save"),
    markdown: argv.includes("--markdown"),
    daysSet: argv.includes("--days"),
  };
}

async function promptForTemplateType(
  fallback: ProjectTemplateType,
  options: CliOptions,
): Promise<ProjectTemplateType> {
  if (options.json || !process.stdin.isTTY || !process.stdout.isTTY) {
    return fallback;
  }

  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log(
      `Choose a project template: ${projectTemplateTypes.join(", ")}`,
    );
    const answer = await prompt.question(`Template (${fallback}): `);
    const value = answer.trim();

    if (projectTemplateTypes.includes(value as ProjectTemplateType)) {
      return value as ProjectTemplateType;
    }

    return fallback;
  } finally {
    prompt.close();
  }
}

function positional(argv: string[]): string[] {
  const values: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (!value) {
      continue;
    }

    if (value.startsWith("--")) {
      const valueless = [
        "--json",
        "--force",
        "--dry-run",
        "--yes",
        "--push",
        "--save",
        "--markdown",
      ];
      index += valueless.includes(value) ? 0 : 1;
      continue;
    }

    values.push(value);
  }

  return values;
}

function cwdPath(...parts: string[]): string {
  return resolve(process.cwd(), ...parts);
}

function configPath(): string {
  return resolve(
    process.env["BUFFALO_CONFIG_HOME"] ??
      process.env["XDG_CONFIG_HOME"] ??
      join(homedir(), ".config"),
    "buffalo",
    "config.toml",
  );
}

function parseConfigToml(value: string): BuffaloConfig {
  const config: BuffaloConfig = {};

  for (const line of value.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+)\s*=\s*"(.*)"\s*$/.exec(line.trim());
    if (!match) {
      continue;
    }

    const key = match[1];
    const rawValue = match[2]?.replace(/\\"/g, '"') ?? "";

    if (key === "defaultVisibility") {
      config.defaultVisibility = rawValue as BuffaloConfig["defaultVisibility"];
    }
    if (
      key === "defaultTemplate" &&
      projectTemplateTypes.includes(rawValue as ProjectTemplateType)
    ) {
      config.defaultTemplate = rawValue as ProjectTemplateType;
    }
    if (key === "editor") {
      config.editor = rawValue;
    }
    if (key === "token") {
      config.token = rawValue;
    }
    if (key === "syncBaseUrl") {
      config.syncBaseUrl = rawValue;
    }
    if (key === "aimedTargetId") {
      config.aimedTargetId = rawValue;
    }
  }

  return config;
}

function serializeConfigToml(config: BuffaloConfig): string {
  return Object.entries(config)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key} = "${String(value).replace(/"/g, '\\"')}"`)
    .join("\n")
    .concat("\n");
}

async function readConfig(): Promise<BuffaloConfig> {
  const text = await readOptional(configPath());

  return text ? parseConfigToml(text) : {};
}

async function writeConfig(config: BuffaloConfig): Promise<void> {
  const path = configPath();

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeConfigToml(config), { mode: 0o600 });
}

async function readKeychainToken(): Promise<string | null> {
  if (process.platform !== "darwin") {
    return null;
  }

  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-a",
      keychainAccount,
      "-s",
      keychainService,
      "-w",
    ]);

    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function writeKeychainToken(token: string): Promise<boolean> {
  if (process.platform !== "darwin") {
    return false;
  }

  try {
    await execFileAsync("security", [
      "add-generic-password",
      "-a",
      keychainAccount,
      "-s",
      keychainService,
      "-w",
      token,
      "-U",
    ]);

    return true;
  } catch {
    return false;
  }
}

async function readAuthToken(
  config: BuffaloConfig,
): Promise<string | undefined> {
  return (await readAuthState(config)).token;
}

async function readAuthState(config: BuffaloConfig): Promise<{
  token?: string;
  source: "environment" | "os-keychain" | "config-fallback" | "missing";
}> {
  if (process.env["BUFFALO_TOKEN"]) {
    return { token: process.env["BUFFALO_TOKEN"], source: "environment" };
  }

  const keychainToken = await readKeychainToken();
  if (keychainToken) {
    return { token: keychainToken, source: "os-keychain" };
  }

  if (config.token) {
    return { token: config.token, source: "config-fallback" };
  }

  return { source: "missing" };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

async function readProjectMarkdown(filePath = "project.md"): Promise<{
  inputPath: string;
  markdown: string;
}> {
  const inputPath = cwdPath(filePath);
  const markdown = await readFile(inputPath, "utf8");

  return { inputPath, markdown };
}

function statePath(): string {
  return cwdPath(".buffalo", "state.json");
}

function defaultRemotePath(): string {
  return cwdPath(".buffalo", "remote.project.md");
}

async function readState(): Promise<ProjectSyncState | null> {
  try {
    return JSON.parse(await readFile(statePath(), "utf8")) as ProjectSyncState;
  } catch {
    return null;
  }
}

async function writeState(state: ProjectSyncState): Promise<void> {
  const buffaloDir = cwdPath(".buffalo");

  await mkdir(buffaloDir, { recursive: true });
  await writeFile(statePath(), `${JSON.stringify(state, null, 2)}\n`);
}

async function writeMetadata(
  projectId: string,
  markdown: string,
): Promise<void> {
  await writeState({
    projectId,
    syncState: "local-only",
    lastPushedHash: null,
    lastPulledHash: null,
    localHash: hash(markdown),
    remotePath: defaultRemotePath(),
    remoteHash: null,
  });
}

async function updateLocalHash(markdown: string): Promise<void> {
  const state = await readState();

  if (!state) {
    return;
  }

  await writeState({
    ...state,
    syncState: state.remoteHash === hash(markdown) ? "synced" : "local-only",
    localHash: hash(markdown),
  });
}

function resolveRemotePath(
  options: CliOptions,
  state: ProjectSyncState | null,
): string {
  return resolve(options.remote ?? state?.remotePath ?? defaultRemotePath());
}

function isHttpUrl(value: string | undefined): boolean {
  return Boolean(value && /^https?:\/\//i.test(value));
}

function hostedBaseUrl(
  options: CliOptions,
  config: BuffaloConfig,
): string | undefined {
  return isHttpUrl(options.remote) ? options.remote : config.syncBaseUrl;
}

function loginBaseUrl(options: CliOptions, config: BuffaloConfig): string {
  return hostedBaseUrl(options, config) ?? defaultHostedBaseUrl;
}

function cliLoginUrl(
  baseUrl: string,
  callbackUrl: string,
  state: string,
): string {
  const url = new URL("/cli/login", baseUrl);
  url.searchParams.set("callback", callbackUrl);
  url.searchParams.set("state", state);

  return url.toString();
}

async function openBrowser(url: string): Promise<boolean> {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  try {
    await execFileAsync(command, args);
    return true;
  } catch {
    return false;
  }
}

async function waitForBrowserLogin(options: {
  baseUrl: string;
  timeoutMs?: number;
  onManualLoginUrl?: (url: string) => void;
}): Promise<{
  token: string;
  callbackUrl: string;
  loginUrl: string;
}> {
  const state = randomUUID();
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;

  return await new Promise((resolvePromise, reject) => {
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (requestUrl.pathname !== "/callback") {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("Not found");
        return;
      }

      const returnedState = requestUrl.searchParams.get("state");
      const token = requestUrl.searchParams.get("token");
      const error = requestUrl.searchParams.get("error");

      if (returnedState !== state) {
        response.writeHead(400, { "content-type": "text/html" });
        response.end(
          "<h1>Buffalo login failed</h1><p>The login state did not match.</p>",
        );
        reject(
          new Error("Login failed because the callback state did not match."),
        );
        server.close();
        return;
      }

      if (error || !token) {
        response.writeHead(400, { "content-type": "text/html" });
        response.end(
          "<h1>Buffalo login failed</h1><p>Return to the terminal and try again.</p>",
        );
        reject(new Error(error ?? "Login callback did not include a token."));
        server.close();
        return;
      }

      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        "<h1>Buffalo CLI is connected.</h1><p>You can close this tab.</p>",
      );
      resolvePromise({
        token,
        callbackUrl: `http://127.0.0.1:${addressPort(server)}/callback`,
        loginUrl: cliLoginUrl(
          options.baseUrl,
          `http://127.0.0.1:${addressPort(server)}/callback`,
          state,
        ),
      });
      server.close();
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for browser login."));
    }, timeoutMs);

    server.once("close", () => clearTimeout(timer));
    server.once("error", reject);
    server.listen(0, "127.0.0.1", async () => {
      const callbackUrl = `http://127.0.0.1:${addressPort(server)}/callback`;
      const loginUrl = cliLoginUrl(options.baseUrl, callbackUrl, state);
      const opened = await openBrowser(loginUrl);

      if (!opened) {
        options.onManualLoginUrl?.(loginUrl);
      }
    });
  });
}

function addressPort(server: ReturnType<typeof createServer>): number {
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Login callback server did not start.");
  }

  return address.port;
}

function stateProjectId(state: ProjectSyncState | null): string {
  return state?.projectId ?? "local-project";
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function initProject(options: CliOptions): Promise<number> {
  const projectPath = cwdPath("project.md");
  const config = await readConfig();

  if ((await exists(projectPath)) && !options.force) {
    const result = {
      ok: true,
      changed: false,
      projectPath,
      message: "project.md already exists; nothing changed.",
    };

    options.json ? printJson(result) : console.log(result.message);
    return 0;
  }

  const markdown = createProjectMarkdownTemplate({
    templateType:
      options.template ??
      config.defaultTemplate ??
      (await promptForTemplateType("generic", options)),
  });
  const projectId = randomUUID();

  await writeFile(projectPath, markdown, "utf8");
  await writeMetadata(projectId, markdown);

  const result = {
    ok: true,
    changed: true,
    projectPath,
    metadataPath: cwdPath(".buffalo", "state.json"),
    projectId,
  };

  options.json
    ? printJson(result)
    : ok("created project.md", ["next: buffalo lint, then buffalo push"]);
  return 0;
}

async function newFromExample(options: CliOptions): Promise<number> {
  const exampleId = options.from;

  if (!exampleId) {
    printUsageError(options, "Missing required --from <example-id>.");
    return 1;
  }

  const example = findProjectExample(exampleId);

  if (!example) {
    const result = {
      ok: false,
      error: `Unknown example: ${exampleId}`,
    };

    options.json ? printJson(result) : console.error(result.error);
    return 1;
  }

  const projectPath = cwdPath("project.md");

  if ((await exists(projectPath)) && !options.force) {
    const result = {
      ok: false,
      projectPath,
      error:
        "project.md already exists. Re-run with --force to replace it deliberately.",
    };

    options.json ? printJson(result) : console.error(result.error);
    return 1;
  }

  const markdown = blankMarkdownFromExample(example);
  const projectId = randomUUID();

  await writeFile(projectPath, markdown, "utf8");
  await writeMetadata(projectId, markdown);

  const result = {
    ok: true,
    changed: true,
    projectPath,
    projectId,
    from: example.id,
  };

  options.json
    ? printJson(result)
    : ok(`created project.md from ${example.id}`, [
        "next: buffalo lint, then buffalo push",
      ]);
  return 0;
}

function coerceConfigValue(key: string, value: string): Partial<BuffaloConfig> {
  if (key === "defaultVisibility") {
    if (!["private", "link", "public"].includes(value)) {
      throw new Error("defaultVisibility must be private, link, or public.");
    }
    return { defaultVisibility: value as BuffaloConfig["defaultVisibility"] };
  }

  if (key === "defaultTemplate") {
    if (!projectTemplateTypes.includes(value as ProjectTemplateType)) {
      throw new Error(
        `defaultTemplate must be one of: ${projectTemplateTypes.join(", ")}.`,
      );
    }
    return { defaultTemplate: value as ProjectTemplateType };
  }

  if (key === "editor") {
    return { editor: value };
  }

  if (key === "syncBaseUrl") {
    try {
      new URL(value);
    } catch {
      throw new Error("syncBaseUrl must be an absolute URL.");
    }
    return { syncBaseUrl: value };
  }

  throw new Error(
    "Supported config keys: defaultVisibility, defaultTemplate, editor, syncBaseUrl.",
  );
}

async function configCommand(
  args: string[],
  options: CliOptions,
): Promise<number> {
  const [action, key, ...valueParts] = args;
  const config = await readConfig();

  if (!action) {
    const result = { ok: true, path: configPath(), config };
    options.json
      ? printJson(result)
      : console.log(serializeConfigToml(config).trim());
    return 0;
  }

  if (action === "get" && key) {
    const value = config[key as keyof BuffaloConfig];
    const result = { ok: value !== undefined, key, value };
    options.json ? printJson(result) : console.log(value ?? "");
    return value === undefined ? 1 : 0;
  }

  if (action === "set" && key && valueParts.length) {
    const patch = coerceConfigValue(key, valueParts.join(" "));
    const nextConfig = { ...config, ...patch };

    await writeConfig(nextConfig);

    const result = {
      ok: true,
      changed: true,
      path: configPath(),
      config: nextConfig,
    };
    options.json ? printJson(result) : console.log(`Updated ${key}`);
    return 0;
  }

  printUsageError(options);
  return 1;
}

async function loginCommand(options: CliOptions): Promise<number> {
  const envToken = process.env["BUFFALO_TOKEN"];
  const config = await readConfig();
  const baseUrl = loginBaseUrl(options, config);

  if (!envToken) {
    const existingToken = await readAuthToken(config);

    if (existingToken) {
      const result = {
        ok: true,
        changed: false,
        authState: "authenticated",
        storage: "existing-token",
        baseUrl,
        message: "Already logged in.",
      };

      options.json ? printJson(result) : ok("already connected");
      return 0;
    }
  }

  const login = envToken
    ? { token: envToken, callbackUrl: null, loginUrl: null }
    : await waitForBrowserLogin({
        baseUrl,
        onManualLoginUrl: options.json
          ? undefined
          : (url) => console.log(`Open this URL to finish login:\n${url}`),
      });
  const storedInKeychain = await writeKeychainToken(login.token);

  if (!storedInKeychain) {
    await writeConfig({ ...config, token: login.token });
  }

  const result = {
    ok: true,
    changed: true,
    authState: "authenticated",
    storage: storedInKeychain ? "os-keychain" : "config-fallback",
    baseUrl,
    callbackUrl: login.callbackUrl,
    loginUrl: login.loginUrl,
    message: envToken
      ? storedInKeychain
        ? "Stored BUFFALO_TOKEN in the OS keychain."
        : "Stored BUFFALO_TOKEN in local CLI config because the OS keychain was unavailable."
      : "Logged in through the browser.",
  };

  if (options.json) {
    printJson(result);
  } else {
    ok("connected", ['log your next ship: buffalo log "what you shipped"']);
  }

  return 0;
}

async function authCommand(options: CliOptions): Promise<number> {
  const config = await readConfig();
  const baseUrl = loginBaseUrl(options, config).replace(/\/+$/g, "");
  const auth = await readAuthState(config);

  if (!auth.token) {
    const result = {
      ok: false,
      authenticated: false,
      baseUrl,
      tokenSource: auth.source,
      next: "Run `buffalo login` to connect this machine, or set BUFFALO_TOKEN for CI/MCP.",
    };

    if (options.json) {
      printJson(result);
    } else {
      console.error(
        `${loginRequiredMessage()}\nAccount page: ${baseUrl}/app/settings`,
      );
    }

    return 1;
  }

  try {
    const projects = await createHttpProjectReadRepository({
      baseUrl,
      token: auth.token,
    }).list();
    const result = {
      ok: true,
      authenticated: true,
      baseUrl,
      tokenSource: auth.source,
      visibleProjectCount: projects.length,
      next: 'Log work with `buffalo log "what you shipped"` or scan this repo with `buffalo scan`.',
    };

    options.json
      ? printJson(result)
      : ok("connected", [
          `account: ${displayUrl(baseUrl)}`,
          `projects visible: ${projects.length}`,
          'next: buffalo log "what you shipped"',
        ]);

    return 0;
  } catch (error) {
    const result = {
      ok: false,
      authenticated: false,
      baseUrl,
      tokenSource: auth.source,
      error: error instanceof Error ? error.message : "Auth check failed.",
      next: "Run `buffalo login` again, or create a fresh API key in Buffalo Projects settings.",
    };

    if (options.json) {
      printJson(result);
    } else {
      console.error(
        [
          "Buffalo found a token, but the hosted account check failed.",
          result.error,
          `Try: buffalo login`,
          `Settings: ${baseUrl}/app/settings`,
        ].join("\n"),
      );
    }

    return 1;
  }
}

async function lintProject(
  filePath: string | undefined,
  options: CliOptions,
): Promise<number> {
  const { inputPath, markdown } = await readProjectMarkdown(filePath);
  const project = projectSchema.parse(
    projectFromMarkdown(markdown, {
      id: basename(inputPath).replace(/\.md$/i, ""),
    }),
  );
  const report = checkDensity({ project, markdown });
  const result = {
    ok: report.passes,
    filePath: inputPath,
    project,
    report,
  };

  if (options.json) {
    printJson(result);
  } else {
    console.log(`${project.title}`);
    console.log(`Density score: ${report.score}/100`);

    for (const dimension of report.dimensions) {
      console.log(`- ${dimension.label}: ${dimension.status}`);
    }

    if (report.gapItems.length) {
      console.log("\nGaps");
      for (const gap of report.gapItems) {
        console.log(`- ${gap.line ? `line ${gap.line}: ` : ""}${gap.message}`);
      }
    }
  }

  return report.passes ? 0 : 1;
}

async function addEvidence(
  source: string | undefined,
  options: CliOptions,
): Promise<number> {
  if (!source) {
    printUsageError(options, "Missing evidence file or URL.");
    return 1;
  }

  const { inputPath, markdown } = await readProjectMarkdown();
  const nextMarkdown = appendEvidenceMarkdown(markdown, {
    source,
    caption: options.caption,
    milestoneId: options.milestone,
  });

  await writeFile(inputPath, nextMarkdown, "utf8");
  await updateLocalHash(nextMarkdown);

  const result = {
    ok: true,
    changed: true,
    filePath: inputPath,
    evidence: {
      source,
      caption: options.caption,
      milestoneId: options.milestone,
    },
  };

  options.json ? printJson(result) : ok("added evidence", [source]);
  return 0;
}

async function addMilestone(
  title: string | undefined,
  options: CliOptions,
): Promise<number> {
  if (!title) {
    printUsageError(options, "Missing milestone title.");
    return 1;
  }

  const { inputPath, markdown } = await readProjectMarkdown();
  const nextMarkdown = appendMilestoneMarkdown(markdown, {
    title,
    note: options.note,
    date: localDateString(),
  });

  await writeFile(inputPath, nextMarkdown, "utf8");
  await updateLocalHash(nextMarkdown);

  const result = {
    ok: true,
    changed: true,
    filePath: inputPath,
    milestone: {
      title,
      note: options.note,
    },
  };

  options.json ? printJson(result) : ok("added milestone", [title]);
  return 0;
}

/**
 * Log one shipped thing straight to the hosted Buffalo work page from the
 * terminal — the CLI half of "your work logs itself". Posts a WorkEntry with
 * source "cli" (rendered "via buffalo push" on the log), so it shows up
 * attributed to the terminal, not as a hand-typed entry. Unlike `add
 * milestone`, this does not touch the local project.md — it appends to the
 * living record directly.
 */
async function logWork(title: string, options: CliOptions): Promise<number> {
  const trimmed = title.trim();
  if (!trimmed) {
    printUsageError(
      options,
      'Missing work entry. Try: buffalo log "shipped the onboarding flow".',
    );
    return 1;
  }

  const config = await readConfig();
  const token = await readAuthToken(config);
  const baseUrl = loginBaseUrl(options, config);
  if (!token) {
    throw notConnectedError(baseUrl);
  }

  const response = await fetch(
    `${baseUrl.replace(/\/+$/g, "")}/api/builder/work-entries`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: trimmed,
        annotation: options.note,
        projectId: options.project,
        source: "cli",
        operationId: randomUUID(),
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw hostedActionError(
      response,
      "log your work entry",
      baseUrl,
      detail || undefined,
    );
  }

  const data = (await response.json()) as {
    entry?: { id?: string };
    handle?: string | null;
  };
  const result = {
    ok: true,
    logged: { title: trimmed, note: options.note, projectId: options.project },
    entryId: data.entry?.id,
    handle: data.handle ?? null,
  };
  if (options.json) {
    printJson(result);
  } else {
    const details = [trimmed];
    if (data.handle) {
      details.push(`→ live at ${publicPageUrl(baseUrl, data.handle)}`);
    }
    ok("logged to your work page", details);
  }
  return 0;
}

// ── buffalo scan ────────────────────────────────────────────────────────
//
// Detect the distinct projects in a codebase and add the ones you choose.
// Reflects what you built — it does NOT judge quality. Candidates are ranked
// by recency/activity only; you curate (use / skip / never). Chosen ones are
// created link-only (publishing stays explicit).

function ignorePath(): string {
  return cwdPath(".buffalo", "ignore.json");
}

async function readLocalIgnore(): Promise<string[]> {
  try {
    const data = JSON.parse(await readFile(ignorePath(), "utf8")) as {
      never?: unknown;
    };
    return Array.isArray(data.never)
      ? data.never.filter((k): k is string => typeof k === "string")
      : [];
  } catch {
    return [];
  }
}

async function writeLocalIgnore(keys: string[]): Promise<void> {
  await mkdir(cwdPath(".buffalo"), { recursive: true });
  await writeFile(
    ignorePath(),
    `${JSON.stringify({ never: [...new Set(keys)] }, null, 2)}\n`,
  );
}

async function readRemoteIgnore(
  baseUrl: string,
  token: string,
): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/api/builder/me/scan-ignore`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as { keys?: string[] };
    return Array.isArray(data.keys) ? data.keys : [];
  } catch {
    return [];
  }
}

async function writeRemoteIgnore(
  baseUrl: string,
  token: string,
  keys: string[],
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/builder/me/scan-ignore`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ keys }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function createHostedProject(
  baseUrl: string,
  token: string,
  body: ReturnType<typeof candidateToProjectInput>,
): Promise<{ id: string }> {
  const res = await fetch(`${baseUrl}/api/builder/projects`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw hostedActionError(
      res,
      "create the project",
      baseUrl,
      detail || undefined,
    );
  }
  const data = (await res.json()) as { project: { id: string } };
  return data.project;
}

function candidateHint(candidate: ScanCandidate): string {
  const bits: string[] = [candidate.groupingKind];
  if (candidate.recency.commitCount > 0) {
    bits.push(`${candidate.recency.commitCount} commits`);
  }
  if (candidate.skills.length > 0) {
    bits.push(candidate.skills.slice(0, 3).join("/"));
  }
  if (candidate.dedupe) {
    bits.push("already on your page");
  }
  return bits.join(" · ");
}

async function enrichProjects(
  baseUrl: string,
  token: string,
  created: { title: string; projectId: string }[],
): Promise<void> {
  for (const project of created) {
    clack.note(project.title, "Add detail");

    const description = await clack.text({
      message: "One-line summary (enter to skip)",
    });
    if (clack.isCancel(description)) {
      return;
    }
    const skills = await clack.text({
      message: "Key skills, comma-separated (enter to skip)",
    });
    if (clack.isCancel(skills)) {
      return;
    }
    const currentAsk = await clack.text({
      message: "Current ask — what do you want a viewer to do? (enter to skip)",
    });
    if (clack.isCancel(currentAsk)) {
      return;
    }

    const body: Record<string, unknown> = {};
    if (typeof description === "string" && description.trim()) {
      body["description"] = description.trim();
    }
    if (typeof skills === "string" && skills.trim()) {
      body["primarySkills"] = skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 8);
    }
    if (typeof currentAsk === "string" && currentAsk.trim()) {
      body["currentAsk"] = currentAsk.trim();
    }
    if (Object.keys(body).length === 0) {
      continue;
    }

    const res = await fetch(
      `${baseUrl}/api/builder/projects/${project.projectId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      },
    );
    if (res.ok) {
      clack.log.success(`Updated ${project.title}`);
    } else {
      clack.log.error(`Couldn't update ${project.title}`);
    }
  }
}

type BuffaloWorkRecord = {
  project: {
    title: string;
    summary: string;
  };
  recentWork: string[];
  evidenceFound: string[];
  missingEvidence: string[];
  nextBestProof: string;
  suggestedWorkEntry: string;
  privacyReceipt: string[];
  sourceSignals: {
    manifests: string[];
    languages: string[];
    sourceFileCount: number;
    commitCount: number;
  };
};

type SavedWorkRecordFile = {
  ok: true;
  savedAt: string;
  record: BuffaloWorkRecord;
};

function sentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function bulletList(items: string[]): string[] {
  return items.length > 0 ? items.map((item) => `• ${item}`) : ["• None yet"];
}

function recordPrivacyReceipt(saved: boolean): string[] {
  return [
    "Read local metadata from README.md, manifests, and git history.",
    "Did not upload raw source files.",
    "Did not read .env, secrets, node_modules, or your home directory.",
    saved
      ? "Saved only local .buffalo/ files. Public profile unchanged."
      : "Saved nothing. Public profile unchanged.",
  ];
}

function evidenceFoundFor(candidate: ScanCandidate): string[] {
  const signals = candidate.localSignals;
  const found: string[] = [];
  if (signals?.readmeSummary || signals?.readmeExcerpt) {
    found.push("README.md");
  }
  for (const manifest of signals?.manifests ?? []) {
    found.push(manifest);
  }
  if (candidate.recency.commitCount > 0) {
    found.push(
      `git history: ${candidate.recency.commitCount} commit${
        candidate.recency.commitCount === 1 ? "" : "s"
      }`,
    );
  }
  if ((signals?.sourceFileCount ?? 0) > 0) {
    found.push(
      `${candidate.languages[0] ?? "source"} source files: ${signals?.sourceFileCount ?? 0}`,
    );
  }
  for (const url of candidate.evidenceUrls) {
    found.push(`evidence URL: ${url}`);
  }
  if (candidate.githubRepoUrl) {
    found.push(`GitHub repo: ${candidate.githubRepoUrl}`);
  }
  return [...new Set(found)];
}

function missingEvidenceFor(candidate: ScanCandidate): string[] {
  const missing: string[] = [];
  if (candidate.evidenceUrls.length === 0 && !candidate.githubRepoUrl) {
    missing.push(
      "No public demo, screenshot, write-up, repo URL, or evidence link attached.",
    );
  }
  if ((candidate.recentWork ?? []).length === 0) {
    missing.push("No recent git work surfaced for this record yet.");
  }
  return missing;
}

function nextBestProofFor(record: {
  missingEvidence: string[];
  projectTitle: string;
}): string {
  if (record.missingEvidence.length === 0) {
    return "Pick the strongest existing evidence link and attach it before sharing externally.";
  }
  return `Attach a screenshot, demo link, repo URL, write-up, or 30-second walkthrough for ${record.projectTitle} before sharing externally.`;
}

function suggestedWorkEntryFor(candidate: ScanCandidate): string {
  const recent = candidate.recentWork?.[0];
  if (recent) {
    return recent;
  }
  return `Built ${candidate.summary.replace(/[.!?]$/g, "")}.`;
}

function buildWorkRecord(candidate: ScanCandidate, saved = false): BuffaloWorkRecord {
  const missingEvidence = missingEvidenceFor(candidate);
  return {
    project: {
      title: candidate.title,
      summary: sentence(candidate.resumeSummary ?? candidate.summary),
    },
    recentWork: candidate.recentWork ?? [],
    evidenceFound: evidenceFoundFor(candidate),
    missingEvidence,
    nextBestProof: nextBestProofFor({
      missingEvidence,
      projectTitle: candidate.title,
    }),
    suggestedWorkEntry: suggestedWorkEntryFor(candidate),
    privacyReceipt: recordPrivacyReceipt(saved),
    sourceSignals: {
      manifests: candidate.localSignals?.manifests ?? [],
      languages: candidate.languages,
      sourceFileCount: candidate.localSignals?.sourceFileCount ?? 0,
      commitCount: candidate.recency.commitCount,
    },
  };
}

function recordNextCommands(saved: boolean): string[] {
  return saved
    ? ["buffalo export mentor-update", "buffalo export profile-draft"]
    : ["buffalo record --save", "buffalo export mentor-update"];
}

function recordToMarkdown(record: BuffaloWorkRecord): string {
  return [
    `# ${record.project.title}`,
    "",
    "Private Buffalo work record.",
    "",
    "## What it is",
    record.project.summary,
    "",
    "## Recent work",
    ...bulletList(record.recentWork),
    "",
    "## Evidence found",
    ...bulletList(record.evidenceFound),
    "",
    "## Missing evidence",
    ...bulletList(record.missingEvidence),
    "",
    "## Next best proof",
    record.nextBestProof,
    "",
    "## Suggested work entry",
    record.suggestedWorkEntry,
    "",
    "## Privacy receipt",
    ...bulletList(record.privacyReceipt),
    "",
  ].join("\n");
}

function recordToText(record: BuffaloWorkRecord, saved: boolean): string {
  return [
    "Buffalo work record preview",
    "",
    "Project",
    record.project.title,
    record.project.summary,
    "",
    "Recent work",
    ...bulletList(record.recentWork),
    "",
    "Evidence found",
    ...bulletList(record.evidenceFound),
    "",
    "Missing evidence",
    ...bulletList(record.missingEvidence),
    "",
    "Next best proof",
    record.nextBestProof,
    "",
    "Suggested private work entry",
    record.suggestedWorkEntry,
    "",
    "Privacy receipt",
    ...bulletList(record.privacyReceipt),
    "",
    saved ? "Saved local files" : "Next",
    ...recordNextCommands(saved),
  ].join("\n");
}

async function scanTopWorkRecord(options: CliOptions, saved = false): Promise<BuffaloWorkRecord> {
  const result = await scanProjects({
    cwd: process.cwd(),
    sinceDays: options.daysSet ? options.days : undefined,
  });
  const candidate = result.candidates[0];
  if (!candidate) {
    throw new Error("No project-like work detected in this folder yet.");
  }
  return buildWorkRecord(candidate, saved);
}

async function saveLocalWorkRecord(record: BuffaloWorkRecord): Promise<void> {
  const dir = cwdPath(".buffalo");
  await mkdir(dir, { recursive: true });
  const savedAt = new Date().toISOString();
  const savedFile: SavedWorkRecordFile = { ok: true, savedAt, record };
  await writeFile(join(dir, "record.md"), recordToMarkdown(record), "utf8");
  await writeFile(join(dir, "projects.json"), JSON.stringify(savedFile, null, 2), "utf8");
  const workPath = join(dir, "work.jsonl");
  const prior = (await readOptional(workPath)) ?? "";
  const event = {
    id: randomUUID(),
    createdAt: savedAt,
    source: "buffalo-record",
    projectTitle: record.project.title,
    title: record.suggestedWorkEntry,
    visibility: "private",
  };
  await writeFile(workPath, `${prior}${JSON.stringify(event)}\n`, "utf8");
}

async function readSavedWorkRecord(): Promise<BuffaloWorkRecord | null> {
  const text = await readOptional(cwdPath(".buffalo", "projects.json"));
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as Partial<SavedWorkRecordFile>;
    return parsed.record ?? null;
  } catch {
    return null;
  }
}

async function recordCommand(options: CliOptions): Promise<number> {
  const saved = options.save;
  const record = await scanTopWorkRecord(options, saved);
  if (saved) {
    await saveLocalWorkRecord(record);
  }
  if (options.json) {
    printJson({
      ok: true,
      saved,
      record,
      nextCommands: recordNextCommands(saved),
    });
    return 0;
  }
  console.log(options.markdown ? recordToMarkdown(record) : recordToText(record, saved));
  return 0;
}

function mentorUpdate(record: BuffaloWorkRecord): string {
  return [
    `Subject: Quick update on ${record.project.title}`,
    "",
    `This week I worked on ${record.project.title}: ${record.project.summary}`,
    "",
    "What changed:",
    ...bulletList(record.recentWork.length ? record.recentWork : [record.suggestedWorkEntry]),
    "",
    "What I could use feedback on:",
    `• ${record.nextBestProof}`,
    "",
    "Source signals:",
    ...bulletList(record.evidenceFound),
  ].join("\n");
}

function profileDraft(record: BuffaloWorkRecord): string {
  return [
    `# ${record.project.title}`,
    "",
    record.project.summary,
    "",
    "## Recent work",
    ...bulletList(record.recentWork),
    "",
    "## Evidence",
    ...bulletList(record.evidenceFound),
    "",
    "## Before sharing publicly",
    ...bulletList(record.missingEvidence.length ? record.missingEvidence : [record.nextBestProof]),
    "",
    "Draft only. Nothing has been published.",
  ].join("\n");
}

async function exportCommand(kind: string | undefined, options: CliOptions): Promise<number> {
  const savedRecord = await readSavedWorkRecord();
  const generated = !savedRecord;
  const record = savedRecord ?? (await scanTopWorkRecord(options));
  if (kind === "json") {
    printJson({ ok: true, generated, record });
    return 0;
  }
  if (kind === "mentor-update") {
    const text = mentorUpdate(record);
    options.json ? printJson({ ok: true, generated, type: kind, text }) : console.log(text);
    return 0;
  }
  if (kind === "profile-draft") {
    const text = profileDraft(record);
    options.json ? printJson({ ok: true, generated, type: kind, text }) : console.log(text);
    return 0;
  }
  throw new Error("Unknown export. Use `buffalo export mentor-update`, `buffalo export profile-draft`, or `buffalo export json`.");
}

async function scanCommand(options: CliOptions): Promise<number> {
  const config = await readConfig();
  const token = await readAuthToken(config);
  const baseUrl = loginBaseUrl(options, config);
  const host = baseUrl.replace(/\/+$/g, "");
  // A dry run is a local preview, so it doesn't require auth; everything that
  // touches the account (dedupe, never-list sync, creation) is token-gated.
  if (!token && !options.dryRun) {
    throw notConnectedError(baseUrl);
  }

  // Existing projects → dedupe signal (best-effort).
  let existingRepoUrls: string[] = [];
  let existingTitles: string[] = [];
  if (token) {
    try {
      const projects = await createHttpProjectReadRepository({
        baseUrl: host,
        token,
      }).list();
      existingRepoUrls = projects
        .map((p) => p.githubRepoUrl)
        .filter((u): u is string => Boolean(u));
      existingTitles = projects.map((p) => p.title);
    } catch {
      // Listing is best-effort; the scan still runs without dedupe.
    }
  }

  // Never-list = local ∪ remote.
  const ignoreKeys = [
    ...new Set([
      ...(await readLocalIgnore()),
      ...(token ? await readRemoteIgnore(host, token) : []),
    ]),
  ];

  // scanProjects is container-aware: run inside a repo it scans that one repo;
  // run in a folder of repos (a home or dev directory) it finds each real
  // project and scans it, instead of surfacing loose folders as projects.
  const result = await scanProjects({
    cwd: process.cwd(),
    sinceDays: options.daysSet ? options.days : undefined,
    existingRepoUrls,
    existingTitles,
    ignoreKeys,
  });

  if (result.candidates.length === 0) {
    options.json
      ? printJson({ ok: true, created: [], candidates: [] })
      : console.log("No new projects detected in this codebase.");
    return 0;
  }

  if (options.dryRun) {
    if (options.json) {
      printJson({ ok: true, dryRun: true, ...result });
    } else {
      console.log(`\nWould add ${result.candidates.length} project(s):`);
      for (const candidate of result.candidates) {
        console.log(`  - ${candidate.title}  [${candidateHint(candidate)}]`);
      }
    }
    return 0;
  }

  // Past the dry-run gate, everything writes — require auth.
  if (!token) {
    throw notConnectedError(baseUrl);
  }

  const interactive =
    !options.json &&
    !options.yes &&
    Boolean(process.stdin.isTTY) &&
    Boolean(process.stdout.isTTY);

  let toCreate: ScanCandidate[];
  let toNever: ScanCandidate[] = [];

  if (!interactive) {
    // Non-TTY / --yes / --json: take every non-deduped candidate.
    toCreate = result.candidates.filter((c) => !c.dedupe);
  } else {
    clack.intro("buffalo scan");
    const useSel = await clack.multiselect({
      message: "Which projects should we add? (space toggles, enter confirms)",
      options: result.candidates.map((c) => ({
        value: c.key,
        label: c.title,
        hint: candidateHint(c),
      })),
      initialValues: result.candidates
        .filter((c) => !c.dedupe)
        .map((c) => c.key),
      required: false,
    });
    if (clack.isCancel(useSel)) {
      clack.cancel("Cancelled — nothing added.");
      return 1;
    }
    const useKeys = new Set(useSel as string[]);
    toCreate = result.candidates.filter((c) => useKeys.has(c.key));

    const rest = result.candidates.filter((c) => !useKeys.has(c.key));
    if (rest.length > 0) {
      const neverSel = await clack.multiselect({
        message:
          "Mark any of the rest as NEVER? (won't reappear on future scans)",
        options: rest.map((c) => ({
          value: c.key,
          label: c.title,
          hint: candidateHint(c),
        })),
        initialValues: [],
        required: false,
      });
      if (clack.isCancel(neverSel)) {
        clack.cancel("Cancelled — nothing added.");
        return 1;
      }
      const neverKeys = new Set(neverSel as string[]);
      toNever = rest.filter((c) => neverKeys.has(c.key));
    }
  }

  // Create chosen projects (link-only).
  const created: { title: string; projectId: string; url: string }[] = [];
  for (const candidate of toCreate) {
    const project = await createHostedProject(
      host,
      token,
      candidateToProjectInput(candidate),
    );
    created.push({
      title: candidate.title,
      projectId: project.id,
      url: `${displayUrl(host)}/app/${project.id}`,
    });
  }

  // Persist never-list (local + remote).
  let remoteSynced = true;
  if (toNever.length > 0) {
    const allNever = [...ignoreKeys, ...toNever.map((c) => c.key)];
    await writeLocalIgnore(allNever);
    remoteSynced = await writeRemoteIgnore(host, token, allNever);
  }

  if (options.json) {
    printJson({
      ok: true,
      created,
      never: toNever.map((c) => c.key),
      remoteSynced,
    });
    return 0;
  }

  if (created.length === 0) {
    console.log("\nNothing added.");
  } else {
    ok(
      `added ${created.length} project(s) (link-only)`,
      created.map((c) => `${c.title} → ${c.url}`),
    );
  }

  if (interactive && created.length > 0) {
    const go = await clack.confirm({
      message: "Go into further detail on these now?",
      initialValue: false,
    });
    if (!clack.isCancel(go) && go) {
      await enrichProjects(host, token, created);
    }
    clack.outro("Done.");
  }

  return 0;
}

async function statusProject(options: CliOptions): Promise<number> {
  const projectPath = cwdPath("project.md");
  const metadataPath = statePath();
  const hasProject = await exists(projectPath);
  const hasMetadata = await exists(metadataPath);
  const markdown = hasProject ? await readFile(projectPath, "utf8") : "";
  const state = await readState();
  const config = await readConfig();
  const token = await readAuthToken(config);
  const localHash = hasProject ? hash(markdown) : null;
  const baseUrl = hostedBaseUrl(options, config);
  const remotePath = baseUrl ?? resolveRemotePath(options, state);
  const remoteSnapshot = baseUrl
    ? await createHttpProjectSyncRepository({
        baseUrl,
        projectId: stateProjectId(state),
        token,
      }).read()
    : null;
  const remoteMarkdown = baseUrl
    ? (remoteSnapshot?.markdown ?? null)
    : await readOptional(remotePath);
  const remoteHash =
    remoteSnapshot?.hash ?? (remoteMarkdown ? hash(remoteMarkdown) : null);
  const syncState = classifyProjectSyncState({
    hasProject,
    hasMetadata,
    localHash,
    remoteHash,
  });
  const result = {
    ok: hasProject,
    projectPath,
    metadataPath,
    remotePath,
    remoteKind: baseUrl ? "hosted-http" : "local-file",
    state: syncState,
    localHash,
    remoteHash,
  };

  if (options.json) {
    printJson(result);
  } else if (!hasProject) {
    console.log("No project.md found. Run buffalo init to create one.");
  } else {
    console.log(`project.md: ${result.state}`);
  }

  return hasProject ? 0 : 1;
}

async function listFiles(root: string, maxDepth = 3): Promise<string[]> {
  const output: string[] = [];

  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return;
    }

    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === ".buffalo"
      ) {
        continue;
      }

      const fullPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        await visit(fullPath, depth + 1);
      } else {
        output.push(fullPath);
      }
    }
  }

  await visit(root, 0);
  return output;
}

interface CaptureProposal {
  id: string;
  kind: "milestone" | "evidence";
  title: string;
  source: string;
  confidence: number;
  reason?: string;
}

function acceptedProposalIds(
  value: string | undefined,
  proposals: CaptureProposal[],
): Set<string> {
  if (!value) {
    return new Set();
  }

  if (value.trim().toLowerCase() === "all") {
    return new Set(proposals.map((proposal) => proposal.id));
  }

  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

async function applyCaptureProposals(
  proposals: CaptureProposal[],
  accept: string | undefined,
): Promise<{
  applied: CaptureProposal[];
  filePath?: string;
}> {
  const accepted = acceptedProposalIds(accept, proposals);

  if (!accepted.size) {
    return { applied: [] };
  }

  const { inputPath, markdown } = await readProjectMarkdown();
  let nextMarkdown = markdown;
  const applied: CaptureProposal[] = [];

  for (const proposal of proposals) {
    if (!accepted.has(proposal.id)) {
      continue;
    }

    if (proposal.kind === "milestone") {
      nextMarkdown = appendMilestoneMarkdown(nextMarkdown, {
        title: proposal.title,
        note: `Source: ${proposal.source}`,
        date: localDateString(),
      });
    } else {
      nextMarkdown = appendEvidenceMarkdown(nextMarkdown, {
        source: proposal.source,
        caption:
          proposal.title === proposal.source ||
          proposal.title === basename(proposal.source)
            ? undefined
            : proposal.title,
      });
    }

    applied.push(proposal);
  }

  if (applied.length) {
    await writeFile(inputPath, nextMarkdown, "utf8");
    await updateLocalHash(nextMarkdown);
  }

  return {
    applied,
    filePath: inputPath,
  };
}

async function captureProject(options: CliOptions): Promise<number> {
  const root = process.cwd();
  const requestedDays = options.days ?? 7;
  const days =
    Number.isFinite(requestedDays) && requestedDays > 0 ? requestedDays : 7;
  const proposals: CaptureProposal[] = [];

  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "log",
        `--since=${days} days ago`,
        "--pretty=format:%h %s",
        "--max-count=8",
      ],
      { cwd: root },
    );

    for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
      proposals.push({
        id: `git-${proposals.filter((proposal) => proposal.kind === "milestone").length + 1}`,
        kind: "milestone",
        title: line,
        source: "git log",
        confidence: 0.78,
      });
    }
  } catch {
    // Git history is optional; capture remains useful in plain folders.
  }

  try {
    const { stdout } = await execFileAsync("git", ["status", "--short"], {
      cwd: root,
    });

    for (const line of stdout.split(/\r?\n/).filter(Boolean).slice(0, 12)) {
      const filePath = line.slice(3).trim();

      if (!filePath || filePath.startsWith(".buffalo/")) {
        continue;
      }

      proposals.push({
        id: `modified-${proposals.filter((proposal) => proposal.id.startsWith("modified-")).length + 1}`,
        kind: "evidence",
        title: `Recently changed file: ${filePath}`,
        source: filePath,
        confidence: 0.55,
        reason: "The file has local changes that may document recent work.",
      });
    }
  } catch {
    // Plain folders can still be scanned without git status.
  }

  const files = await listFiles(root);
  const interestingFiles = files.filter((filePath) => {
    const name = basename(filePath).toLowerCase();

    return (
      name === "readme.md" ||
      /\.(png|jpg|jpeg|webp|gif|pdf|mov|mp4)$/i.test(name) ||
      name.includes("demo") ||
      name.includes("screenshot")
    );
  });

  for (const filePath of interestingFiles.slice(0, 12)) {
    proposals.push({
      id: `file-${proposals.filter((proposal) => proposal.kind === "evidence").length + 1}`,
      kind: "evidence",
      title: basename(filePath),
      source: relative(root, filePath),
      confidence: /\.(png|jpg|jpeg|webp|gif|pdf)$/i.test(filePath)
        ? 0.82
        : 0.58,
      reason: "The file looks inspectable as project evidence.",
    });
  }

  const textFiles = files.filter((filePath) =>
    /\.(md|mdx|txt|csv|json|ts|tsx|js|jsx|py|ipynb)$/i.test(filePath),
  );
  const metricPattern =
    /\b(\d+(?:\.\d+)?\s?(?:%|percent|users?|students?|customers?|signups?|downloads?|views?|clicks?|hours?|days?|ms|seconds?|minutes?|dollars?|\$|x)\b)/gi;

  for (const filePath of textFiles.slice(0, 30)) {
    try {
      const text = await readFile(filePath, "utf8");
      const matches = [...text.matchAll(metricPattern)]
        .map((match) => match[0])
        .slice(0, 3);

      if (!matches.length) {
        continue;
      }

      proposals.push({
        id: `metric-${proposals.filter((proposal) => proposal.id.startsWith("metric-")).length + 1}`,
        kind: "evidence",
        title: `Metric mention: ${matches.join(", ")}`,
        source: relative(root, filePath),
        confidence: 0.64,
        reason:
          "The file mentions measurable outcomes that may strengthen the project page.",
      });
    } catch {
      // Ignore files that cannot be read as text.
    }
  }

  const application = await applyCaptureProposals(proposals, options.accept);
  const unknownAccepted = [
    ...acceptedProposalIds(options.accept, proposals),
  ].filter((id) => !proposals.some((proposal) => proposal.id === id));
  const result = {
    ok: true,
    days,
    proposals,
    applied: application.applied,
    rejected: proposals.filter(
      (proposal) =>
        options.accept &&
        !application.applied.some((item) => item.id === proposal.id),
    ),
    unknownAccepted,
    changed: application.applied.length > 0,
    filePath: application.filePath,
    message: application.applied.length
      ? "Applied selected capture proposals."
      : "Capture only proposes additions; pass --accept with proposal IDs to edit project.md.",
  };

  if (options.json) {
    printJson(result);
  } else {
    console.log(result.message);
    for (const proposal of proposals) {
      console.log(`- ${proposal.kind}: ${proposal.title} (${proposal.source})`);
    }
    if (application.applied.length) {
      console.log(`Applied ${application.applied.length} proposal(s).`);
    }
  }

  return unknownAccepted.length ? 1 : 0;
}

async function examplesCommand(
  type: string | undefined,
  options: CliOptions,
): Promise<number> {
  const templateType = type as ProjectTemplateType | undefined;

  if (!templateType || !projectTemplateTypes.includes(templateType)) {
    const result = {
      ok: false,
      error: `Choose one example type: ${projectTemplateTypes.join(", ")}`,
    };

    options.json ? printJson(result) : console.error(result.error);
    return 1;
  }

  const examples = examplesForTemplate(templateType);
  const examplesDir = cwdPath(".buffalo", "examples");

  await mkdir(examplesDir, { recursive: true });

  for (const example of examples) {
    await writeFile(
      join(examplesDir, `${example.id}.project.md`),
      example.markdown,
      "utf8",
    );
  }

  const result = {
    ok: true,
    changed: examples.length > 0,
    type: templateType,
    directory: examplesDir,
    examples: examples.map((example) => ({
      id: example.id,
      title: example.title,
      summary: example.summary,
      path: join(examplesDir, `${example.id}.project.md`),
    })),
  };

  if (options.json) {
    printJson(result);
  } else {
    console.log(`Wrote ${examples.length} example(s) to ${examplesDir}`);
    for (const example of result.examples) {
      console.log(`- ${example.id}: ${example.title}`);
    }
  }

  return 0;
}

function simpleLineDiff(
  local: string,
  remote: string,
): Array<{
  type: "same" | "local" | "remote";
  line: string;
}> {
  const localLines = local.split(/\r?\n/);
  const remoteLines = remote.split(/\r?\n/);
  const rows: Array<{ type: "same" | "local" | "remote"; line: string }> = [];
  const max = Math.max(localLines.length, remoteLines.length);

  for (let index = 0; index < max; index += 1) {
    const localLine = localLines[index];
    const remoteLine = remoteLines[index];

    if (localLine === remoteLine) {
      rows.push({ type: "same", line: localLine ?? "" });
    } else {
      if (remoteLine !== undefined) {
        rows.push({ type: "remote", line: remoteLine });
      }
      if (localLine !== undefined) {
        rows.push({ type: "local", line: localLine });
      }
    }
  }

  return rows;
}

async function diffProject(options: CliOptions): Promise<number> {
  const { inputPath, markdown } = await readProjectMarkdown();
  const state = await readState();
  const config = await readConfig();
  const token = await readAuthToken(config);
  const baseUrl = hostedBaseUrl(options, config);
  const remotePath = baseUrl ?? resolveRemotePath(options, state);
  const remoteSnapshot = baseUrl
    ? await createHttpProjectSyncRepository({
        baseUrl,
        projectId: stateProjectId(state),
        token,
      }).read()
    : null;
  const remoteMarkdown = baseUrl
    ? (remoteSnapshot?.markdown ?? null)
    : await readOptional(remotePath);

  if (!remoteMarkdown) {
    const result = {
      ok: false,
      filePath: inputPath,
      remotePath,
      error: "No remote mirror exists yet. Run buffalo push to create one.",
    };

    options.json ? printJson(result) : console.error(result.error);
    return 1;
  }

  const diff = simpleLineDiff(markdown, remoteMarkdown).filter(
    (row) => row.type !== "same",
  );
  const result = {
    ok: true,
    filePath: inputPath,
    remotePath,
    changed: diff.length > 0,
    diff,
  };

  if (options.json) {
    printJson(result);
  } else if (!diff.length) {
    console.log("Local project.md matches the remote mirror.");
  } else {
    for (const row of diff) {
      console.log(`${row.type === "local" ? "+" : "-"} ${row.line}`);
    }
  }

  return diff.length ? 1 : 0;
}

async function pushProject(options: CliOptions): Promise<number> {
  const { inputPath, markdown } = await readProjectMarkdown();
  const state = await readState();
  const config = await readConfig();
  const token = await readAuthToken(config);
  const baseUrl = hostedBaseUrl(options, config);
  const remotePath = baseUrl ?? resolveRemotePath(options, state);
  const repository = baseUrl
    ? createHttpProjectSyncRepository({
        baseUrl,
        projectId: stateProjectId(state),
        token,
      })
    : null;
  const remoteSnapshot = repository ? await repository.read() : null;
  const remoteMarkdown = repository
    ? (remoteSnapshot?.markdown ?? null)
    : await readOptional(remotePath);
  const remoteHash =
    remoteSnapshot?.hash ?? (remoteMarkdown ? hash(remoteMarkdown) : null);

  const decision = decideProjectPush({
    remoteHash,
    lastPulledHash: state?.lastPulledHash,
    force: options.force,
  });

  if (!decision.ok) {
    const result = {
      ok: false,
      filePath: inputPath,
      remotePath,
      error: decision.error,
    };

    options.json ? printJson(result) : console.error(result.error);
    return 1;
  }

  const localHash = hash(markdown);
  const pushed = repository
    ? await repository.write(markdown, {
        force: options.force,
        lastPulledHash: state?.lastPulledHash,
      })
    : null;

  if (!repository) {
    await mkdir(dirname(remotePath), { recursive: true });
    await writeFile(remotePath, markdown, "utf8");
  }

  const syncedHash = pushed?.hash ?? localHash;
  await writeState({
    projectId: state?.projectId ?? randomUUID(),
    syncState: "synced",
    lastPushedHash: syncedHash,
    lastPulledHash: syncedHash,
    localHash,
    remotePath,
    remoteHash: syncedHash,
  });

  const result = {
    ok: true,
    changed: true,
    filePath: inputPath,
    remotePath,
    remoteKind: repository ? "hosted-http" : "local-file",
    publicUrl:
      pushed?.url ?? (repository ? remotePath : `file://${remotePath}`),
  };

  if (options.json) {
    printJson(result);
  } else if (repository && pushed?.url) {
    ok("pushed to your work page", [`→ live at ${displayUrl(pushed.url)}`]);
  } else {
    ok("pushed", [remotePath]);
  }
  return 0;
}

async function pullProject(options: CliOptions): Promise<number> {
  const projectPath = cwdPath("project.md");
  const localMarkdown = await readOptional(projectPath);
  const state = await readState();
  const config = await readConfig();
  const token = await readAuthToken(config);
  const baseUrl = hostedBaseUrl(options, config);
  const remotePath = baseUrl ?? resolveRemotePath(options, state);
  const repository = baseUrl
    ? createHttpProjectSyncRepository({
        baseUrl,
        projectId: stateProjectId(state),
        token,
      })
    : null;
  const remoteSnapshot = repository ? await repository.read() : null;
  const remoteMarkdown = repository
    ? (remoteSnapshot?.markdown ?? null)
    : await readOptional(remotePath);

  if (!remoteMarkdown) {
    const result = {
      ok: false,
      projectPath,
      remotePath,
      error: "No remote mirror exists to pull.",
    };

    options.json ? printJson(result) : console.error(result.error);
    return 1;
  }

  const decision = decideProjectPull({
    localHash: localMarkdown ? hash(localMarkdown) : null,
    recordedLocalHash: state?.localHash,
    hasLocalProject: Boolean(localMarkdown),
    force: options.force,
  });

  if (!decision.ok) {
    const result = {
      ok: false,
      projectPath,
      remotePath,
      error: decision.error,
    };

    options.json ? printJson(result) : console.error(result.error);
    return 1;
  }

  await writeFile(projectPath, remoteMarkdown, "utf8");

  const remoteHash = remoteSnapshot?.hash ?? hash(remoteMarkdown);
  await writeState({
    projectId: state?.projectId ?? randomUUID(),
    syncState: "synced",
    lastPushedHash: state?.lastPushedHash ?? null,
    lastPulledHash: remoteHash,
    localHash: remoteHash,
    remotePath,
    remoteHash,
  });

  const result = {
    ok: true,
    changed: true,
    projectPath,
    remotePath,
    remoteKind: repository ? "hosted-http" : "local-file",
  };

  options.json ? printJson(result) : console.log(`Pulled from ${remotePath}`);
  return 0;
}

async function previewProject(options: CliOptions): Promise<number> {
  const { inputPath, markdown } = await readProjectMarkdown();
  const project = projectSchema.parse(projectFromMarkdown(markdown));
  const previewPath = cwdPath(".buffalo", "preview.html");
  const { renderProjectPreviewHtml } = await import("@buffalo/ui");
  const html = renderProjectPreviewHtml({ project, markdown });

  await mkdir(dirname(previewPath), { recursive: true });
  await writeFile(previewPath, html, "utf8");

  const result = {
    ok: true,
    filePath: inputPath,
    previewPath,
    url: `file://${previewPath}`,
  };

  if (options.json) {
    printJson(result);
  } else {
    try {
      await execFileAsync("open", [previewPath]);
    } catch {
      // Opening a browser is a convenience; the preview file is still the durable output.
    }
    ok("preview ready", [previewPath]);
  }
  return 0;
}

async function ciProject(options: CliOptions): Promise<number> {
  const lintExit = await lintProject("project.md", options);

  if (lintExit !== 0) {
    return lintExit;
  }

  if (options.push) {
    return await pushProject(options);
  }

  return 0;
}

// ── buffalo targets ──────────────────────────────────────────────────────
//
// Surface the Buffalo events/grants/programs a builder's record routes them
// toward — read-only. Authed: the hosted matcher derives context from the
// builder's own record. Zero-record path: pass --tags / --event to match
// without a token (the same query params the hosted endpoint accepts).
//
// The "qualify"/gap shown is the TARGET's OWN stated bar, quoted from the
// corpus — never a judgment of the builder's work. Targets whose status reads
// as over are labelled past, never surfaced as open.

interface HostedTarget {
  name: string;
  host: string;
  when: string;
  status: string;
  temporal: "upcoming" | "past" | "rolling" | "unknown";
  sourceUrl: string;
  id: string;
}

interface HostedTargetMatch {
  target: HostedTarget;
  qualifies: boolean;
  gap: string | null;
}

function targetWhenLabel(target: HostedTarget): string {
  // Surface the verbatim cadence/deadline, and flag an over-status as past so
  // a closed round is never read as actionable.
  return target.temporal === "past"
    ? `${target.when} (past — ${target.status})`
    : target.when;
}

async function targetsCommand(options: CliOptions): Promise<number> {
  const config = await readConfig();
  const token = await readAuthToken(config);
  const baseUrl = loginBaseUrl(options, config);
  const host = baseUrl.replace(/\/+$/g, "");

  const tags = options.tags
    ?.split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const hasZeroRecordInput = Boolean((tags && tags.length > 0) || options.event);

  // Authed reads the builder's own record; the zero-record path (--tags /
  // --event) works without a token. With neither, fall back to the standard
  // not-connected guidance.
  if (!token && !hasZeroRecordInput) {
    throw notConnectedError(baseUrl);
  }

  const query = new URLSearchParams();
  if (!token) {
    if (options.event) {
      query.set("eventId", options.event);
    }
    if (tags && tags.length > 0) {
      query.set("tags", tags.join(","));
    }
  }
  const qs = query.toString();
  const requestUrl = `${host}/api/targets${qs ? `?${qs}` : ""}`;

  const response = await fetch(requestUrl, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw hostedActionError(
      response,
      "match your targets",
      baseUrl,
      detail || undefined,
    );
  }

  const data = (await response.json()) as { matches?: HostedTargetMatch[] };
  const matches = data.matches ?? [];

  if (options.json) {
    printJson({ ok: true, aimedTargetId: config.aimedTargetId, matches });
    return 0;
  }

  if (matches.length === 0) {
    ok("no matching Buffalo targets yet", [
      hasZeroRecordInput
        ? "try different --tags, or connect with buffalo login to match from your record"
        : "log more work so your record can route you: buffalo log \"what you shipped\"",
    ]);
    return 0;
  }

  ok(`${matches.length} Buffalo target(s) for you`);
  for (const match of matches) {
    const t = match.target;
    const status = match.qualifies
      ? "qualify"
      : match.gap
        ? `gap: ${match.gap}`
        : "see eligibility";
    console.log(`    ${t.name} — ${t.host}`);
    console.log(`      when: ${targetWhenLabel(t)}`);
    console.log(`      ${status}`);
  }
  return 0;
}

// ── buffalo aim ──────────────────────────────────────────────────────────
//
// Record which target the builder is building toward, kept in local CLI
// config (mirrors token / syncBaseUrl). Light by design — hosted persistence
// of aims is a future step.

async function aimCommand(
  targetId: string | undefined,
  options: CliOptions,
): Promise<number> {
  const trimmed = targetId?.trim();
  if (!trimmed) {
    printUsageError(
      options,
      "Missing target id. Try: buffalo aim <targetId> (see `buffalo targets`).",
    );
    return 1;
  }

  const config = await readConfig();
  await writeConfig({ ...config, aimedTargetId: trimmed });

  const result = {
    ok: true,
    changed: true,
    aimedTargetId: trimmed,
    path: configPath(),
  };

  if (options.json) {
    printJson(result);
  } else {
    ok(`aiming at ${trimmed}`, [
      "stored locally — see your matches with buffalo targets",
    ]);
  }
  return 0;
}

export async function run(argv = process.argv.slice(2)): Promise<number> {
  const options = parseOptions(argv);
  const args = positional(argv);
  const [command, subcommand, ...rest] = args;

  if (!command || command === "help" || command === "-h") {
    console.log(usage());
    return 0;
  }

  try {
    if (command === "init") {
      return await initProject(options);
    }

    if (command === "new") {
      return await newFromExample(options);
    }

    if (command === "login") {
      return await loginCommand(options);
    }

    if (command === "auth" || command === "whoami") {
      return await authCommand(options);
    }

    if (command === "config") {
      return await configCommand(
        [subcommand, ...rest].filter((value): value is string =>
          Boolean(value),
        ),
        options,
      );
    }

    if (command === "lint") {
      return await lintProject(subcommand, options);
    }

    if (command === "status") {
      return await statusProject(options);
    }

    if (command === "capture") {
      return await captureProject(options);
    }

    if (command === "examples") {
      return await examplesCommand(subcommand, options);
    }

    if (command === "diff") {
      return await diffProject(options);
    }

    if (command === "preview") {
      return await previewProject(options);
    }

    if (command === "push") {
      return await pushProject(options);
    }

    if (command === "pull") {
      return await pullProject(options);
    }

    if (command === "ci") {
      return await ciProject(options);
    }

    if (command === "add" && subcommand === "evidence") {
      return await addEvidence(rest[0], options);
    }

    if (command === "add" && subcommand === "milestone") {
      return await addMilestone(rest.join(" "), options);
    }

    if (command === "log") {
      return await logWork([subcommand, ...rest].join(" "), options);
    }

    if (command === "record") {
      return await recordCommand(options);
    }

    if (command === "export") {
      return await exportCommand(subcommand, options);
    }

    if (command === "scan") {
      return await scanCommand(options);
    }

    if (command === "targets") {
      return await targetsCommand(options);
    }

    if (command === "aim") {
      return await aimCommand(subcommand, options);
    }

    printUsageError(options);
    return 1;
  } catch (error) {
    // A typed CLI error already carries a human next action — emit it as clean
    // structured JSON (never a raw, double-encoded API body) or a two-line
    // message in text mode.
    if (error instanceof CliActionError) {
      if (options.json) {
        printJson({
          ok: false,
          error: error.message,
          ...(error.next ? { next: error.next } : {}),
          ...(error.status ? { status: error.status } : {}),
          ...(error.baseUrl ? { baseUrl: error.baseUrl } : {}),
        });
      } else {
        console.error(error.message);
        if (error.next) {
          console.error(error.next);
        }
      }
      return 1;
    }

    const message = error instanceof Error ? error.message : "Unknown error";

    if (options.json) {
      printJson({ ok: false, error: message });
    } else {
      console.error(message);
    }

    return 1;
  }
}

// Run when invoked as a bin. A raw `import.meta.url === file://argv[1]` check
// breaks under a global/npx symlink (argv[1] is the symlink, import.meta.url is
// the resolved target), so compare real paths.
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
  process.exitCode = await run();
}
