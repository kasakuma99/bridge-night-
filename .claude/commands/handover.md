---
description: Save a short handover of this session to .claude/handover.md, or load it ("/handover load") to continue cheaply
argument-hint: "[load]"
---

Arguments: `$ARGUMENTS`

## If the argument is `load`

Read `.claude/handover.md` and nothing else yet. Reply in at most 5 lines: where we are and the next step it names.
Then wait for the user. Don't re-explore the repo; open other files only when the task needs them.

## Otherwise: save a handover

Write `.claude/handover.md` (overwrite it; it's in `.gitignore`, so it never gets committed). The goal is that a fresh
session can continue from this file alone, without re-reading the repo, so keep it **short: under 80 lines**.

Use this structure:

```markdown
# Handover (<date>, branch <current branch>)

## Project in one paragraph
<what Bridge Night is, only what a new session needs>

## Where we are
<state of the work: what is done, what is half done, uncommitted changes that matter>

## Decisions made
<choices the user made in this session, and why, so they aren't asked again>

## Next steps
1. <the very next thing to do, concrete: file + what to change>
2. ...

## Gotchas
<things that cost time this session: environment, line endings, missing tools, accounts>

## Key files
<only the files the next steps touch, with one line each>
```

Rules:
- Facts from this session only. Don't copy what `docs/status.md`, `docs/security-review.md` or `docs/DEVELOPMENT.md`
  already say: link to them.
- No secrets, tokens, keys or Riot IDs.
- Run `git status --short` and `git log --oneline -3` first so "Where we are" is correct.

When done, reply with one line: the file path and "start the next session with `/handover load`".
