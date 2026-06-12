# buffalo-projects-mcp

The Buffalo Projects MCP server. Lets an AI co-pilot (Claude Code, etc.) scan a
codebase, add projects, log work, summarize velocity, request vouches, and keep
a builder's Buffalo work record current — private by default, shareable when
the builder chooses.

Free and open source (MIT). Pairs with the hosted Buffalo API. Public profiles
are optional outputs from the same source-backed record, not the default write
path.

## Use with Claude Code

Add to your MCP server config (e.g. `.mcp.json` or Claude Code settings):

```json
{
  "mcpServers": {
    "buffalo": {
      "command": "npx",
      "args": ["-y", "buffalo-projects-mcp@latest"],
      "env": {
        "BUFFALO_TOKEN": "bp_your_api_key",
        "BUFFALO_BASE_URL": "https://buffaloprojects.com"
      }
    }
  }
}
```

Mint a `bp_` API key from your Buffalo workspace settings. The co-pilot reads
your codebase with its own file tools; the Buffalo tools structure and persist
what you choose.

Run `buffalo.auth_status` first when onboarding a new agent. Local discovery and
resume briefs work without a token; hosted reads/writes need `BUFFALO_TOKEN` in
the `buffalo-projects-mcp` server environment.

## Troubleshooting

**Every hosted tool returns 429 / "Blocked by the Vercel firewall".** The
Buffalo API sits behind Vercel's firewall. When the `bot_protection` managed
rule is set to `challenge`, Vercel returns HTTP 429 with an
`x-vercel-mitigated: challenge` header to *all* non-browser clients (this MCP,
the `buffalo` CLI, curl) **before the request reaches the app** — your `bp_`
key is never even checked. Browsers solve the JS challenge silently, so the
website keeps working while every programmatic client is dead.

Confirm it: `curl -i https://buffaloprojects.com/api/builder/me` and look for
`x-vercel-mitigated`. Fix it on the Buffalo (Vercel) side — keep the project's
`bot_protection` rule at `log` (not `challenge`), or, on a plan with System
Bypass, add a firewall Bypass rule scoped to `/api/*` so the public site keeps
bot protection while the API stays open.

> **Invariant:** `bot_protection` must stay `log` (or `/api/*` must be bypassed)
> for the MCP and CLI to work. Flipping it back to `challenge` silently breaks
> every programmatic client.

`buffalo.auth_status` now reports a precise `hostedTools` state so you don't
have to guess:

- `verified` — connected and working.
- `blocked-by-firewall` — the firewall is challenging the request (see above); **not** a token problem.
- `token-invalid` — the `bp_` key was rejected (401/403); mint a new one at `/app/settings`.
- `rate-limited` — a genuine 429; wait and retry.
- `needs-token` — no `BUFFALO_TOKEN` is set.

## Current capability boundary

Buffalo Projects does **not** yet provide an opportunity marketplace,
opportunity supply inventory, matching, routing, referrals, or guaranteed access
to mentors, recruiters, sponsors, grants, internships, or customers.

The MCP is builder-side infrastructure. It captures and organizes projects,
work entries, evidence links, velocity, resume-style summaries, and vouch
requests. Those signals can prepare Buffalo Projects for a future opportunity
router, but the MCP must not describe current data as available opportunities or
claim that routing exists today.

## Tools

- `buffalo.auth_status` — check whether hosted account reads/writes are configured and return setup instructions
- `buffalo.find_projects` — scan approved local roots for project-like folders (read-only, redacted preview)
- `buffalo.scan_repo` — detect distinct projects in one codebase (read-only)
- `buffalo.preview_project_writes` — show exactly what would be sent before creating projects
- `buffalo.refresh_projects` — rescan approved roots and propose updates/work entries for existing projects
- `buffalo.build_resume_brief` — synthesize resume-quality profile/project copy from approved local metadata
- `buffalo.build_evidence_graph` — connect approved projects, skills, claims, evidence, confidence, and proof gaps
- `buffalo.suggest_next_proof` — recommend the next proof moves for credibility without matching or routing opportunities
- `buffalo.ignore_projects` — add candidate keys to the builder's never-list
- `buffalo.add_projects` — add chosen candidates as link-only projects
- `buffalo.update_project` — add detail (description, skills, ask, evidence)
- `buffalo.draft_project` — structure a project from a description
- `buffalo.log_milestone` / `buffalo.save_work` — append to the work log
- `buffalo.list_work` — read recent work entries before summarizing or updating
- `buffalo.get_velocity` — summarize recent work by source and active day
- `buffalo.request_vouch` — create a validation link after meaningful work
- `buffalo.suggest_evidence` — surface inspectable URLs from context
- `buffalo.list_projects` / `buffalo.get_project` — read the account

It reflects what a builder has built; it does **not** score the quality of the
work. New projects are created link-only — publishing is always explicit.
Machine-wide discovery scans only approved roots, refuses whole-home/system
credential folders, and does not send file contents or absolute local paths in
the project-write preview.
Resume briefs are synthesized from bounded local signals such as manifests,
README summaries, package scripts, dependency/language signals, and git
activity. They do not return raw source file contents, secrets, or environment
variables.
Evidence graphs and proof-gap plans are read-only builder-side outputs. They
prepare work records for future routing primitives, but they do not claim that
Buffalo Projects has opportunity supply, matching, referrals, or routing today.

## Run directly

```bash
BUFFALO_TOKEN=bp_... BUFFALO_BASE_URL=https://buffaloprojects.com npx -y buffalo-projects-mcp@latest
```

Speaks MCP over stdio. Requires Node 18+.

## License

MIT — see [LICENSE](./LICENSE).
