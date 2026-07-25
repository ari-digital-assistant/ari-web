# Your first skill

Here's the shape of the smallest useful skill — a declarative one, no code
required. This page is a taste; the [full tutorial](https://github.com/ari-digital-assistant/ari-skills/blob/main/docs/tutorial-declarative.md)
in the ari-skills repo walks through every step in about fifteen minutes.

## The manifest

A declarative skill is one file: `skills/<slug>/SKILL.en.md`. It's a
Markdown file with YAML frontmatter describing the skill, followed by a
short body:

```markdown
---
name: coin-flip
description: Flips a coin and returns heads or tails. Use when the user asks to flip a coin, toss a coin, or wants a heads-or-tails answer.
license: MIT
metadata:
  ari:
    id: dev.heyari.coin-flip
    version: "0.1.0"
    author: Your Name <you@example.com>
    languages: [en]
    matching:
      patterns:
        - keywords: [flip, coin]
          weight: 0.95
        - keywords: [toss, coin]
          weight: 0.95
    declarative:
      response_pick: ["Heads.", "Tails."]
---

# Coin Flip

Flips a coin. "flip a coin" → "Heads." or "Tails."
```

- `name` matches the directory name exactly.
- `metadata.ari.id` is a reverse-DNS identifier, `dev.heyari.<slug>` for
  skills in this taxonomy.
- `matching.patterns` are the fast path: every keyword in a pattern must
  appear in the utterance for that pattern to fire.
- `declarative.response_pick` is a list Ari picks one line from at random.

## Patterns match normalised input

Before matching, Ari lowercases the input and expands contractions —
"what's" becomes "what is", apostrophes disappear. So keywords must always
be **lowercase and apostrophe-free**, or they can never match. Write
`whats`, not `what's`; `flip`, not `Flip`.

## Try it, then open a PR

Once your manifest is written, `./tools/validate skills/<slug>/` checks it
against the schema, and `./tools/sideload-android skills/<slug>/` lets you
try it on a real device. Fork the repo, add your skill, validate it, and
open a pull request — a maintainer reviews, and on merge it's signed and
published automatically.

For the full walkthrough — including router examples, specificity, and
what makes a good description — see the canonical tutorial:

[`ari-digital-assistant/ari-skills/docs/tutorial-declarative.md`](https://github.com/ari-digital-assistant/ari-skills/blob/main/docs/tutorial-declarative.md)
