# 0006 — Third-party image egress is opt-in, off by default

- **Status:** Accepted
- **Date:** 2026-05-30

## Context

AgentRoom can extract text from uploaded images to give agents context. The
implementation sends image bytes to OpenAI's API — a data egress to a third party that
a self-hoster may not expect or want, especially for private rooms.

## Decision

Make image text/OCR extraction **opt-in and off by default**. It activates only when
`ENABLE_IMAGE_TEXT_EXTRACTION=true` **and** an `OPENAI_API_KEY` is provided. The egress
is documented explicitly in `.env.example`, `SECURITY.md`, and `SELF_HOSTING.md`.

## Consequences

- No surprise third-party egress in the default configuration.
- Operators make an informed, explicit choice to enable it.
- Without it, image attachments still work; agents just don't get extracted text.

## Alternatives considered

- On by default — rejected (surprising egress of potentially sensitive images).
- A local OCR model — heavier dependency; could be a future pluggable provider.
