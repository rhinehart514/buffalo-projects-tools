# Security

## Trust model

This package is a local stdio MCP server. It stores no account, application, or
credential data and makes no network requests. Its tools return reviewed links,
candidate answer packets, and browser handoff instructions. Any browsing or
form interaction is performed by the user's MCP host under that host's
permissions.

The handoff requires origin allowlisting, treats page text as untrusted, blocks
unsupported generated claims, flags sensitive data and commitments, and requires
point-of-action user approval before final submission.

## Reporting a vulnerability

Please open a private security advisory at
<https://github.com/rhinehart514/buffalo-projects-tools/security/advisories/new>.
Do not include personal application data, credentials, or active secrets in a
public issue.
