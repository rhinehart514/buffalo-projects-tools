# buffalo-projects

The Buffalo Projects CLI. Scan a codebase for the projects you've built, log
work, and keep your Buffalo work record current from the terminal — private by
default, shareable when you choose.

Free and open source (MIT). Buffalo Projects gives Buffalo college builders a
source-backed work record that can be updated from the terminal, an AI
co-pilot, and GitHub. A public profile at `/b/[handle]` is optional output, not
the default obligation.

## Install

```bash
# one-off
npx -y buffalo-projects@latest scan

# or install the `buffalo` command globally
npm i -g buffalo-projects@latest
```

Requires Node 18+.

## Quickstart

```bash
buffalo login                 # device-code login in your browser
buffalo auth                  # confirm this machine is connected
buffalo record                # preview a private work record from this repo, no login required
buffalo record --save         # save .buffalo/record.md, projects.json, and work.jsonl locally
buffalo export mentor-update  # turn the local record into a sendable update
buffalo scan                  # detect projects in the current repo, pick which to add
buffalo log "shipped X"       # log one shipped thing to your work record
```

## `buffalo record`

The first-run command. It turns the current repo into a private work-record
preview without requiring auth or uploading source code.

```bash
buffalo record             # human-readable preview, writes nothing
buffalo record --json      # structured output for scripts/agents
buffalo record --markdown  # markdown preview
buffalo record --save      # write local .buffalo/ artifacts only
```

The preview includes the project title, summary, recent git work, source
signals, missing evidence, next proof move, suggested private work entry, and a
privacy receipt. `--save` creates `.buffalo/record.md`, `.buffalo/projects.json`,
and `.buffalo/work.jsonl`; it does not publish or sync anything.

```bash
buffalo export mentor-update
buffalo export profile-draft
buffalo export json
```

Exports read the local record when present, or generate an unsaved preview from
the current repo.

## `buffalo scan`

Detects the distinct efforts in a codebase (monorepo packages, standalone
tools, subprojects), then lets you choose which to add to your record. It
reflects what you built — it does **not** judge the quality of your work.
Candidates are ranked by recency/activity only; you curate **use / skip /
never**. Chosen projects are created link-only (you publish explicitly later).

```bash
buffalo scan                  # interactive checklist
buffalo scan --dry-run        # preview candidates, write nothing
buffalo scan --yes            # non-interactive: add all detected projects
buffalo scan --json           # machine-readable output
```

The `never` choices are remembered (locally in `.buffalo/ignore.json` and
synced to your account) so they don't reappear on future scans.

## Commands

```
buffalo login
buffalo auth      [--json]
buffalo record    [--days <n>] [--save] [--markdown] [--json]
buffalo export    mentor-update|profile-draft|json [--json]
buffalo scan      [--days <n>] [--dry-run] [--yes] [--json]
buffalo log       <what you shipped> [--note <text>] [--project <id>]
buffalo init      [--template <type>]
buffalo new       --from <example-id>
buffalo lint      [project.md]
buffalo add       evidence <file-or-url> [--caption <text>]
buffalo add       milestone <title> [--note <text>]
buffalo capture   [--days <n>] [--accept <id,id|all>]
buffalo preview
buffalo push | pull | diff | status | ci | config | examples
```

Add `--json` to any command for scriptable output.

## Auth

`buffalo login` stores a token in your OS keychain (falling back to
`~/.config/buffalo/config.toml`). You can also set `BUFFALO_TOKEN` and
`BUFFALO_BASE_URL` in the environment.

Run `buffalo auth` or `buffalo whoami` to verify the account connection before
using hosted commands such as `buffalo scan`, `buffalo log`, `buffalo push`, or
MCP-backed writes.

## License

MIT — see [LICENSE](./LICENSE).
