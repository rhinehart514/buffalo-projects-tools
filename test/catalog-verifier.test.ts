import assert from "node:assert/strict";
import test from "node:test";
import { getOpportunity, opportunities, opportunitySchema, type Opportunity } from "../src/catalog.js";
import {
  catalogVerification,
  catalogVerificationReportSchema,
  verificationFor,
} from "../src/catalog-evidence.js";
import {
  compareToCatalog,
  groundExtraction,
  htmlToText,
  patternExtractor,
  statedDates,
  verifyCatalog,
  verifyOpportunity,
  type AvailabilityExtractor,
} from "../src/catalog-verifier.js";

const program = (availability: Partial<Opportunity["availability"]> = {}): Opportunity => {
  const base = getOpportunity("ub-cultivator")!;
  return { ...base, availability: { ...base.availability, ...availability } };
};

const page = (body: string) =>
  `<!DOCTYPE html><html><head><title>t</title><script>var closed = "applications are closed";</script></head>
  <body><nav>Apply now. Applications are closed.</nav><main>${body}</main><footer>© 2026</footer></body></html>`;

function htmlFetcher(routes: Record<string, string | number | Error>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const route = routes[String(input)];
    if (route instanceof Error) throw route;
    if (typeof route === "number") return new Response("gone", { status: route });
    if (route === undefined) return new Response("missing", { status: 404 });
    return new Response(route, { headers: { "content-type": "text/html" } });
  }) as typeof fetch;
}

test("reads dates without inventing a year", () => {
  assert.deepEqual(
    statedDates("Applications due March 15, 2027. Deadline: Oct 1st. Posted 7/20/26. Spring 2026.").map(
      (date) => date.value,
    ),
    ["2027-03-15", "--10-01", "2026-07-20"],
  );
  assert.deepEqual(statedDates("May 2026 and 13/40/2026"), []);
});

test("page text drops scripts, navigation, and footers and decodes entities", () => {
  const text = htmlToText(page("<p>Cultivator&rsquo;s cohort &amp; mentors</p>"));
  assert.match(text, /Cultivator’s cohort & mentors/u);
  assert.doesNotMatch(text, /closed|DOCTYPE|2026/u);
});

test("pattern reader finds status, deadline, and cohort statements with exact quotes", async () => {
  const text = htmlToText(
    page(`
      <h2>How to apply</h2>
      <p>Applications are accepted on a rolling basis. The deadline for the spring cohort is January 30, 2027.</p>
      <p>The next cohort kicks off on February 9, 2027.</p>
      <p>We are not currently accepting applications for the summer program.</p>
      <p>When applications open we will email you.</p>`),
  );
  const extraction = await patternExtractor.extract({ url: "https://example.org", text });
  assert.deepEqual(
    extraction.status.map((finding) => [finding.value, finding.quote]),
    [
      ["rolling", "Applications are accepted on a rolling basis."],
      ["closed", "We are not currently accepting applications for the summer program."],
    ],
  );
  assert.deepEqual(extraction.deadlines, [
    { value: "2027-01-30", quote: "The deadline for the spring cohort is January 30, 2027." },
  ]);
  assert.deepEqual(extraction.cohortDates, [
    { value: "2027-02-09", quote: "The next cohort kicks off on February 9, 2027." },
  ]);
  const grounded = groundExtraction(extraction, text);
  assert.equal(grounded.rejections.length, 0);
});

