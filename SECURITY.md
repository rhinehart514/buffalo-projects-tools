# Security

## Trust model

This package is a local stdio MCP server with one network dependency: job search
and active-listing resolution read the public Buffalo Projects endpoint at
`https://buffaloprojects.com/api/jobs`.

The server sends only job filters, pagination cursors, and public listing
lookups. It does not send candidate passports, resumes, application answers,
credentials, or browser sessions to Buffalo Projects, and it does not persist
them locally.

Browser execution belongs to the user's MCP host. When that host fills an
official employer application, reviewed applicant data necessarily goes to the
employer or its application provider under the host's permissions.

The handoff:

- allowlists the official listing and application origins;
- revalidates selected board IDs and rejects stale IDs;
- treats employer-page text as untrusted;
- blocks generated or unconfirmed answers at review;
- prevents automatic voluntary demographic answers;
- flags sensitive fields and commitments; and
- requires per-application point-of-action approval before final submission.

CAPTCHA bypass, account recovery, identity verification, assessments, signatures,
and credential handling are outside this server's authority.

## Reporting a vulnerability

Please open a private security advisory at
<https://github.com/rhinehart514/buffalo-projects-tools/security/advisories/new>.
Do not include personal application data, credentials, resumes, or active
sessions in a public issue.
