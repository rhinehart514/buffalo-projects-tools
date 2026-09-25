# Contributing

Issues and focused pull requests are welcome.

Job discovery must continue to use the public Buffalo Projects job API rather
than introducing a competing hardcoded employer feed. Keep its external response
validation strict, send no candidate data to the index, and preserve stale-ID
revalidation before an application handoff.

Resume changes need real PDF and DOCX extraction coverage. Candidate-memory and
ledger changes need tests for opt-in consent, owner-only permissions, prohibited
field rejection, scoped answer reuse, deletion, and corrupt or stale state.
Tailored-material changes need evidence-map, diff, approval, PDF export, and
round-trip text extraction coverage.

New catalog entries must use an official City of Buffalo, Erie County, New York
State, university, or program-provider source. Record the date you actually
reviewed the source. Set `availability.status` and `deadline` only to what the
official page states, then run `pnpm catalog:verify` and commit the refreshed
`src/catalog-verification.json`. Resolve or explain every reported drift. Describe it as a starting point, preserve uncertainty about
eligibility and timing, and keep the browser allowlist as narrow as the live
route permits.

Before opening a pull request:

```bash
corepack enable
pnpm install
pnpm check
pnpm build:mcpb
```

Release changes must keep `package.json`, the MCP server version, and
`mcpb/manifest.json` aligned. Validate and unpack-smoke-test the generated MCPB
before attaching it to a release.

Never commit application answers, personal data, credentials, captured form
sessions, resumes, or invented job or program requirements.
