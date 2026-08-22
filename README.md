<div align="center">

# SHALL

**A language whose source code is English.**

*When independent readers disagree about what your specification means,
that is a compile error — and it points at the sentence.*

`shall build` · `shall verify` · `shall lint` · zero-config · one dependency

</div>

---

## Run it in thirty seconds, with no API key

```bash
git clone https://github.com/iamdflame/shall && cd shall
npm install && npm run build
npm run install-cli          # puts `shall` on your PATH, no sudo needed

shall check examples/word-count.shall
```

```console
  replaying 6 recorded readers (2026-08-22) - --live to re-ask

AMBIGUOUS SPECIFICATION  WordCount
──────────────────────────────────────────────────────────────────

  the ensemble split into 3 distinct behaviours across 7 probe(s).
  6 readers, 23 probes, 7 disagreements

  examples/word-count.shall:10

   │  THE SYSTEM SHALL count the words in the text
   │                             ~~~~~
   └─ a "word" is undefined until the specification states how text is
      split — hyphens, apostrophes and digits are all conventions
      engaged by 7/7 disagreeing inputs but only 15/16 agreeing ones

   WITNESS  text = "a-a"
     also  text = "well-known state-of-the-art"

     5    gpt-4.1, o4-mini, gpt-5.2, gpt-5.6-terra
     2    gpt-4o, gpt-5.6-luna
```

Every bundled example ships with its **recorded ensemble** — the verbatim output
of a real run against six models, committed to this repository and stamped with
its date. Replaying costs nothing and reproduces exactly what the author saw.
`--live` re-asks the models for real.

## The specification that produced it

```
program WordCount

interface
  input  text: string
  output count: integer

Requirement 1: Words
  THE SYSTEM SHALL count the words in the text

Requirement 2: Significance
  THE SYSTEM SHALL ignore words shorter than three letters
```

That reads fine. Six models spanning gpt-4o to gpt-5.6 read it and wrote **three
behaviourally different programs**, because nobody said whether a hyphen
separates words.

## Now fix the sentence

```diff
- THE SYSTEM SHALL count the words in the text
+ THE SYSTEM SHALL split the text on runs of whitespace and treat each
+   resulting non-empty run as exactly one token, no matter which hyphens,
+   apostrophes, digits or punctuation marks it contains
```

```console
$ shall check examples/word-count.fixed.shall

UNAMBIGUOUS  WordCount
──────────────────────────────────────────────────────────────────

  6 independent readers produced the same behaviour on all 33 probes.

    = gpt-4o        = gpt-4.1       = o4-mini
    = gpt-5.2       = gpt-5.6-luna  = gpt-5.6-terra

  CONFORMANCE  100%  11/11 derived cases hold
```

One sentence. Ambiguous → unanimous. Both halves replay for free.

## Reproduce the findings

```bash
npm run findings     # ten seconds, no API key, no spend
```

Four findings, each re-run from the committed recordings rather than asserted:

| | Finding | Evidence |
|---|---|---|
| **1** | An ensemble of one model family shares its blind spots | Five same-generation readers call a spec unanimous — and two of them wrote comments silently resolving the ambiguity |
| **2** | Human intuition about ambiguity is unreliable | A clause humans read two ways is unanimous at **5,000 probes**; a mundane one splits at 23 |
| **3** | Some disagreement is arithmetic, not English | Two orderings of the same arithmetic differ by 1 ULP; reporting that as ambiguity blames an innocent clause |
| **4** | Ambiguity hides *between* precise sentences | A dice-scoring spec the lint finds nothing wrong with still splits the readers, because two clauses never say which applies first |

Finding 1's evidence is the readers' own generated source:

```js
// gpt-5 low
const shipping = discounted < 50 ? 6 : 0;   // Shipping: add 6 if order (after coupon) is below 50
```

It *noticed* the ambiguity, resolved it silently, and the ensemble reported
unanimous agreement. That is the failure mode a single-family roster has.

## Why this is not "ask a model if it's ambiguous"

You can ask a model whether prose is ambiguous. It will tell you, confidently,
whether or not the prose is actually underdetermined — and it cannot show you.

SHALL never asks. It runs independent readers, executes what they produce, and
diffs the behaviour. The disagreement **is** the ambiguity, and it arrives with
the exact input that exposes it. Every rejection in this README is a measurement
with a witness attached, not an opinion.

