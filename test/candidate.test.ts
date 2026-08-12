import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCandidatePassport,
  matchCandidateAnswers,
  prepareJobApplications,
  rememberCandidateAnswers,
  reviewJobApplication,
} from "../src/candidate.js";
import type { LiveJob } from "../src/jobs.js";

const job: LiveJob = {
  id: "job-1",
  externalId: "1",
  sourceId: "source-1",
  provider: "buffalo-projects-job-board",
  employer: "Example Buffalo Company",
  title: "Software Engineer",
  location: "Buffalo, NY, USA",
  workplace: "hybrid",
  commitment: "full_time",
  department: "technology",
  salary: "USD 90,000–120,000 year",
  compensation: {
    original: null,
    currency: "USD",
    min: 90000,
    max: 120000,
    period: "year",
    provenance: "disclosed",
    annualMin: 90000,
    annualMax: 120000,
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

function confirmedPassport() {
  return buildCandidatePassport({
    candidate: {
      fullName: "Example Candidate",
      email: "candidate@example.com",
      phone: "+1 716 555 0100",
      city: "Buffalo",
      stateOrRegion: "NY",
      country: "USA",
      linkedIn: "https://www.linkedin.com/in/example",
      resumePath: "/tmp/example-resume.pdf",
      workAuthorized: "Yes",
      needsSponsorship: "No",
      skills: ["TypeScript", "Product engineering"],
      workHistory: [
        {
          employer: "Previous Company",
          title: "Engineer",
          startDate: "2023-01",
          current: true,
          responsibilities: ["Shipped customer-facing software"],
        },
      ],
    },
    evidence: [{ kind: "resume", localPath: "/tmp/example-resume.pdf" }],
    factsConfirmedByUser: true,
  });
}

test("builds a confirmed local passport with structured employment facts", () => {
  const passport = confirmedPassport();

  assert.equal(passport.readiness.status, "ready");
  assert.equal(passport.portability.persisted, false);
  assert.ok(
    passport.claims.some(
      (claim) =>
        claim.key === "candidate.workHistory.1.employer" &&
        claim.source === "user-confirmed",
    ),
  );
  assert.match(passport.excludedFromPassport.join(" "), /race/);
});

test("asks once for missing material facts and never upgrades unconfirmed input", () => {
  const passport = buildCandidatePassport({
    candidate: { fullName: "Model Inferred Person" },
  });

  assert.equal(passport.readiness.status, "needs-confirmation");
  assert.ok(passport.readiness.missingQuestions.some((question) => question.id === "resume"));
  assert.ok(passport.claims.every((claim) => claim.source === "unverified-input"));
});

test("resume evidence requires one confirmation pass before application use", () => {
  const passport = buildCandidatePassport({
    candidate: {
      fullName: "Resume Candidate",
      email: "resume@example.com",
      phone: "+1 716 555 0100",
      resumePath: "/tmp/resume.pdf",
      workAuthorized: "Yes",
      needsSponsorship: "No",
    },
    candidateFactsSource: "resume-evidence",
  });

  assert.equal(passport.readiness.status, "needs-confirmation");
  assert.ok(
    passport.readiness.missingQuestions.some(
      (question) => question.id === "confirm-resume-facts",
    ),
  );
  assert.ok(passport.claims.every((claim) => claim.source === "resume-evidence"));
});

test("matches remembered answers only within their confirmed scope", () => {
  const passport = rememberCandidateAnswers({
    passport: confirmedPassport(),
    answers: [
      {
        question: "Are you willing to relocate?",
        answer: "Yes",
        sensitivity: "material",
        scope: "employer",
        employer: "Example Buffalo Company",
        confirmedByUser: true,
      },
    ],
  });

  assert.equal(
    matchCandidateAnswers(passport, ["Are you willing to relocate?"], {
      employer: "Example Buffalo Company",
    })[0]?.status,
    "remembered",
  );
  assert.equal(
    matchCandidateAnswers(passport, ["Are you willing to relocate?"], {
      employer: "Different Company",
    })[0]?.status,
    "needs-answer",
  );
});

test("prepares one official browser handoff per selected Buffalo Projects job", () => {
  const set = prepareJobApplications({ passport: confirmedPassport(), jobs: [job, job] });

  assert.equal(set.applications.length, 1);
  assert.deepEqual(set.applications[0]?.browserHandoff.allowedOrigins.sort(), [
    "https://apply.example.com",
    "https://careers.example.com",
  ]);
  assert.equal(set.approval.batchSubmitAllowed, false);
  assert.match(set.sharedQuestionPass.instruction, /deduplicated question set/);
});

test("blocks lookalike destinations and voluntary demographic auto-answers", () => {
  const review = reviewJobApplication({
    job,
    destinationUrl: "https://lookalike.example/jobs/1",
    fields: [
      {
        label: "Race / ethnicity",
        value: "Assistant selected an answer",
        source: "generated-draft",
      },
    ],
  });

  assert.equal(review.decision, "blocked");
  assert.equal(review.destination.allowed, false);
  assert.deepEqual(review.review.demographicFields, ["Race / ethnicity"]);
  assert.equal(review.requiresFinalSubmitConfirmation, true);
});
