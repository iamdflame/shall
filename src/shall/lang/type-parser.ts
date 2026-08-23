import type { RecordField, ScalarType, ShallType } from './types.js';

/**
 * The type grammar.
 *
 *   type    := scalar | list | record
 *   scalar  := "integer" | "number" | "string" | "boolean"
 *   list    := "list" "<" type ">"
 *   record  := "{" field ("," field)* "}"
 *   field   := name "?"? ":" type
 *
 * Types nest: a list of records, a record containing a list, a record
 * containing a record. That is the whole point — a specification about an order
 * cannot be written with scalars alone, and a language that can only describe
 * flat inputs is not describing the specifications people actually write.
 *
 * This is a hand-written recursive-descent parser rather than a regex because
 * the grammar is genuinely recursive. The previous implementation matched
 * `list<T>` with one pattern and could express nothing else.
 */

const SCALARS = new Set<string>(['integer', 'number', 'string', 'boolean']);

export class TypeError extends Error {
  constructor(message: string, readonly column: number) {
    super(message);
    this.name = 'TypeError';
  }
}

type Punct = '<' | '>' | '{' | '}' | ':' | ',' | '?';

type Token =
  | { kind: 'name'; value: string; at: number }
  | { kind: Punct; at: number };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i]!;
    if (/\s/.test(ch)) { i++; continue; }

    if ('<>{}:,?'.includes(ch)) {
      tokens.push({ kind: ch as Punct, at: i });
      i++;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j]!)) j++;
      tokens.push({ kind: 'name', value: source.slice(i, j), at: i });
      i = j;
      continue;
    }

    throw new TypeError(`unexpected character "${ch}" in type`, i);
  }

  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[], private readonly source: string) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private take(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new TypeError('type ended unexpectedly', this.source.length);
    this.pos++;
    return t;
  }

  private expect(kind: Token['kind']): Token {
    // Report what was wanted even when the input simply ran out. "type ended
    // unexpectedly" tells an author nothing; "expected > but the type ended"
    // tells them the bracket they forgot.
    const ahead = this.peek();
    if (!ahead) {
      throw new TypeError(`expected "${kind}" but the type ended`, this.source.length);
    }
    const t = this.take();
    if (t.kind !== kind) {
      throw new TypeError(`expected "${kind}" in type, found "${describe(t)}"`, t.at);
    }
    return t;
  }

  parse(): ShallType {
    const type = this.parseType();
    const extra = this.peek();
    if (extra) {
      throw new TypeError(`unexpected "${describe(extra)}" after the type`, extra.at);
    }
    return type;
  }

  private parseType(): ShallType {
    const t = this.peek();
    if (!t) throw new TypeError('a type was expected', this.source.length);

    if (t.kind === '{') return this.parseRecord();

    if (t.kind === 'name') {
      if (t.value === 'list') return this.parseList();
      this.take();
      if (SCALARS.has(t.value)) return t.value as ScalarType;
      throw new TypeError(
        `unknown type "${t.value}" — expected ${[...SCALARS].join(', ')}, list<T>, or a { record }`,
        t.at,
      );
    }

    throw new TypeError(`a type was expected, found "${describe(t)}"`, t.at);
  }

  private parseList(): ShallType {
    this.take();               // list
    this.expect('<');
    const element = this.parseType();
    this.expect('>');
    return { list: element };
  }

  private parseRecord(): ShallType {
    this.expect('{');
    const fields: RecordField[] = [];
    const seen = new Set<string>();

    // An empty record has no values to vary, so nothing about it could ever be
    // probed; rejecting it here is clearer than silently generating {} forever.
    if (this.peek()?.kind === '}') {
      throw new TypeError('an empty record has no fields to test', this.peek()!.at);
    }

    for (;;) {
      const name = this.take();
      if (name.kind !== 'name') {
        throw new TypeError(`expected a field name, found "${describe(name)}"`, name.at);
      }
      if (seen.has(name.value)) {
        throw new TypeError(`duplicate field "${name.value}" in record`, name.at);
      }
      seen.add(name.value);

      let optional = false;
      if (this.peek()?.kind === '?') { this.take(); optional = true; }

      this.expect(':');
      fields.push({ name: name.value, type: this.parseType(), optional });

      const next = this.peek();
      if (next?.kind === ',') { this.take(); continue; }
      break;
    }

    this.expect('}');
    return { record: fields };
  }
}

function describe(t: Token): string {
  return t.kind === 'name' ? t.value : t.kind;
}

/** Parse a type expression, throwing TypeError with a column on failure. */
export function parseType(source: string): ShallType {
  return new Parser(tokenize(source), source).parse();
}
