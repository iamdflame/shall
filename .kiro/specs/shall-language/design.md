# Design — The SHALL Language

## Overview

```
program.shall
     │
     ├── parse ───────────────► Program (interface + EARS criteria)
     │
     ├── compile ─────────────► N candidates, one per independent reader
     │      (identical question, no reader knows the others exist)
     │
     ├── probe ───────────────► deterministic inputs, spec-literal aware
     │
     ├── execute ─────────────► behaviour vector per candidate (sandboxed)
     │
     ├── partition ───────────► groups by behaviour
     │        1 group  → consensus
     │       >1 group  → COMPILE ERROR, clause named, witness attached
     │
     └── conform ─────────────► expectations derived per clause, checked
              contradiction   → COMPILE ERROR, build not emitted
```

## Why an ensemble rather than one model asked a question

The obvious design is to ask a model "is this specification ambiguous?" That
returns an opinion, and a confident one, whether or not the prose is actually
underdetermined. Worse, it cannot produce a witness.

Running independent readers and diffing their behaviour returns a fact: on this
input, these readers produced these different answers. The disagreement *is* the
ambiguity, and it comes with the input that exposes it.

## Component design

### Language (`lang/`)

The grammar has exactly one formal construct: the interface. Everything else is
English. The interface exists because the oracle needs a signature it can
generate inputs for and compare outputs across — without it there is nothing to
run. One output is enforced, because comparison needs a single value.

### Ensemble compilation (`compile/`)

The prompt's most important property is what it omits. It never tells a reader
how to resolve unclear wording — no "make reasonable assumptions", no worked
edge cases. Any such instruction pushes every reader toward the *same*
resolution and the ensemble would report consensus on genuinely ambiguous prose.

Readers are also never told that other readers exist. A reader that knew it was
being compared would hedge toward the obvious interpretation, which is precisely
the bias being measured.

**Roster design was corrected empirically.** An initial ensemble of five
same-generation variants passed a specification a human reader would question:
every member resolved the open clause by the same shared convention, one of them
writing a comment acknowledging the ambiguity before silently picking a side.
Size and reasoning effort are not independence. The roster now spans generations
(gpt-4o through gpt-5.6), and cross-vendor readers would be better still.

### Probes (`oracle/probes.ts`)

Three tiers, all deterministic:

1. **Structural** — type-derived edge values.
2. **Spec-literal** — every number the specification mentions, plus its
   neighbours. A threshold is only interesting near where it trips, and a
   generic pool never approaches "below 50".
3. **Dense sweep** — engaged when the budget is large. Readers disagree at
   *intermediate* values as often as at input boundaries; two candidates that
   round with `toFixed` and with `Math.round` differ only at a half-cent
   midpoint that a handful of hand-chosen values will never produce.

Half the budget is reserved for input *interactions*. Single-field variation
consumed the entire budget in an earlier version, and could never witness an
ambiguity requiring two inputs to move together — the most common kind.

### Differential execution (`oracle/differential.ts`)

Candidates are compared by behaviour, never source. Two correct implementations
routinely share no lines; two implementations differing by one operator can be
behaviourally identical. Each candidate's results across all probes concatenate
into a behaviour vector; identical vectors are the same program.

A split is an error even with a clear plurality, because a plurality measures
popularity, not meaning.

### Attribution (`attribute/`)

Two signals, deliberately ranked:

- a **named vague phrase** from a static lexicon (`words`, `sort`, `between`,
  `average`, `the order`, …) — says *what* is underdetermined
- a **statistical contrast** — how much more often a clause is engaged by
  disagreeing inputs than by agreeing ones

The named phrase always outranks correlation. Correlation alone implicated
innocent clauses: a tax rule engaged by every input correlates with every
failure. An author sent to edit correct prose stops trusting the tool.

### Conformance (`conform/`)

Consensus is silent on correctness. Each clause is turned back into test cases
derived from that clause alone, and the built program is run against them.

The expectations are themselves filtered by consensus: several readers propose
independently, and only expectations they agree on are kept. A case readers
cannot agree about is not evidence about the program — it is more evidence about
the prose, and is reported as disputed.

### Sandbox (`execute/`)

Candidates are unreviewed generated code. They run in a fresh `node:vm` context
containing JavaScript intrinsics and nothing else — no require, no process, no
fs, no fetch, no timers. Execution is synchronous because `vm`'s timeout can
only interrupt synchronous code; a candidate that tries to be async fails to
load, which is correct.

Outcomes are compared canonically. Two candidates that both throw have agreed
about the behaviour even if they word the error differently; a candidate that
returns where another throws has genuinely diverged.

## Error handling

| Failure | Behaviour |
|---|---|
| A reader is unreachable | Recorded, ensemble shrinks, build continues, report says so |
| A candidate will not load | Excluded from grouping, reported |
| A candidate does not terminate | Killed at the timeout, counted as a failure |
| Fewer candidates than quorum | Build rejected — ambiguity cannot be ruled out |
| No API key | `shall lint` still runs; `--offline` uses cached readers |
| Unreadable cache | Recomputed |

## Verification strategy

This specification is verified against this implementation by `shall verify`:
every criterion is bound to the code that implements it and the test that proves
it, and the suite decides whether those claims still hold. Current state: 25/25.
