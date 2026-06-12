/**
 * Codebase scan engine — shared by the Buffalo CLI and MCP server.
 *
 * Detects the *distinct efforts* in a codebase (a monorepo app, a standalone
 * tool, a significant subproject) and returns them as candidate projects the
 * builder can choose to add. It is deterministic (filesystem + git only, no
 * LLM) and — importantly — it does NOT judge the quality of the work. It
 * answers the factual question "is this a distinct, real project?", ranks by
 * neutral activity signals (recency, commit volume) for ordering only, and
 * leaves the decision of what is worth showing to the builder.
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Public types ───────────────────────────────────────────────────────

export type ScanGroupingKind =
  | "workspace-package"
  | "top-level-dir"
  | "language-cluster"
  | "repo-root";

export interface ScanCandidate {
  /** Stable id for the never-list; survives folder renames where possible. */
  key: string;
  title: string;
  summary: string;
  /** Human-readable resume-style summary synthesized from safe project metadata. */
  resumeSummary?: string;
  /** Resume-style bullets synthesized from manifests, README metadata, and git/file signals. */
  resumeBullets?: string[];
  /**
   * Recent, meaningful commit subjects scoped to this candidate. The richest
   * *accomplishment* signal (what actually shipped), surfaced for synthesis.
   * Noise (merges, version bumps, formatting) is filtered; not a quality score.
   */
  recentWork?: string[];
  /** Bounded local signals used for synthesis. No raw source file contents. */
  localSignals?: {
    manifests: string[];
    scripts: string[];
    sourceFileCount: number;
    readmeSummary?: string;
    /** A longer (bounded) README excerpt — fuel for co-pilot synthesis. */
    readmeExcerpt?: string;
  };
  groupingKind: ScanGroupingKind;
  /** Repo-relative paths grouped under this candidate. */
  sourcePaths: string[];
  evidenceUrls: string[];
  githubRepoUrl?: string;
  skills: string[];
  languages: string[];
  recency: { lastCommitAt: string | null; commitCount: number };
  /** Sort signal only (recency + activity + completeness). NOT a quality score. */
  activity: number;
  /** Set when the candidate likely already exists on the builder's account. */
  dedupe?: { matchedExisting: true; reason: "repo-url" | "title" };
}

export interface ScanSkip {
  reason: string;
  count: number;
}

export interface ScanResult {
  cwd: string;
  isGitRepo: boolean;
  scannedAt: string;
  candidates: ScanCandidate[];
  skipped: ScanSkip[];
}

export interface ScanOptions {
  cwd: string;
  now?: Date;
  maxCandidates?: number;
  sinceDays?: number;
  /** Never-list keys to drop before capping. */
  ignoreKeys?: string[];
  /** Existing project repo URLs / titles, for dedupe flagging (not removal). */
  existingRepoUrls?: string[];
  existingTitles?: string[];
}

/** Shape accepted by POST /api/builder/projects (link-only by default). */
export interface NewProjectBody {
  title: string;
  description: string;
  privacy: "link";
  primarySkills: string[];
  githubRepoUrl?: string;
  evidenceBindings: { customUrls: string[] };
}

// ── Heuristic tables ───────────────────────────────────────────────────

const EXCLUDED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  "coverage",
  ".cache",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  "target",
]);

// Never read the contents of, or surface, anything matching these.
const SECRET_PATTERNS = [
  /^\.env/i,
  /\.pem$/i,
  /\.key$/i,
  /^id_rsa/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.keystore$/i,
];

const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".py": "Python",
  ".rb": "Ruby",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".swift": "Swift",
  ".c": "C",
  ".h": "C",
  ".cpp": "C++",
  ".cc": "C++",
  ".cs": "C#",
  ".php": "PHP",
  ".scala": "Scala",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".sol": "Solidity",
  ".sh": "Shell",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".dart": "Dart",
  ".sql": "SQL",
};

const MANIFESTS = [
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "composer.json",
];

// Files that mark a directory as a *real project root* (vs. an arbitrary
// folder of files). Discovery keys off these, not source-file counts, so a
// home folder with stray scripts never reads as a project — only directories a
// human deliberately set up as a project do.
const PROJECT_MARKERS = [".git", ...MANIFESTS, "README.md"];

// Folders that never hold a publishable project and can be huge; descent skips
// them outright. Hidden dirs (".ssh", ".config", …) are already skipped by the
// leading-dot rule, so this only needs the non-hidden system/home folders.
const DISCOVERY_SKIP_DIRS = new Set([
  ...EXCLUDED_DIRS,
  "Library",
  "Applications",
  "Mail",
  "Music",
  "Movies",
  "Pictures",
  "Public",
]);

const SCRIPT_LABELS: Record<string, string> = {
  dev: "local development workflow",
  build: "production build workflow",
  test: "test workflow",
  lint: "linting workflow",
  typecheck: "type safety workflow",
  start: "runtime start command",
  deploy: "deployment workflow",
};

// package.json dependency → skill label.
const DEP_SKILLS: Record<string, string> = {
  react: "React",
  next: "Next.js",
  vue: "Vue",
  svelte: "Svelte",
  "@angular/core": "Angular",
  express: "Express",
  fastify: "Fastify",
  "@nestjs/core": "NestJS",
  tailwindcss: "Tailwind CSS",
  prisma: "Prisma",
  "firebase-admin": "Firebase",
  firebase: "Firebase",
  three: "Three.js",
  "framer-motion": "Framer Motion",
  zod: "Zod",
  vitest: "Vitest",
  jest: "Jest",
  playwright: "Playwright",
  electron: "Electron",
  "react-native": "React Native",
  graphql: "GraphQL",
};

// ── Small fs/git helpers ───────────────────────────────────────────────

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  const text = await readOptional(path);
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isSecret(name: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(name));
}

