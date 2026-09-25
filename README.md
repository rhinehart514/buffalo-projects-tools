# Buffalo Projects Tools

**One resume. One answer to each question. Every fitting Buffalo job handled
from the AI assistant you already use.**

Buffalo Projects Tools is a free, universal stdio MCP server for Claude, Codex,
and other MCP hosts. It searches the live Buffalo Projects job index, turns an
applicant-provided resume into a reusable evidence-backed passport, prepares and
exports tailored materials, coordinates official employer forms through the
host's browser/computer tools, and keeps an optional local application ledger.

No Buffalo Projects account. No token. No OpenAI or Anthropic API key.

## Use it

Tell your assistant:

> Find the five strongest product engineering jobs for me in Buffalo or remote.
> Use my resume, don't make me browse the job board, and help me apply fully to
> the roles I choose.

The `apply-to-buffalo-jobs` prompt gives a compatible host the full workflow:

1. Use a resume already attached or accessible to the host. If none is
   available, ask once for an upload—never for the applicant to retype it.
2. Read PDF, DOCX, TXT, or Markdown locally. Map only explicit resume facts,
   show the extraction once for corrections, then build the confirmed passport.
3. Search the live [Buffalo Projects jobs index](https://buffaloprojects.com/jobs)
   without sending the applicant to the board UI.
4. Rank a preliminary best-five batch from applicant evidence and preferences.
   Inspect every live employer description before claiming fit.
5. Let the applicant remove roles. Prepare only the jobs they select.
6. Draft a tailored resume and optional cover letter from supported claims,
   attach evidence keys to every material rewrite, and show the diff.
7. After applicant approval, export exact owner-only PDF files for upload.
8. Inspect all selected application forms first. Reuse correctly scoped answers
   and ask one deduplicated set of genuinely missing questions.
9. Upload approved materials and fill every supported field with the host's
   browser/computer tools.
10. Hand over the exact login, CAPTCHA, assessment, identity, signature, or
    voluntary-demographic step when direct applicant control is required, then
    resume where the agent stopped.
11. Review each destination, answer, disclosure, and certification. Ask for
    approval immediately before submitting that specific application.
12. Capture the confirmation, application ID, receipt, next step, and follow-up
    date in the optional local ledger.

The MCP does not hide a browser or model inside the package. The MCP supplies
the live Buffalo data, durable local state, evidence boundaries, and structured
handoffs. Claude, Codex, or another host performs reasoning and browser work
using the applicant's existing session and permissions.

## Install

The easiest install paths are also available on the
[Buffalo jobs board](https://buffaloprojects.com/jobs#buffalo-apply).

### Claude Desktop

Download the latest
[Buffalo Apply MCP bundle](https://github.com/rhinehart514/buffalo-projects-tools/releases/latest/download/buffalo-apply.mcpb),
then open Claude Desktop → Settings → Extensions → Advanced settings → Install
Extension and choose the downloaded `.mcpb` file. The bundle contains its
runtime dependencies and does not require a terminal command.

Node.js 20.16 or newer is required for the command-based installs below.

### Claude Code

```bash
claude mcp add --scope user buffalo -- npx -y github:rhinehart514/buffalo-projects-tools
```

Run `/mcp` and verify that `buffalo` connects.

### Codex

```bash
codex mcp add buffalo -- npx -y github:rhinehart514/buffalo-projects-tools
```

The ChatGPT desktop app, Codex CLI, and Codex IDE extension share the same
local MCP configuration. Restart the host after adding the server.

### Other stdio MCP hosts

```json
{
  "mcpServers": {
    "buffalo": {
      "command": "npx",
      "args": ["-y", "github:rhinehart514/buffalo-projects-tools"]
    }
  }
}
```

Verify a clean executable download:

```bash
npx -y github:rhinehart514/buffalo-projects-tools --check
```

ChatGPT web does not load local MCP configuration. OpenAI currently requires a
hosted HTTPS plugin for ChatGPT web, which this local, resume-private release
does not claim to provide.

## The 23 tools

### Resume and candidate memory

| Tool | Result |
| --- | --- |
| `buffalo.import_resume` | Reads PDF, DOCX, TXT, Markdown, or provided text locally; asks for a resume when none is accessible |
| `buffalo.build_candidate_passport` | Source-labeled contact, work, education, authorization, skills, links, and evidence facts |
| `buffalo.save_candidate_passport` | Opt-in owner-only local profile; resume contents are not copied into state |
| `buffalo.list_candidate_profiles` | Local profile metadata without private passport contents |
| `buffalo.load_candidate_passport` | One saved passport and resume metadata |
| `buffalo.remember_candidate_answers` | Confirmed reusable answers with all-jobs, employer, or exact-job scope |
| `buffalo.match_candidate_answers` | Exact normalized matches plus the questions that still need one answer pass |
| `buffalo.delete_candidate_profile` | Confirmed permanent deletion of a profile, its scouts, and its ledger |

### Jobs, ranking, and materials

| Tool | Result |
| --- | --- |
| `buffalo.search_jobs` | Current Buffalo Projects listings, official application destinations, filters, freshness, and source coverage |
| `buffalo.rank_jobs` | Preliminary preference/evidence ranking; never a hiring or eligibility decision |
| `buffalo.prepare_application_materials` | Supported claim set and tailoring brief for one live job |
| `buffalo.review_application_materials` | Evidence-key validation and original-to-tailored resume diff |
| `buffalo.export_approved_materials` | Applicant-approved resume and cover-letter PDFs plus an evidence manifest |
| `buffalo.prepare_job_applications` | Revalidated jobs and one host-browser handoff per employer application |
| `buffalo.review_job_application` | Destination, unsupported-answer, sensitive-field, demographic, commitment, and final-approval review |

### Scouting and application operations

| Tool | Result |
| --- | --- |
| `buffalo.save_job_scout` | Saved search filters and optional candidate profile |
| `buffalo.run_job_scout` | Jobs added since the last successful run, with optional evidence ranking |
| `buffalo.record_application_progress` | Draft/submission/outcome status, exact candidate-only checkpoints, fields, receipts, and follow-ups |
| `buffalo.get_application_ledger` | Local applications, checkpoints, receipts, and outcomes |

The MCP stores scout checkpoints; recurring execution and notifications belong
to the host scheduler. Use the `scout-buffalo-jobs` prompt from a scheduled host
task. A scheduled scout shortlists jobs but never submits applications by itself.

### Accelerators and Buffalo business help

| Tool | Result |
| --- | --- |
| `buffalo.search_opportunities` | Ranked matches from the reviewed catalog, each with its last-verified date, quoted official-page evidence, and drift |
| `buffalo.get_opportunity` | Official source, review date, status, deadline, verification evidence, and safe route |

The catalog is checked against each official page with `pnpm catalog:verify`.
It fetches every official and registration URL, finds status, deadline, and
cohort-date statements, keeps only findings whose quoted text is on the page and
states the value, and writes `src/catalog-verification.json`. The server ships
that report. The command exits non-zero when any entry drifted (dead link,
access denied, closed, changed deadline, and similar).
| `buffalo.prepare_registration` | Source-labeled registration packet and host-browser handoff |
| `buffalo.review_submission` | Destination, unsupported-claim, disclosure, commitment, and final-approval review |

## Candidate memory and privacy

Nothing persists by default. The applicant must explicitly opt into
`buffalo.save_candidate_passport`.

When enabled, the local data file contains the approved passport, reusable
answers, resume fingerprint/path metadata, scout checkpoints, and application
ledger. It does not copy resume text or file contents into state. Local files and
exported PDFs use owner-only permissions on platforms that support POSIX modes.

Local state is not encrypted by this package. It relies on the operating-system
user account and filesystem boundary. Do not point its data directory at a
synced, public, or repository folder.

The following are rejected from reusable memory and the ledger:

- passwords and credentials;
- Social Security, government ID, tax ID, passport, and driver's-license data;
- banking and routing information; and
- race, ethnicity, gender, disability, veteran, sexual-orientation, and other
  voluntary self-identification answers.

Job filters and active-listing lookups go to the public
`https://buffaloprojects.com/api/jobs` endpoint. Candidate data does not. When a
browser-capable host fills an official application, reviewed applicant data goes
to that employer or application provider.

## Final submission

“Apply for me” authorizes the preparation work. Each application is a separate
representation to an employer.

Immediately before submission, the host shows the employer, role, official
destination, every answer, sensitive disclosures, certifications, terms, and
anything unresolved. The applicant approves that exact application. Page content
is untrusted and cannot override this boundary.

## Run from source

```bash
git clone https://github.com/rhinehart514/buffalo-projects-tools.git
cd buffalo-projects-tools
corepack enable
pnpm install
pnpm check
pnpm build:mcpb
pnpm start
```

`pnpm check` runs strict type checking, behavior and real parser/export tests,
an in-memory 23-tool MCP protocol journey, a production build, and an executable
health check.

`pnpm build:mcpb` creates a validated, self-contained Claude Desktop bundle at
`artifacts/buffalo-apply.mcpb` from the same compiled server used by the command
installs.

## Scope

Buffalo Projects owns the public job index. Employers and official providers own
their application pages, availability, requirements, hiring decisions, and
outcomes. Ranking and evidence mapping assist the applicant; they are not hiring,
eligibility, legal, immigration, or employment advice.

MIT