test("fabricated or mismatched findings are rejected and counted", () => {
  const text = "Applications are accepted on a rolling basis. Applications are due March 1, 2027.";
  const grounded = groundExtraction(
    {
      status: [
        { value: "rolling", quote: "Applications are accepted on a rolling basis." },
        // On the page, but does not say closed.
        { value: "closed", quote: "Applications are accepted on a rolling basis." },
        // Not on the page at all.
        { value: "open", quote: "Applications are now open!" },
      ],
      deadlines: [
        { value: "2027-03-01", quote: "Applications are due March 1, 2027." },
        // Quote is real but states a different date.
        { value: "2027-04-01", quote: "Applications are due March 1, 2027." },
        // Quote writes the date but never says it is a deadline.
        { value: "2027-03-01", quote: "March 1, 2027" },
      ],
      cohortDates: [{ value: "2027-05-01", quote: "Cohort starts May 1, 2027." }],
    },
    text,
  );
  assert.deepEqual(grounded.accepted.status.map((finding) => finding.value), ["rolling"]);
  assert.deepEqual(grounded.accepted.deadlines.map((finding) => finding.value), ["2027-03-01"]);
  assert.deepEqual(grounded.accepted.cohortDates, []);
  assert.equal(grounded.rejections.length, 5);
  assert.match(grounded.rejections.join("\n"), /status open: quote is not on the page/u);
  assert.match(grounded.rejections.join("\n"), /deadline 2027-04-01: quote does not state it/u);
});

test("a model-backed extractor cannot smuggle an invented deadline into the report", async () => {
  const hallucinating: AvailabilityExtractor = {
    name: "fake-model",
    async extract() {
      return {
        status: [{ value: "closed", quote: "Applications closed on June 1, 2026." }],
        deadlines: [{ value: "2026-11-15", quote: "Applications are due November 15, 2026." }],
        cohortDates: [],
      };
    },
  };
  const { entry, rejections } = await verifyOpportunity(program(), {
    fetcher: htmlFetcher({
      [program().officialUrl]: page("<p>Cultivator is accepting applications on a rolling basis.</p>"),
      [program().registration.startUrl]: page("<form>Apply</form>"),
    }),
    extractor: hallucinating,
    now: new Date("2026-09-25T12:00:00Z"),
  });
  assert.equal(rejections.length, 2);
  assert.equal(entry.rejectedFindingCount, 2);
  assert.deepEqual(entry.evidence, []);
  assert.deepEqual(entry.drift, []);
  assert.deepEqual(entry.observed, { status: "unknown", deadline: null });
});

test("compares grounded findings to the catalog and names the drift", () => {
  const url = "https://example.org/program";
  const closed = compareToCatalog(
    program({ status: "rolling" }),
    { status: [{ value: "closed", quote: "Applications are closed." }], deadlines: [], cohortDates: [] },
    url,
    "2026-09-25",
  );
  assert.deepEqual(closed.drift.map((drift) => drift.kind), ["closed"]);

  const moved = compareToCatalog(
    program({ status: "open", deadline: "2026-10-15" }),
    {
      status: [{ value: "open", quote: "Applications are open." }],
      deadlines: [{ value: "2026-11-01", quote: "Deadline: November 1, 2026" }],
      cohortDates: [],
    },
    url,
    "2026-09-25",
  );
  assert.deepEqual(moved.drift.map((drift) => drift.kind), ["deadline-unconfirmed", "deadline-changed"]);
  assert.equal(moved.observed.deadline, "2026-11-01");

  const confirmed = compareToCatalog(
    program({ status: "open", deadline: "2026-10-15" }),
    {
      status: [{ value: "open", quote: "Applications are open." }],
      deadlines: [{ value: "--10-15", quote: "Applications due October 15" }],
      cohortDates: [],
    },
    url,
    "2026-09-25",
  );
  assert.deepEqual(confirmed.drift, []);
  assert.equal(confirmed.observed.deadline, "--10-15");

  const passed = compareToCatalog(
    program({ status: "open", deadline: "2026-09-01" }),
    { status: [], deadlines: [], cohortDates: [] },
    url,
    "2026-09-25",
  );
  assert.deepEqual(passed.drift.map((drift) => drift.kind), ["deadline-passed"]);

  const conflict = compareToCatalog(
    program({ status: "rolling" }),
    {
      status: [
        { value: "rolling", quote: "Accepted on a rolling basis." },
        { value: "closed", quote: "Applications are closed." },
      ],
      deadlines: [],
      cohortDates: [],
    },
    url,
    "2026-09-25",
  );
  assert.deepEqual(conflict.drift.map((drift) => drift.kind), ["status-conflict"]);
  assert.equal(conflict.observed.status, "unknown");
});

