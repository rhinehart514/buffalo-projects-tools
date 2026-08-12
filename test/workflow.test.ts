import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildCandidatePassport } from "../src/candidate.js";
import { exportApprovedMaterials } from "../src/export-materials.js";
import type { LiveJob } from "../src/jobs.js";
import {
  prepareApplicationMaterials,
  reviewApplicationMaterials,
} from "../src/materials.js";
import { rankJobs } from "../src/ranking.js";
import { importResume } from "../src/resume.js";
import { runJobScout } from "../src/scout.js";
import { saveCandidateProfile, saveJobScout } from "../src/storage.js";

function job(overrides: Partial<LiveJob> = {}): LiveJob {
  return {
    id: "job-1",
    externalId: "1",
    sourceId: "source-1",
    provider: "buffalo-projects-job-board",
    employer: "Example Buffalo Company",
    title: "Senior Software Engineer",
    location: "Buffalo, NY, USA",
    workplace: "hybrid",
    commitment: "full_time",
    department: "technology",
    salary: "USD 100,000–140,000 year",
    compensation: {
      original: null,
      currency: "USD",
      min: 100000,
      max: 140000,
      period: "year",
      provenance: "disclosed",
      annualMin: 100000,
      annualMax: 140000,
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
    ...overrides,
  };
}

function passport() {
  return buildCandidatePassport({
    candidate: {
      fullName: "Example Candidate",
      email: "candidate@example.com",
      phone: "+1 716 555 0100",
      resumePath: "/tmp/resume.pdf",
      desiredRoles: ["Software Engineer"],
      skills: ["TypeScript", "Product engineering"],
      workAuthorized: "Yes",
      needsSponsorship: "No",
      workHistory: [
        {
          employer: "Previous Company",
          title: "Engineer",
          responsibilities: ["Shipped customer-facing TypeScript applications"],
        },
      ],
    },
    factsConfirmedByUser: true,
  });
}

test("ranks a best-five batch from candidate evidence and explicit preferences", () => {
  const result = rankJobs(
    passport(),
    [
      job(),
      job({ id: "job-2", title: "Restaurant General Manager", department: "retail_hospitality_food" }),
    ],
    {
      preferredWorkModes: ["hybrid"],
      preferredSectors: ["technology"],
      avoidWords: ["restaurant"],
      limit: 5,
    },
  );

  assert.equal(result.ranked[0]?.job.id, "job-1");
  assert.ok(result.ranked[0]!.score > 0);
  assert.equal(result.excluded[0]?.job.id, "job-2");
  assert.match(result.notice, /not a hiring or eligibility decision/);
});

test("reviews tailored materials against passport evidence and exposes the diff", () => {
  const candidate = passport();
  const claimKey = candidate.claims.find((claim) =>
    claim.value.includes("customer-facing TypeScript"),
  )!.key;
  const brief = prepareApplicationMaterials(candidate, job());
  assert.ok(brief.supportedClaims.some((claim) => claim.key === claimKey));

  const review = reviewApplicationMaterials({
    passport: candidate,
    job: job(),
    originalResumeText: "Engineer\nBuilt software",
    tailoredResumeText:
      "Senior Software Engineer\nShipped customer-facing TypeScript applications",
    coverLetter: "I am interested in the role based on my product engineering work.",
    proposedClaims: [
      {
        text: "Shipped customer-facing TypeScript applications",
        evidenceKeys: [claimKey],
      },
    ],
  });

  assert.equal(review.decision, "ready-for-applicant-review");
  assert.equal(review.diff.addedLineCount, 2);
  assert.equal(review.coverLetter.included, true);

  const blocked = reviewApplicationMaterials({
    passport: candidate,
    job: job(),
    originalResumeText: "Engineer",
    tailoredResumeText: "Invented executive credential",
    proposedClaims: [
      { text: "Invented executive credential", evidenceKeys: ["missing.claim"] },
    ],
  });
  assert.equal(blocked.decision, "blocked");
  assert.deepEqual(blocked.evidenceReview.unsupportedEvidenceKeys, ["missing.claim"]);
});

test("exports the applicant-approved tailored resume and cover letter as uploadable PDFs", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "buffalo-material-export-test-"));
  context.after(async () => rm(dataDir, { recursive: true, force: true }));
  const candidate = passport();
  await saveCandidateProfile(
    {
      profileId: "example",
      label: "Example Candidate",
      passport: candidate,
      consentToLocalStorage: true,
    },
    dataDir,
  );
  const claimKey = candidate.claims.find((claim) =>
    claim.value.includes("customer-facing TypeScript"),
  )!.key;
  await assert.rejects(
    exportApprovedMaterials(
      {
        profileId: "example",
        job: job(),
        originalResumeText: "Example Candidate\nSoftware Engineer",
        tailoredResumeText: "Example Candidate\nEXPERIENCE\nSoftware Engineer",
        proposedClaims: [{ text: "Software Engineer", evidenceKeys: [claimKey] }],
        approvedByUser: false,
      },
      dataDir,
    ),
    /requires applicant approval/,
  );
  await assert.rejects(
    exportApprovedMaterials(
      {
        profileId: "example",
        job: job(),
        originalResumeText: "Example Candidate\nSoftware Engineer",
        tailoredResumeText: "Example Candidate\nInvented executive credential",
        proposedClaims: [
          { text: "Invented executive credential", evidenceKeys: ["missing.claim"] },
        ],
        approvedByUser: true,
      },
      dataDir,
    ),
    /failed evidence review/,
  );

  const exported = await exportApprovedMaterials(
    {
      profileId: "example",
      job: job(),
      originalResumeText: [
        "Example Candidate",
        "candidate@example.com | Buffalo, NY",
        "Software Engineer — Previous Company",
        "Shipped customer-facing TypeScript applications",
      ].join("\n"),
      tailoredResumeText: [
        "Example Candidate",
        "candidate@example.com | Buffalo, NY",
        "EXPERIENCE",
        "Software Engineer — Previous Company",
        "- Shipped customer-facing TypeScript applications",
      ].join("\n"),
      coverLetter:
        "Example Candidate\n\nI am applying for the Senior Software Engineer role based on my confirmed product engineering experience.",
      proposedClaims: [
        {
          text: "Shipped customer-facing TypeScript applications",
          evidenceKeys: [claimKey],
        },
      ],
      approvedByUser: true,
    },
    dataDir,
  );

  assert.equal(exported.status, "approved-materials-exported");
  assert.ok(exported.coverLetterPath);
  assert.ok((await stat(exported.resume.localPath!)).size > 500);
  if (process.platform !== "win32") {
    assert.equal(((await stat(exported.resume.localPath!)).mode & 0o777).toString(8), "600");
  }
  const parsed = await importResume({ path: exported.resume.localPath! });
  assert.equal(parsed.status, "ready-for-fact-extraction");
  assert.match(parsed.extractedText, /TypeScript applications/);
});

