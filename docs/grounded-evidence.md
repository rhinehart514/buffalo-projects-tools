# Grounded evidence build log

Raw material for the typesafe dev blog, continuing the Buffalo Projects typed
ingestion log. Each entry records the problem, the evidence, the decision, and
the numbers.

## Thesis

Every claim carries the exact source text that states it, and code checks that
text exists. In this repo, that rule applies in two places:

1. **Program availability.** "UB Cultivator takes applications on a rolling
   basis" must quote the official page.
2. **Job fit.** "You match because you built SQL dashboards" must quote the
   candidate's resume and the job description.

A claim that fails the check is dropped and counted. It is never shown.

## Starting state (2026-09-25)

- **Catalog.** 11 programs hard-coded as a TypeScript interface in `src/catalog.ts`.
  - `availability.state` mixed a status (`rolling`) with a kind of page
    (`directory`, `public-site`).
  - `reviewedAt` was the only freshness signal.
  - Nothing checked whether the official pages still said what the catalog said.
- **Ranking.**
  - `rank_jobs` gave reasons as bare strings, e.g. `candidate skill appears in
    listing metadata: java`.
  - Skill matching used substring search.
  - `supportingClaimKeys` listed any passport claim that shared a word with the
    listing, including contact details.
- **Materials.** `review_application_materials` checked that evidence keys
  existed in the passport. It never checked that the tailored claim or the job
  requirement it answered came from real text.
- **LLMs.** None. The README promises "No OpenAI or Anthropic API key", and the
  MCP host is the only model involved.

## Entry 1: should this repo call an LLM at all?

**Decision: no.** Extraction is deterministic and sits behind an interface. A
model can plug in later without touching anything else.

**Reasons.**
- **No client exists.** Adding one means a new dependency, an API key, and a
  second vendor. That would break the README's no-key promise.
- **Privacy.** This is a local stdio server. The host model already reads the
  resume, so a second model call would add a second place candidate data goes.
  For job fit, the host model proposes the claims and this server checks them
  with code. That keeps candidate text on the host channel it already uses.
