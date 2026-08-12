# Contributing

Issues and focused pull requests are welcome.

Job discovery must continue to use the public Buffalo Projects job API rather
than introducing a competing hardcoded employer feed. Keep its external response
validation strict, send no candidate data to the index, and preserve stale-ID
revalidation before an application handoff.

New catalog entries must use an official City of Buffalo, Erie County, New York
State, university, or program-provider source. Record the date you actually
reviewed the source. Describe it as a starting point, preserve uncertainty about
eligibility and timing, and keep the browser allowlist as narrow as the live
route permits.

Before opening a pull request:

```bash
corepack enable
pnpm install
pnpm check
```

Never commit application answers, personal data, credentials, captured form
sessions, resumes, or invented job or program requirements.
