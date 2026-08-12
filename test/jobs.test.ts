import assert from "node:assert/strict";
import test from "node:test";
import { resolveLiveJobs, searchLiveJobs } from "../src/jobs.js";

function rawJob(id = "job-1") {
  return {
    id,
    externalId: id,
    sourceId: "buffalo-source",
    title: "Software Engineer",
    employer: "Example Buffalo Company",
    opportunityKind: "job",
    sector: "technology",
    workMode: "hybrid",
    employmentType: "full_time",
    sourceTier: "canonical-employer",
    freshness: "current",
    checkedAt: "2026-08-12",
    postedAt: "2026-08-11T12:00:00Z",
    deadline: null,
    url: `https://careers.example.com/jobs/${id}`,
    applicationUrl: `https://careers.example.com/jobs/${id}/apply`,
    location: {
      display: "Buffalo, NY, USA",
      city: "Buffalo",
      region: "NY",
      country: "USA",
      workMode: "hybrid",
    },
    compensation: {
      original: null,
      currency: "USD",
      min: 90000,
      max: 120000,
      period: "year",
      provenance: "disclosed",
      annualMin: 90000,
      annualMax: 120000,
      annualization: "disclosed",
    },
    image: null,
    source: {
      id: "buffalo-source",
      sourceId: "buffalo-source",
      organization: "Example Buffalo Company",
      sourceUrl: "https://careers.example.com",
      sourceTier: "canonical-employer",
      sector: "technology",
      geography: "Buffalo, NY, USA",
      platform: "example",
      sourceType: "employer",
      careersUrl: "https://careers.example.com",
      verifiedAt: "2026-08-12",
    },
  };
}

function payload(
  jobs: ReturnType<typeof rawJob>[],
  pagination: { nextCursor: string | null; hasMore: boolean; totalMatching?: number },
) {
  return {
    jobs,
    pagination: {
      limit: 50,
      cursor: null,
      nextCursor: pagination.nextCursor,
      hasMore: pagination.hasMore,
      totalMatching: pagination.totalMatching ?? jobs.length,
    },
    coverage: {
      checkedAt: "2026-08-12T12:00:00Z",
      cacheReadStatus: "healthy",
      cacheError: null,
      healthySourceCount: 60,
      quarantinedSourceCount: 0,
      failedSourceCount: 0,
      staleSourceCount: 0,
      activePostingCount: 784,
      matchingPostingCount: jobs.length,
      returnedPostingCount: jobs.length,
    },
  };
}

test("searches the Buffalo Projects board with its public filter contract", async () => {
  let requestedUrl = "";
  const fetcher = (async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return Response.json(payload([rawJob()], { nextCursor: null, hasMore: false }));
  }) as typeof fetch;

  const result = await searchLiveJobs(
    {
      query: "software engineer",
      opportunityKind: "job",
      sector: "technology",
      workMode: "hybrid",
      minPay: 90000,
      limit: 7,
    },
    fetcher,
  );

  const request = new URL(requestedUrl);
  assert.equal(request.origin + request.pathname, "https://buffaloprojects.com/api/jobs");
  assert.equal(request.searchParams.get("q"), "software engineer");
  assert.equal(request.searchParams.get("opportunityKind"), "job");
  assert.equal(request.searchParams.get("sector"), "technology");
  assert.equal(request.searchParams.get("workMode"), "hybrid");
  assert.equal(request.searchParams.get("minPay"), "90000");
  assert.equal(request.searchParams.get("limit"), "7");
  assert.equal(result.jobs[0]?.provider, "buffalo-projects-job-board");
  assert.equal(result.jobs[0]?.applyUrl, "https://careers.example.com/jobs/job-1/apply");
  assert.equal(result.coverage.activePostingCount, 784);
});

test("resolves selected board IDs across pages and preserves selection order", async () => {
  const requestedUrls: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    requestedUrls.push(url);
    const cursor = new URL(url).searchParams.get("cursor");
    return Response.json(
      cursor
        ? payload([rawJob("wanted")], { nextCursor: null, hasMore: false })
        : payload([rawJob("other")], { nextCursor: "page-two", hasMore: true, totalMatching: 2 }),
    );
  }) as typeof fetch;

  const jobs = await resolveLiveJobs(["wanted"], fetcher);

  assert.equal(jobs[0]?.id, "wanted");
  assert.equal(requestedUrls.length, 2);
  assert.equal(new URL(requestedUrls[1]!).searchParams.get("cursor"), "page-two");
});

test("rejects stale IDs instead of applying to a guessed listing", async () => {
  const fetcher = (async () =>
    Response.json(payload([], { nextCursor: null, hasMore: false }))) as typeof fetch;

  await assert.rejects(
    resolveLiveJobs(["stale-job"], fetcher),
    /no longer in the active index/,
  );
});
