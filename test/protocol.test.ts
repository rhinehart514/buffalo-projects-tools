import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBuffaloServer } from "../src/server.js";

test("exposes the complete workflow through MCP", async (context) => {
  const fetcher = (async () =>
    Response.json({
      jobs: [
        {
          id: "job-1",
          externalId: "1",
          sourceId: "source-1",
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
          url: "https://careers.example.com/jobs/1",
          applicationUrl: "https://apply.example.com/jobs/1",
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
          source: {
            organization: "Example Buffalo Company",
            sourceUrl: "https://careers.example.com",
            careersUrl: "https://careers.example.com",
            platform: "example",
            verifiedAt: "2026-08-12",
          },
        },
      ],
      pagination: {
        limit: 20,
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
    })) as typeof fetch;
  const server = createBuffaloServer({ fetcher });
  const client = new Client({ name: "buffalo-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  context.after(async () => {
    await client.close();
    await server.close();
  });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name).sort(),
    [
      "buffalo.build_candidate_passport",
      "buffalo.get_opportunity",
      "buffalo.prepare_job_applications",
      "buffalo.prepare_registration",
      "buffalo.review_job_application",
      "buffalo.review_submission",
      "buffalo.search_jobs",
      "buffalo.search_opportunities",
    ],
  );

  const result = await client.callTool({
    name: "buffalo.search_opportunities",
    arguments: {
      description: "A Buffalo startup building climate software",
      goal: "accelerator and mentoring",
      kinds: ["accelerator"],
    },
  });
  const first = (
    result as { content: Array<{ type: string; text?: string }> }
  ).content[0];
  assert.equal(first?.type, "text");
  if (first?.type !== "text" || typeof first.text !== "string") {
    throw new Error("Expected text tool output");
  }
  const payload = JSON.parse(first.text) as {
    notice: string;
    matches: Array<{ id: string }>;
  };

  assert.match(payload.notice, /not eligibility decisions/);
  assert.ok(payload.matches.some((match) => match.id === "launch-ny"));

  const jobsResult = await client.callTool({
    name: "buffalo.search_jobs",
    arguments: { query: "software engineer", limit: 5 },
  });
  const jobsText = (
    jobsResult as { content: Array<{ type: string; text?: string }> }
  ).content[0]?.text;
  assert.ok(jobsText);
  const jobsPayload = JSON.parse(jobsText!) as {
    jobs: Array<{ id: string }>;
  };
  assert.deepEqual(jobsPayload.jobs.map((job) => job.id), ["job-1"]);

  const passportResult = await client.callTool({
    name: "buffalo.build_candidate_passport",
    arguments: {
      candidate: {
        fullName: "Example Candidate",
        email: "candidate@example.com",
        phone: "+1 716 555 0100",
        resumePath: "/tmp/resume.pdf",
        workAuthorized: "Yes",
        needsSponsorship: "No",
      },
      factsConfirmedByUser: true,
    },
  });
  const passportText = (
    passportResult as { content: Array<{ type: string; text?: string }> }
  ).content[0]?.text;
  assert.ok(passportText);
  const passport = JSON.parse(passportText!);

  const preparedResult = await client.callTool({
    name: "buffalo.prepare_job_applications",
    arguments: { jobIds: ["job-1"], passport },
  });
  const preparedText = (
    preparedResult as { content: Array<{ type: string; text?: string }> }
  ).content[0]?.text;
  assert.ok(preparedText);
  const prepared = JSON.parse(preparedText!) as { applications: unknown[] };
  assert.equal(prepared.applications.length, 1);

  const prompts = await client.listPrompts();
  assert.ok(prompts.prompts.some((prompt) => prompt.name === "register-in-buffalo"));
  assert.ok(prompts.prompts.some((prompt) => prompt.name === "apply-to-buffalo-jobs"));
});