function extname(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

const URL_RE = /\bhttps?:\/\/[^\s<>()"']+/gi;

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** Walk a tree collecting repo-relative file paths, skipping junk + secrets. */
async function walk(root: string, maxFiles = 6000): Promise<string[]> {
  const out: string[] = [];

  async function visit(dir: string, depth: number): Promise<void> {
    if (out.length >= maxFiles || depth > 6) {
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) {
        return;
      }
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith(".")) {
          continue;
        }
        await visit(join(dir, entry.name), depth + 1);
      } else if (!isSecret(entry.name)) {
        out.push(relative(root, join(dir, entry.name)));
      }
    }
  }

  await visit(root, 0);
  return out;
}

function normalizeGitHubUrl(
  raw: string | undefined | null,
): string | undefined {
  if (!raw) {
    return undefined;
  }
  const value = raw.trim().replace(/^git\+/, "");
  const ssh = /^git@github\.com:(.+?)(?:\.git)?$/.exec(value);
  if (ssh?.[1]) {
    return `https://github.com/${ssh[1]}`;
  }
  const https = /^https?:\/\/github\.com\/(.+?)(?:\.git)?$/.exec(value);
  if (https?.[1]) {
    return `https://github.com/${https[1]}`;
  }
  return undefined;
}

interface GitCommit {
  date: string;
  subject: string;
  files: string[];
}

interface GitData {
  isRepo: boolean;
  remoteUrl?: string;
  commits: GitCommit[];
}

async function readGit(root: string, sinceDays: number): Promise<GitData> {
  let isRepo = false;
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: root,
    });
    isRepo = true;
  } catch {
    return { isRepo: false, commits: [] };
  }

  let remoteUrl: string | undefined;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["remote", "get-url", "origin"],
      {
        cwd: root,
      },
    );
    remoteUrl = stdout.trim() || undefined;
  } catch {
    // No origin remote is fine.
  }

  const commits: GitCommit[] = [];
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "log",
        `--since=${sinceDays} days ago`,
        "--name-only",
        "--pretty=format:\u0001%cI\u001f%s",
      ],
      { cwd: root, maxBuffer: 20 * 1024 * 1024 },
    );
    let current: GitCommit | null = null;
    for (const line of stdout.split(/\r?\n/)) {
      if (line.startsWith("\u0001")) {
        const rest = line.slice(1);
        const sep = rest.indexOf("\u001f");
        const date = sep === -1 ? rest : rest.slice(0, sep);
        const subject = sep === -1 ? "" : rest.slice(sep + 1);
        current = { date, subject, files: [] };
        commits.push(current);
      } else if (line.trim() && current) {
        current.files.push(line.trim());
      }
    }
  } catch {
    // Shallow clones / empty history are fine.
  }

  return { isRepo, remoteUrl, commits };
}

function recencyFor(
  git: GitData,
  relDir: string,
): {
  lastCommitAt: string | null;
  commitCount: number;
} {
  const prefix = relDir === "." ? "" : `${relDir}/`;
  let count = 0;
  let last: string | null = null;
  for (const commit of git.commits) {
    const touches =
      prefix === "" || commit.files.some((f) => f.startsWith(prefix));
    if (!touches) {
      continue;
    }
    count += 1;
    if (!last || commit.date > last) {
      last = commit.date;
    }
  }
  return { lastCommitAt: last, commitCount: count };
}

// Commit subjects that are housekeeping, not accomplishment signal.
const TRIVIAL_COMMIT_RE =
  /^(merge\b|revert\b|wip\b|fixup!|squash!|bump\b|release\b|v?\d+\.\d+\.\d+\b|chore\b|chore\(deps\)|deps\b|format(ting)?\b|lint\b|prettier\b|typo\b|cleanup\b|whitespace\b|gitignore\b|initial commit\b)/i;

/**
 * Recent, meaningful commit subjects scoped to a dir — the accomplishment
 * signal (what shipped), most-recent first, deduped, with housekeeping filtered.
 * Deterministic: this surfaces real subjects, it does not judge or rewrite them.
 */
