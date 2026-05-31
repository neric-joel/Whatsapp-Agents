# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The pre-1.0 production-hardening effort (`docs/production-hardening/`) turns the MVP
into a self-hostable, OSS-ready project. Highlights by phase:

### Added

- **Observability & reliability (Phase 6).** Structured, secret-redacted JSON logging
  shared by web + bridge; web `/api/health` database-readiness ping; a bridge
  `/healthz` + `/metrics` HTTP server (Prometheus exposition); opt-in error tracking
  (no-op without a DSN); runtime metrics (runs started/completed/failed/cancelled +
  latency); documented run state machine + stale-run recovery
  (`docs/OBSERVABILITY.md`).
- **Developer experience & containerization (Phase 5).** Multi-stage non-root
  Dockerfiles for web + bridge, `docker-compose.yml`, `.devcontainer/`, cross-platform
  bootstrap, boot-time env validation, and `docs/SELF_HOSTING.md`.
- **Testing (Phase 3).** Coverage floors in CI, Playwright e2e scaffold, and pgTAP
  RLS/policy tests.
- **CI & repo hygiene (Phase 0).** GitHub Actions (verify, security/secret-scan,
  CodeQL, e2e, db-tests, image build), Dependabot, `.editorconfig`, `.nvmrc`,
  branch protection + pre-push hook.
- **Open-source readiness (Phase 7).** `LICENSE` (MIT), `CONTRIBUTING.md`,
  `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CODEOWNERS`, issue templates,
  `docs/ARCHITECTURE.md`, and `docs/adr/`.

### Changed

- **Code quality (Phase 2).** Root ESLint flat config + Prettier + import sorting;
  stricter TypeScript (`noUncheckedIndexedAccess`); `knip` dead-code gate.
- **UI/UX & accessibility (Phase 4).** WCAG 2.1 AA pass (keyboard nav, focus
  management, ARIA live regions, contrast), reduced-motion support, render-state
  coverage.

### Security

- **Security hardening (Phase 1).** Subprocess sandbox (`shell:false`, stdin
  system-prompt, binary allowlist, minimized env, output cap); storage RLS scoped to
  room membership; CSRF/Origin checks + rate limiting + fail-closed middleware +
  security headers; error-message redaction; opt-in third-party image egress.

[Unreleased]: https://github.com/neric-joel/Whatsapp-Agents/commits/main
