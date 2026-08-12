import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CandidatePassport } from "./candidate.js";
import type { LiveJob, SearchJobsInput } from "./jobs.js";
import type { ResumeEvidence } from "./resume.js";

export const applicationStatuses = [
  "shortlisted",
  "drafting",
  "needs-candidate-action",
  "ready-for-review",
  "submitted",
  "interview",
  "rejected",
  "offer",
  "withdrawn",
] as const;

export const candidateBlockerKinds = [
  "login",
  "captcha",
  "assessment",
  "identity-check",
  "signature",
  "voluntary-demographics",
  "missing-answer",
  "other",
] as const;

export type ApplicationStatus = (typeof applicationStatuses)[number];
export type CandidateBlockerKind = (typeof candidateBlockerKinds)[number];

export interface StoredCandidateProfile {
  profileId: string;
  label: string;
  passport: CandidatePassport;
  resume: ResumeEvidence | null;
  consentRecordedAt: string;
  savedAt: string;
}

export interface SavedJobScout {
  searchId: string;
  name: string;
  profileId: string | null;
  filters: Omit<SearchJobsInput, "cursor" | "newSince">;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastResultIds: string[];
}

export interface StoredApplicationField {
  label: string;
  value: string;
  source: string;
}

export interface ApplicationCheckpoint {
  kind: CandidateBlockerKind;
  currentUrl: string;
  completedFields: string[];
  remainingFields: string[];
  instruction: string;
  recordedAt: string;
}

export interface ApplicationLedgerEntry {
  entryId: string;
  profileId: string;
  job: {
    id: string;
    employer: string;
    title: string;
    location: string;
    officialJobUrl: string;
    applyUrl: string;
  };
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  confirmationId: string | null;
  confirmationText: string | null;
  receiptUrl: string | null;
  receiptEmail: string | null;
  nextStep: string | null;
  followUpAt: string | null;
  resumeDocumentId: string | null;
  resumeFileName: string | null;
  submittedFields: StoredApplicationField[];
  checkpoint: ApplicationCheckpoint | null;
  notes: string | null;
  history: Array<{
    status: ApplicationStatus;
    at: string;
    note: string | null;
  }>;
}

interface LocalState {
  version: "buffalo-local-state/v1";
  profiles: StoredCandidateProfile[];
  scouts: SavedJobScout[];
  applications: ApplicationLedgerEntry[];
}

const emptyState = (): LocalState => ({
  version: "buffalo-local-state/v1",
  profiles: [],
  scouts: [],
  applications: [],
});

function defaultDataDir(): string {
  const configured = process.env["BUFFALO_PROJECTS_TOOLS_DATA_DIR"]?.trim();
  if (configured) return configured;
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "buffalo-projects-tools");
  }
  if (process.platform === "win32") {
    return join(
      process.env["LOCALAPPDATA"]?.trim() || homedir(),
      "buffalo-projects-tools",
    );
  }
  return join(
    process.env["XDG_DATA_HOME"]?.trim() || join(homedir(), ".local", "share"),
    "buffalo-projects-tools",
  );
}

export function localDataDir(override?: string): string {
  return override?.trim() || defaultDataDir();
}

function statePath(dataDir?: string): string {
  return join(localDataDir(dataDir), "state.json");
}

function isCandidatePassport(value: unknown): value is CandidatePassport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record["version"] === "buffalo-candidate-passport/v2" &&
    typeof record["passportId"] === "string" &&
    Array.isArray(record["claims"]) &&
    Array.isArray(record["applicationAnswers"])
  );
}

function parseState(value: unknown): LocalState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Local Buffalo state is not a JSON object.");
  }
  const record = value as Record<string, unknown>;
  if (
    record["version"] !== "buffalo-local-state/v1" ||
    !Array.isArray(record["profiles"]) ||
    !Array.isArray(record["scouts"]) ||
    !Array.isArray(record["applications"])
  ) {
    throw new Error("Local Buffalo state has an unsupported or damaged shape.");
  }
  const profiles = (record["profiles"] as unknown[]).filter(
    (profile): profile is StoredCandidateProfile => {
      if (!profile || typeof profile !== "object" || Array.isArray(profile)) return false;
      const candidate = profile as Record<string, unknown>;
      return (
        typeof candidate["profileId"] === "string" &&
        typeof candidate["label"] === "string" &&
        isCandidatePassport(candidate["passport"])
      );
    },
  );
  return {
    version: "buffalo-local-state/v1",
    profiles,
    scouts: record["scouts"] as SavedJobScout[],
    applications: record["applications"] as ApplicationLedgerEntry[],
  };
}

