# Ready, Spec, Ship — Submission

**Project:** SHALL — a language whose source code is English
**Repository:** https://github.com/iamdflame/shall
**Live site:** https://shall-david-praises-projects.vercel.app
**Demo video:** https://youtu.be/peMdu3rn8Yc

> Every figure in this document was measured on the submitted commit. Nothing
> here needs an API key to verify.

---

## Project description

SHALL is a programming language whose source code is English requirements, and a
compiler that refuses to build when those requirements do not say one thing.

A `.shall` program is a specification: a type signature and a set of acceptance
criteria written in EARS — exactly the format Kiro generates. There is no
implementation file. To compile it, SHALL sends the specification to an ensemble
of independent language models, each given byte-identical instructions and none
told the others exist. Every program they write is then executed against the same
generated inputs inside an isolated sandbox, and the results are compared.

If every reader produced the same behaviour, the English determined the program,
and SHALL emits it. If they split, the English did not determine it — and that is
a **compile error**, reported the way a compiler reports one: the responsible
sentence, the phrase underlined, and the smallest input that proves the
disagreement.

Consensus alone is not enough, so a second pass turns each clause back into test
cases and runs the built program against them. Six readers can agree on behaviour
nobody asked for; agreement is not correctness, and the two are checked
separately.

The result is a tool that answers a question nothing else answers: **does this
specification actually say one thing?** Not "does a model think it is unclear" —
that returns an opinion. SHALL returns a measurement with a witness attached.

---

## What problem does the project solve?

**Spec-driven development assumes the specification means one thing. It very
often means two, and nobody finds out until production behaves in a way nobody
specified.**

Kiro, spec-kit and every agentic workflow built on requirements share the same
unexamined premise: that the English handed to the model is determinate. The
whole toolchain downstream — design docs, task lists, generated code, tests —
inherits whatever the model happened to assume. When a requirement is
underdetermined, the assumption is invisible, unrecorded, and only discovered
when someone notices the software doing something no one asked for.

This is not hypothetical. It is measured in this repository.

Here is a complete specification. Two sentences. Read it and decide whether it is
clear:

```
Requirement 1: Words
  THE SYSTEM SHALL count the words in the text

Requirement 2: Significance
  THE SYSTEM SHALL ignore words shorter than three letters
```

Six models — gpt-4o, gpt-4.1, o4-mini, gpt-5.2, gpt-5.6-luna, gpt-5.6-terra —
were each given that specification and asked to implement it. They returned
**three behaviourally different programs.**

| Input | Answers | What was never stated |
|---|---|---|
| `"well-known state-of-the-art"` | **5** vs **2** | does a hyphen separate words |
| `"it's don't o'clock"` | **2** vs **3** | does an apostrophe split a token |
| `"a1 22 333 4444"` | **0** vs **2** | can digits be words |
| `"one,two;three"` | **3** vs **1** | does punctuation separate words |
| `"ß Ünïcode naïve"` | **1** vs **2** | are accented characters letters |
| `"..."` | **0** vs **1** | is punctuation a three-letter word |

Nobody wrote down what a *word* is. Every reader had to decide, each decided
silently, and they did not decide the same way. In a normal spec-driven workflow
one of those six programs ships and the other five readings are lost.

### Why existing tools do not catch this

| | Input | Question it answers | What it cannot do |
|---|---|---|---|
| Property-based testing | running code | does it behave correctly | needs the code to exist |
| Kiro / spec correctness checks | spec + code | does the code satisfy the spec | assumes the spec means one thing |
| TLA+, Alloy | a formal model | is the model consistent | you must abandon English |
| Asking a model "is this ambiguous?" | prose | does a model *think* it is unclear | returns an opinion, cannot show you |
| **SHALL** | **prose alone** | **does the English determine behaviour** | needs N independent readers |

The row that matters is TLA+. Formal methods answer this rigorously and charge
you the English to do it. SHALL's bet is that you keep the English and *measure*
it instead — weaker than a proof, and available to anyone who can write a
requirement.

### The cost of being wrong

