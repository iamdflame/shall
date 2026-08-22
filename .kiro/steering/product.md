---
inclusion: always
---

# Product — SHALL

SHALL is a language whose source code is English requirements. It answers one
question about a specification: **does it actually say one thing?**

## The problem

Spec-driven development asks people to write requirements in English and hands
them to a model. The unexamined assumption is that the English says one thing.
It frequently says two, and nobody finds out until production behaves in a way
nobody specified.

Measured on this project: six models spanning gpt-4o to gpt-5.6 were given one
short specification. They returned three behaviourally different programs. On
`"well-known state-of-the-art"` four answered 5 and two answered 2, because
nothing in the specification said whether a hyphen separates words.

## What SHALL does

- Parses a `.shall` program: an interface plus acceptance criteria in EARS
- Compiles it with an ensemble of independent readers, each asked the identical
  question and told nothing about the others
- Executes every candidate against probes in an isolated sandbox
- Groups candidates by observed behaviour, never by source text
- Rejects the build when the group count exceeds one, naming the clause
- Derives test cases from each clause and checks the built program against them

## Users

- **Authors** writing specifications who want to know what theirs does not say
- **Reviewers** who need a specification to mean one thing before approving it
- **Teams** enforcing that requirements are determinate before implementation

## Principles

1. **Measure, never ask.** Asking a model whether prose is ambiguous returns an
   opinion. Running independent readers and diffing their behaviour returns
   evidence with a witness attached.
2. **A plurality settles nothing.** Four against two is data about popularity,
   which is exactly the question a specification exists to answer.
3. **Agreement is not correctness.** Readers can agree on behaviour nobody asked
   for, so conformance is checked separately from consensus.
4. **Evidence over assertion.** Every rejection carries a concrete input, the
   differing outputs, and the reader that produced each.
5. **Degrade, never fail closed on infrastructure.** A dead reader shrinks the
   ensemble and is reported; it does not stop the build.

## Explicitly out of scope

Writing specifications. Repairing them automatically. Ranking one reader's
interpretation above another's — SHALL reports that readers disagreed and
refuses to arbitrate.