function boardPayload() {
  const listing = job();
  return {
    jobs: [
      {
        id: listing.id,
        externalId: listing.externalId,
        sourceId: listing.sourceId,
        title: listing.title,
        employer: listing.employer,
        opportunityKind: listing.opportunityKind,
        sector: listing.department,
        workMode: listing.workplace,
        employmentType: listing.employmentType,
        sourceTier: listing.sourceTier,
        freshness: listing.freshness,
        checkedAt: listing.boardCheckedAt,
        postedAt: listing.publishedAt,
        deadline: listing.deadline,
        url: listing.officialJobUrl,
        applicationUrl: listing.applyUrl,
        location: {
          display: listing.location,
          city: "Buffalo",
          region: "NY",
          country: "USA",
          workMode: listing.workplace,
        },
        compensation: {
          ...listing.compensation,
          annualization: "disclosed",
        },
        source: listing.source,
      },
    ],
    pagination: {
      limit: 50,
      cursor: null,
      nextCursor: null,
      hasMore: false,
      totalMatching: 1,
    },
    coverage: {
      checkedAt: "2026-08-12T12:00:00Z",
      cacheReadStatus: "healthy",
      cacheError: null,
      healthySourceCount: 1,
      quarantinedSourceCount: 0,
      failedSourceCount: 0,
      staleSourceCount: 0,
      activePostingCount: 1,
      matchingPostingCount: 1,
      returnedPostingCount: 1,
    },
  };
}

test("saved scouts return only jobs newer than the previous successful run", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "buffalo-scout-test-"));
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
  await saveJobScout(
    {
      searchId: "daily-engineering",
      name: "Daily engineering jobs",
      profileId: "example",
      filters: { query: "software engineer", sector: "technology", limit: 50 },
    },
    dataDir,
  );
  const requested: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    requested.push(String(input));
    return Response.json(boardPayload());
  }) as typeof fetch;

  const first = await runJobScout(
    { searchId: "daily-engineering" },
    { dataDir, fetcher },
  );
  const second = await runJobScout(
    { searchId: "daily-engineering" },
    { dataDir, fetcher },
  );

  assert.equal(first.jobs.length, 1);
  assert.equal(first.ranking?.ranked[0]?.job.id, "job-1");
  assert.equal(new URL(requested[0]!).searchParams.has("newSince"), false);
  assert.equal(new URL(requested[1]!).searchParams.has("newSince"), true);
  assert.equal(second.search.previousRunAt, first.search.ranAt);
});