---

## Where this sits

| | Input | Question it answers | What it costs you |
|---|---|---|---|
| Property-based testing | running code | does it behave correctly | the code must already exist |
| Kiro spec correctness | spec + code | does the code satisfy the spec | assumes the spec means one thing |
| TLA+ / Alloy | a formal model | is the model consistent | you must abandon English |
| "Ask a model if it's ambiguous" | prose | does a model *think* it's unclear | an opinion, unfalsifiable |
| **SHALL** | **prose alone** | **does the English determine behaviour** | **N independent readers** |

The row that matters is TLA+. Formal methods answer this question rigorously and
charge you the English to do it. SHALL's bet is that you keep the English and
*measure* it instead — weaker than a proof, and available to anyone who can
write a requirement.

## What one build actually does

```
program.shall
     │
     ├── parse ──────────► an interface and EARS criteria
     │
     ├── compile ────────► N candidates from N independent readers
     │                     identical question · no reader knows the others exist
     │
     ├── probe ──────────► deterministic inputs, mined from your own thresholds
     │
     ├── execute ────────► sandboxed; results form a behaviour vector
     │
     ├── partition ──────► group by behaviour, never by source code
     │                       1 group  → consensus
     │                      >1 group  → COMPILE ERROR + clause + witness
     │
     └── conform ────────► expectations derived per clause, run against the build
                             contradiction → COMPILE ERROR, nothing emitted
```

**Consensus and conformance are different questions, and a build needs both.**
Consensus asks whether readers understood your English the same way. It is
silent on whether that shared understanding is what you wrote down — six readers
can agree on behaviour you never asked for. So each clause is turned back into
test cases and the built program is run against them.

The expectations are filtered by the same principle: several readers propose
independently, and only ones they agree on are kept. A case readers cannot agree
about is not evidence about your program — it is more evidence about your prose,
and it is reported as disputed.

---

## Install and verify

Node 20+. One runtime dependency.

```bash
npm install && npm run build

npm test          # 145 tests
npm run findings  # reproduce all three findings, no API key
npm run kiro      # what the .kiro package contains
npm run verify    # this repo against its own .kiro spec — 50/50
```

To run against **your own** specifications you need a key, since nothing is
recorded for them:

```bash
echo 'OPENAI_API_KEY=sk-...' > .env      # git-ignored; the CLI loads it
shall check my-spec.shall
shall record my-spec.shall   # commit it so others replay free
```

## Commands

| Command | What it does |
|---|---|
| `shall build <f>` | Compile. Emits JavaScript, or fails with the clause named. |
| `shall check <f>` | Same analysis, emits nothing. For CI. |
| `shall lint <f>` | Static scan for open wording. **No model calls, no API key.** |
| `shall record <f>` | Ask the readers for real and commit the result to `recordings/`. |
| `shall suggest <f>` | Propose a rewrite for each reading; `--apply <n>` writes it and re-checks. |
| `shall run <f> --input '{…}'` | Build from cache and execute one input. |
| `shall verify` | Check this repository against its own `.kiro` specification. |
| `shall models` | List the models your account can actually reach. |

| Flag | Effect |
|---|---|
| `--live` | Re-ask every reader for real. Costs money. |
| `--dry-run` | Show what a run would cost and which readers are reachable. |
| `--offline` | Never call a model, even if nothing is recorded. |
| `--no-conform` | Consensus only, skip the conformance pass. |
| `--no-cache` | Re-ask every reader. |
| `--probes <n>` | Probe count. Probes are microseconds; readers are not. |
| `--json` | Machine-readable result. |
| `--update` | Record the drift baseline (`verify`). |

Exit codes: `0` unambiguous · `1` ambiguous or invalid · `2` could not run.

---

## The findings in detail

### An ensemble of one family is not an ensemble

The first roster was five GPT-5 variants at different sizes and reasoning
efforts. It passed a specification a human would question. Every member resolved
the open clause the same way, and two wrote comments showing they had noticed it.

Size and effort are not independence. The roster now spans generations:

```
gpt-4o · gpt-4.1 · o4-mini · gpt-5.2 · gpt-5.6-luna · gpt-5.6-terra
```

