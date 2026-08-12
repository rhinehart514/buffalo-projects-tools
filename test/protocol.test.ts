import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBuffaloServer } from "../src/server.js";

test("exposes the complete workflow through MCP", async (context) => {
  const dataDir = await mkdtemp(join(tmpdir(), "buffalo-protocol-test-"));
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
  const server = createBuffaloServer({ fetcher, dataDir });
  const client = new Client({ name: "buffalo-test", version: "2.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  context.after(async () => {
    await client.close();
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
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
      "buffalo.delete_candidate_profile",
      "buffalo.export_approved_materials",
      "buffalo.get_application_ledger",
      "buffalo.get_opportunity",
      "buffalo.import_resume",
      "buffalo.list_candidate_profiles",
      "buffalo.load_candidate_passport",
      "buffalo.match_candidate_answers",
      "buffalo.prepare_application_materials",
      "buffalo.prepare_job_applications",
      "buffalo.prepare_registration",
      "buffalo.rank_jobs",
      "buffalo.record_application_progress",
      "buffalo.remember_candidate_answers",
      "buffalo.review_application_materials",
      "buffalo.review_job_application",
      "buffalo.review_submission",
      "buffalo.run_job_scout",
      "buffalo.save_candidate_passport",
      "buffalo.save_job_scout",
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

  const resumeRequest = await client.callTool({
    name: "buffalo.import_resume",
    arguments: {},
  });
  const resumeRequestText = (
    resumeRequest as { content: Array<{ type: string; text?: string }> }
  ).content[0]?.text;
  assert.equal(JSON.parse(resumeRequestText!).status, "needs-resume");

  await client.callTool({
    name: "buffalo.save_candidate_passport",
    arguments: {
      profileId: "example",
      label: "Example Candidate",
      passport,
      consentToLocalStorage: true,
    },
  });
  const profilesResult = await client.callTool({
    name: "buffalo.list_candidate_profiles",
    arguments: {},
  });
  const profilesText = (
    profilesResult as { content: Array<{ type: string; text?: string }> }
  ).content[0]?.text;
  assert.equal(JSON.parse(profilesText!).profiles[0].profileId, "example");

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

  const progressResult = await client.callTool({
    name: "buffalo.record_application_progress",
    arguments: {
      profileId: "example",
      jobId: "job-1",
      status: "needs-candidate-action",
      checkpoint: {
        kind: "login",
        currentUrl: "https://apply.example.com/jobs/1/login",
        completedFields: ["Name"],
        remainingFields: ["Resume"],
        instruction: "Sign in and return control.",
      },
    },
  });
  const progressText = (
    progressResult as { content: Array<{ type: string; text?: string }> }
  ).content[0]?.text;
  assert.equal(JSON.parse(progressText!).takeover.status, "candidate-action-needed");

  const prompts = await client.listPrompts();
  assert.ok(prompts.prompts.some((prompt) => prompt.name === "register-in-buffalo"));
  assert.ok(prompts.prompts.some((prompt) => prompt.name === "apply-to-buffalo-jobs"));
  assert.ok(prompts.prompts.some((prompt) => prompt.name === "scout-buffalo-jobs"));
});