test("dead, denied, and unreachable links are drift; lastVerified carries forward", async () => {
  const now = new Date("2026-09-25T12:00:00Z");
  const official = program().officialUrl;
  const registration = program().registration.startUrl;
  const healthy = await verifyOpportunity(program(), {
    fetcher: htmlFetcher({
      [official]: page("<p>Cultivator is accepting applications on a rolling basis.</p>"),
      [registration]: page("<form>Apply</form>"),
    }),
    now,
  });
  assert.equal(healthy.entry.lastVerified, "2026-09-25");
  assert.deepEqual(healthy.entry.evidence, [
    {
      field: "status",
      value: "rolling",
      quote: "Cultivator is accepting applications on a rolling basis.",
      url: official,
    },
  ]);

  const previous = catalogVerificationReportSchema.parse({
    version: "buffalo-catalog-verification/v1",
    generatedAt: now.toISOString(),
    extractor: "pattern/v1",
    entries: [healthy.entry],
  });
  const later = new Date("2026-10-25T12:00:00Z");
  const cases: Array<[string | number | Error, string]> = [
    [404, "dead-link"],
    [403, "access-denied"],
    [503, "unreachable"],
    [new TypeError("fetch failed"), "unreachable"],
  ];
  for (const [route, kind] of cases) {
    const { entry } = await verifyOpportunity(program(), {
      fetcher: htmlFetcher({ [official]: route, [registration]: page("<form>Apply</form>") }),
      previous,
      now: later,
    });
    assert.deepEqual(entry.drift.map((drift) => drift.kind), [kind]);
    assert.equal(entry.lastVerified, "2026-09-25", `${kind} keeps the last good date`);
    assert.deepEqual(entry.evidence, []);
  }

  const deadForm = await verifyOpportunity(program(), {
    fetcher: htmlFetcher({
      [official]: page("<p>Cultivator is accepting applications on a rolling basis.</p>"),
      [registration]: 410,
    }),
    now: later,
  });
  assert.deepEqual(deadForm.entry.drift.map((drift) => [drift.kind, drift.url]), [["dead-link", registration]]);
});

test("redirects to a different page are reported", async () => {
  const official = program().officialUrl;
  const fetcher = (async (input: string | URL | Request) => {
    const response = new Response(page("<p>Moved.</p>"), { headers: { "content-type": "text/html" } });
    if (String(input) === official) {
      Object.defineProperty(response, "url", { value: "https://www.buffalo.edu/partnerships.html" });
    }
    return response;
  }) as typeof fetch;
  const { entry } = await verifyOpportunity(program(), { fetcher });
  assert.deepEqual(entry.drift.map((drift) => drift.kind), ["redirected"]);
});

test("the shipped report is valid, covers every catalog entry, and is surfaced to MCP users", async () => {
  for (const opportunity of opportunities) opportunitySchema.parse(opportunity);
  assert.deepEqual(
    catalogVerification.entries.map((entry) => entry.id).sort(),
    opportunities.map((opportunity) => opportunity.id).sort(),
  );
  for (const entry of catalogVerification.entries) {
    for (const evidence of entry.evidence) {
      assert.ok(evidence.quote.length > 0 && evidence.url.startsWith("https://"));
    }
  }
  const view = verificationFor(getOpportunity("ub-cultivator")!);
  assert.ok(["no-drift", "drift"].includes(view.state));
  assert.equal(
    verificationFor({ ...program(), id: "not-in-report" }).state,
    "never-verified",
  );

  const { report } = await verifyCatalog([program()], {
    fetcher: htmlFetcher({}),
    now: new Date("2026-09-25T12:00:00Z"),
  });
  assert.equal(report.entries[0]!.drift[0]!.kind, "dead-link");
});
