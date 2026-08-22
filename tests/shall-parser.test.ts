import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseShall, hasFatal } from '../dist/shall/lang/parser.js';
import { programCriteria, typeName } from '../dist/shall/lang/types.js';

const SRC = readFileSync('examples/order-total.shall', 'utf8');

// @shall shall-language/1.1
test('parses a program declaration, description and interface', () => {
  const { program, diagnostics } = parseShall(SRC, 'examples/order-total.shall');
  assert.equal(hasFatal(diagnostics), false, JSON.stringify(diagnostics));
  assert.ok(program);
  assert.equal(program.name, 'OrderTotal');
  assert.match(program.description ?? '', /what a customer pays/);

  assert.equal(program.interface.inputs.length, 2);
  assert.equal(program.interface.inputs[0].name, 'subtotal');
  assert.equal(typeName(program.interface.inputs[0].type), 'number');
  assert.equal(typeName(program.interface.inputs[1].type), 'integer');
  assert.equal(program.interface.outputs.length, 1);
  assert.equal(program.interface.outputs[0].name, 'total');
});

test('parses requirements and their EARS criteria', () => {
  const { program } = parseShall(SRC, 'x.shall');
  assert.ok(program);
  assert.equal(program.requirements.length, 4);

  const criteria = programCriteria(program);
  assert.equal(criteria.length, 6);
  assert.equal(criteria[0].id, '1.1');
  assert.equal(criteria[0].qualifiedId, 'OrderTotal/1.1');
  assert.equal(criteria[0].pattern, 'event');
  assert.equal(criteria[0].clauses.trigger, 'a coupon percentage is supplied');

  const shipping = criteria.find((c) => c.id === '2.1');
  assert.equal(shipping?.pattern, 'unwanted');
  assert.equal(shipping?.clauses.condition, 'the order is below 50');

  const tax = criteria.find((c) => c.id === '3.1');
  assert.equal(tax?.pattern, 'ubiquitous');
  assert.equal(tax?.clauses.response, 'add sales tax of 8 percent');
});

test('list types parse', () => {
  const { program, diagnostics } = parseShall(
    'program P\ninterface\n  input xs: list<integer>\n  output n: integer\nRequirement 1: R\n  THE SYSTEM SHALL sum them\n',
    'p.shall',
  );
  assert.equal(hasFatal(diagnostics), false);
  assert.equal(typeName(program!.interface.inputs[0].type), 'list<integer>');
});

test('an unknown type is fatal and names the valid options', () => {
  const { diagnostics } = parseShall(
    'program P\ninterface\n  input x: blob\n  output y: string\nRequirement 1: R\n  THE SYSTEM SHALL do it\n',
    'p.shall',
  );
  assert.equal(hasFatal(diagnostics), true);
  assert.match(diagnostics[0].message, /unknown type "blob"/);
});

// @shall shall-language/1.2
test('a program with no inputs is rejected — nothing could be tested', () => {
  const { diagnostics } = parseShall(
    'program P\ninterface\n  output y: string\nRequirement 1: R\n  THE SYSTEM SHALL do it\n',
    'p.shall',
  );
  assert.ok(diagnostics.some((d) => d.fatal && /no inputs/.test(d.message)));
});

// @shall shall-language/1.3
test('a program with two outputs is rejected — comparison needs one value', () => {
  const { diagnostics } = parseShall(
    'program P\ninterface\n  input x: integer\n  output a: string\n  output b: string\nRequirement 1: R\n  THE SYSTEM SHALL do it\n',
    'p.shall',
  );
  assert.ok(diagnostics.some((d) => d.fatal && /exactly one output/.test(d.message)));
});

test('a program with no requirements has nothing to compile', () => {
  const { diagnostics } = parseShall(
    'program P\ninterface\n  input x: integer\n  output y: string\n',
    'p.shall',
  );
  assert.ok(diagnostics.some((d) => d.fatal && /states no requirements/.test(d.message)));
});

// @shall shall-language/1.4
test('a malformed criterion is reported but not fatal', () => {
  const { program, diagnostics } = parseShall(
    'program P\ninterface\n  input x: integer\n  output y: string\nRequirement 1: R\n  The system should probably work\n',
    'p.shall',
  );
  assert.equal(hasFatal(diagnostics), false);
  assert.ok(diagnostics.some((d) => /not valid EARS/.test(d.message)));
  assert.equal(programCriteria(program!)[0].pattern, 'malformed');
});

test('comments and blank lines are ignored', () => {
  const { program, diagnostics } = parseShall(
    '# a comment\nprogram P\n\n// another\ninterface\n  input x: integer\n  output y: string\nRequirement 1: R\n  THE SYSTEM SHALL do it\n',
    'p.shall',
  );
  assert.equal(hasFatal(diagnostics), false);
  assert.equal(program!.name, 'P');
});
