<div align="center">

# SHALL

**A language whose source code is English.**

*When independent readers disagree about what your specification means,
that is a compile error — and it points at the sentence.*

`shall build` · `shall verify` · `shall lint` · zero-config · one dependency

</div>

---

## The one-minute version

Write a specification. Not a prompt — a specification, with an interface and
acceptance criteria in EARS:

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

Compile it:

```console
$ shall check examples/word-count.shall

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

   WITNESS  text = "well-known state-of-the-art"

     5    gpt-4.1, o4-mini, gpt-5.2, gpt-5.6-terra
     2    gpt-4o, gpt-5.6-luna

$ echo $?
1
```

That specification reads fine. Six models spanning gpt-4o to gpt-5.6 read it and
wrote **three behaviourally different programs**. Nobody said whether a hyphen
separates words, so four readers said 5 and two said 2.

Fix the sentence, and it compiles.

---

## Why this is not "ask a model if it's ambiguous"

You can ask a model whether prose is ambiguous. It will tell you, confidently,
whether or not the prose is actually underdetermined — and it cannot show you.

SHALL never asks. It runs independent readers, executes what they produce, and
diffs the behaviour. The disagreement **is** the ambiguity, and it arrives with
the exact input that exposes it. Every rejection in this README is a measurement
with a witness attached, not an opinion.

---

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

## Install

Node 20+. One runtime dependency.

```bash
git clone <this-repo> shall && cd shall
npm install && npm run build
```

```bash
echo 'OPENAI_API_KEY=sk-...' > .env      # git-ignored; the CLI loads it
```

Then:

```bash
npm test                                     # 104 tests
npm run verify                               # this repo vs its own spec — 25/25
node dist/shall/cli.js lint examples/word-count.shall   # no API key needed
node dist/shall/cli.js check examples/word-count.shall  # the real thing
```

---

## Commands

| Command | What it does |
|---|---|
| `shall build <f>` | Compile. Emits JavaScript, or fails with the clause named. |
| `shall check <f>` | Same analysis, emits nothing. For CI. |
| `shall lint <f>` | Static scan for open wording. **No model calls, no API key.** |
| `shall run <f> --input '{…}'` | Build from cache and execute one input. |
| `shall verify` | Check this repository against its own `.kiro` specification. |
| `shall models` | List the models your account can actually reach. |

| Flag | Effect |
|---|---|
| `--offline` | Use cached readers only; never call a model. |
| `--no-conform` | Consensus only, skip the conformance pass. |
| `--no-cache` | Re-ask every reader. |
| `--probes <n>` | Probe count. Probes are microseconds; readers are not. |
| `--json` | Machine-readable result. |
| `--update` | Record the drift baseline (`verify`). |

Exit codes: `0` unambiguous · `1` ambiguous or invalid · `2` could not run.

---

## Two findings that changed the design

Both were measured on this project, and both contradicted the original design.

### An ensemble of one family is not an ensemble

The first roster was five GPT-5 variants at different sizes and reasoning
efforts. It passed a specification a human would question. Every member resolved
the open clause by the same shared convention — **one wrote a comment
acknowledging the ambiguity before silently picking a side.**

Size and effort are not independence. The roster now spans generations:

```
gpt-4o · gpt-4.1 · o4-mini · gpt-5.2 · gpt-5.6-luna · gpt-5.6-terra
```

Cross-vendor readers would be better still, and the provider boundary exists so
that adding one touches nothing else.

### Human intuition about ambiguity is unreliable

A hand-written "ambiguous" example — whether a coupon applies before or after a
shipping threshold — came back **unanimous at 5,000 probes** across all six
generations. LLMs share a strong convention there that humans do not.

The ambiguity that actually splits readers was mundane: what is a *word*.

| Input | Readings | Never stated |
|---|---|---|
| `"well-known state-of-the-art"` | **5** vs **2** | does a hyphen separate words |
| `"it's don't o'clock"` | **2** vs **3** | does an apostrophe split a token |
| `"a1 22 333 4444"` | **0** vs **2** | can digits be words |
| `"one,two;three"` | **3** vs **1** | does punctuation separate words |
| `"ß Ünïcode naïve"` | **1** vs **2** | are accented characters letters |
| `"..."` | **0** vs **1** | is punctuation a three-letter word |

You cannot reason your way to which sentences are ambiguous. You have to run it.

---

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

  CONFORMANCE  100.0%  25/25 criteria proven
  ████████████████████████████████████████████████

  + 25 conformant
```

---

## Limitations

Stated plainly, because a tool about under-specification should not be
under-specified itself.

- **Same-vendor readers share blind spots.** The roster spans generations, which
  is better than sizes, but a second vendor would be better than both. Absence of
  divergence is weaker evidence than its presence.
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

---

## Repository

```
src/shall/     the language, compiler, oracle, conformance, CLI
src/ears/      EARS clause parser, shared with .kiro specs
src/{binding,verify,lock,report}/   the engine behind `shall verify`
examples/      .shall programs, each with an ambiguous and a fixed version
tests/         104 tests, TAP
.kiro/         the specification this repository is verified against
```

104 tests · 25/25 criteria proven · one runtime dependency · TypeScript strict.

## License

MIT
