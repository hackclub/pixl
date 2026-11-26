// Matches the JSON printed by the official HCB CLI
// (`hcb grants --org ysws-pixl`) against the grant orders still waiting in the
// dashboard. The CLI performs the read-only API call; this module never talks
// to HCB itself. Buyer emails stay on the server: matchGrantsToOrders needs
// them to pair rows, but every type returned to the client carries only order
// ids, player display names, amounts and grant links.

export const HCB_GRANT_LINK_PREFIX = "https://hcb.hackclub.com/grants/";

const HCB_GRANT_ID_PREFIX = "cdg_";
const HASH_RE = /^[A-Za-z0-9]+$/;

// A grant created up to an hour before the order is still plausible (clock
// skew between HCB and Postgres), but a much older grant is not this order's.
const CLOCK_SKEW_MS = 60 * 60 * 1000;

// Protect the dashboard from a giant accidental paste. The CLI returns every
// grant the org ever sent, so this is intentionally generous.
const MAX_GRANTS = 10_000;

export interface HcbGrant {
  id: string;
  /** Bare hashid used in the human URL. */
  hash: string;
  email: string;
  amountCents: number;
  purpose: string;
  status: string;
  createdAt: string | null;
}

export interface ParsedHcbGrants {
  grants: HcbGrant[];
  ignored: number;
  /** Empty when the file parsed. */
  error: string;
}

export interface GrantImportOrder {
  orderId: number;
  playerName: string;
  itemName: string;
  quantity: number;
  amountCents: number;
  status: string;
  email: string;
  /** ISO timestamp, or "" when the order row has none. */
  createdAt: string;
}

export interface GrantImportMatch {
  orderId: number;
  playerName: string;
  itemName: string;
  quantity: number;
  amountCents: number;
  status: string;
  grantId: string;
  grantLink: string;
  purpose: string;
  grantCreatedAt: string | null;
  /** Set when more than one order/grant shares the same email and amount. */
  note: string;
}

export interface GrantImportWarning {
  orderIds: number[];
  reason: string;
}

export interface GrantImportUnmatchedOrder {
  orderId: number;
  playerName: string;
  itemName: string;
  amountCents: number;
  reason: string;
}

export interface GrantImportUnusedGrant {
  grantId: string;
  grantLink: string;
  amountCents: number;
  purpose: string;
  createdAt: string | null;
}

export interface GrantImportPreview {
  totalGrants: number;
  ignored: number;
  matches: GrantImportMatch[];
  warnings: GrantImportWarning[];
  unmatchedOrders: GrantImportUnmatchedOrder[];
  unusedGrants: GrantImportUnusedGrant[];
}

// "cdg_abc123" and "abc123" both mean the same grant. Anything with a slash,
// query string or unexpected character is rejected rather than turned into a
// URL.
export function grantHash(id: string): string | null {
  const value = String(id ?? "").trim();
  const hash = value.startsWith(HCB_GRANT_ID_PREFIX) ? value.slice(HCB_GRANT_ID_PREFIX.length) : value;
  return HASH_RE.test(hash) ? hash : null;
}

export function grantLinkFromId(id: string): string | null {
  const hash = grantHash(id);
  return hash ? `${HCB_GRANT_LINK_PREFIX}${hash}` : null;
}