- **The pages don't need a model.** The live run (entry 3) found that official
  program pages rarely state a status or deadline at all. When they do, the
  wording is short and predictable ("accepting applications on a rolling
  basis"). A pattern reader handles that, and its quotes are, by construction,
  exact page text.

**Design.**
- `AvailabilityExtractor { name; extract({ url, text }) }` is the seam.
- `patternExtractor` (`pattern/v1`) is the default.
- A model-backed reader implements the same interface. It would use the web
  repo's pattern: return `{ value, quote }` from a zod schema and cache by
  content hash.
- Every extractor's output goes through `groundExtraction`, which drops
  anything the page doesn't support. The fake-model test already exercises this
  path.

## Entry 2: the contract

**`opportunitySchema` (zod).**
- `availability.status` is one of `open`, `closed`, `rolling`, `unknown`.
- `availability.deadline` is an ISO date or null.
- The registration start URL must be on an allowed origin (a `refine`).
- The catalog array is parsed at module load, so a bad entry fails the build.

**`catalogVerificationReportSchema` (zod).** One entry per program:
- the HTTP status and final URL of each page;
- the observed status and deadline;
- quoted evidence (`field`, `value`, `quote`, `url`);
- the number of rejected findings;
- drift items: `dead-link`, `access-denied`, `unreachable`, `redirected`,
  `closed`, `status-changed`, `status-conflict`, `deadline-changed`,
  `deadline-passed`, `deadline-unconfirmed`.

**`lastVerified`** is the last day the official page loaded and contradicted
nothing in the catalog.
- It lives in the machine-written report, not in the hand-kept catalog, so the
  verifier never rewrites human-reviewed TypeScript.
- A failed run carries the previous date forward. A 503 today does not erase
  the fact that the page matched last month (the same retention idea as the web
  repo's jobs).

**What code checks before a finding counts:**
- **Status.** The quote is on the page and uses that status's own words:
  "rolling", "year-round", or "any time" for `rolling`; "closed", "no longer",
  or "not accepting" for `closed`.
- **Dates.** The quote writes that exact date.
- **Deadlines.** The quote also uses a deadline word.

**Dates never gain a year the page didn't write.**
- "Deadline: Oct 1" becomes `--10-01` (the ISO 8601 form for a month and day
  with no year), not `2026-10-01`.
- A year-less date matches a catalog deadline on month and day.
- `deadline-passed` is computed only from full dates.

This is the same lesson as the web repo's "third Wednesday": the model, or the
regex, reads; code does the arithmetic; nothing is invented in between.

## Entry 3: the live run

Run `pnpm catalog:verify` on 2026-09-25 against the real pages:

| Metric | Value |
|---|---|
| Catalog entries | 11 |
| URLs fetched | 12 (11 official + UB Cultivator's Formstack form) |
| Wall time | 7.4 s, all in parallel |
| HTTP 200 | 11 of 12 |
| Drift | 1 entry |
| Grounded status findings | 2, both "rolling", both on UB Cultivator |
| Grounded deadlines / cohort dates | 0 / 0 |
| Rejected findings | 0 |
| Page text after cleanup | 580 chars (Erie procurement) to 15,117 (UB Cultivator) |

**The drift.**
- The City of Buffalo Business Assistance Grant press page on `www3.erie.gov`
  returns **HTTP 403** with a Drupal "Access denied" page.
- A browser user agent gets the same 403, so this isn't bot blocking. It looks
  like the node was unpublished.
- The entry now ships with `verification.state: "drift"` and `access-denied`,
  so an MCP user sees it before being sent there.
- Removing or replacing the entry is a human call.

**The two quotes (UB Cultivator):**
- "Applications remain open on a rolling basis, with deadlines announced for
  future cohorts."
- "Cultivator is accepting applications on a rolling basis."

**What the verifier changed in the catalog.**
- Converting `availability.state` to a status first produced five `rolling`
  claims: two old `rolling`/`public-site` programs plus portals.
- Only one of the five had page text saying so.
- The other four (Launch NY, the permits portal, Sell to Erie County, NYS
  Contract Reporter) were set to `unknown`, and their human notes are unchanged.
- The catalog now makes 1 status claim, and that one is quoted.

**Blog angle.** The first thing grounding did was delete claims, not add them.
Four of five "rolling" labels were my own inference from what kind of page it
was. The page never said "rolling". `unknown` plus a note is more honest than a
confident enum.

## Entry 4: gotchas from real pages

- **Doctype as text.** `node-html-parser` keeps `<!DOCTYPE html>` and
  `<?xml …?>` as text nodes, so the Launch NY page text began with
  "<!doctype html> Apply Now". They are stripped before parsing.
- **JavaScript-rendered forms.** UB Cultivator's Formstack form returns 200
  with 0 characters of text. The check can prove the link works, but it can't
  read the form. The report shows `characterCount: 0` instead of pretending.
- **Dates that aren't deadlines.** The UB Cultivator page repeats "7/20/26" on
  at least 18 lines (news and event items). Without a deadline word in the same
  sentence, they are ignored, which is correct.
- **403 is not 404.** 401 and 403 are `access-denied`. 404, 410, other 4xx, and
  DNS failures are `dead-link`. 5xx, 429, and timeouts are `unreachable`. A
  transient failure must not read as "the program is gone".
- **"When applications open".** The `open` pattern has a negative lookbehind
  for when, once, until, before, and after. Otherwise the future tense counts
  as open now.
- **Dependency.** `node-html-parser` (types bundled, 2 dependencies) is a
  **dev** dependency. Only the verifier imports it, and the shipped server
  bundle doesn't contain it (0 occurrences in `dist/index.js`). PDF text reuses
  `pdf-parse`, which is already a dependency, for the Erie microenterprise
  flyer.

## Entry 5: quoted resume-to-job matches

**Where claims come from, and what each must quote:**

| Surface | Claims come from | candidateQuote must be in | jobQuote must be in |
|---|---|---|---|
| `rank_jobs` | Code (word overlap) | Passport desired roles, skills, ordinary evidence claims | The listing field (title, employer, location, sector, …) |
| `buffalo.verify_job_fit` (new) | The host model | Resume text and/or evidence-backed passport claims | Live job description + title/employer/location |
| `review_application_materials` | The host model | Original resume, or the passport claims *this* claim cites | Live job description + listing |

**Shared rules** (in `src/grounding.ts` and `src/fit.ts`):
- `normalizeForQuote` folds NFKC, curly quotes, dashes, bullets, Markdown
  markup, whitespace, and case. It keeps `#` so C# and F# stay distinct.
- Quotes shorter than 3 characters, or with no letter or digit, never count.
- When a match states a `term`, the term must appear as a whole word in both
  quotes.
- Unconfirmed passport claims (`unverified-input`, `generated-draft`) are not
  quotable. Otherwise a model could launder its own draft into evidence.
- Dropped claims are reported by index and reason only, never by content. The
  host can fix a claim without re-displaying it.

**What it caught in this repo:**
- **Name matched employer.** The first ranking test run produced "evidence
  matches the job employer: example". The candidate's *name* "Example
  Candidate" matched "Example Buffalo Company". Contact, authorization, and pay
  claims are no longer fit evidence; only `ordinary` claims are.
- **Substring matching.** The old code scored skill "Java" on "JavaScript
  Developer". Scoring now comes only from verified whole-word matches, so it
  scores 0 and shows no reason.
- **Borrowed evidence.** A material claim that cited the `TypeScript` skill
  key but quoted a work-history bullet is dropped. The candidate quote must come
  from the claims it actually cites, or from the original resume.

**Contract change (no compatibility layer):**
- Material claims now require `candidateQuote` and `jobQuote`.
- `review_application_materials` and `export_approved_materials` require
  `jobDescriptionText`.
- The export manifest stores the verified `evidenceMap` in place of the raw
  proposed claims.
- `rank_jobs` returns `evidenceMatches`, `droppedMatchCount`, and
  `preferenceReasons`, replacing `reasons` and `supportingClaimKeys`.
- There are now 24 tools.

**Privacy.** All checks run in process on text the host already sent. Nothing
is persisted or fetched. The job description is whatever the host read from
the live page.

## Tests

The suite went from 28 to 46 tests. Tests for fabricated quotes:
- A fake model extractor claims "closed" and a November 15 deadline against a
  page that says neither. Both are rejected, counted, and kept out of the
  report.
- Rejected quotes include: a real quote given the wrong status, a real quote
  given the wrong date, a date quote with no deadline word, and a quote that
  isn't on the page.
- Material claims with an invented "team of 12" or an invented "1M people"
  requirement are dropped (2 of 3). The remaining claim passes despite a
  non-breaking hyphen and a line break in its quote.
- `verify_job_fit` keeps 1 of 3 host claims. The protocol journey calls the
  real MCP tool and keeps 1 of 2.

`pnpm check` passes: typecheck, 46 tests, build, and smoke (`tools: 24`).
`pnpm build:mcpb` passes.

**Pre-existing CI issue.** `pnpm audit --prod` reports 19 advisories in
existing runtime dependencies (`@xmldom/xmldom`, `fast-uri`, `hono`, `qs`).
None come from this change, but they will fail that CI step.

## Blog angles

1. **Grounding deletes before it adds.** The verifier's first useful output was
   four catalog claims that no page supported.
2. **Code does the arithmetic.** `--10-01` is an honest date: the page never
   gave a year, so the record doesn't either.
3. **The checker belongs where the data is.** The host model writes the "why
   you match" sentence, and this local server checks it. No second model and no
   second copy of the resume.
4. **A quote check is a bug finder.** Requiring both quotes exposed a name
   matching an employer and "Java" matching "JavaScript". Both bugs had been
   hidden behind reason strings nobody could audit.
