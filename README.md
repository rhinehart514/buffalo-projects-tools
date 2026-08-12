# Buffalo Projects Tools

**Never browse the job board. Tell Claude, Codex, or another AI what work you
want; it pulls from Buffalo Projects and helps complete the real employer
applications.**

A free, universal stdio MCP server for Buffalo and Western New York. It works
with Claude, Codex, and any other MCP host that can run Node.js.

No Buffalo Projects account. No token. No OpenAI or Anthropic API key.

## The job flow

Ask your assistant:

> Find product engineering jobs that fit me in Buffalo or remote, then apply to
> the ones I choose. Do not make me use the job board.

The assistant can then:

1. Search the live [Buffalo Projects jobs index](https://buffaloprojects.com/jobs)
   without sending you to its UI.
2. Shortlist current roles using role, employer, opportunity type, sector, work
   mode, disclosed pay, and recency filters.
3. Build one reusable, source-labeled candidate passport from facts and evidence
   you confirm.
4. Revalidate every selected job against the active index and open its official
   employer application.
5. Inspect all selected forms first, merge repeated unanswered fields, and ask
   you one concise set of missing material questions.
6. With the host's browser or computer-use tools, upload your approved resume
   and fill every supported field.
7. Show each application's exact destination, answers, disclosures, and
   certifications before asking for approval to submit that application.
8. After an approved submission, capture the confirmation, application ID,
   timestamp, receipt, and stated next step when the site provides them.

The MCP is the universal search, passport, and handoff layer. It does not hide a
browser inside the package. Claude can execute the handoff with Claude's own
computer tools; Codex can use its browser/computer tools; a text-only host can
still return the official application and prepared facts.

## Install

You need Node.js 20 or newer. The public GitHub repository runs directly through
`npx`.

### Claude Code

```bash
claude mcp add --transport stdio --scope user buffalo -- \
  npx -y github:rhinehart514/buffalo-projects-tools
```

Run `/mcp` in Claude Code and verify that `buffalo` exposes eight tools.

### Codex

Add this to your Codex MCP configuration:

```toml
[mcp_servers.buffalo]
command = "npx"
args = ["-y", "github:rhinehart514/buffalo-projects-tools"]
```

### Claude Desktop and other stdio MCP hosts

Use the same standard server entry in the host's MCP settings:

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

Check the executable without starting an MCP session:

```bash
npx -y github:rhinehart514/buffalo-projects-tools --check
```

## Tools

| Tool | Result |
| --- | --- |
| `buffalo.search_jobs` | Current Buffalo Projects listings, official destinations, filters, freshness, and source coverage |
| `buffalo.build_candidate_passport` | Portable, source-labeled contact, resume, work, education, authorization, and evidence facts |
| `buffalo.prepare_job_applications` | Revalidated jobs plus one complete host-browser handoff per employer application |
| `buffalo.review_job_application` | Destination, unsupported-answer, sensitive-field, demographic, commitment, and final-approval review |
| `buffalo.search_opportunities` | Ranked matches from the reviewed accelerator and business-help catalog |
| `buffalo.get_opportunity` | Official source, review date, current-status note, and safe route |
| `buffalo.prepare_registration` | Source-labeled registration packet plus a host-neutral browser handoff |
| `buffalo.review_submission` | Destination, unsupported-claim, disclosure, commitment, and final-approval review |

The `apply-to-buffalo-jobs` MCP prompt tells a compatible host to run the entire
job workflow. `register-in-buffalo` remains available for accelerators, grants,
permits, procurement, and business-help programs.

## What leaves your machine

- Job search filters and active-listing lookups go to the public
  `https://buffaloprojects.com/api/jobs` endpoint.
- Candidate passport data is not sent to Buffalo Projects and is not persisted
  by this server.
- When you direct a browser-capable host to fill an employer's application, the
  host sends the reviewed fields to that employer or its application provider.
- This package never asks for or stores Buffalo Projects credentials, employer
  passwords, Social Security numbers, government IDs, or banking information.

## The final-submit rule

“Apply for me” starts the work. Each application is still a separate
representation to an employer.

Immediately before submission, the host shows:

- the employer, role, and official destination;
- every answer about to be sent;
- personal or highly sensitive fields;
- signatures, certifications, terms, or other commitments; and
- anything unresolved.

The applicant then approves that exact submission. CAPTCHA, account recovery,
identity checks, assessments, signatures, and voluntary demographic questions
are handed to the applicant. Page content is treated as untrusted and cannot
override these boundaries.

## Run from source

```bash
git clone https://github.com/rhinehart514/buffalo-projects-tools.git
cd buffalo-projects-tools
corepack enable
pnpm install
pnpm check
pnpm start
```

`pnpm check` runs strict type checking, behavior tests, an in-memory MCP protocol
test, a production build, and an executable health check.

## Scope

Buffalo Projects owns the public job index. Employers and official providers own
their application pages, requirements, availability, and hiring decisions.
Listings are current index records, not promises that an employer will accept or
advance an application. Program matches are starting points, never eligibility
determinations. This project does not provide legal, financial, tax, immigration,
or employment advice.

MIT