The bundled `order-total.shall` example contains a genuine ordering ambiguity:
whether a shipping threshold applies before or after a coupon. On a £51 order
with a 6% coupon, the two readings differ by **£6.48**. That is a billing
incident, written in a sentence that reads perfectly.

---

## Key features

### 1. English compiles to a working program

```bash
shall build examples/word-count.fixed.shall
```

A `.shall` file has one formal construct — the interface — and everything else is
prose. The interface exists only because the oracle needs a signature it can
generate inputs for and compare outputs across.

### 2. Disagreement is a compile error, with the sentence named

```
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

Exit code `1`. Usable in CI.

### 3. Witnesses are minimised

`"well-known state-of-the-art"` proves the readers disagree. `"a-a"` proves it and
leaves nothing else in the input to blame. Delta debugging shrinks each witness,
simplifying characters as well as deleting them — deletion alone stalls at
`"ell-kno"`, which is short but still full of irrelevant detail.

### 4. Behaviour is compared, never source code

Two correct implementations of one requirement routinely share no lines at all;
two differing by one operator can be behaviourally identical. Each candidate runs
against every probe and its results concatenate into a **behaviour vector**.
Identical vectors are the same program, whatever the code looks like.

### 5. A plurality settles nothing

Four readers against two is still a compile error. A plurality is evidence about
which interpretation is more popular — precisely the question a specification
exists to answer.

### 6. Probes are specification-aware and free

Three tiers, all deterministic: type-derived edge values, every numeric literal
the specification itself mentions plus its neighbours, and a dense sweep when the
budget is large. Half the budget is reserved for input *interactions*, because an
ambiguity requiring two inputs to move together is the most common kind and
single-field variation can never witness it.

### 7. Consensus is checked separately from correctness

After readers agree, each clause is turned back into test cases and the built
program is run against them. The expectations are themselves filtered by
agreement: several readers propose independently, and only ones they agree on are
kept. A case they cannot agree about is not evidence about the program — it is
more evidence about the prose, and is reported as disputed.

### 8. Ordering ambiguity is attributed to clause *pairs*

"No single clause is responsible" is a dead end. Ambiguity often lives *between*
two precise sentences — two rules, each unambiguous alone, silent about which
applies first. Pairs are ranked by how much of the disagreement they account for:

```
  No single clause is responsible - these two interact
      engaged together by 8/8 disagreeing inputs but only 47/88 agreeing ones

   fee.shall:9   THE SYSTEM SHALL reduce the amount by the discountPercent
   fee.shall:12  IF the amount is below 50 THEN the system SHALL add a fee of 6

   Neither says which applies first.
