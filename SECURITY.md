# Security policy

EQMUX launches shells and AI agent CLIs on your machine, so we treat vulnerabilities seriously.

## Reporting

**Do not open a public issue.** Report privately through
[GitHub private vulnerability reporting](https://github.com/ReDocu/EQMUX/security/advisories/new).
Include the version (Settings › About), your OS, and steps to reproduce.

We aim to reply within 7 days. Please give us a chance to ship a fix before disclosing.

## In scope

- Anything that lets another process, page, or repository run commands through EQMUX without the user pressing a button
  (named pipe `eqmux` CLI, hook commands, browser panel, `.eqmux/` files in a cloned repository)
- Secrets leaking into logs, the diagnostics bundle, or notifications
- EQMUX writing outside the places listed in [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md)

## Supported versions

Only the latest release.
