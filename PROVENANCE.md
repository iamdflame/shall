# Provenance

This repository has **one commit**. That is unusual enough to explain rather
than leave someone to notice, so this document states plainly how the work
happened and what evidence exists for it.

## What happened

All of SHALL was built on **2026-08-22**, in a single continuous session, using
[Claude Code](https://claude.com/claude-code) in the terminal. The work was not
committed incrementally as it went. When the project was finished, `git init`
was run in the working directory and everything was committed at once.

That is the whole story. There is no squashed branch, no earlier repository, and
no history held back. **The reflog contains one entry.** If a richer history
existed anywhere it would be pushed; it does not.

## Why that matters, and what it costs

A single commit is the one artifact that cannot corroborate a development
narrative. The README describes findings that changed the design mid-build — an
ensemble roster that was wrong, an example that turned out not to be ambiguous —
and `git log` cannot show any of that happening. Nothing below fully substitutes
for a commit history. It is offered as the evidence that does exist.

## Evidence that does exist

### 1. Filesystem timestamps

Modification times across the source tree span a single working window:

```
02:02  src/ears/types.ts        first file written
02:52  src/shall/lang/          the .shall grammar
02:54  src/shall/provider/      the provider boundary
06:53  src/shall/{oracle,attribute,compile,conform}/
07:27  src/shall/execute/       the sandbox isolation fix
07:34  recordings/              ensemble recordings captured
07:37  scripts/findings.mjs     findings made reproducible
```

The order matches the build order described in
[`.kiro/specs/shall-language/tasks.md`](.kiro/specs/shall-language/tasks.md):
language first, then the provider boundary, then the oracle, then conformance,
then the toolchain. It does not match a project assembled from pre-existing
parts.

### 2. The recordings carry their own dates

[`recordings/manifest.json`](recordings/manifest.json) stamps every recorded
reader with the date its output was captured (`2026-08-22`) and the model that
produced it. Those are real API responses from real models, retained verbatim.
They are not reconstructible after the fact.

### 3. The findings are re-runnable, not asserted

```bash
npm run findings
```

Reproduces all three documented findings offline from those recordings, in about
ten seconds, with no API key. Two of them are evidenced by the readers' own
generated source — including two same-family readers that wrote comments
silently resolving an ambiguity the ensemble then reported as unanimous. Those
comments were not written by the author and could not have been.

### 4. The task list records the order of work

[`tasks.md`](.kiro/specs/shall-language/tasks.md) tracks 49 tasks across seven
phases, with Phase 7 ("Empirical validation") recording the two mid-build
corrections as tasks rather than as retrospective narrative.

### 5. The specification is verified against the code

```bash
npm run verify     # 25/25 acceptance criteria
```

Every criterion in `.kiro/specs/` is bound to the implementation site and the
test that proves it. That binding is checkable by anyone, independent of any
claim in this document.

## What this document does not claim

- It does not claim a commit history exists.
- It does not claim the timestamps are tamper-proof; they are not.
- It does not claim any of this is equivalent to incremental commits. It is not.

The honest summary: **the code is original and was written on 2026-08-22, and
the version control practice was poor.** Committing as the work progressed would
have produced better evidence than anything above, and that is a process failure
worth naming rather than dressing up.