```

### 9. The report ends in a decision

```bash
shall suggest examples/word-count.shall
shall suggest examples/word-count.shall --apply 1
```

Each behaviour group *is* a coherent reading, so each is offered as a rewrite with
the input and output it produces. `--apply` writes the sentence and immediately
re-runs the check. The proposal is a model call and is untrusted; the
verification is the deterministic oracle.

### 10. Some disagreement is arithmetic, not English

`0.1 + 0.2` and `0.3` are different numbers. Two readers who understood the
specification identically, differing only in multiplication order, were being
reported as an ambiguous specification pointing at an innocent clause.
Divergences are now classified, and float-only splits are reported separately
without failing the build. Catastrophic cancellation is deliberately excluded
from that class — calling it "equivalent" would be the tool lying.

### 11. Untrusted code, properly sandboxed

Candidates are model-generated and unreviewed. They execute in a fresh `node:vm`
context with JavaScript intrinsics and nothing else: no `require`, no `process`,
no `fs`, no `fetch`, no timers, and a wall-clock timeout. Each candidate is also
run forwards and backwards over the probe set; if a candidate carried state
between calls its two vectors disagree, and it is **excluded and named as
non-deterministic** rather than silently averaged into the result.

### 12. Everything replays for free

Every bundled example ships its **recorded ensemble** — the verbatim output of a
real run against six models, committed and stamped with its date. Replaying costs
nothing and reproduces exactly what the author saw. It is never presented as a
live run: the banner states it is a replay and when it was recorded, and `--live`
re-asks the models for real.

### 13. Any vendor, no new dependency

Anthropic, Google, Groq, DeepSeek, Mistral, OpenRouter, Together and a local
Ollama all speak the OpenAI wire format, so one compatible client reaches all of
them. Readers whose vendor has no key are dropped and reported, and a roster that
ends up single-vendor prints a standing note that same-vendor readers share blind
spots.

---

## Target users

**Anyone whose work starts with a written requirement and ends with software.**

| User | What they get |
|---|---|
| **Engineers working spec-first** — Kiro, spec-kit, any agentic workflow | Find out that a requirement is underdetermined *before* an agent silently resolves it and builds on the assumption |
| **Reviewers and tech leads** | A specification with a machine-checkable property: it means one thing. `shall check` exits non-zero, so it can gate a pull request |
| **Product managers and BAs writing acceptance criteria** | `shall lint` needs no API key and no engineering knowledge. It names open wording — *word*, *sort*, *between*, *average*, *the order* — and says why each is undefined |
| **Teams in regulated or high-consequence domains** | Requirements ambiguity in billing, pricing, eligibility or scoring is an incident waiting to happen. The `order-total` example is a £6.48 discrepancy hidden in one clause |
| **Researchers on LLM agreement and evaluation** | A reproducible harness for measuring inter-model behavioural agreement, with committed recordings so results are re-runnable |

The immediate audience is the second group. A reviewer approving a specification
today has no way to know whether it means one thing. This gives them one.

---

## Project type

**Developer tool** — a command-line compiler, language and CI gate, published as
a Node package with a public API, plus a static project site.

If a single category is required: **Developer tool / CLI.**

Secondary characterisations, if multiple apply:
- **Programming language** — `.shall` is a real language with a grammar, a parser and a compiler
- **Testing / QA tool** — the oracle is differential testing over generated inputs
- **AI / agent infrastructure** — an ensemble compiler and an evaluation harness

It is **not** a web app. The deployed site is the project page; the product is
the CLI and library.

---

## Public repository URL

**https://github.com/iamdflame/shall**

Public, MIT licensed, `main` branch, 17 commits.

---

## Live demo, deployed app, or test build URL

**https://shall-david-praises-projects.vercel.app**

The project site, deployed on Vercel. Deployment protection is **off** — it opens
for anyone, signed in or not.

Its centrepiece is a **witness explorer running on real recorded measurements**,
not a mock-up. Pick an input and see what each of the six readers actually
returned; the data is generated from the committed recordings by
`scripts/site-data.mjs`, so the page cannot drift from what the CLI replays.

Because SHALL is a CLI, the truest "live demo" is the two-command replay in the
next section — it runs the real tool, on the judge's machine, with no key.

---

## Demo video URL

**https://youtu.be/peMdu3rn8Yc**

Three minutes. The specification, the split, the minimal witness, the one-sentence
fix, `npm run verify` reaching 50/50, and the findings reproducing.

---

## Setup and testing notes

### Everything below runs with no API key and spends nothing

This matters, so it is worth stating plainly: **judges do not need an OpenAI key,
an account, or any credentials to verify every claim in this submission.** The
recorded ensembles are committed to the repository.

### Sixty seconds, three commands

```bash
git clone https://github.com/iamdflame/shall && cd shall
npm install && npm run build
npm run install-cli          # puts `shall` on PATH — no sudo needed
```

> Use `npm run install-cli`, **not** `npm link`. On most Linux installs npm's
> global prefix is a system directory and `npm link` fails with a permissions
> error. `install-cli` writes a small wrapper into `~/.local/bin`.
> If you would rather not touch your PATH at all, every `shall …` command below
> also works as `node dist/shall/cli.js …`.

### The one command that shows the whole thing

```bash
shall check examples/word-count.shall
```

Expected: a replay banner, then `AMBIGUOUS SPECIFICATION`, the clause at line 10
with `words` underlined, the minimal witness `text = "a-a"`, and the readers
grouped by what each returned. **Exit code 1.** Takes about 2 seconds.

### Then watch one sentence fix it

```bash
shall check examples/word-count.fixed.shall
```

Expected: `UNAMBIGUOUS`, six readers agreeing on all 33 probes, and
`CONFORMANCE 100% · 11/11 derived cases hold`. **Exit code 0.** About 1 second.

### Reproduce the four findings

```bash
npm run findings
```

Expected: 12 checks pass in roughly 15 seconds, ending in
`all findings reproduced — no API key, no spend`. Progress is printed throughout,
so it never looks stalled.

### Verify the repository against its own Kiro specification

```bash
npm run kiro     # what the .kiro package contains
npm run verify   # check the code against it
```

Expected: the listing totals **50 criteria**, and `verify` reports
`CONFORMANCE 100.0% · 50/50 criteria proven`. The two numbers matching is the
point — `verify` runs the full test suite and joins each result back to the
criterion it proves, so it takes about 16 seconds.

### The rest

```bash
npm test                                  # 148 tests, 18 files, TAP
shall lint examples/order-total.shall     # static scan, no model, no key
shall suggest examples/word-count.shall   # needs a key: proposes rewrites
shall check <file> --dry-run              # what a real run would cost
shall check <file> --live                 # re-ask the models for real
```

Only `suggest` and `--live` require `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`,
`GEMINI_API_KEY`, `GROQ_API_KEY`, …). Nothing in the evaluation path needs one.

### Requirements

Node.js **20 or newer**. One runtime dependency (`openai`). No database, no
services, no Docker, no build step beyond `tsc`.

### Continuous integration

`.github/workflows/ci.yml` runs the tests, reproduces all four findings, verifies
the repository against its own specification, and asserts every bundled example
still resolves as recorded — all without secrets, because the recordings are
committed. `.github/workflows/spec-gate.yml` is the adoption path: any `.shall`
file changed in a pull request must lint and check before it can merge.

---

## Test credentials

**None required.** There is no login, no account, no database and no hosted
service. Everything is a local CLI plus a static site.

If you wish to run the ensemble live rather than replaying, set your own key:

```bash
echo 'OPENAI_API_KEY=sk-...' > .env     # git-ignored; the CLI loads it
shall check examples/word-count.shall --live
```

A live run of one example costs roughly **$0.02–0.05**. `--dry-run` reports the
estimate and which readers are reachable before anything is spent.

---

## How Kiro was used

`.kiro/` here is not build residue that was generated once and abandoned. It is
the contract this repository is continuously held to, and it is also the format
the product itself consumes.

**Four specs, 50 EARS acceptance criteria** — `shall-language` (25 criteria, plus
`design.md` recording the reasoning behind each decision and `tasks.md` tracing
49 tasks to the requirements they satisfy), `offline-replay`,
`multi-vendor-ensemble` and `disambiguation`.

**Three steering documents** loaded into every Kiro interaction — `product.md`,
`tech.md` (which encodes the hard one-dependency rule and the provider boundary)
and `structure.md` (the layering rule that modules never reach upward).

**Three agent hooks** — re-verify the repository on any source save; lint any
`.shall` file on save, which is free and needs no key; and prompt for
re-verification when a requirement changes, because editing a criterion voids its
previous proof.

**Every criterion is bound to the code that implements it and the test that
proves it**, via `@shall <spec>/<id>` annotations, and `npm run verify` checks all
50 on demand. Writing the three newer specs immediately found two real defects:
adding a second spec made every bare `@shall 1.1` ambiguous across specs — the
tool's own ambiguity guard firing on its own repository — and the binding scanner
stopped at the first line beneath an annotation, so where several criteria are
proven by one test only the last one bound.

---

## Findings

Four results, each reproducible offline in about fifteen seconds by
`npm run findings`. Two of them contradicted the design and forced it to change.

### 1 — An ensemble of one model family shares its blind spots

The first roster was five GPT-5 variants at different sizes and reasoning efforts.
It passed a specification a human would question. Every member resolved the open
clause the same way — and **two wrote comments in their own generated code showing
they had noticed the ambiguity and quietly picked a side**:

```js
// gpt-5 low
const shipping = discounted < 50 ? 6 : 0;   // Shipping: add 6 if order (after coupon) is below 50
```

Size and effort are not independence. The roster now spans generations.

### 2 — Human intuition about ambiguity is unreliable

A hand-written "obviously ambiguous" example — whether a coupon applies before or
after a shipping threshold — came back **unanimous at 5,000 probes** across all
six generations. Models share a strong convention there that humans do not. The
ambiguity that actually split them was mundane: what is a *word*.

You cannot reason your way to which sentences are ambiguous. You have to run it.

### 3 — Some ensemble disagreement is arithmetic, not English

Two orderings of the same multiplication differ by one unit in the last place.
Reporting that as ambiguity sends an author to edit a sentence that was already
correct — and an author sent to edit correct prose stops trusting the tool.

### 4 — Ambiguity hides between precise sentences

A dice-scoring specification that the static lint finds nothing wrong with still
splits the readers, because two clauses never say which applies first:

```
    ✓ the static lint finds nothing to complain about
    ✓ yet the readers still split
        witness {"dice":[0,0,0,0,0]}
        2000   gpt-4o, o4-mini, gpt-5.2, gpt-5.6-luna, gpt-5.6-terra
        0      gpt-4.1
    ✓ a hand of three matching dice splits them too
        roll    [1,1,1,2,2]
        100    gpt-4o, gpt-4.1, o4-mini, gpt-5.2, gpt-5.6-terra
        250    gpt-5.6-luna
