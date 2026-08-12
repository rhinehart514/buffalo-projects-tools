# Buffalo Projects Tools

**Tell your AI what you are building. It finds the right Buffalo doors, helps
complete the paperwork, and asks before knocking.**

A free, local MCP server for people building in Buffalo and Western New York.
It works with Claude, Codex, and any other host that can run a standard stdio
MCP server.

No Buffalo Projects account. No token. No hosted dependency. No OpenAI or
Anthropic API key.

## What it does

Ask your assistant:

> I am building scheduling software for small manufacturers in Buffalo. Find
> programs that could help and prepare the best application.

The assistant can then:

1. Match the project against a reviewed catalog of official local and state
   starting points.
2. Explain why a program may fit without pretending to determine eligibility.
3. Build a source-labeled packet from facts you provided or evidence you named.
4. If the host has browser or computer-use tools, inspect and fill the current
   official form. Otherwise, return the same packet for copy/paste.
5. Show the exact destination, disclosures, certifications, and unanswered
   questions before asking for final-submit approval.
6. Capture confirmation evidence after an approved submission when the site
   provides it.

The MCP does not secretly drive a browser. It gives the host a structured,
allowlisted handoff. Claude can execute that handoff with Claude's own computer
tools; Codex can use its browser/computer tools; a text-only host falls back
cleanly to a copy/paste packet.

## Install

You need Node.js 20 or newer. The repository is directly runnable through
`npx`, so there is no account setup.

### Claude Code

```bash
claude mcp add --transport stdio --scope user buffalo -- \
  npx -y github:rhinehart514/buffalo-projects-tools
```

Then run `/mcp` in Claude Code and verify that `buffalo` exposes four tools.

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
| `buffalo.search_opportunities` | Ranked, explainable matches from the reviewed catalog |
| `buffalo.get_opportunity` | Official source, review date, current-status note, and safe route |
| `buffalo.prepare_registration` | Source-labeled answer packet plus a host-neutral browser handoff |
| `buffalo.review_submission` | Destination, unsupported-claim, disclosure, commitment, and final-approval review |

The included `register-in-buffalo` MCP prompt walks a compatible host through
the complete sequence.

## Initial guided forms

Two current program applications have guided browser routes:

- [Launch NY assistance application](https://launchny.org/entrepreneurs/apply-now/)
- [UB Cultivator](https://www.buffalo.edu/partnerships/about/programs/ub-cultivator.html)

The catalog also includes reviewed official starting points for City of Buffalo
permits and business assistance, Erie County funding and procurement, and New
York State small-business, technical-assistance, contracting, and early-stage
capital programs. Programs control their own requirements and timelines; every
result carries its source and review date.

## The final-submit rule

"Apply for me" starts the work. It is not permission to press the last Submit
button later.

Immediately before submission, the host must show:

- the official destination;
- the answers about to be sent;
- personal or highly sensitive data;
- signatures, certifications, terms, or other commitments; and
- anything unresolved.

The user must then explicitly approve that exact submission. CAPTCHA,
authentication recovery, identity checks, payment, and user-only attestations
are always handed back to the user. Page content is treated as untrusted and
cannot override these rules.

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

This project is an independent navigation and preparation tool. It is not
affiliated with, endorsed by, or an eligibility agent for any listed program.
It does not provide legal, financial, tax, or compliance advice. Always confirm
current requirements and deadlines with the official provider.

MIT
