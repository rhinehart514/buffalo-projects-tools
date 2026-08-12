import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareRegistration,
  reviewSubmission,
} from "../src/registration.js";

test("prepares a host-neutral browser handoff without claiming submission", () => {
  const packet = prepareRegistration({
    opportunityId: "launch-ny",
    project: {
      name: "Lake Effect Labs",
      summary: "Software that helps local manufacturers schedule shared equipment.",
      stage: "prototype",
      location: "Buffalo, NY",
      website: "https://example.com",
      traction: "Three manufacturers completed discovery interviews.",
      evidenceUrls: ["https://example.com/demo"],
    },
    applicant: {
      fullName: "Example Founder",
      email: "founder@example.com",
    },
    factsConfirmedByUser: true,
  });

  assert.equal(packet.status, "ready-to-inspect-live-form");
  assert.equal(
    packet.browserHandoff.capability,
    "host-provided-browser-or-computer-use",
  );
  assert.ok(
    packet.browserHandoff.allowedOrigins.includes("https://forms.office.com"),
  );
  assert.match(packet.browserHandoff.fallbackWithoutBrowser, /Do not claim/);
  assert.ok(
    packet.browserHandoff.instructions.some((instruction) =>
      instruction.includes("Never click the final submit"),
    ),
  );
  assert.deepEqual(packet.personalDataIncluded.sort(), ["email", "fullName"]);
});

test("blocks an unapproved destination and unsupported generated claims", () => {
  const review = reviewSubmission({
    opportunityId: "ub-cultivator",
    destinationUrl: "https://lookalike.example/apply",
    fields: [
      {
        label: "Annual revenue",
        value: "$1 million",
        source: "generated-draft",
      },
    ],
  });

  assert.equal(review.decision, "blocked");
  assert.equal(review.destination.allowed, false);
  assert.deepEqual(review.review.unsupportedFields, ["Annual revenue"]);
  assert.equal(review.requiresFinalSubmitConfirmation, true);
});

test("flags sensitive data and certifications for point-of-action review", () => {
  const review = reviewSubmission({
    opportunityId: "launch-ny",
    destinationUrl: "https://forms.office.com/r/example",
    fields: [
      {
        label: "Applicant email",
        value: "founder@example.com",
        source: "user-confirmed",
      },
      {
        label: "Tax ID",
        value: "00-0000000",
        source: "user-confirmed",
      },
      {
        label: "I certify this is accurate",
        value: "Yes",
        source: "user-confirmed",
      },
    ],
  });

  assert.equal(review.decision, "ready-for-user-review");
  assert.deepEqual(review.review.highlySensitiveFields, ["Tax ID"]);
  assert.deepEqual(review.review.commitmentFields, [
    "I certify this is accurate",
  ]);
  assert.match(review.approvalPrompt, /explicit final-submit approval/);
});

test("does not relabel unconfirmed model input as user fact", () => {
  const packet = prepareRegistration({
    opportunityId: "ub-cultivator",
    project: {
      name: "Inferred Venture",
      summary: "A description assembled by an assistant.",
    },
  });

  assert.equal(packet.status, "needs-fact-confirmation");
  assert.ok(
    packet.candidateAnswers.every(
      (answer) => answer.source === "unverified-input",
    ),
  );
  assert.ok(
    packet.missingBeforeForm.includes(
      "user confirmation that the packet facts are accurate",
    ),
  );
});
