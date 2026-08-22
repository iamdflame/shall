import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEars, describe as describeClauses } from '../dist/ears/parser.js';
import { parseRequirementsDocument } from '../dist/ears/spec-reader.js';

test('event pattern: WHEN … THEN … SHALL', () => {
  const r = parseEars('WHEN a user submits valid registration data THEN the system SHALL create a new user account');
  assert.equal(r.pattern, 'event');
  assert.equal(r.clauses.trigger, 'a user submits valid registration data');
  assert.equal(r.clauses.subject, 'the system');
  assert.equal(r.clauses.response, 'create a new user account');
  assert.equal(r.clauses.negated, false);
});

test('unwanted pattern: IF … THEN … SHALL', () => {
  const r = parseEars('IF the input is invalid THEN the system SHALL display an error');
  assert.equal(r.pattern, 'unwanted');
  assert.equal(r.clauses.condition, 'the input is invalid');
  assert.equal(r.clauses.response, 'display an error');
});

test('state pattern: WHILE … SHALL, with no THEN separator', () => {
  const r = parseEars('WHILE a file is uploading the system SHALL display progress');
  assert.equal(r.pattern, 'state');
  assert.equal(r.clauses.state, 'a file is uploading');
  assert.equal(r.clauses.subject, 'the system');
  assert.equal(r.clauses.response, 'display progress');
});

test('optional pattern: WHERE … SHALL', () => {
  const r = parseEars('WHERE the application runs on mobile the system SHALL use a compact layout');
  assert.equal(r.pattern, 'optional');
  assert.equal(r.clauses.context, 'the application runs on mobile');
  assert.equal(r.clauses.response, 'use a compact layout');
});

test('ubiquitous pattern: bare SHALL', () => {
  const r = parseEars('THE SYSTEM SHALL log every authentication attempt');
  assert.equal(r.pattern, 'ubiquitous');
  assert.equal(r.clauses.subject, 'the system');
  assert.equal(r.clauses.response, 'log every authentication attempt');
});

test('complex pattern: WHILE + WHEN', () => {
  const r = parseEars('WHILE the session is active WHEN the token expires THEN the system SHALL refresh it');
  assert.equal(r.pattern, 'complex');
  assert.equal(r.clauses.state, 'the session is active');
  assert.equal(r.clauses.trigger, 'the token expires');
  assert.equal(r.clauses.response, 'refresh it');
});

test('named subject is preserved, not flattened to "the system"', () => {
  const r = parseEars('WHEN drift is detected THEN Keel SHALL exit with a non-zero status');
  assert.equal(r.clauses.subject, 'Keel');
  assert.equal(r.clauses.response, 'exit with a non-zero status');
});

test('SHALL NOT is recorded as a prohibition', () => {
  const r = parseEars('IF the lockfile is absent THEN the system SHALL NOT report drift');
  assert.equal(r.clauses.negated, true);
  assert.equal(r.clauses.response, 'report drift');
});

test('markdown decoration is stripped', () => {
  const r = parseEars('3. **WHEN** the parser encounters `SHALL` **THEN** the system SHALL emit a criterion');
  assert.equal(r.pattern, 'event');
  assert.equal(r.clauses.trigger, 'the parser encounters SHALL');
});

test('lowercase keywords still parse', () => {
  const r = parseEars('when the build fails then the system shall halt the pipeline');
  assert.equal(r.pattern, 'event');
  assert.equal(r.clauses.response, 'halt the pipeline');
});

test('missing SHALL is malformed with a useful diagnostic', () => {
  const r = parseEars('The system should probably handle errors well');
  assert.equal(r.pattern, 'malformed');
  assert.match(r.diagnostic ?? '', /no SHALL/);
});

test('two SHALL clauses are rejected as unsplittable', () => {
  const r = parseEars('WHEN x happens THEN the system SHALL do a and SHALL do b');
  assert.equal(r.pattern, 'malformed');
  assert.match(r.diagnostic ?? '', /multiple SHALL/);
});

test('dangling THEN is rejected', () => {
  const r = parseEars('THEN the system SHALL do something');
  assert.equal(r.pattern, 'malformed');
  assert.match(r.diagnostic ?? '', /without a preceding WHEN or IF/);
});

test('SHALL with no response is malformed', () => {
  const r = parseEars('WHEN x happens THEN the system SHALL');
  assert.equal(r.pattern, 'malformed');
  assert.match(r.diagnostic ?? '', /no response clause/);
});

test('describe() renders a readable one-liner', () => {
  const r = parseEars('WHILE syncing WHEN a conflict occurs THEN Keel SHALL NOT overwrite local edits');
  assert.equal(
    describeClauses(r.clauses),
    'while syncing, when a conflict occurs, Keel shall not overwrite local edits',
  );
});

const DOC = `# Requirements

## Introduction

Keel verifies that shipped code still satisfies its specs.

### Requirement 1: Spec parsing

**User Story:** As a developer, I want my specs parsed, so that criteria become checkable.

#### Acceptance Criteria

1. WHEN a requirements.md file is present THEN Keel SHALL extract every acceptance criterion
2. IF a criterion is not valid EARS THEN Keel SHALL report it as malformed

### Requirement 2: Drift detection

**User Story:** As a maintainer, I want drift caught, so that specs stay true.

#### Acceptance Criteria

1. WHEN bound code changes THEN Keel SHALL mark the criterion as drifted

## Non-Functional Requirements

Some prose that is not a criterion.
`;

test('document parser extracts requirements, stories and criteria', () => {
  const spec = parseRequirementsDocument(DOC, 'keel-core', '/tmp/requirements.md');
  assert.equal(spec.name, 'keel-core');
  assert.equal(spec.requirements.length, 2);

  const [r1, r2] = spec.requirements;
  assert.equal(r1.title, 'Spec parsing');
  assert.equal(r1.userStory?.role, 'developer');
  assert.equal(r1.userStory?.benefit, 'criteria become checkable');
  assert.equal(r1.criteria.length, 2);
  assert.equal(r1.criteria[0].id, '1.1');
  assert.equal(r1.criteria[0].qualifiedId, 'keel-core/1.1');
  assert.equal(r1.criteria[1].id, '1.2');

  assert.equal(r2.criteria.length, 1);
  assert.equal(r2.criteria[0].id, '2.1');
  assert.match(spec.introduction ?? '', /verifies that shipped code/);
});

test('prose after the acceptance block is not mistaken for criteria', () => {
  const spec = parseRequirementsDocument(DOC, 'keel-core', '/tmp/requirements.md');
  const total = spec.requirements.reduce((n, r) => n + r.criteria.length, 0);
  assert.equal(total, 3);
});

test('fenced code blocks are never parsed as criteria', () => {
  const doc = `### Requirement 1: Docs

#### Acceptance Criteria

1. WHEN documenting THEN Keel SHALL show examples

\`\`\`
WHEN this is an example THEN the system SHALL be ignored
\`\`\`
`;
  const spec = parseRequirementsDocument(doc, 's', '/tmp/r.md');
  assert.equal(spec.requirements[0].criteria.length, 1);
});

test('template placeholders are skipped, not counted as real criteria', () => {
  const doc = `### Requirement 1: Template

#### Acceptance Criteria

1. WHEN [specific event or trigger] THEN [system name] SHALL [specific system response]
2. WHEN a real thing happens THEN Keel SHALL do a real thing
`;
  const spec = parseRequirementsDocument(doc, 's', '/tmp/r.md');
  assert.equal(spec.requirements[0].criteria.length, 1);
  assert.equal(spec.requirements[0].criteria[0].id, '1.1');
});
