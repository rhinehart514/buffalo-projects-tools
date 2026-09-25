import assert from "node:assert/strict";
import test from "node:test";
import { opportunities } from "../src/catalog.js";
import { searchOpportunities } from "../src/matcher.js";

test("catalog ids and official routes are internally safe", () => {
  assert.equal(new Set(opportunities.map((item) => item.id)).size, opportunities.length);

  for (const opportunity of opportunities) {
    assert.equal(new URL(opportunity.officialUrl).protocol, "https:");
    assert.ok(
      opportunity.registration.allowedOrigins.includes(
        new URL(opportunity.registration.startUrl).origin,
      ),
      `${opportunity.id} start URL is allowlisted`,
    );
    assert.match(opportunity.reviewedAt, /^2026-\d{2}-\d{2}$/u);
    assert.ok(["open", "closed", "rolling", "unknown"].includes(opportunity.availability.status));
    assert.match(opportunity.caution, /not an eligibility determination/);
  }
});

test("matches scalable startups to the two guided accelerator forms", () => {
  const matches = searchOpportunities({
    description:
      "A Buffalo founder building a scalable software startup with a working prototype",
    goal: "mentoring, customer discovery, and seed capital",
    stage: "prototype",
    kinds: ["accelerator"],
    limit: 4,
  });
  const ids = matches.map((match) => match.opportunity.id);

  assert.ok(ids.includes("launch-ny"));
  assert.ok(ids.includes("ub-cultivator"));
  assert.equal(matches[0]?.opportunity.registration.mode, "browser-form");
});

test("returns useful Buffalo starting points for a sparse description", () => {
  const matches = searchOpportunities({
    description: "I run a neighborhood shop",
    limit: 3,
  });

  assert.equal(matches.length, 3);
  assert.ok(matches.every((match) => match.opportunity.officialUrl.startsWith("https://")));
});