```

On `[1,1,1,2,2]` one reader scored the three matching dice **both** as a set and
again as singles — 250 against 100 — because nothing says whether a die consumed
by a set is still "remaining".

---

## Limitations

Stated plainly, because a tool about under-specification should not be
under-specified itself.

- **Same-vendor readers share blind spots.** The roster spans generations, which
  is better than sizes, but a second vendor would be better than both. The
  multi-vendor provider is implemented and any OpenAI-compatible endpoint works —
  but **the cross-vendor delta is not yet measured**, and that measurement would
  be the most valuable finding this project could produce.
- **Consensus is not proof of correctness.** The conformance pass narrows this,
  but it relies on model-derived expectations filtered by agreement. A clause all
  readers misread the same way is reported as satisfied.
- **The interface is minimal** — scalars and lists, one output. Records and
  optional fields are not implemented.
- **Attribution is evidential, not causal.** It reports which clause the
  disagreements concentrate on. The engagement heuristic is lexical, so it misses
  a clause that refers to an input by a different word ("die" where the input is
  `dice`) — in that case the report honestly says no single clause is responsible
  rather than guessing.
- **Numeric equivalence is a relative-epsilon test** at 4 ULPs, not a bit-exact
  ULP count. It never bridges zero or a sign change and never absorbs
  catastrophic cancellation.
- **Recordings are a snapshot.** A replay reproduces the run it captured, not what
  those models would say today. `--live` is the only current answer.
- **Compiled output is JavaScript.** Nothing in the design is language-specific,
  but nothing else is implemented.

---

## A note on the commit history

The first commit contains the whole initial project. All of SHALL was built in a
single continuous session and committed at the end rather than incrementally;
every commit after that is genuine incremental work.

[`PROVENANCE.md`](PROVENANCE.md) states this plainly, lists the evidence that does
exist — filesystem timestamps matching the task order in `tasks.md`, dated
recordings containing real API responses, and the re-runnable findings — and is
explicit about what it does *not* claim. It is raised here rather than left for
someone to notice.

---

## Verified figures

Measured on the submitted commit.

| | |
|---|---|
| Tests | **148** passing, 18 files |
| Acceptance criteria verified | **50 / 50** |
| Kiro specs · hooks · steering docs | 4 · 3 · 3 |
| Recorded readers · programs | 47 · 7 |
| Source | 5,287 lines, 29 TypeScript files |
| Runtime dependencies | **1** (`openai`) |
| Example specifications | 7 |
| `npm run findings` | 12 checks, ~15s, no API key |
| Exit codes | ambiguous `1` · unambiguous `0` · cannot run `2` |
