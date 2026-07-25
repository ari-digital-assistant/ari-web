# Develop for Ari

Anyone can add a skill to Ari. There's no gatekeeping beyond a review and an
automated check — write it, validate it, open a pull request, and it ships
to every user within minutes of merging.

## Three kinds of skill

- **Declarative** — a `SKILL.md` manifest with patterns and responses. No
  code, no build step. This is what most skills should be.
- **WASM** — a sandboxed WebAssembly module plus a manifest, for skills that
  need logic, state, HTTP, or device capabilities.
- **Assistant** — a manifest describing an LLM API, to provide Ari's
  general-purpose brain.

If your skill can be described as "when the user says roughly this, reply
with roughly that", it should be declarative. Reach for WASM only when you
genuinely need code to run.

## The registry

Skills live in the open [`ari-digital-assistant/ari-skills`](https://github.com/ari-digital-assistant/ari-skills)
repository. Every skill is reviewed and validated in CI before merge; on
merge, the bundle is signed and published, and every Ari user can install it
from Settings → Skills → Browse within minutes. Nothing is gatekept beyond
that review and the signing chain.

## Canonical references

The full developer documentation — the tutorial, manifest reference,
capabilities, actions, SDKs, internationalisation, and publishing checklist
— all lives in the ari-skills repo, not here. Start with the docs index:

[`ari-digital-assistant/ari-skills/docs`](https://github.com/ari-digital-assistant/ari-skills/tree/main/docs)

## Get started

Ready for a taste? [Your first skill](/develop/first-skill) walks through a
small declarative skill from nothing to a pull request.
