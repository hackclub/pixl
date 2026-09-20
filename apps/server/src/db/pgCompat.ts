// A postgres.js-backed stand-in for the slice of the supabase-js query builder
// this codebase uses, so the ~400 existing `.from(...).select(...).eq(...)`
// call sites keep working while the data lives in Orchard Postgres instead of
// Supabase. It is deliberately not a general PostgREST implementation:
// embedded relation selects ("users(display_name)") are not supported and are
// written as explicit joins at the call site instead.
//
// Copied per app rather than shared from packages/*, because each app's Docker
// build context is its own directory and importing a workspace package broke
// the deploy once already (b5c1559).
import postgres from "postgres";

// Connected on first query, not at import time: Next prerenders the dashboard
// modules that import this in contexts where env vars aren't present yet, and
// a module-level throw there fails the build rather than the request.
let _sql: ReturnType<typeof postgres> | null = null;
function conn(): ReturnType<typeof postgres> {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL must be set");
    _sql = postgres(url, { max: 10, onnotice: () => {} });
  }
  return _sql;
}

export async function connectForTests(url: string | null): Promise<void> {
  const previous = _sql;
  _sql = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
  await previous?.end();
}

export const sql: ReturnType<typeof postgres> = new Proxy(
  {} as ReturnType<typeof postgres>,
  {
    get: (_t, prop) => {
      const c = conn() as unknown as Record<string | symbol, unknown>;
      const v = c[prop];
      return typeof v === "function" ? v.bind(c) : v;
    },
    set: (_t, prop, value) => {
      (conn() as unknown as Record<string | symbol, unknown>)[prop] = value;
      return true;
    },
  },
);

// Mirrors the shape of a supabase-js error closely enough for the call sites
// that branch on it. `code` is the Postgres SQLSTATE (e.g. "23505" for a
// unique violation), which several routes use to turn a duplicate insert into
// a friendly response instead of a 500. `constraintName` is the specific
// constraint that fired (postgres.js maps error field 'n' to
// `constraint_name`) - a table can have more than one unique constraint, so a
// bare 23505 check isn't enough to know which one tripped.
export interface PgError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
  constraintName?: string | null;
}

export interface PgResult<T> {
  data: T | null;
  error: PgError | null;
  count?: number | null;
}

// .single()/.maybeSingle() resolve to one row rather than an array. Splitting
// the type keeps call sites contextually typed the way supabase-js typed them:
// `data.map(r => ...)` on a list, `data.some_column` on a single row.
export interface SingleQuery<T> extends PromiseLike<PgResult<T>> {}

type Op =
  | "eq" | "neq" | "gt" | "gte" | "lt" | "lte"
  | "like" | "ilike" | "in" | "is" | "contains";

interface Filter {
  col: string;
  op: Op;
  val: unknown;
}

const OPERATORS: Record<Exclude<Op, "in" | "is" | "contains">, string> = {
  eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=",
  like: "like", ilike: "ilike",
};

function ident(name: string): string {
  // Column/table names here are all developer-authored literals, never user
  // input, but quoting keeps reserved words ("order", "user") working.
  return name
    .split(".")
    .map((p) => (p === "*" ? p : `"${p.replace(/"/g, '""')}"`))
    .join(".");
}

