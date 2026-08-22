import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderRegistry, resolveRoster } from '../dist/shall/provider/registry.js';
import { VENDORS } from '../dist/shall/provider/compatible.js';

const model = (id: string, provider: string) => ({
  id, provider, model: id.split(':')[1] ?? id, label: id,
});

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    previous[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { fn(); } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// @shall multi-vendor-ensemble/1.1
test('every listed vendor has a base URL and a key variable', () => {
  for (const [name, v] of Object.entries(VENDORS)) {
    assert.ok(v.baseURL.startsWith('http'), `${name} needs a URL`);
    assert.match(v.keyVar, /^[A-Z0-9_]+$/, `${name} needs an env var name`);
  }
  assert.ok(Object.keys(VENDORS).length >= 5, 'the point is breadth of independence');
});

// @shall multi-vendor-ensemble/2.1
test('a reader whose vendor has no key is dropped, not fatal', () => {
  withEnv({ OPENAI_API_KEY: 'x', ANTHROPIC_API_KEY: undefined, GEMINI_API_KEY: undefined }, () => {
    const registry = new ProviderRegistry();
    const roster = resolveRoster(
      [model('openai:gpt-4o', 'openai'), model('anthropic:claude', 'anthropic')],
      registry,
    );
    assert.equal(roster.usable.length, 1);
    assert.equal(roster.dropped.length, 1);
    assert.equal(roster.dropped[0].provider, 'anthropic');
  });
});

// @shall multi-vendor-ensemble/2.2
test('a single-vendor roster is flagged as such', () => {
  withEnv({ OPENAI_API_KEY: 'x', ANTHROPIC_API_KEY: undefined }, () => {
    const roster = resolveRoster(
      [model('openai:a', 'openai'), model('openai:b', 'openai')],
      new ProviderRegistry(),
    );
    assert.equal(roster.singleVendor, true, 'this is the sharpest known weakness and must be visible');
    assert.deepEqual(roster.vendors, ['openai']);
  });
});

// @shall multi-vendor-ensemble/2.3
test('two vendors clear the single-vendor flag', () => {
  withEnv({ OPENAI_API_KEY: 'x', ANTHROPIC_API_KEY: 'y' }, () => {
    const roster = resolveRoster(
      [model('openai:a', 'openai'), model('anthropic:b', 'anthropic')],
      new ProviderRegistry(),
    );
    assert.equal(roster.singleVendor, false);
    assert.deepEqual(roster.vendors, ['anthropic', 'openai']);
  });
});

// @shall multi-vendor-ensemble/1.3
test('an unknown vendor names the ones that exist', () => {
  const registry = new ProviderRegistry();
  assert.throws(() => registry.providerFor('nope'), /unknown vendor "nope"/);
  assert.throws(() => registry.providerFor('nope'), /openai/);
});

// @shall multi-vendor-ensemble/1.2
test('configuredVendors reflects only keys actually present', () => {
  withEnv({ OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: 'y', GROQ_API_KEY: undefined }, () => {
    const vendors = new ProviderRegistry().configuredVendors();
    assert.ok(vendors.includes('anthropic'));
    assert.ok(!vendors.includes('openai'));
    assert.ok(!vendors.includes('groq'));
  });
});