function recentWorkFor(git: GitData, relDir: string, limit = 6): string[] {
  const prefix = relDir === "." ? "" : `${relDir}/`;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const commit of git.commits) {
    const touches =
      prefix === "" || commit.files.some((f) => f.startsWith(prefix));
    if (!touches) {
      continue;
    }
    const subject = commit.subject?.trim();
    if (!subject || subject.length < 10 || TRIVIAL_COMMIT_RE.test(subject)) {
      continue;
    }
    const norm = subject.toLowerCase();
    if (seen.has(norm)) {
      continue;
    }
    seen.add(norm);
    out.push(subject.length > 120 ? `${subject.slice(0, 117)}...` : subject);
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

// ── Inference helpers ──────────────────────────────────────────────────

function humanize(name: string): string {
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Clean a README H1 into a usable project title, or `undefined` when it is not
 * a title at all. Strips inline markdown (links, images, emphasis, code) and
 * rejects a heading that is really a sentence — a long first heading is a
 * tagline/summary, not a name, and would read badly as a project title.
 */
function usableReadmeTitle(raw: string): string | undefined {
  const value = raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → their text
    .replace(/[`*_~]/g, "") // inline code / emphasis
    .replace(/\s+/g, " ")
    .trim();
  if (!value || value.length > 80) {
    return undefined;
  }
  return value.slice(0, 200);
}

function stripScope(name: string): string {
  return name.replace(/^@[^/]+\//, "");
}

function firstPathSegment(path: string): string {
  return path.split(/[\\/]/)[0] ?? path;
}

function topLanguages(relFiles: string[]): string[] {
  const counts = new Map<string, number>();
  for (const file of relFiles) {
    const lang = LANGUAGE_BY_EXT[extname(file)];
    if (lang) {
      counts.set(lang, (counts.get(lang) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);
}

function depSkills(pkg: Record<string, unknown> | null): string[] {
  if (!pkg) {
    return [];
  }
  const deps = {
    ...(pkg["dependencies"] as Record<string, string> | undefined),
    ...(pkg["devDependencies"] as Record<string, string> | undefined),
  };
  const skills: string[] = [];
  for (const dep of Object.keys(deps)) {
    const skill = DEP_SKILLS[dep];
    if (skill && !skills.includes(skill)) {
      skills.push(skill);
    }
  }
  return skills;
}

function scriptSignals(pkg: Record<string, unknown> | null): string[] {
  const scripts = pkg?.["scripts"];
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    return [];
  }
  return Object.keys(scripts as Record<string, unknown>)
    .filter((name) => SCRIPT_LABELS[name])
    .slice(0, 8);
}

function meaningfulSummary(value: string | undefined): boolean {
  if (!value?.trim()) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length >= 24 &&
    !/^typescript project\.?$/.test(normalized) &&
    !/^javascript project\.?$/.test(normalized) &&
    !/^project from the codebase\.?$/.test(normalized)
  );
}

function joinHuman(items: string[]): string {
  if (items.length <= 1) {
    return items[0] ?? "";
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function projectKind(skills: string[], languages: string[]): string {
  if (skills.includes("Next.js")) {
    return "full-stack web application";
  }
  if (skills.includes("React")) {
    return "frontend application";
  }
  if (skills.includes("Express") || skills.includes("Fastify")) {
    return "backend service";
  }
  if (skills.includes("Playwright") || skills.includes("Vitest")) {
    return "developer tooling project";
  }
  if (languages.includes("Python")) {
    return "Python project";
  }
  if (languages.includes("Swift")) {
    return "Swift application";
  }
  return "software project";
}

function synthesizeResumeSummary(input: {
  title: string;
  baseSummary: string;
  skills: string[];
  languages: string[];
  recency: { lastCommitAt: string | null; commitCount: number };
  sourceFileCount: number;
}): string {
  if (meaningfulSummary(input.baseSummary)) {
    return input.baseSummary.trim().replace(/\s+/g, " ").slice(0, 500);
  }
  const stack = input.skills.length
    ? ` built with ${joinHuman(input.skills.slice(0, 5))}`
    : input.languages.length
      ? ` built in ${joinHuman(input.languages.slice(0, 3))}`
      : "";
  const activity =
    input.recency.commitCount > 0
      ? ` with ${input.recency.commitCount} recent commit${
          input.recency.commitCount === 1 ? "" : "s"
        }`
      : "";
  const size =
    input.sourceFileCount > 0
      ? ` across ${input.sourceFileCount} source file${
          input.sourceFileCount === 1 ? "" : "s"
        }`
      : "";
  return `${input.title} is a ${projectKind(input.skills, input.languages)}${stack}${activity}${size}.`;
}

function synthesizeResumeBullets(input: {
  groupingKind: ScanGroupingKind;
  skills: string[];
  languages: string[];
  recentWork: string[];
  recency: { lastCommitAt: string | null; commitCount: number };
  sourceFileCount: number;
  hasReadme: boolean;
  hasEvidence: boolean;
}): string[] {
  const bullets: string[] = [];
  // Lead with what actually shipped — the accomplishment, not the mechanics.
  // (Generated co-pilot synthesis turns these raw subjects into polished lines;
  // these deterministic bullets are the honest fallback.)
  if (input.recentWork.length > 0) {
    bullets.push(`Recent work: ${input.recentWork.slice(0, 3).join("; ")}.`);
  }
  if (input.skills.length > 0) {
    bullets.push(`Built with ${joinHuman(input.skills.slice(0, 6))}.`);
  } else if (input.languages.length > 0) {
    bullets.push(
      `Implemented primarily in ${joinHuman(input.languages.slice(0, 3))}.`,
    );
  }
  if (input.recentWork.length === 0 && input.recency.commitCount > 0) {
    bullets.push(
      `Shows active development with ${input.recency.commitCount} recent commit${
        input.recency.commitCount === 1 ? "" : "s"
      }.`,
    );
  }
  if (input.hasReadme || input.hasEvidence) {
    bullets.push(
      `Has inspectable project context${input.hasEvidence ? " and external evidence" : ""}.`,
    );
  }
  if (bullets.length === 0 && input.sourceFileCount > 0) {
    bullets.push(
      `Contains ${input.sourceFileCount} source files grouped as a ${input.groupingKind}.`,
    );
  }
  return bullets.slice(0, 4);
}

/**
 * README h1 / first real paragraph (summary), a longer bounded prose excerpt
 * (synthesis fuel), and any URLs found. The excerpt strips headings, badges,
 * code fences, and HTML so the co-pilot synthesizes from prose, not markup.
 */
async function readReadme(dirAbs: string): Promise<{
  /**
   * The README H1 kept verbatim as the explicit project title. Distinct from
   * `summary`, which gets overwritten by the first paragraph when the H1 is a
   * short name (e.g. "Campus Pantry Bot") — that overwrite is right for a
   * description but would otherwise erase the best title signal we have.
   */
  title?: string;
  summary?: string;
  excerpt?: string;
  urls: string[];
}> {
  for (const name of ["README.md", "readme.md", "Readme.md", "README.mdx"]) {
    const text = await readOptional(join(dirAbs, name));
    if (!text) {
      continue;
    }
    const urls = [...text.matchAll(URL_RE)].map((m) => m[0]).slice(0, 6);
    const lines = text.split(/\r?\n/);
    const h1 = lines.find((l) => /^#\s+\S/.test(l));
    const title = h1 ? usableReadmeTitle(h1.replace(/^#\s+/, "")) : undefined;
    let summary: string | undefined;
    if (h1) {
      summary = h1.replace(/^#\s+/, "").trim();
    }
    const paraLines: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (paraLines.length > 0) {
          break;
        }
        continue;
      }
      if (
        paraLines.length === 0 &&
        (trimmed.startsWith("#") ||
          trimmed.startsWith("!") ||
          trimmed.startsWith("[") ||
          trimmed.startsWith("```"))
      ) {
        continue;
      }
      paraLines.push(trimmed);
    }
    const para = paraLines.join(" ");
    if (para && (!summary || !meaningfulSummary(summary))) {
      summary = para;
    }

    // Bounded prose excerpt: drop markup-only lines, keep readable sentences.
    let inFence = false;
    const proseLines: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("```")) {
        inFence = !inFence;
        continue;
      }
      if (inFence || !trimmed) {
        continue;
      }
      if (
        trimmed.startsWith("!") ||
        trimmed.startsWith("|") ||
        trimmed.startsWith("<") ||
        /^\[!\[/.test(trimmed)
      ) {
        continue;
      }
      proseLines.push(trimmed.replace(/^#{1,6}\s+/, "").replace(/^[-*]\s+/, ""));
      if (proseLines.join(" ").length > 900) {
        break;
      }
    }
    const excerpt = proseLines.join(" ").replace(/\s+/g, " ").slice(0, 800);

    return {
      title,
      summary: summary?.slice(0, 200),
      excerpt: excerpt || undefined,
      urls,
    };
  }
  return { urls: [] };
}

function computeActivity(
  recency: { lastCommitAt: string | null; commitCount: number },
  hasManifest: boolean,
  hasReadme: boolean,
  now: Date,
): number {
  let score = recency.commitCount * 2;
  if (recency.lastCommitAt) {
    const days =
      (now.getTime() - new Date(recency.lastCommitAt).getTime()) /
      (1000 * 60 * 60 * 24);
    score += Math.max(0, 30 - days);
  }
  if (hasManifest) {
    score += 6;
  }
  if (hasReadme) {
    score += 4;
  }
  return Math.round(score);
}

// ── Candidate construction ─────────────────────────────────────────────

async function buildCandidate(opts: {
  root: string;
  dirAbs: string;
  kind: ScanGroupingKind;
  allFiles: string[];
  git: GitData;
  now: Date;
  /** Repo product name, used to qualify role-named surfaces ("Acme Web"). */
  rootDisplayName?: string;
}): Promise<ScanCandidate | null> {
  const { root, dirAbs, kind, allFiles, git, now } = opts;
  const relDir = relative(root, dirAbs) || ".";
  const prefix = relDir === "." ? "" : `${relDir}/`;
  const myFiles = allFiles.filter((f) => prefix === "" || f.startsWith(prefix));
  if (myFiles.length === 0 && kind !== "repo-root") {
    return null;
  }

  const pkg = await readJson(join(dirAbs, "package.json"));
  const readme = await readReadme(dirAbs);
  const languages = topLanguages(myFiles);
  const sourceFileCount = myFiles.filter(
    (file) => LANGUAGE_BY_EXT[extname(file)],
  ).length;

  const repoName = normalizeGitHubUrl(git.remoteUrl)?.split("/").pop();
  const pkgName =
    typeof pkg?.["name"] === "string" ? (pkg["name"] as string) : undefined;
  // Title resolution is centralized so the CLI and MCP agree, and so a real
  // README H1 or package name always beats a throwaway clone/temp dir name.
  const title = deriveCandidateTitle({
    kind,
    readmeTitle: readme.title,
    pkgName,
    repoName,
    dirName: basename(dirAbs),
    rootName: basename(root),
    rootDisplayName: opts.rootDisplayName,
  });

  const pkgDescription =
    typeof pkg?.["description"] === "string"
      ? (pkg["description"] as string)
      : undefined;
  const summary =
    pkgDescription?.trim() ||
    readme.summary ||
    (languages[0] ? `${languages[0]} project.` : "Project from the codebase.");

  const evidenceUrls: string[] = [];
  const homepage =
    typeof pkg?.["homepage"] === "string"
      ? (pkg["homepage"] as string)
      : undefined;
  if (homepage && isHttpUrl(homepage)) {
    evidenceUrls.push(homepage);
  }
  for (const url of readme.urls) {
    if (isHttpUrl(url) && !evidenceUrls.includes(url)) {
      evidenceUrls.push(url);
    }
  }

  const pkgRepo =
    typeof pkg?.["repository"] === "string"
      ? (pkg["repository"] as string)
      : ((pkg?.["repository"] as { url?: string } | undefined)?.url ??
        undefined);
  const githubRepoUrl =
    normalizeGitHubUrl(pkgRepo) ?? normalizeGitHubUrl(git.remoteUrl);

  const skills = [...languages.slice(0, 4), ...depSkills(pkg)].filter(
    (s, i, arr) => arr.indexOf(s) === i,
  );
  const scripts = scriptSignals(pkg);

  const recency = recencyFor(git, relDir);
  const recentWork = recentWorkFor(git, relDir);
  const hasManifest = MANIFESTS.some((m) =>
    myFiles.some((f) => f === `${prefix}${m}` || (prefix === "" && f === m)),
  );
  const hasReadme =
    Boolean(readme.summary) || myFiles.some((f) => /readme\.mdx?$/i.test(f));
  const manifests = MANIFESTS.filter((m) =>
    myFiles.some((f) => f === `${prefix}${m}` || (prefix === "" && f === m)),
  );
  const resumeSummary = synthesizeResumeSummary({
    title,
    baseSummary: summary,
    skills,
    languages,
    recency,
    sourceFileCount,
  });
  const resumeBullets = synthesizeResumeBullets({
    groupingKind: kind,
    skills,
    languages,
    recentWork,
    recency,
    sourceFileCount,
    hasReadme,
    hasEvidence: evidenceUrls.length > 0 || Boolean(githubRepoUrl),
  });

  const key =
    kind === "workspace-package" && pkgName
      ? `pkg:${pkgName}`
      : kind === "repo-root"
        ? `repo:${normalizeGitHubUrl(git.remoteUrl) ?? basename(root)}`
        : `path:${relDir}`;

  return {
    key,
    title: title.slice(0, 200),
    summary: summary.slice(0, 500),
    resumeSummary,
    resumeBullets,
    recentWork,
    localSignals: {
      manifests,
      scripts,
      sourceFileCount,
      readmeSummary: readme.summary,
      readmeExcerpt: readme.excerpt,
    },
    groupingKind: kind,
    sourcePaths: relDir === "." ? ["."] : [relDir],
    evidenceUrls: evidenceUrls.slice(0, 8),
    githubRepoUrl,
    skills: skills.slice(0, 8),
    languages,
    recency,
    activity: computeActivity(recency, hasManifest, hasReadme, now),
  };
}

// ── Workspace discovery ────────────────────────────────────────────────

async function workspaceGlobs(root: string): Promise<string[]> {
  const globs: string[] = [];
  const pkg = await readJson(join(root, "package.json"));
  const ws = pkg?.["workspaces"];
  if (Array.isArray(ws)) {
    globs.push(...ws.filter((g): g is string => typeof g === "string"));
  } else if (ws && Array.isArray((ws as { packages?: unknown }).packages)) {
    globs.push(
      ...(ws as { packages: unknown[] }).packages.filter(
        (g): g is string => typeof g === "string",
      ),
    );
  }
  const pnpm = await readOptional(join(root, "pnpm-workspace.yaml"));
  if (pnpm) {
    for (const line of pnpm.split(/\r?\n/)) {
      const m = /^\s*-\s*["']?([^"'#\s]+)["']?/.exec(line);
      if (m?.[1]) {
        globs.push(m[1]);
      }
    }
  }
  return [...new Set(globs)];
}

async function dirsForGlob(root: string, glob: string): Promise<string[]> {
  const stripped = glob.replace(/\/\*\*?$/, "");
  const base = join(root, stripped);
  if (stripped === glob) {
    return (await isDir(base)) ? [base] : [];
  }
  try {
    const entries = await readdir(base, { withFileTypes: true });
    return entries
      .filter(
        (e) =>
          e.isDirectory() &&
          !EXCLUDED_DIRS.has(e.name) &&
          !e.name.startsWith("."),
      )
      .map((e) => join(base, e.name));
  } catch {
    return [];
  }
}

async function topLevelDirs(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter(
        (e) =>
          e.isDirectory() &&
          !EXCLUDED_DIRS.has(e.name) &&
          !e.name.startsWith("."),
      )
      .map((e) => join(root, e.name));
  } catch {
    return [];
  }
}

async function hasManifestIn(dirAbs: string): Promise<boolean> {
  for (const m of MANIFESTS) {
    if (await readOptional(join(dirAbs, m))) {
      return true;
    }
  }
  return false;
}

const IMPLEMENTATION_WORKSPACE_DIRS = new Set([
  "apps",
  "packages",
  "libs",
  "services",
]);

// Parent folders that hold *independent* efforts, not the surfaces of one
// product. Children under these never collapse into a single project.
const CONTAINER_DIRS = new Set([
  "examples",
  "example",
  "samples",
  "sample",
  "demos",
  "demo",
  "projects",
  "experiments",
  "sandbox",
  "playground",
  "templates",
]);

// Folder names that denote a *role* inside one product (a surface or layer),
// not a product in its own right. A repo whose subfolders are all role-named
// (web + api + worker) is one project split across folders — not three.
const ROLE_DIR_NAMES = new Set([
  "web",
  "webapp",
  "web-app",
  "app",
  "api",
  "apis",
  "server",
  "client",
  "frontend",
  "front-end",
  "backend",
  "back-end",
  "mobile",
  "ios",
  "android",
  "desktop",
  "electron",
  "extension",
  "www",
  "site",
  "website",
  "admin",
  "dashboard",
  "worker",
  "workers",
  "functions",
  "service",
  "services",
  "gateway",
  "edge",
  "core",
  "common",
  "shared",
  "ui",
  "sdk",
  "cli",
  "docs",
  "marketing",
  "landing",
]);

function isRoleName(name: string): boolean {
  return ROLE_DIR_NAMES.has(name.trim().toLowerCase());
}

// Root names that mark a repo as a *container* of many efforts rather than one
// product. Used only as a negative signal for the product-identity label.
const GENERIC_ROOT_NAME =
  /(^|[-_ ])(monorepo|workspace|workspaces|repo|projects?|sandbox|playground|examples?|samples?|demos?|experiments?|root)([-_ ]|$)/i;

/**
 * A short human label for the repo as a single product, or null when the repo
 * reads as a bare container. Prefers a real README summary, then a non-generic
 * package name, then a non-generic git remote name. This is the signal that
 * lets `apps/*` collapse into one project without a brittle `private: true`
 * requirement — a repo with a product README is one product whether or not its
 * root package happens to be marked private.
 */
function rootIdentityLabel(input: {
  readmeSummary?: string;
  rootName?: string;
  remoteName?: string;
}): string | null {
  if (meaningfulSummary(input.readmeSummary)) {
    return input.readmeSummary!.trim();
  }
  if (input.rootName && !GENERIC_ROOT_NAME.test(input.rootName)) {
    return humanize(stripScope(input.rootName));
  }
  if (input.remoteName && !GENERIC_ROOT_NAME.test(input.remoteName)) {
    return humanize(input.remoteName);
  }
  return null;
}

/**
 * Resolve a candidate's title with one explicit, shared priority so a scan
 * never falls back to a throwaway temp/clone directory name when a real title
 * is available:
 *
 *   1. README H1 / explicit project title from the README
 *   2. package.json `name`, humanized
 *   3. git remote repo name, humanized
 *   4. directory name, humanized (last resort)
 *
 * Two structural refinements layer on top, neither of which overrides a real
 * README H1:
 *   - A role-named surface inside a product (web, api, worker) is not a project
 *     name on its own, so when it is shown as its own component it is qualified
 *     with the repo's product name ("Acme Web") rather than surfaced as "Web".
 *   - For a whole-repo (repo-root) candidate, a generic container package name
 *     like "x-monorepo" is skipped in favor of the git remote name, which is
 *     the truer product identity.
 *
 * Shared by the CLI and MCP because both go through `buildCandidate`.
 */
function deriveCandidateTitle(opts: {
  kind: ScanGroupingKind;
  readmeTitle?: string;
  pkgName?: string;
  /** Leaf of this candidate's git remote, e.g. "campus-pantry-bot". */
  repoName?: string;
  /** basename(dirAbs) — the candidate's own directory. */
  dirName: string;
  /** basename(root) — the repo root, used only as the repo-root last resort. */
  rootName: string;
  /** Product name used to qualify a role-named surface ("Acme Web"). */
  rootDisplayName?: string;
}): string {
  // 1. An explicit README H1 always wins — it is a deliberate, specific title.
  const readmeTitle = opts.readmeTitle?.trim();
  if (readmeTitle) {
    return readmeTitle.slice(0, 200);
  }

  const leafName = opts.pkgName ? stripScope(opts.pkgName) : undefined;

  // A bare role-named surface shown as its own component → qualify it.
  if (
    opts.kind !== "repo-root" &&
    opts.rootDisplayName &&
    leafName &&
    isRoleName(leafName)
  ) {
    return `${opts.rootDisplayName} ${humanize(leafName)}`;
  }

  if (opts.kind === "repo-root") {
    // 2/3/4. Whole-repo project: package name (unless it is a generic container
    // label), then the git remote name, then the directory — all humanized.
    if (leafName && !GENERIC_ROOT_NAME.test(leafName)) {
      return humanize(leafName);
    }
    return humanize(opts.repoName ?? leafName ?? opts.rootName);
  }

  // 2/4. Component/subproject: package name humanized, else its directory name.
  return humanize(leafName ?? opts.dirName);
}

/**
 * Decide whether a set of sibling candidates are surfaces of ONE project
 * (collapse) or distinct projects (keep separate). Deterministic and
 * structural — no quality judgment. Rule order matters:
 *   1. A shared *container* parent (examples/, projects/) ⇒ independent efforts.
 *   2. All children role-named (web + api + worker) ⇒ one product, always.
 *   3. Conventional impl layout (apps/, packages/, ...) ⇒ one product *iff* the
 *      repo root reads as a single product (has an identity label).
 */
function shouldCollapse(opts: {
  root: string;
  workspaceDirs: string[];
  candidates: ScanCandidate[];
  rootLabel: string | null;
}): boolean {
  const { root, workspaceDirs, candidates, rootLabel } = opts;
  if (candidates.length <= 1) {
    return false;
  }
  const relDirs = workspaceDirs.map((dir) => relative(root, dir));

  if (relDirs.every((dir) => CONTAINER_DIRS.has(firstPathSegment(dir)))) {
    return false;
  }
  if (relDirs.every((dir) => isRoleName(basename(dir)))) {
    return true;
  }
  if (
    relDirs.every((dir) =>
      IMPLEMENTATION_WORKSPACE_DIRS.has(firstPathSegment(dir)),
    )
  ) {
    return rootLabel !== null;
  }
  return false;
}

/**
 * Collapse sibling candidates into one repo-root project when they are the
 * surfaces of a single product; otherwise return them unchanged. Shared by the
 * workspace branch and the loose top-level-dir branch so both group the same
 * way.
 */
async function maybeCollapse(opts: {
  root: string;
  childDirs: string[];
  children: ScanCandidate[];
  rootLabel: string | null;
  rootDisplayName: string;
  allFiles: string[];
  git: GitData;
  now: Date;
  skipped: ScanSkip[];
}): Promise<ScanCandidate[]> {
  const { root, childDirs, children, rootLabel, allFiles, git, now, skipped } =
    opts;
  if (
    !shouldCollapse({
      root,
      workspaceDirs: childDirs,
      candidates: children,
      rootLabel,
    })
  ) {
    return children;
  }
  const rootCandidate = await buildCandidate({
    root,
    dirAbs: root,
    kind: "repo-root",
    allFiles,
    git,
    now,
    rootDisplayName: opts.rootDisplayName,
  });
  if (!rootCandidate) {
    return children;
  }
  skipped.push({
    reason: "components-grouped-into-project",
    count: children.length,
  });
  return [collapseWorkspaceCandidates(rootCandidate, children)];
}

function unique<T>(items: T[]): T[] {
  return items.filter((item, index, arr) => arr.indexOf(item) === index);
}

function collapseWorkspaceCandidates(
  rootCandidate: ScanCandidate,
  children: ScanCandidate[],
): ScanCandidate {
  const skills = unique([
    ...rootCandidate.skills,
    ...children.flatMap((child) => child.skills),
  ]).slice(0, 8);
  const languages = unique([
    ...rootCandidate.languages,
    ...children.flatMap((child) => child.languages),
  ]);
  const scripts = unique([
    ...(rootCandidate.localSignals?.scripts ?? []),
    ...children.flatMap((child) => child.localSignals?.scripts ?? []),
  ]).slice(0, 8);
  const manifests = unique([
    ...(rootCandidate.localSignals?.manifests ?? []),
    ...children.flatMap((child) =>
      (child.localSignals?.manifests ?? []).map((manifest) =>
        child.sourcePaths[0] && child.sourcePaths[0] !== "."
          ? `${child.sourcePaths[0]}/${manifest}`
          : manifest,
      ),
    ),
  ]).slice(0, 12);
  const evidenceUrls = unique([
    ...rootCandidate.evidenceUrls,
    ...children.flatMap((child) => child.evidenceUrls),
  ]).slice(0, 8);
  const sourceFileCount =
    rootCandidate.localSignals?.sourceFileCount ??
    children.reduce(
      (sum, child) => sum + (child.localSignals?.sourceFileCount ?? 0),
      0,
    );
  // The repo-root scan already aggregates whole-repo commits, so its recentWork
  // is the canonical set; merge in any child-specific subjects as a fallback.
  const recentWork = unique([
    ...(rootCandidate.recentWork ?? []),
    ...children.flatMap((child) => child.recentWork ?? []),
  ]).slice(0, 6);

  return {
    ...rootCandidate,
    skills,
    languages,
    evidenceUrls,
    recentWork,
    resumeSummary: synthesizeResumeSummary({
      title: rootCandidate.title,
      baseSummary: rootCandidate.summary,
      skills,
      languages,
      recency: rootCandidate.recency,
      sourceFileCount,
    }),
    resumeBullets: synthesizeResumeBullets({
      groupingKind: rootCandidate.groupingKind,
      skills,
      languages,
      recentWork,
      recency: rootCandidate.recency,
      sourceFileCount,
      hasReadme: Boolean(rootCandidate.localSignals?.readmeSummary),
      hasEvidence:
        evidenceUrls.length > 0 || Boolean(rootCandidate.githubRepoUrl),
    }),
    localSignals: {
      manifests,
      scripts,
      sourceFileCount,
      readmeSummary: rootCandidate.localSignals?.readmeSummary,
      readmeExcerpt: rootCandidate.localSignals?.readmeExcerpt,
    },
  };
}

// ── Entry point ────────────────────────────────────────────────────────

export async function scanCodebase(options: ScanOptions): Promise<ScanResult> {
  const now = options.now ?? new Date();
  const maxCandidates = options.maxCandidates ?? 25;
  const sinceDays = options.sinceDays ?? 90;
  const ignore = new Set(options.ignoreKeys ?? []);
  const existingRepoUrls = new Set(
    (options.existingRepoUrls ?? [])
      .map((u) => normalizeGitHubUrl(u) ?? u.trim().toLowerCase())
      .filter(Boolean),
  );
  const existingTitles = new Set(
    (options.existingTitles ?? []).map((t) => t.trim().toLowerCase()),
  );

  const git = await readGit(options.cwd, sinceDays);
  const allFiles = await walk(options.cwd);
  const skipped: ScanSkip[] = [];

  // Read the repo's product identity once. `rootLabel` decides whether sibling
  // surfaces collapse into one project; `rootDisplayName` qualifies role-named
  // surfaces ("Acme Web") when they are surfaced as components.
  const rootPkg = await readJson(join(options.cwd, "package.json"));
  const rootReadme = await readReadme(options.cwd);
  const remoteName = normalizeGitHubUrl(git.remoteUrl)?.split("/").pop();
  const rootName =
    typeof rootPkg?.["name"] === "string"
      ? (rootPkg["name"] as string)
      : undefined;
  const rootLabel = rootIdentityLabel({
    readmeSummary: rootReadme.summary,
    rootName,
    remoteName,
  });
  const rootDisplayName = humanize(
    remoteName ?? (rootName ? stripScope(rootName) : basename(options.cwd)),
  );
  // When the root is itself a project (manifest, README, or a git repo), a bare
  // source subfolder like `src/` or `tests/` is internal code, not its own
  // project. Only manifest-bearing subdirs may stand alone; everything else
  // belongs to the one repo-root project. The loose source-count heuristic is
  // reserved for plain folders that have no project identity of their own.
  const rootIsProject =
    (await hasManifestIn(options.cwd)) ||
    Boolean(rootReadme.summary) ||
    git.isRepo;

  // 1. Workspaces may be independent projects or implementation components.
  const globs = await workspaceGlobs(options.cwd);
  const workspaceDirs: string[] = [];
  for (const glob of globs) {
    for (const dir of await dirsForGlob(options.cwd, glob)) {
      if (await readOptional(join(dir, "package.json"))) {
        workspaceDirs.push(dir);
      }
    }
  }

  let raw: (ScanCandidate | null)[] = [];

  if (workspaceDirs.length > 0) {
    const uniqueWorkspaceDirs = [...new Set(workspaceDirs)];
    const workspaceCandidates = (
      await Promise.all(
        uniqueWorkspaceDirs.map((dirAbs) =>
          buildCandidate({
            root: options.cwd,
            dirAbs,
            kind: "workspace-package",
            allFiles,
            git,
            now,
            rootDisplayName,
          }),
        ),
      )
    ).filter((candidate): candidate is ScanCandidate => candidate !== null);

    raw = await maybeCollapse({
      root: options.cwd,
      childDirs: uniqueWorkspaceDirs,
      children: workspaceCandidates,
      rootLabel,
      rootDisplayName,
      allFiles,
      git,
      now,
      skipped,
    });
  } else {
    // 2. Loose top-level dirs (no formal workspace) that each look like their
    //    own effort. These still group: web/ + server/ in one repo is one
    //    project, not two.
    const dirs = await topLevelDirs(options.cwd);
    const built: ScanCandidate[] = [];
    const builtDirs: string[] = [];
    for (const dirAbs of dirs) {
      const manifest = await hasManifestIn(dirAbs);
      const relDir = relative(options.cwd, dirAbs);
      const sourceCount = allFiles.filter(
        (f) => f.startsWith(`${relDir}/`) && LANGUAGE_BY_EXT[extname(f)],
      ).length;
      if (manifest || (!rootIsProject && sourceCount >= 3)) {
        const candidate = await buildCandidate({
          root: options.cwd,
          dirAbs,
          kind: manifest ? "top-level-dir" : "language-cluster",
          allFiles,
          git,
          now,
          rootDisplayName,
        });
        if (candidate) {
          built.push(candidate);
          builtDirs.push(dirAbs);
        }
      }
    }

    raw =
      built.length > 1
        ? await maybeCollapse({
            root: options.cwd,
            childDirs: builtDirs,
            children: built,
            rootLabel,
            rootDisplayName,
            allFiles,
            git,
            now,
            skipped,
          })
        : built;

    // 3. Repo-root fallback when nothing else grouped.
    if (raw.filter(Boolean).length === 0) {
      raw = [
        await buildCandidate({
          root: options.cwd,
          dirAbs: options.cwd,
          kind: "repo-root",
          allFiles,
          git,
          now,
          rootDisplayName,
        }),
      ];
    }
  }

  let candidates = raw.filter((c): c is ScanCandidate => c !== null);

  // Never-list filtering (explicit builder choice).
  const beforeIgnore = candidates.length;
  candidates = candidates.filter((c) => !ignore.has(c.key));
  if (beforeIgnore !== candidates.length) {
    skipped.push({
      reason: "never-list",
      count: beforeIgnore - candidates.length,
    });
  }

  // Dedupe flagging vs the account (flag, never drop).
  for (const c of candidates) {
    const repoMatch = c.githubRepoUrl && existingRepoUrls.has(c.githubRepoUrl);
    const titleMatch = existingTitles.has(c.title.trim().toLowerCase());
    if (repoMatch) {
      c.dedupe = { matchedExisting: true, reason: "repo-url" };
    } else if (titleMatch) {
      c.dedupe = { matchedExisting: true, reason: "title" };
    }
  }

  // Sort by activity (ordering only), then cap.
  candidates.sort((a, b) => b.activity - a.activity);
  if (candidates.length > maxCandidates) {
    skipped.push({
      reason: "over-cap",
      count: candidates.length - maxCandidates,
    });
    candidates = candidates.slice(0, maxCandidates);
  }

  return {
    cwd: options.cwd,
    isGitRepo: git.isRepo,
    scannedAt: now.toISOString(),
    candidates,
    skipped,
  };
}

// ── Project-root discovery ─────────────────────────────────────────────

function hasProjectMarker(dirAbs: string): boolean {
  return PROJECT_MARKERS.some((name) => existsSync(join(dirAbs, name)));
}

export interface DiscoverProjectRootsOptions {
  /** Stop after this many roots (keeps a deep tree bounded). */
  maxRoots?: number;
  /** How far below `start` to look for project roots. */
  maxDepth?: number;
}

/**
 * Resolve a starting directory to the set of project roots that should each be
 * scanned on their own.
 *
 * - If `start` is itself a project (a marker sits at its top), it is the only
 *   root — single-repo behavior is preserved exactly.
 * - Otherwise `start` is treated as a *container* (a home or dev folder): the
 *   tree is walked, bounded, and every project-marked subdirectory is returned.
 *   A marked directory is taken whole and not descended into — its internal
 *   layout is `scanCodebase`'s job, not discovery's.
 * - When nothing project-shaped is found, returns `[]`. The caller decides
 *   whether to fall back to scanning `start` directly.
 *
 * This is the deterministic answer to "which folders here are projects?" and is
 * shared by the CLI (`scanProjects`) and the MCP server so they never drift.
 */
export function discoverProjectRoots(
  start: string,
  options: DiscoverProjectRootsOptions = {},
): string[] {
  const maxRoots = options.maxRoots ?? 60;
  const maxDepth = options.maxDepth ?? 2;
  const out = new Set<string>();

  function visit(dirAbs: string, depth: number): void {
    if (out.size >= maxRoots || depth > maxDepth) {
      return;
    }
    if (hasProjectMarker(dirAbs)) {
      out.add(dirAbs);
      return;
    }
    let entries;
    try {
      entries = readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.size >= maxRoots) {
        return;
      }
      if (
        !entry.isDirectory() ||
        entry.name.startsWith(".") ||
        DISCOVERY_SKIP_DIRS.has(entry.name)
      ) {
        continue;
      }
      visit(join(dirAbs, entry.name), depth + 1);
    }
  }

  visit(start, 0);
  return [...out];
}

/**
 * Container-aware scan. Discovers the project roots under `options.cwd` and
 * scans each, merging the results into one `ScanResult`. When `cwd` is a single
 * project this is identical to `scanCodebase`; when it is a folder of projects
 * (e.g. a home or dev directory) each real project is detected and looked into,
 * instead of the container's loose folders surfacing as phantom projects.
 */
export async function scanProjects(options: ScanOptions): Promise<ScanResult> {
  const roots = discoverProjectRoots(options.cwd);

  // No project roots found → behave exactly like the single-folder scanner so
  // plain folders (and the `web/ + server/` loose layout) still work.
  if (roots.length === 0) {
    return scanCodebase(options);
  }
  // The common case: `cwd` is itself the one project root.
  if (roots.length === 1 && roots[0] === options.cwd) {
    return scanCodebase(options);
  }

  const now = options.now ?? new Date();
  const maxCandidates = options.maxCandidates ?? 25;
  const results = await Promise.all(
    roots.map((root) => scanCodebase({ ...options, cwd: root, now })),
  );

  // Merge candidates across roots, dropping exact duplicates (same repo + key)
  // and keeping the higher-activity copy. Candidate keys are left untouched so
  // the never-list stays stable per project.
  const merged = new Map<string, ScanCandidate>();
  for (const result of results) {
    for (const candidate of result.candidates) {
      const dedupeKey = `${candidate.githubRepoUrl ?? "no-repo"}::${candidate.key}`;
      const existing = merged.get(dedupeKey);
      if (!existing || candidate.activity > existing.activity) {
        merged.set(dedupeKey, candidate);
      }
    }
  }

  let candidates = [...merged.values()].sort((a, b) => b.activity - a.activity);

  const skipCounts = new Map<string, number>();
  for (const result of results) {
    for (const skip of result.skipped) {
      skipCounts.set(
        skip.reason,
        (skipCounts.get(skip.reason) ?? 0) + skip.count,
      );
    }
  }
  const skipped: ScanSkip[] = [...skipCounts.entries()].map(
    ([reason, count]) => ({ reason, count }),
  );

  if (candidates.length > maxCandidates) {
    skipped.push({
      reason: "over-cap",
      count: candidates.length - maxCandidates,
    });
    candidates = candidates.slice(0, maxCandidates);
  }

  return {
    cwd: options.cwd,
    isGitRepo: results.some((result) => result.isGitRepo),
    scannedAt: now.toISOString(),
    candidates,
    skipped,
  };
}

/** Convert a chosen candidate into a link-only POST /api/builder/projects body. */
export function candidateToProjectInput(
  candidate: ScanCandidate,
): NewProjectBody {
  const body: NewProjectBody = {
    title: candidate.title.slice(0, 500),
    description: candidate.summary.slice(0, 2000),
    privacy: "link",
    primarySkills: candidate.skills.slice(0, 8),
    evidenceBindings: {
      customUrls: candidate.evidenceUrls.filter(isHttpUrl).slice(0, 10),
    },
  };
  if (candidate.githubRepoUrl) {
    body.githubRepoUrl = candidate.githubRepoUrl;
  }
  return body;
}