Cross-vendor readers would be better still. The provider boundary exists so that
adding one touches nothing else — every vendor with an OpenAI-compatible
endpoint fits behind it without a new dependency. **This remains the single
biggest known weakness**, and the honest version of the roster claim is that
spanning generations is better than spanning sizes, not that it is sufficient.

### You cannot reason your way to which sentences are ambiguous

A hand-written "ambiguous" example — whether a coupon applies before or after a
shipping threshold — came back **unanimous at 5,000 probes** across all six
generations. Models share a strong convention there that humans do not.

The ambiguity that actually split readers was mundane: what is a *word*.

| Input | Readings | Never stated |
|---|---|---|
| `"well-known state-of-the-art"` | **5** vs **2** | does a hyphen separate words |
| `"it's don't o'clock"` | **2** vs **3** | does an apostrophe split a token |
| `"a1 22 333 4444"` | **0** vs **2** | can digits be words |
| `"one,two;three"` | **3** vs **1** | does punctuation separate words |
| `"ß Ünïcode naïve"` | **1** vs **2** | are accented characters letters |
| `"..."` | **0** vs **1** | is punctuation a three-letter word |

### Some disagreement is arithmetic

`0.1 + 0.2` and `0.3` are different numbers. Two readers that understood the
specification identically, differing only in the order they multiplied, were
being reported as an **ambiguous specification** pointing at an innocent clause.

Divergences are now classified. A split explained entirely by floating point is
reported separately and does not fail the build:

```
  FLOATING-POINT DIVERGENCE
  readers agree on the behaviour; they differ by a few ULPs at 3 probe(s).
  This is IEEE 754, not your English. State a rounding mode to remove it.
```

The distinction matters because false positives are fatal here — an author sent
to edit correct prose stops trusting the tool. Catastrophic cancellation is
deliberately **not** absorbed into this class: `big - big*p` produces genuinely
different numbers relative to a tiny result, and calling that equivalent would
be the tool lying.

## Ending in a decision, not a complaint

A report that says "this is ambiguous" leaves the author to guess which of
several behaviours they meant. Each behaviour group the readers formed *is* a
coherent reading, so each one can be offered as a sentence:

```console
$ shall suggest examples/word-count.shall

  This clause splits the readers 3 ways. Each rewrite below would compile.

  [1]  4 readers  gpt-4.1, o4-mini, gpt-5.2, gpt-5.6-terra
       text = "a-a"  ->  0
       <a rewrite that pins this reading>

  [2]  1 reader   gpt-4o
       text = "a-a"  ->  1
       <a rewrite that pins the other>

$ shall suggest examples/word-count.shall --apply 1
  wrote reading 1 into examples/word-count.shall:10
  re-checking...
```

The rewrite is a model call and is untrusted. The check that it works is the
deterministic oracle. Suggestion is cheap and fallible; proof is not.

**Witnesses are minimised first.** `"well-known state-of-the-art"` proves the
readers disagree; `"a-a"` proves it with nothing else in the input to blame.
Deletion alone gets stuck at `"ell-kno"` — short but still full of irrelevant
detail — so characters are simplified as well as deleted.

**When no single clause is responsible, pairs are checked.** Ambiguity often
lives *between* two precise sentences rather than inside one vague one:

```
  No single clause is responsible - these two interact
      engaged together by 8/8 disagreeing inputs but only 47/88 agreeing ones

   fee.shall:9   THE SYSTEM SHALL reduce the amount by the discountPercent
   fee.shall:12  IF the amount is below 50 THEN the system SHALL add a fee of 6

   Neither says which applies first.
```

## Design decisions worth knowing

**The prompt's most important property is what it omits.** It never tells a
reader how to resolve unclear wording — no "make reasonable assumptions", no
worked edge cases. Any such instruction pushes every reader toward the *same*
resolution, and the ensemble would report consensus on genuinely ambiguous
prose. Readers are also never told other readers exist.

**A plurality settles nothing.** Four against two is rejected. A plurality is
evidence about which reading is more popular, which is exactly the question a
specification exists to answer.

**Behaviour is compared, never source.** Two correct implementations routinely
share no lines; two differing by one operator can be identical. Each candidate's
results across all probes form a behaviour vector.

**Probes are spec-aware and free.** A threshold is only interesting near where it
trips, so every number your specification mentions is mined and probed with its
neighbours. Half the budget is reserved for input *interactions* — single-field
variation can never witness an ambiguity needing two inputs to move together.

