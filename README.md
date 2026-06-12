# Buffalo Projects — Agent Tools

**Your shipped work, read and written by your AI — and routed to what's next in Buffalo.**

The MCP server and CLI for [Buffalo Projects](https://buffaloprojects.com). Your
record is a living trajectory: what you've shipped, and what you're building
toward. These tools let you and your agent write to it from where you already
build, and pull the Buffalo events, grants, and programs that fit what you're
making.

Pure clients — they talk to the hosted API with a token you supply. No server,
no secrets. Read the source.

## MCP — hand your agent your record

```jsonc
{
  "mcpServers": {
    "buffalo-projects": {
      "command": "npx",
      "args": ["-y", "buffalo-projects-mcp@latest"],
      "env": { "BUFFALO_TOKEN": "bp_..." }
    }
  }
}
```

Get a token at <https://buffaloprojects.com/app/settings>. Now your agent can
log what you ship, read your record, and answer "what should I apply to in
Buffalo?"

## CLI

```bash
npm i -g buffalo-projects
buffalo login
buffalo targets          # Buffalo grants, events & programs that fit what you build
buffalo log "shipped X"
```

## Build it

pnpm workspace. The shared `@buffalo/*` packages are vendored from the Buffalo
Projects monorepo and bundled in at build time, so each published package ships
self-contained.

```bash
pnpm install && pnpm build && pnpm smoke
```

MIT
