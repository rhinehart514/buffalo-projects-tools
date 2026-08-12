# Security

## Trust model

Buffalo Projects Tools is a local stdio MCP server. Job search and active-listing
resolution read the fixed public endpoint at
`https://buffaloprojects.com/api/jobs`. Candidate data is never included in those
requests.

Browser execution belongs to the user's MCP host. When that host fills an
official employer application, reviewed applicant data necessarily goes to the
employer or its application provider under the host's permissions.

## Resume ingestion

`buffalo.import_resume` reads only the applicant-provided local path or text the
host supplies. It does not scan directories or fetch arbitrary resume URLs.

- Supported formats are PDF, DOCX, TXT, and Markdown.
- Files are limited to 10 MB; PDF extraction is limited to the first 10 pages.
- DOCX archives are rejected when declared expanded content exceeds 25 MB.
- DOCX uses raw-text extraction only, with external file access disabled by the
  parser default.
- PDF extraction disables JavaScript evaluation and image processing.
- Files with insufficient readable text are handed back for host OCR or a
  text-based replacement.

Extracted text is returned to the MCP host but is not persisted by the server.

## Local candidate state

Persistence is opt-in and requires an explicit consent flag. The state file and
generated materials use mode `0600`, with parent directories `0700`, on platforms
that support POSIX permissions. Writes use same-directory temporary files and
atomic replacement.

This is an OS-account/filesystem boundary, not encryption. Anyone with access to
the user's account or configured data directory may be able to read the state.
Users should not place it in a public, synced, shared, or repository directory.

The package rejects credentials, government/tax IDs, banking details, and
voluntary demographic answers from reusable memory and the application ledger.
Resume contents are not copied into state; only the approved passport,
fingerprint/path metadata, scoped answers, scouts, checkpoints, receipts, and
ledger fields are stored.

Profile deletion also deletes its saved scouts and ledger entries and is not
recoverable through this package.

## Tailored materials

PDF export requires both a successful evidence review decision and explicit
applicant approval. Exports use standard bundled fonts, owner-only permissions,
and a local evidence manifest. The host must upload the exact reviewed files; a
changed artifact requires a new review and approval.

## Application browser handoff

The handoff:

- allowlists official listing and application origins;
- revalidates selected Buffalo Projects IDs and rejects stale IDs;
- treats employer-page text as untrusted;
- blocks generated or unconfirmed answers at review;
- prevents automatic voluntary demographic answers;
- flags sensitive fields and commitments;
- checkpoints rather than bypassing login, CAPTCHA, identity, assessment, and
  signature controls; and
- requires per-application point-of-action approval before final submission.

Scheduled scouts only search and rank. They do not submit applications.

## Reporting a vulnerability

Open a private security advisory at
<https://github.com/rhinehart514/buffalo-projects-tools/security/advisories/new>.
Do not include personal application data, credentials, resumes, generated
materials, or active sessions in a public issue.