async function readState(dataDir?: string): Promise<LocalState> {
  try {
    return parseState(JSON.parse(await readFile(statePath(dataDir), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    if (error instanceof SyntaxError) {
      throw new Error("Local Buffalo state contains invalid JSON.");
    }
    throw error;
  }
}

async function writeState(state: LocalState, dataDir?: string): Promise<void> {
  const directory = localDataDir(dataDir);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(directory, 0o700);
  const destination = statePath(dataDir);
  const temporary = join(directory, `.state-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, destination);
    if (process.platform !== "win32") await chmod(destination, 0o600);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function cleanId(value: string, label: string): string {
  const id = value.trim();
  if (!/^[a-zA-Z0-9._-]{1,100}$/u.test(id)) {
    throw new Error(`${label} may contain only letters, numbers, dots, underscores, and dashes.`);
  }
  return id;
}

export async function getLocalStorageStatus(dataDir?: string) {
  const file = statePath(dataDir);
  try {
    const info = await stat(file);
    return {
      configured: true,
      exists: true,
      path: file,
      byteLength: info.size,
      mode: process.platform === "win32" ? null : (info.mode & 0o777).toString(8),
      note: "Local state contains applicant-approved private data. Do not commit or share it.",
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      configured: true,
      exists: false,
      path: file,
      byteLength: 0,
      mode: null,
      note: "No local candidate memory exists yet.",
    };
  }
}

export async function listCandidateProfiles(dataDir?: string) {
  const state = await readState(dataDir);
  return state.profiles.map((profile) => ({
    profileId: profile.profileId,
    label: profile.label,
    passportId: profile.passport.passportId,
    savedAt: profile.savedAt,
    resumeFileName: profile.resume?.fileName ?? null,
    rememberedAnswerCount: profile.passport.applicationAnswers.length,
  }));
}

export async function saveCandidateProfile(
  input: {
    profileId?: string | undefined;
    label: string;
    passport: CandidatePassport;
    resume?: ResumeEvidence | null | undefined;
    consentToLocalStorage?: boolean | undefined;
  },
  dataDir?: string,
) {
  if (!input.consentToLocalStorage) {
    throw new Error("Saving private candidate memory requires explicit applicant consent.");
  }
  const profileId = cleanId(input.profileId ?? input.passport.passportId, "profileId");
  const state = await readState(dataDir);
  const now = new Date().toISOString();
  const persistedPassport: CandidatePassport = {
    ...input.passport,
    updatedAt: now,
    portability: {
      persisted: true,
      profileId,
      note: "Saved only in this user's local Buffalo Projects Tools data file.",
    },
  };
  const existing = state.profiles.find((profile) => profile.profileId === profileId);
  const profile: StoredCandidateProfile = {
    profileId,
    label: input.label.trim() || "Candidate",
    passport: persistedPassport,
    resume: input.resume ?? existing?.resume ?? null,
    consentRecordedAt: existing?.consentRecordedAt ?? now,
    savedAt: now,
  };
  state.profiles = [
    ...state.profiles.filter((candidate) => candidate.profileId !== profileId),
    profile,
  ];
  await writeState(state, dataDir);
  return profile;
}

export async function loadCandidateProfile(profileId: string, dataDir?: string) {
  const id = cleanId(profileId, "profileId");
  const profile = (await readState(dataDir)).profiles.find(
    (candidate) => candidate.profileId === id,
  );
  if (!profile) throw new Error(`Unknown local candidate profile: ${id}`);
  return profile;
}

export async function deleteCandidateProfile(
  profileId: string,
  confirmedByUser: boolean,
  dataDir?: string,
) {
  if (!confirmedByUser) throw new Error("Profile deletion requires explicit confirmation.");
  const id = cleanId(profileId, "profileId");
  const state = await readState(dataDir);
  const existed = state.profiles.some((profile) => profile.profileId === id);
  state.profiles = state.profiles.filter((profile) => profile.profileId !== id);
  state.scouts = state.scouts.filter((scout) => scout.profileId !== id);
  state.applications = state.applications.filter((entry) => entry.profileId !== id);
  if (existed) await writeState(state, dataDir);
  return { deleted: existed, profileId: id, recoverable: false };
}

export async function saveJobScout(
  input: {
    searchId: string;
    name: string;
    profileId?: string | null | undefined;
    filters: Omit<SearchJobsInput, "cursor" | "newSince">;
  },
  dataDir?: string,
) {
  const state = await readState(dataDir);
  const searchId = cleanId(input.searchId, "searchId");
  const profileId = input.profileId ? cleanId(input.profileId, "profileId") : null;
  if (profileId && !state.profiles.some((profile) => profile.profileId === profileId)) {
    throw new Error(`Unknown local candidate profile: ${profileId}`);
  }
  const now = new Date().toISOString();
  const existing = state.scouts.find((scout) => scout.searchId === searchId);
  const scout: SavedJobScout = {
    searchId,
    name: input.name.trim() || searchId,
    profileId,
    filters: input.filters,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastRunAt: existing?.lastRunAt ?? null,
    lastResultIds: existing?.lastResultIds ?? [],
  };
  state.scouts = [
    ...state.scouts.filter((candidate) => candidate.searchId !== searchId),
    scout,
  ];
  await writeState(state, dataDir);
  return scout;
}

export async function loadJobScout(searchId: string, dataDir?: string) {
  const id = cleanId(searchId, "searchId");
  const scout = (await readState(dataDir)).scouts.find(
    (candidate) => candidate.searchId === id,
  );
  if (!scout) throw new Error(`Unknown saved job scout: ${id}`);
  return scout;
}

export async function recordJobScoutRun(
  searchId: string,
  resultIds: string[],
  ranAt: string,
  dataDir?: string,
) {
  const state = await readState(dataDir);
  const id = cleanId(searchId, "searchId");
  const scout = state.scouts.find((candidate) => candidate.searchId === id);
  if (!scout) throw new Error(`Unknown saved job scout: ${id}`);
  scout.lastRunAt = ranAt;
  scout.updatedAt = ranAt;
  scout.lastResultIds = [...new Set(resultIds)].slice(0, 100);
  await writeState(state, dataDir);
  return scout;
}

const prohibitedStoredField =
  /(?:social security|ssn|tax id|bank|routing|account number|password|credential|race|ethnicity|gender|disability|veteran|sexual orientation|self.identif)/iu;

export async function recordApplicationProgress(
  input: {
    profileId: string;
    job: LiveJob;
    status: ApplicationStatus;
    submittedAt?: string | null | undefined;
    confirmationId?: string | null | undefined;
    confirmationText?: string | null | undefined;
    receiptUrl?: string | null | undefined;
    receiptEmail?: string | null | undefined;
    nextStep?: string | null | undefined;
    followUpAt?: string | null | undefined;
    resume?: ResumeEvidence | null | undefined;
    submittedFields?: StoredApplicationField[] | undefined;
    checkpoint?: Omit<ApplicationCheckpoint, "recordedAt"> | null | undefined;
    notes?: string | null | undefined;
  },
  dataDir?: string,
) {
  const state = await readState(dataDir);
  const profileId = cleanId(input.profileId, "profileId");
  if (!state.profiles.some((profile) => profile.profileId === profileId)) {
    throw new Error(`Unknown local candidate profile: ${profileId}`);
  }
  for (const field of input.submittedFields ?? []) {
    if (prohibitedStoredField.test(field.label)) {
      throw new Error(`This application field is intentionally never stored: ${field.label}`);
    }
  }
  const now = new Date().toISOString();
  const entryId = `${profileId}:${input.job.id}`;
  const existing = state.applications.find((entry) => entry.entryId === entryId);
  const entry: ApplicationLedgerEntry = {
    entryId,
    profileId,
    job: {
      id: input.job.id,
      employer: input.job.employer,
      title: input.job.title,
      location: input.job.location,
      officialJobUrl: input.job.officialJobUrl,
      applyUrl: input.job.applyUrl,
    },
    status: input.status,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    submittedAt: input.submittedAt ?? existing?.submittedAt ?? null,
    confirmationId: input.confirmationId ?? existing?.confirmationId ?? null,
    confirmationText: input.confirmationText ?? existing?.confirmationText ?? null,
    receiptUrl: input.receiptUrl ?? existing?.receiptUrl ?? null,
    receiptEmail: input.receiptEmail ?? existing?.receiptEmail ?? null,
    nextStep: input.nextStep ?? existing?.nextStep ?? null,
    followUpAt: input.followUpAt ?? existing?.followUpAt ?? null,
    resumeDocumentId: input.resume?.documentId ?? existing?.resumeDocumentId ?? null,
    resumeFileName: input.resume?.fileName ?? existing?.resumeFileName ?? null,
    submittedFields: input.submittedFields ?? existing?.submittedFields ?? [],
    checkpoint:
      input.status === "submitted"
        ? null
        : input.checkpoint
          ? { ...input.checkpoint, recordedAt: now }
          : (existing?.checkpoint ?? null),
    notes: input.notes ?? existing?.notes ?? null,
    history: [
      ...(existing?.history ?? []),
      { status: input.status, at: now, note: input.notes ?? null },
    ].slice(-100),
  };
  state.applications = [
    ...state.applications.filter((candidate) => candidate.entryId !== entryId),
    entry,
  ];
  await writeState(state, dataDir);
  return entry;
}

export async function getApplicationLedger(
  input: {
    profileId?: string | undefined;
    statuses?: ApplicationStatus[] | undefined;
  } = {},
  dataDir?: string,
) {
  const state = await readState(dataDir);
  return state.applications
    .filter(
      (entry) =>
        (!input.profileId || entry.profileId === input.profileId) &&
        (!input.statuses?.length || input.statuses.includes(entry.status)),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