export function grantHashFromLink(link: string): string | null {
  // Accept the canonical /grants/<hash> page and HCB's /grants/<hash>/spending
  // variant (the link the grants table actually renders).
  const match = /\/grants\/([A-Za-z0-9]+)(?:\/|$)/i.exec(String(link ?? "").trim());
  return match?.[1] ?? null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The CLI prints the endpoint's raw body: an array of card grants. Accept the
// pagination envelope and a couple of obvious wrappers too, so a hand-edited
// or future-paginated export still works.
function grantList(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return null;
  if (Array.isArray(value.data)) return value.data;
  if (Array.isArray(value.card_grants)) return value.card_grants;
  return null;
}

interface RawGrant {
  id?: unknown;
  email?: unknown;
  amount_cents?: unknown;
  purpose?: unknown;
  status?: unknown;
  created_at?: unknown;
}

// Shared by the CLI JSON and the bookmarklet CSV. Only active grants can be
// marked sent; a canceled/expired row is skipped rather than paired with a
// live order.
function toHcbGrant(item: RawGrant): HcbGrant | null {
  const id = typeof item.id === "string" ? item.id : "";
  const hash = grantHash(id);
  const email = typeof item.email === "string" ? item.email.trim().toLowerCase() : "";
  const amountCents = Number(item.amount_cents);
  const status = typeof item.status === "string" ? item.status : "active";
  const purpose = typeof item.purpose === "string" ? item.purpose.trim() : "";

  if (!hash || !email.includes("@") || !Number.isSafeInteger(amountCents) || amountCents <= 0 || status !== "active") {
    return null;
  }

  const parsedDate = typeof item.created_at === "string" ? new Date(item.created_at) : null;
  const createdAt = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null;

  return {
    id: `${HCB_GRANT_ID_PREFIX}${hash}`,
    hash,
    email,
    amountCents,
    purpose,
    status,
    createdAt,
  };
}

export function parseHcbGrantsJson(raw: string): ParsedHcbGrants {
  const text = String(raw ?? "").trim();
  if (!text) {
    return {
      grants: [],
      ignored: 0,
      error: "Choose the grants.json file printed by `hcb grants --org ysws-pixl`.",
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      grants: [],
      ignored: 0,
      error: "That file isn't valid JSON. Run `hcb grants --org ysws-pixl > grants.json` and upload the whole file.",
    };
  }

  const list = grantList(value);
  if (!list) {
    return {
      grants: [],
      ignored: 0,
      error: "Expected the JSON array that `hcb grants` prints.",
    };
  }
  if (list.length > MAX_GRANTS) {
    return {
      grants: [],
      ignored: 0,
      error: `That file has more than ${MAX_GRANTS.toLocaleString("en-US")} grants. Narrow it down before importing.`,
    };
  }

  const grants: HcbGrant[] = [];
  let ignored = 0;
  for (const item of list) {
    if (!isRecord(item)) {
      ignored++;
      continue;
    }
    const grant = toHcbGrant({
      id: item.id,
      email: item.email,
      amount_cents: item.amount_cents,
      purpose: item.purpose,
      status: item.status,
      created_at: item.created_at,
    });
    if (!grant) {
      ignored++;
      continue;
    }
    grants.push(grant);
  }

  if (grants.length === 0) {
    return {
      grants,
      ignored,
      error: "No active card grants were found in that file. Check that you exported from the right HCB organization.",
    };
  }

  return { grants, ignored, error: "" };
}

// Small RFC4180-ish parser for the bookmarklet CSV: quoted fields, doubled
// quotes, commas and newlines inside quotes. The dashboard only writes this
// format, so a full CSV library would be overkill.
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

const normalizeHeader = (value: string) =>
  value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s-]+/g, "_");

