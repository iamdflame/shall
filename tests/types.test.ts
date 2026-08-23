import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseType, TypeError } from '../dist/shall/lang/type-parser.js';
import { typeName, scalarsWithin, isRecordType, isListType } from '../dist/shall/lang/types.js';
import { parseShall, hasFatal } from '../dist/shall/lang/parser.js';
import { structuralProbes } from '../dist/shall/oracle/probes.js';
import { minimiseWitness } from '../dist/shall/oracle/minimise.js';

/* ── the grammar ────────────────────────────────────────────────────────── */

test('scalars parse', () => {
  for (const t of ['integer', 'number', 'string', 'boolean']) {
    assert.equal(parseType(t), t);
  }
});

test('types nest arbitrarily', () => {
  assert.equal(typeName(parseType('list<integer>')), 'list<integer>');
  assert.equal(typeName(parseType('list<list<string>>')), 'list<list<string>>');
  assert.equal(
    typeName(parseType('{ subtotal: number, coupon: integer }')),
    '{ subtotal: number, coupon: integer }',
  );
  assert.equal(
    typeName(parseType('list<{ id: integer, tags: list<string> }>')),
    'list<{ id: integer, tags: list<string> }>',
  );
  assert.equal(
    typeName(parseType('{ outer: { inner: { deep: boolean } } }')),
    '{ outer: { inner: { deep: boolean } } }',
  );
});

test('optional fields round-trip', () => {
  const t = parseType('{ name: string, note?: string }');
  assert.ok(isRecordType(t));
  assert.equal(t.record[0].optional, false);
  assert.equal(t.record[1].optional, true);
  assert.equal(typeName(t), '{ name: string, note?: string }');
});

test('whitespace is irrelevant', () => {
  assert.equal(
    typeName(parseType('  {a:number,b?:list< string >}  ')),
    '{ a: number, b?: list<string> }',
  );
});

test('scalarsWithin sees through every layer', () => {
  assert.deepEqual(scalarsWithin(parseType('list<{ a: integer, b: list<string> }>')),
    ['integer', 'string']);
});

/* ── the diagnostics ────────────────────────────────────────────────────── */

test('a malformed type says what was expected and where', () => {
  const cases: [string, RegExp][] = [
    ['blob',                    /unknown type "blob"/],
    ['list<blob>',              /unknown type "blob"/],
    ['list<integer',            /expected ">"/],
    ['list integer',            /expected "<"/],
    ['{ a: }',                  /a type was expected/],
    ['{ a number }',            /expected ":"/],
    ['{ }',                     /empty record has no fields/],
    ['{ a: integer, a: string }',/duplicate field "a"/],
    ['integer extra',           /unexpected "extra" after the type/],
    ['{ a: integer',            /expected "}"|ended unexpectedly/],
    ['list<>',                  /a type was expected/],
    ['@',                       /unexpected character "@"/],
  ];
  for (const [src, expected] of cases) {
    assert.throws(() => parseType(src), expected, `for input: ${src}`);
  }
});

test('errors carry the column they occurred at', () => {
  try {
    parseType('{ a: integer, b: blob }');
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof TypeError);
    assert.equal(typeof err.column, 'number');
    assert.equal('{ a: integer, b: blob }'.slice(err.column, err.column + 4), 'blob');
  }
});

/* ── records end-to-end ─────────────────────────────────────────────────── */

const RECORD_SPEC = `program Order

interface
  input  order: { subtotal: number, coupon: integer, note?: string }
  output total: number

Requirement 1: Discount
  THE SYSTEM SHALL reduce the subtotal by the coupon percentage
`;

test('a record interface parses into the program', () => {
  const { program, diagnostics } = parseShall(RECORD_SPEC, 'o.shall');
  assert.equal(hasFatal(diagnostics), false, JSON.stringify(diagnostics));
  const t = program!.interface.inputs[0].type;
  assert.ok(isRecordType(t));
  assert.deepEqual(t.record.map((f) => f.name), ['subtotal', 'coupon', 'note']);
  assert.equal(t.record[2].optional, true);
});

test('probes vary each record field and drop the optional one', () => {
  const program = parseShall(RECORD_SPEC, 'o.shall').program!;
  const probes = structuralProbes(program, 60);
  const orders = probes.map((p) => p.input.order as Record<string, unknown>);

  assert.ok(orders.length > 5, `expected real coverage, got ${orders.length}`);
  assert.ok(orders.every((o) => typeof o === 'object' && !Array.isArray(o)));
  assert.ok(orders.some((o) => !('note' in o)), 'an optional field must sometimes be absent');
  assert.ok(orders.some((o) => 'note' in o), 'and sometimes present');
  assert.ok(new Set(orders.map((o) => o.subtotal)).size > 2, 'subtotal must vary');
  assert.ok(new Set(orders.map((o) => o.coupon)).size > 2, 'coupon must vary');
});

test('a record witness shrinks, dropping the optional field first', () => {
  const program = parseShall(RECORD_SPEC, 'o.shall').program!;
  // Two readings that differ only on whether the note is present.
  const A = 'export function run({ order }) { return order.note === undefined ? 0 : 1; }';
  const B = 'export function run({ order }) { return 0; }';

  const result = minimiseWitness(
    program,
    { id: 'p', input: { order: { subtotal: 19.99, coupon: 7, note: 'gift wrap please' } }, origin: 'structural' },
    [{ source: A }, { source: B }],
    500,
  );

  const order = result.input.order as Record<string, unknown>;
  assert.ok('note' in order, 'the field the split depends on must survive');
  assert.equal(order.subtotal, 0, 'a field the split does not depend on should vanish');
  assert.equal(order.coupon, 0);
});

test('a probe with an invented record field is rejected', async () => {
  const { parseGeneratedProbes } = await import('../dist/shall/oracle/probes.js');
  const program = parseShall(RECORD_SPEC, 'o.shall').program!;

  const good = JSON.stringify([{ input: { order: { subtotal: 1, coupon: 2 } } }]);
  assert.equal(parseGeneratedProbes(good, program, 0).length, 1, 'optional field may be omitted');

  for (const bad of [
    JSON.stringify([{ input: { order: { subtotal: 1, coupon: 2, bogus: 3 } } }]),
    JSON.stringify([{ input: { order: { subtotal: 1 } } }]),
    JSON.stringify([{ input: { order: { subtotal: 'x', coupon: 2 } } }]),
    JSON.stringify([{ input: { order: [1, 2] } }]),
  ]) {
    assert.equal(parseGeneratedProbes(bad, program, 0).length, 0, `should reject: ${bad}`);
  }
});