**Named wording outranks correlation.** A clause containing `words`, `sort`,
`between`, `average` is ranked above one implicated only statistically.
Correlation alone blamed innocent clauses — a tax rule engaged by every input
correlates with every failure — and an author sent to edit correct prose stops
trusting the tool.

**Candidates are untrusted.** They run in a fresh `node:vm` context with
JavaScript intrinsics and nothing else: no require, no process, no fs, no fetch,
no timers, and a wall-clock timeout.

---

## How Kiro is used

`.kiro/` is not build residue here; it is the contract this repository is held
to, continuously.

- **[`specs/shall-language/`](.kiro/specs/shall-language/)** — `requirements.md`
  (25 EARS criteria across 6 requirements), `design.md` (architecture and the
  reasoning behind each decision, including the two findings above), `tasks.md`
  (49 tasks traced to the requirements they satisfy).
- **[`steering/`](.kiro/steering/)** — `product.md`, `tech.md`, `structure.md`,
  loaded into every Kiro interaction. `tech.md` encodes the one-dependency rule
  and the provider boundary; `structure.md` encodes the layering rule.
- **[`hooks/shall-hooks.json`](.kiro/hooks/shall-hooks.json)** — three agent
  hooks: re-verify the repository on any source save, lint any `.shall` file on
  save (free, no API key), and prompt for re-verification when a requirement
  changes, because editing a criterion voids its previous proof.

Every one of those 25 criteria is bound to the code implementing it and the test
proving it:

```console
$ npm run verify

shall verify - this repository against its own specification
----------------------------------------------------------------

  CONFORMANCE  100.0%  50/50 criteria proven
  ████████████████████████████████████████████████

  + 50 conformant
```

---

## Limitations

Stated plainly, because a tool about under-specification should not be
under-specified itself.

- **Same-vendor readers share blind spots.** The roster spans generations, which
  is better than sizes, but a second vendor would be better than both. Any vendor
  with an OpenAI-compatible endpoint now works — set `ANTHROPIC_API_KEY`,
  `GEMINI_API_KEY`, `GROQ_API_KEY` and the roster widens — and the CLI says so
  whenever every reachable reader comes from one vendor. **The cross-vendor delta
  is not yet measured**, and that measurement would be the most valuable finding
  this project could produce.
- **Consensus is not proof of correctness.** The conformance pass narrows this
  but relies on model-derived expectations, filtered by agreement. A clause all
  readers misread the same way is reported as satisfied.
- **The interface is minimal** — scalars and lists, one output. Records and
  optional fields are not implemented.
- **Attribution is evidential, not causal.** It reports which clause the
  disagreements concentrate on. Ambiguity from an *interaction* between clauses
  is reported as "no single clause is clearly responsible".
- **The vagueness lint is a heuristic.** It fires on wording that is often open;
  plenty of correct specifications use those words unambiguously. It is always a
  warning, never an error.
- **Compiled output is JavaScript.** Nothing in the design is language-specific,
  but nothing else is implemented.
- **Numeric equivalence is a relative-epsilon test**, not a bit-exact ULP count,
  tuned at 4 ULPs. It is deliberately conservative: it never bridges zero or a
  sign change, and it never absorbs catastrophic cancellation. Of the seven
  bundled examples, one produces float-only divergence; before this class
  existed that example would have been reported as an ambiguous specification.
- **Recordings are a snapshot.** A replay reproduces the run it captured, not
  what those models would say today. `--live` is the only current answer.

---

## Repository

```
src/shall/     the language, compiler, oracle, conformance, CLI
src/ears/      EARS clause parser, shared with .kiro specs
src/{binding,verify,lock,report}/   the engine behind `shall verify`
examples/      .shall programs, each with an ambiguous and a fixed version
recordings/    committed ensemble outputs, so every example replays for free
scripts/       findings.mjs — reproduces all three findings offline
tests/         145 tests, TAP
.kiro/         the specification this repository is verified against
```

145 tests · 50/50 criteria proven · 47 recorded readers · one runtime dependency.

[`PROVENANCE.md`](PROVENANCE.md) records honestly how this repository was built,
including that the first commit contained the whole initial project.

## License

MIT
