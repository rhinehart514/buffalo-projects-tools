import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildCandidatePassport,
  rememberCandidateAnswers,
} from "../src/candidate.js";
import type { LiveJob } from "../src/jobs.js";
import type { ResumeEvidence } from "../src/resume.js";
import {
  deleteCandidateProfile,
  getApplicationLedger,
  getLocalStorageStatus,
  listCandidateProfiles,
  loadCandidateProfile,
  recordApplicationProgress,
  saveCandidateProfile,
} from "../src/storage.js";

const resume: ResumeEvidence = {
  kind: "resume",
  documentId: "resume_1234567890abcdef",
  fileName: "resume.pdf",
  format: "pdf",
  localPath: "/tmp/resume.pdf",
  byteLength: 1000,
  characterCount: 500,
  pageCount: 1,
  contentSha256: "a".repeat(64),
  importedAt: "2026-08-12T12:00:00Z",
};

const job: LiveJob = {
  id: "job-1",
  externalId: "1",
  sourceId: "source-1",
  provider: "buffalo-projects-job-board",
  employer: "Example Buffalo Company",
  title: "Software Engineer",
  location: "Buffalo, NY",
  workplace: "hybrid",
  commitment: "full_time",
  department: "technology",
  salary: null,
  compensation: {
    original: null,
    currency: null,
    min: null,
    max: null,
    period: "unknown",
    provenance: "unknown",
    annualMin: null,
    annualMax: null,
  },
  opportunityKind: "job",
  employmentType: "full_time",
  sourceTier: "canonical-employer",
  freshness: "current",
  officialJobUrl: "https://careers.example.com/jobs/1",
  applyUrl: "https://apply.example.com/jobs/1",
  publishedAt: "2026-08-11T12:00:00Z",
  deadline: null,
  updatedAt: null,
  fetchedAt: "2026-08-12T12:00:00Z",
  boardCheckedAt: "2026-08-12",
  source: {
    organization: "Example Buffalo Company",
    sourceUrl: "https://careers.example.com",
    careersUrl: "https://careers.example.com",
    platform: "example",
    verifiedAt: "2026-08-12",
  },
};

function passport() {
  return buildCandidatePassport({
    candidate: {
      fullName: "Example Candidate",
      email: "candidate@example.com",
      phone: "+1 716 555 0100",
      resumePath: "/tmp/resume.pdf",
      workAuthorized: "Yes",
      needsSponsorship: "No",
      desiredRoles: ["Software Engineer"],
    },
    factsConfirmedByUser: true,
  });
}

test("local memory requires consent and uses owner-only file permissions", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "buffalo-storage-test-"));
  context.after(async () => rm(dataDir, { recursive: true, force: true }));

  await assert.rejects(
    saveCandidateProfile(
      { label: "Example", passport: passport(), consentToLocalStorage: false },
      dataDir,
    ),
    /explicit applicant consent/,
  );
  const saved = await saveCandidateProfile(
    {
      profileId: "example",
      label: "Example Candidate",
      passport: passport(),
      resume,
      consentToLocalStorage: true,
    },
    dataDir,
  );

  assert.equal(saved.passport.portability.persisted, true);
  assert.equal((await listCandidateProfiles(dataDir))[0]?.profileId, "example");
  assert.equal((await loadCandidateProfile("example", dataDir)).resume?.documentId, resume.documentId);
  const storage = await getLocalStorageStatus(dataDir);
  assert.equal(storage.exists, true);
  if (process.platform !== "win32") assert.equal(storage.mode, "600");
});

test("remembered answers compound but demographic answers are never stored", () => {
  const updated = rememberCandidateAnswers({
    passport: passport(),
    answers: [
      {
        question: "Are you willing to relocate?",
        answer: "Yes, within Western New York",
        sensitivity: "material",
        confirmedByUser: true,
      },
    ],
  });

  assert.equal(updated.applicationAnswers.length, 1);
  assert.throws(
    () =>
      rememberCandidateAnswers({
        passport: updated,
        answers: [
          {
            question: "Race / ethnicity",
            answer: "A demographic response",
            sensitivity: "personal",
            confirmedByUser: true,
          },
        ],
      }),
    /intentionally never stored/,
  );
});

test("ledger resumes exact candidate-only checkpoints and captures receipts", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "buffalo-ledger-test-"));
  context.after(async () => rm(dataDir, { recursive: true, force: true }));
  await saveCandidateProfile(
    {
      profileId: "example",
      label: "Example Candidate",
      passport: passport(),
      resume,
      consentToLocalStorage: true,
    },
    dataDir,
  );

  const blocked = await recordApplicationProgress(
    {
      profileId: "example",
      job,
      status: "needs-candidate-action",
      checkpoint: {
        kind: "login",
        currentUrl: "https://apply.example.com/jobs/1/login",
        completedFields: ["Name", "Email"],
        remainingFields: ["Resume", "Work authorization"],
        instruction: "Sign in to the employer account, then return control.",
      },
    },
    dataDir,
  );
  assert.equal(blocked.checkpoint?.kind, "login");

  const submitted = await recordApplicationProgress(
    {
      profileId: "example",
      job,
      status: "submitted",
      submittedAt: "2026-08-12T13:00:00Z",
      confirmationId: "APP-123",
      receiptUrl: "https://apply.example.com/confirmation/APP-123",
      nextStep: "Employer review",
      resume,
      submittedFields: [
        { label: "Work authorization", value: "Yes", source: "user-confirmed" },
      ],
    },
    dataDir,
  );
  assert.equal(submitted.checkpoint, null);
  assert.equal(submitted.confirmationId, "APP-123");
  assert.equal((await getApplicationLedger({ profileId: "example" }, dataDir)).length, 1);

  await assert.rejects(
    recordApplicationProgress(
      {
        profileId: "example",
        job,
        status: "submitted",
        submittedFields: [
          { label: "Social Security number", value: "not-real", source: "user-confirmed" },
        ],
      },
      dataDir,
    ),
    /intentionally never stored/,
  );
});

test("deleting a profile also removes its private ledger", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "buffalo-delete-test-"));
  context.after(async () => rm(dataDir, { recursive: true, force: true }));
  await saveCandidateProfile(
    {
      profileId: "example",
      label: "Example Candidate",
      passport: passport(),
      consentToLocalStorage: true,
    },
    dataDir,
  );

  await assert.rejects(
    deleteCandidateProfile("example", false, dataDir),
    /explicit confirmation/,
  );
  const result = await deleteCandidateProfile("example", true, dataDir);
  assert.equal(result.deleted, true);
  assert.equal(result.recoverable, false);
  assert.equal((await listCandidateProfiles(dataDir)).length, 0);
});
