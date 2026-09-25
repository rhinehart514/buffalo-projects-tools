import assert from "node:assert/strict";
import test from "node:test";
import { buildCandidatePassport } from "../src/candidate.js";
import { verifyJobFit, verifyQuotedMatches } from "../src/fit.js";
import type { LiveJob } from "../src/jobs.js";

const listing = {
  id: "job-1",
  employer: "Example Health",
  title: "Data Analyst",
  location: "Buffalo, NY",
  officialJobUrl: "https://careers.example.com/jobs/1",
} as LiveJob;

const resumeText = [
  "Example Candidate",
  "Analyst, Erie Clinic (2022–present)",
  "• Built weekly SQL dashboards for 14 clinic managers",
].join("\n");

const description =
  "We need someone who can build SQL reporting for clinic operations teams. Experience with Tableau preferred.";

test("keeps fit claims whose quotes are in both sources, drops and counts the rest", () => {
  const result = verifyJobFit({
    resumeText,
    job: listing,
    jobDescriptionText: description,
    matches: [
      {
        claim: "Has built the SQL reporting this role needs",
        candidateQuote: "Built weekly SQL dashboards for 14 clinic managers",
        jobQuote: "build SQL reporting for clinic operations teams",
      },
      {
        claim: "Knows Tableau",
        candidateQuote: "Built Tableau dashboards",
        jobQuote: "Experience with Tableau preferred.",
      },
      {
        claim: "Meets the certification requirement",
        candidateQuote: "Built weekly SQL dashboards for 14 clinic managers",
        jobQuote: "Certified Health Data Analyst required",
      },
    ],
  });

  assert.equal(result.proposedCount, 3);
  assert.deepEqual(
    result.verifiedMatches.map((match) => match.claim),
    ["Has built the SQL reporting this role needs"],
  );
  assert.equal(result.droppedCount, 2);
  assert.deepEqual(result.dropped, [
    { index: 1, reasons: ["candidateQuote is not in the candidate's resume or passport"] },
    { index: 2, reasons: ["jobQuote is not in the job description or listing"] },
  ]);
  // Dropped claims are reported by index and reason only, never by content.
  assert.doesNotMatch(JSON.stringify(result.dropped), /Tableau|Certified/);
});

test("the listing title counts as job text; unconfirmed passport claims do not count as candidate text", () => {
  const unconfirmed = buildCandidatePassport({
    candidate: { skills: ["Tableau"] },
    candidateFactsSource: "unverified-input",
  });
  const confirmed = buildCandidatePassport({
    candidate: { skills: ["Tableau"] },
    factsConfirmedByUser: true,
  });
  const match = {
    claim: "Tableau experience",
    candidateQuote: "Tableau",
    jobQuote: "Data Analyst",
  };
  const input = { job: listing, jobDescriptionText: description, matches: [match] };
  assert.equal(verifyJobFit({ ...input, passport: unconfirmed }).droppedCount, 1);
  assert.equal(verifyJobFit({ ...input, passport: confirmed }).droppedCount, 0);
});

test("a stated term must appear in both quotes", () => {
  const result = verifyQuotedMatches(
    [
      { claim: "SQL", term: "sql", candidateQuote: "weekly SQL dashboards", jobQuote: "build SQL reporting" },
      { claim: "Python", term: "python", candidateQuote: "weekly SQL dashboards", jobQuote: "build SQL reporting" },
    ],
    { candidate: resumeText, job: description },
  );
  assert.equal(result.verified.length, 1);
  assert.deepEqual(result.dropped, [{ index: 1, reasons: ['term "python" is not in both quotes'] }]);
});