function headerIndex(headers: string[], names: string[]): number {
  for (const name of names) {
    const index = headers.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

function parseCsvAmount(value: string, header: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  const numeric = Number(raw.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  // "amount_cents" is normally an integer, but a hand-edited sheet often puts
  // "$10.00" in that column. A currency symbol/decimals means dollars.
  const looksLikeDollars = /[$]/.test(raw) || /\.\d{1,2}\s*$/.test(raw);
  const cents = header.includes("cents") && !looksLikeDollars
    ? Math.round(numeric)
    : Math.round(numeric * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

// The bookmarklet on HCB's Card grants page downloads this shape:
//   email, amount_cents, purpose, grant_link, created_at
// Hand-edited sheets are accepted too, as long as they have an email, a
// grant link and an amount column. This is deliberately separate from the
// dashboard's own bulk-upload CSV: that file has no link and can't fill one.
export function parseHcbGrantsCsv(raw: string): ParsedHcbGrants {
  const text = String(raw ?? "").replace(/^\uFEFF/, "").trim();
  if (!text) {
    return { grants: [], ignored: 0, error: "Choose the CSV downloaded from HCB (or the CLI's grants.json)." };
  }
  if (text.startsWith("[") || text.startsWith("{")) {
    return { grants: [], ignored: 0, error: "That looks like JSON. Use the JSON file from the CLI instead." };
  }
  if (/^\s*<!doctype html|^\s*<html/i.test(text)) {
    return {
      grants: [],
      ignored: 0,
      error: "That's a saved HCB page, not the grants CSV. The grants table is loaded separately in a Turbo frame, so saving the outer page only captures a spinner. Use the bookmarklet or the CLI on the live Card grants page.",
    };
  }

  const rows = parseCsvRows(text);
  if (rows.length < 2) {
    return { grants: [], ignored: 0, error: "The CSV needs a header row and at least one grant row." };
  }
  if (rows.length > MAX_GRANTS + 1) {
    return {
      grants: [],
      ignored: 0,
      error: `That file has more than ${MAX_GRANTS.toLocaleString("en-US")} rows. Narrow it down before importing.`,
    };
  }

  const headers = rows[0]!.map(normalizeHeader);
  const linkIdx = headerIndex(headers, ["grant_link", "link", "url", "hcb_link", "grant_url", "hcblink"]);
  const emailIdx = headerIndex(headers, ["email", "recipient_email", "to_email", "buyer_email"]);
  const centsIdx = headerIndex(headers, ["amount_cents", "grant_amount_cents", "amount_cents_usd"]);
  const amountIdx = headerIndex(headers, ["amount", "amount_usd", "grant_amount", "value"]);
  const purposeIdx = headerIndex(headers, ["purpose", "for", "grant_purpose", "item"]);
  const dateIdx = headerIndex(headers, ["created_at", "date", "granted_at", "created"]);
  const statusIdx = headerIndex(headers, ["status"]);

  if (linkIdx < 0) {
    return {
      grants: [],
      ignored: 0,
      error: "This CSV has no grant_link column. Use the HCB bookmarklet below; the dashboard's own upload CSV has no links in it.",
    };
  }
  if (emailIdx < 0) {
    return {
      grants: [],
      ignored: 0,
      error: "This CSV has no email column. The HCB bookmarklet includes the recipient email so orders can be matched safely.",
    };
  }
  if (centsIdx < 0 && amountIdx < 0) {
    return { grants: [], ignored: 0, error: "This CSV has no amount_cents (or amount) column." };
  }

  const amountCol = centsIdx >= 0 ? centsIdx : amountIdx;
  const amountHeader = headers[amountCol]!;
  const grants: HcbGrant[] = [];
  let ignored = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const hash = grantHashFromLink(row[linkIdx] ?? "");
    const email = (row[emailIdx] ?? "").trim();
    const amountCents = parseCsvAmount(row[amountCol] ?? "", amountHeader);
    const statusText = (statusIdx >= 0 ? row[statusIdx] : "").trim().toLowerCase();
    // HCB's table says "Invited" for an active grant whose recipient hasn't
    // activated the card yet. Treat both as active; anything else is skipped.
    const status = statusText === "" || statusText === "active" || statusText === "invited" || statusText === "not activated"
      ? "active"
      : statusText;

    if (!hash || !email.includes("@") || !amountCents) {
      ignored++;
      continue;
    }

    const grant = toHcbGrant({
      id: `${HCB_GRANT_ID_PREFIX}${hash}`,
      email,
      amount_cents: amountCents,
      purpose: purposeIdx >= 0 ? (row[purposeIdx] ?? "").trim() : "",
      status,
      created_at: dateIdx >= 0 ? (row[dateIdx] ?? "").trim() : "",
    });
    if (!grant) {
      ignored++;
      continue;
    }
    grants.push(grant);
  }

  if (grants.length === 0) {
    return {
      grants,
      ignored,
      error: "No active grants with an email and amount were found in that CSV. Check that it came from the right HCB organization.",
    };
  }

  return { grants, ignored, error: "" };
}

const createdAtMs = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
};

const byOrder = (a: GrantImportOrder, b: GrantImportOrder) =>
  (createdAtMs(a.createdAt) ?? Number.MAX_SAFE_INTEGER) - (createdAtMs(b.createdAt) ?? Number.MAX_SAFE_INTEGER) ||
  a.orderId - b.orderId;

const byGrant = (a: HcbGrant, b: HcbGrant) =>
  (createdAtMs(a.createdAt) ?? Number.MAX_SAFE_INTEGER) - (createdAtMs(b.createdAt) ?? Number.MAX_SAFE_INTEGER) ||
  a.id.localeCompare(b.id);

// `#123` in a grant's purpose is an exact order marker. The dashboard's CSV
// does not write one today, but accepting it means future exports can be
// matched without relying on timing.
const purposeOrderId = (purpose: string): number | null => {
  const match = /#\s*(\d+)/.exec(purpose);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const groupKey = (email: string, amountCents: number) => `${email.trim().toLowerCase()}\u0000${amountCents}`;

// One-to-one pairing, oldest order with oldest grant. Existing links are
// removed from the pool first so a grant that was already recorded on another
// order can never be reused. Grants older than the order (beyond clock skew)
// are not candidates.
export function matchGrantsToOrders(
  orders: GrantImportOrder[],
  grants: HcbGrant[],
  usedLinks: Iterable<string> = [],
  ignored = 0,
): GrantImportPreview {
  const usedHashes = new Set<string>();
  for (const link of usedLinks) {
    const hash = grantHashFromLink(link);
    if (hash) usedHashes.add(hash);
  }

  const available = grants.filter((grant) => !usedHashes.has(grant.hash));
  const orderGroups = new Map<string, GrantImportOrder[]>();
  const grantGroups = new Map<string, HcbGrant[]>();

  for (const order of orders) {
    const email = order.email.trim().toLowerCase();
    if (!email || !Number.isSafeInteger(order.amountCents) || order.amountCents <= 0) continue;
    const key = groupKey(email, order.amountCents);
    const group = orderGroups.get(key);
    if (group) group.push(order);
    else orderGroups.set(key, [order]);
  }

  for (const grant of available) {
    const key = groupKey(grant.email, grant.amountCents);
    const group = grantGroups.get(key);
    if (group) group.push(grant);
    else grantGroups.set(key, [grant]);
  }

  const matches: GrantImportMatch[] = [];
  const warnings: GrantImportWarning[] = [];
  const unmatchedOrders: GrantImportUnmatchedOrder[] = [];
  const unusedGrants: GrantImportUnusedGrant[] = [];

  const unused = (grant: HcbGrant): GrantImportUnusedGrant => ({
    grantId: grant.id,
    grantLink: `${HCB_GRANT_LINK_PREFIX}${grant.hash}`,
    amountCents: grant.amountCents,
    purpose: grant.purpose,
    createdAt: grant.createdAt,
  });

  const keys = new Set([...orderGroups.keys(), ...grantGroups.keys()]);
  for (const key of keys) {
    const groupOrders = [...(orderGroups.get(key) ?? [])].sort(byOrder);
    const groupGrants = [...(grantGroups.get(key) ?? [])].sort(byGrant);

    if (groupOrders.length === 0) {
      for (const grant of groupGrants) unusedGrants.push(unused(grant));
      continue;
    }
    if (groupGrants.length === 0) {
      for (const order of groupOrders) {
        unmatchedOrders.push({
          orderId: order.orderId,
          playerName: order.playerName,
          itemName: order.itemName,
          amountCents: order.amountCents,
          reason: "No HCB grant with this buyer's email and amount.",
        });
      }
      continue;
    }

    const remaining = [...groupGrants];
    const leftovers: GrantImportOrder[] = [];

    // Exact purpose marker first, so an out-of-order upload still lands on the
    // right order when the CSV carried `#<orderId>`.
    const exactByOrder = new Map<number, HcbGrant>();
    for (const grant of remaining) {
      const id = purposeOrderId(grant.purpose);
      if (id === null || exactByOrder.has(id)) continue;
      if (groupOrders.some((order) => order.orderId === id)) exactByOrder.set(id, grant);
    }

    for (const order of groupOrders) {
      let grant = exactByOrder.get(order.orderId);
      if (grant) {
        exactByOrder.delete(order.orderId);
        const index = remaining.indexOf(grant);
        if (index >= 0) remaining.splice(index, 1);
      } else {
        const orderMs = createdAtMs(order.createdAt);
        const index = remaining.findIndex((candidate) => {
          if (orderMs === null) return true;
          const grantMs = createdAtMs(candidate.createdAt);
          return grantMs === null || grantMs >= orderMs - CLOCK_SKEW_MS;
        });
        grant = index >= 0 ? remaining.splice(index, 1)[0] : undefined;
      }

      if (!grant) {
        leftovers.push(order);
        continue;
      }

      const link = `${HCB_GRANT_LINK_PREFIX}${grant.hash}`;
      matches.push({
        orderId: order.orderId,
        playerName: order.playerName,
        itemName: order.itemName,
        quantity: order.quantity,
        amountCents: order.amountCents,
        status: order.status,
        grantId: grant.id,
        grantLink: link,
        purpose: grant.purpose,
        grantCreatedAt: grant.createdAt,
        note: groupOrders.length > 1 || groupGrants.length > 1
          ? "Another order or grant shares this email and amount. Check this link before marking."
          : "",
      });
    }

    for (const order of leftovers) {
      unmatchedOrders.push({
        orderId: order.orderId,
        playerName: order.playerName,
        itemName: order.itemName,
        amountCents: order.amountCents,
        reason: "No remaining HCB grant matches this order's email and amount.",
      });
    }
    for (const grant of remaining) unusedGrants.push(unused(grant));

    if (groupOrders.length > 1 || groupGrants.length > 1) {
      warnings.push({
        orderIds: groupOrders.map((order) => order.orderId),
        reason: `${groupOrders.length} order(s) and ${groupGrants.length} grant(s) share the same buyer email and amount. They were paired oldest-first; check each link before marking.`,
      });
    }
  }

  return {
    totalGrants: grants.length,
    ignored,
    matches: matches.sort((a, b) => a.orderId - b.orderId),
    warnings,
    unmatchedOrders: unmatchedOrders.sort((a, b) => a.orderId - b.orderId),
    unusedGrants,
  };
}
