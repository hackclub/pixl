import { describe, expect, it } from "bun:test";
import { db, orValue } from "./pgCompat.js";

// build() is private to TypeScript only; at runtime it is an ordinary method,
// which lets these assert on the SQL text without a live database.
function sqlFor(q: unknown): { text: string; params: unknown[] } {
  return (q as { build(): { text: string; params: unknown[] } }).build();
}

const pair = (a: string, b: string) =>
  `and(requester_id.eq.${orValue(a)},addressee_id.eq.${orValue(b)}),` +
  `and(requester_id.eq.${orValue(b)},addressee_id.eq.${orValue(a)})`;

const SELF = "c37006d4-c69a-45cb-96df-0bf1e7de521d";

describe("or() filter parsing", () => {
  it("still builds the symmetric friend-pair lookup", () => {
    const other = "11111111-2222-3333-4444-555555555555";
    const { text, params } = sqlFor(db.from("friends").delete().or(pair(SELF, other)));
    expect(text).toContain(
      '(("requester_id" = $1 and "addressee_id" = $2) or ("requester_id" = $3 and "addressee_id" = $4))',
    );
    expect(params).toEqual([SELF, other, other, SELF]);
  });

  it("keeps a value carrying filter syntax as one parameter", () => {
    const evil = `x),and(requester_id.eq.${SELF}`;
    const { text, params } = sqlFor(db.from("friends").delete().or(pair(SELF, evil)));
    expect(params).toEqual([SELF, evil, evil, SELF]);
    // Four placeholders and no more: the payload added no extra conditions.
    expect(text.match(/\$\d/g)).toHaveLength(4);
  });

  it("does not let a value open a subquery", () => {
    const evil = `x'; select 1 from users where email like 'eth%`;
    const { text, params } = sqlFor(db.from("friends").delete().or(pair(SELF, evil)));
    expect(params).toContain(evil);
    expect(text.toLowerCase()).not.toContain("select 1");
    expect(text).not.toContain(evil);
  });

  it("refuses an is-filter that is not a known literal", () => {
    // This was the raw sink: `raw` went into the SQL text unparameterized.
    const { text } = sqlFor(
      db.from("friends").select("*").or("expires_at.is.(select version())"),
    );
    expect(text).not.toContain("version()");
    expect(text).not.toContain("where");
  });

  it("still handles the is-null filters the app actually uses", () => {
    const { text } = sqlFor(
      db.from("bans").select("*").or("expires_at.is.null,expires_at.gt." + orValue("2026-09-15T00:00:00.000Z")),
    );
    expect(text).toContain('"expires_at" is null');
    expect(text).toContain('"expires_at" > $1');
  });

  it("rejects a column name that is not a plain identifier", () => {
    const { text } = sqlFor(db.from("users").select("*").or('id") = 1 --.eq.1'));
    expect(text).not.toContain("--");
  });

  it("quotes and unquotes round-trip, backslashes included", () => {
    const messy = 'a"b\\c,d)e';
    const { params } = sqlFor(db.from("users").select("*").or(`name.eq.${orValue(messy)}`));
    expect(params).toEqual([messy]);
  });
});