// Splits a comma separated filter list, respecting both paren depth (a
// comma inside an "and(...)" group is not a separator) and double quoted
// values (a comma inside a value is not a separator either). Without the
// quote handling a value could close its own term and append new ones,
// which is how an injected user id used to rewrite the whole filter.
function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let cur = "";
  for (const ch of list) {
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (quoted) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
      cur += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      cur += ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Any value interpolated into an .or() string has to go through this. The
// filter string is parsed, not parameterized, so an unquoted value carrying a
// comma, paren or dot is read as filter syntax and silently changes which
// rows the query matches.
export function orValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  return `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function unquote(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"'))
    return t.slice(1, -1).replace(/\\(.)/g, "$1");
  return t;
}

// Only these follow "is" in a filter. It used to splice `raw` straight into
// the SQL text, which made every .or() carrying a user supplied value a
// direct injection point.
const IS_LITERALS: Record<string, string> = {
  null: "null",
  "not.null": "not null",
  true: "true",
  false: "false",
  unknown: "unknown",
};

const COLUMN_RE = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;

// PostgREST spells one filter as "col.op.value"; .or() takes them comma
// separated, and a term can itself be an "and(...)"/"or(...)" group of flat
// terms (e.g. "and(a.eq.1,b.eq.2),and(a.eq.2,b.eq.1)" for a symmetric-pair
// lookup). Splitting has to respect paren depth or a comma inside a group
// gets mistaken for a top-level separator, which was silently corrupting
// every .or() call that used grouping (areFriends() always returned false).
function parseOrTerm(term: string): { text: string; values: unknown[] } | null {
  const t = term.trim();
  const group = t.match(/^(and|or)\((.*)\)$/s);
  if (group) {
    const [, kind, inner] = group;
    const parts: string[] = [];
    const values: unknown[] = [];
    for (const sub of splitTopLevel(inner)) {
      const parsed = parseOrTerm(sub);
      if (!parsed) continue;
      parts.push(parsed.text);
      values.push(...parsed.values);
    }
    if (!parts.length) return null;
    return { text: `(${parts.join(kind === "and" ? " and " : " or ")})`, values };
  }

  const first = t.indexOf(".");
  const second = t.indexOf(".", first + 1);
  if (first === -1 || second === -1) return null;
  const col = t.slice(0, first);
  const op = t.slice(first + 1, second) as Op;
  const raw = t.slice(second + 1);
  if (!COLUMN_RE.test(col)) return null;
  if (op === "is") {
    const lit = IS_LITERALS[unquote(raw).toLowerCase()];
    return lit ? { text: `${ident(col)} is ${lit}`, values: [] } : null;
  }
  if (op === "in") {
    const items = splitTopLevel(raw.replace(/^\(|\)$/g, "")).map(unquote);
    return { text: `${ident(col)} = any(?)`, values: [items] };
  }
  const sqlOp = OPERATORS[op as keyof typeof OPERATORS];
  if (!sqlOp) return null;
  const val = unquote(raw);
  return { text: `${ident(col)} ${sqlOp} ?`, values: [raw.trim() === "null" ? null : val] };
}

// PostgREST lets a select embed a related table: "*, users(display_name)" or
// "sidequest_id, sidequests!inner(name)". We support exactly that flat, one
// level deep form, resolving the foreign key by the convention every table
// here follows: <singular table>_id on the base table points at <table>.id.
interface Embed {
  table: string;
  inner: boolean;
  cols: string[];
}


function parseColumns(columns: string): { base: string[]; embeds: Embed[] } {
  const base: string[] = [];
  const embeds: Embed[] = [];
  for (const part of splitTopLevel(columns)) {
    const m = part.match(/^([a-zA-Z0-9_]+)(!inner)?\s*\((.*)\)$/s);
    if (m) {
      embeds.push({
        table: m[1],
        inner: Boolean(m[2]),
        cols: m[3].split(",").map((c) => c.trim()).filter(Boolean),
      });
    } else base.push(part);
  }
  return { base, embeds };
}

function foreignKey(table: string): string {
  return `${table.replace(/s$/, "")}_id`;
}

function toPgError(e: unknown): PgError {
  const err = e as {
    message?: string;
    code?: string;
    detail?: string;
    hint?: string;
    constraint_name?: string;
  };
  return {
    message: err?.message ?? String(e),
    code: err?.code,
    details: err?.detail ?? null,
    hint: err?.hint ?? null,
    constraintName: err?.constraint_name ?? null,
  };
}

class Builder<T = any> implements PromiseLike<PgResult<T[]>> {
  private filters: Filter[] = [];
  private orTerms: string[] = [];
  private negated = new Set<number>();
  private orders: string[] = [];
  private limitN: number | null = null;
  private offsetN: number | null = null;
  private mode: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private columns = "*";
  private payload: Record<string, unknown>[] = [];
  private onConflict: string | null = null;
  private ignoreDuplicates = false;
  private returning = false;
  private wantCount = false;
  private rowMode: "many" | "one" | "maybeOne" = "many";

  constructor(private table: string) {}

  select(columns = "*", opts?: { count?: "exact" | "planned" | "estimated"; head?: boolean }): this {
    if (this.mode === "select") this.columns = columns;
    else this.returning = true;
    if (opts?.count) this.wantCount = true;
    return this;
  }

  insert(rows: object | object[]): this {
    this.mode = "insert";
    this.payload = (Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[];
    return this;
  }

  upsert(
    rows: object | object[],
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): this {
    this.mode = "upsert";
    this.payload = (Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[];
    this.onConflict = opts?.onConflict ?? null;
    this.ignoreDuplicates = opts?.ignoreDuplicates ?? false;
    return this;
  }

  update(patch: object): this {
    this.mode = "update";
    this.payload = [patch as Record<string, unknown>];
    return this;
  }

  delete(): this {
    this.mode = "delete";
    return this;
  }

  private push(op: Op, col: string, val: unknown): this {
    this.filters.push({ col, op, val });
    return this;
  }

  eq(col: string, val: unknown) { return this.push("eq", col, val); }
  neq(col: string, val: unknown) { return this.push("neq", col, val); }
  gt(col: string, val: unknown) { return this.push("gt", col, val); }
  gte(col: string, val: unknown) { return this.push("gte", col, val); }
  lt(col: string, val: unknown) { return this.push("lt", col, val); }
  lte(col: string, val: unknown) { return this.push("lte", col, val); }
  like(col: string, val: string) { return this.push("like", col, val); }
  ilike(col: string, val: string) { return this.push("ilike", col, val); }
  in(col: string, vals: unknown[]) { return this.push("in", col, vals); }
  is(col: string, val: null | boolean) { return this.push("is", col, val); }
  contains(col: string, val: unknown) { return this.push("contains", col, val); }

  not(col: string, op: Op, val: unknown): this {
    this.negated.add(this.filters.length);
    return this.push(op, col, val);
  }

  match(conditions: Record<string, unknown>): this {
    for (const [col, val] of Object.entries(conditions)) this.push("eq", col, val);
    return this;
  }

  or(terms: string): this {
    this.orTerms.push(terms);
    return this;
  }

  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): this {
    const dir = opts?.ascending === false ? "desc" : "asc";
    const nulls = opts?.nullsFirst === undefined ? "" : opts.nullsFirst ? " nulls first" : " nulls last";
    this.orders.push(`${ident(col)} ${dir}${nulls}`);
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  range(from: number, to: number): this {
    this.offsetN = from;
    this.limitN = to - from + 1;
    return this;
  }

  single(): SingleQuery<T> {
    this.rowMode = "one";
    return this as unknown as SingleQuery<T>;
  }

  maybeSingle(): SingleQuery<T> {
    this.rowMode = "maybeOne";
    return this as unknown as SingleQuery<T>;
  }

  private where(params: unknown[], q = ""): string {
    const parts: string[] = [];
    this.filters.forEach((f, i) => {
      // f.col already carries its own table qualifier for an embedded-table
      // filter (e.g. "sidequests.active"); prefixing q on top of that produces
      // an invalid three-part reference like "sidequest_unlocks"."sidequests"."active".
      const prefix = f.col.includes(".") ? "" : q;
      let text: string;
      if (f.op === "is") {
        text = `${prefix}${ident(f.col)} is ${f.val === null ? "null" : f.val ? "true" : "false"}`;
      } else if (f.op === "in") {
        params.push(f.val);
        text = `${prefix}${ident(f.col)} = any($${params.length})`;
      } else if (f.op === "contains") {
        params.push(f.val);
        text = `${prefix}${ident(f.col)} @> $${params.length}`;
      } else if (f.val === null) {
        text = `${prefix}${ident(f.col)} is ${f.op === "neq" ? "not " : ""}null`;
      } else {
        params.push(f.val);
        text = `${prefix}${ident(f.col)} ${OPERATORS[f.op as keyof typeof OPERATORS]} $${params.length}`;
      }
      parts.push(this.negated.has(i) ? `not (${text})` : text);
    });

    for (const group of this.orTerms) {
      const ors: string[] = [];
      for (const term of splitTopLevel(group)) {
        const parsed = parseOrTerm(term);
        if (!parsed) continue;
        let text = parsed.text;
        for (const v of parsed.values) {
          params.push(v);
          text = text.replace("?", `$${params.length}`);
        }
        ors.push(text);
      }
      if (ors.length) parts.push(`(${ors.join(" or ")})`);
    }

    return parts.length ? ` where ${parts.join(" and ")}` : "";
  }

  private build(): { text: string; params: unknown[] } {
    const params: unknown[] = [];
    const t = ident(this.table);
    const cols = this.columns === "*" ? "*" : this.columns.split(",").map((c) => ident(c.trim())).join(", ");

    if (this.mode === "insert" || this.mode === "upsert") {
      const keys = [...new Set(this.payload.flatMap((r) => Object.keys(r)))];
      const tuples = this.payload.map((row) => {
        const slots = keys.map((k) => {
          params.push(row[k] ?? null);
          return `$${params.length}`;
        });
        return `(${slots.join(", ")})`;
      });
      let text = `insert into ${t} (${keys.map(ident).join(", ")}) values ${tuples.join(", ")}`;
      if (this.mode === "upsert") {
        const target = (this.onConflict ?? "id").split(",").map((c) => ident(c.trim())).join(", ");
        const sets = keys.filter((k) => !(this.onConflict ?? "id").split(",").map((s) => s.trim()).includes(k));
        text += !this.ignoreDuplicates && sets.length
          ? ` on conflict (${target}) do update set ${sets.map((k) => `${ident(k)} = excluded.${ident(k)}`).join(", ")}`
          : ` on conflict (${target}) do nothing`;
      }
      return { text: `${text} returning ${this.returning ? cols : "*"}`, params };
    }

    if (this.mode === "update") {
      const sets = Object.entries(this.payload[0] ?? {}).map(([k, v]) => {
        params.push(v);
        return `${ident(k)} = $${params.length}`;
      });
      const text = `update ${t} set ${sets.join(", ")}${this.where(params)} returning ${this.returning ? cols : "*"}`;
      return { text, params };
    }

    if (this.mode === "delete") {
      return { text: `delete from ${t}${this.where(params)} returning ${this.returning ? cols : "*"}`, params };
    }

    const { base, embeds } = parseColumns(this.columns);
    if (!embeds.length) {
      let text = `select ${cols} from ${t}${this.where(params)}`;
      if (this.orders.length) text += ` order by ${this.orders.join(", ")}`;
      if (this.limitN !== null) text += ` limit ${this.limitN}`;
      if (this.offsetN !== null) text += ` offset ${this.offsetN}`;
      return { text, params };
    }

    const q = `${t}.`;
    const selected = base.map((c) => (c === "*" ? `${t}.*` : `${q}${ident(c)}`));
    const joins: string[] = [];
    for (const em of embeds) {
      const et = ident(em.table);
      const pairs = em.cols
        .map((c) => `'${c}', ${et}.${ident(c)}`)
        .join(", ");
      selected.push(
        `case when ${et}."id" is null then null else json_build_object(${pairs}) end as ${et}`,
      );
      joins.push(
        `${em.inner ? "join" : "left join"} ${et} on ${q}${ident(foreignKey(em.table))} = ${et}."id"`,
      );
    }

    let text = `select ${selected.join(", ")} from ${t} ${joins.join(" ")}${this.where(params, q)}`;
    if (this.orders.length) text += ` order by ${this.orders.map((o) => `${q}${o}`).join(", ")}`;
    if (this.limitN !== null) text += ` limit ${this.limitN}`;
    if (this.offsetN !== null) text += ` offset ${this.offsetN}`;
    return { text, params };
  }

  async run(): Promise<PgResult<any>> {
    try {
      const { text, params } = this.build();
      const rows = (await sql.unsafe(text, params as never[])) as unknown as Record<string, unknown>[];

      let count: number | null = null;
      if (this.wantCount && this.mode === "select") {
        const cp: unknown[] = [];
        const c = (await sql.unsafe(
          `select count(*)::int as n from ${ident(this.table)}${this.where(cp)}`,
          cp as never[],
        )) as unknown as { n: number }[];
        count = c[0]?.n ?? 0;
      }

      if (this.rowMode === "one") {
        if (rows.length !== 1) {
          return {
            data: null,
            error: { message: `expected exactly one row, got ${rows.length}` },
            count,
          };
        }
        return { data: rows[0], error: null, count };
      }
      if (this.rowMode === "maybeOne") {
        return { data: rows[0] ?? null, error: null, count };
      }
      return { data: rows, error: null, count };
    } catch (e) {
      return { data: null, error: toPgError(e), count: null };
    }
  }

  then<R1 = PgResult<T[]>, R2 = never>(
    onfulfilled?: ((v: PgResult<T[]>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((r: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

export const db = {
  from<T = any>(table: string): Builder<T> {
    return new Builder<T>(table);
  },

  // Postgres functions the app calls through PostgREST's /rpc today
  // (buy_shop_item, credit_project_pixels, ...). They have to exist in the
  // target database; this only changes how they're invoked.
  async rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<PgResult<T>> {
    try {
      const keys = Object.keys(args);
      const params = keys.map((k) => args[k]);
      const slots = keys.map((k, i) => `${ident(k)} => $${i + 1}`);
      const rows = (await sql.unsafe(
        `select * from ${ident(fn)}(${slots.join(", ")})`,
        params as never[],
      )) as unknown as Record<string, unknown>[];
      // A scalar-returning function comes back as [{ fn_name: value }];
      // unwrap it so callers see the value supabase-js would have given them.
      if (rows.length === 1 && Object.keys(rows[0]).length === 1) {
        return { data: Object.values(rows[0])[0] as T, error: null };
      }
      return { data: rows as unknown as T, error: null };
    } catch (e) {
      return { data: null, error: toPgError(e) };
    }
  },
};
