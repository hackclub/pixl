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
  /** Empty for the bookmarklet CSV, which has the displayed name instead. */
  email: string;
  /**
   * Recipient name shown on HCB's Card grants table (the bookmarklet fills
   * this). Empty for the CLI JSON, which has the email.
   */
  name: string;
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
  /** Recipient name shown on HCB, for comparing against the player name. */
  hcbName: string;
  /** Set when more than one order/grant shares the same email and amount. */
  note: string;
}

export interface GrantImportWarning {
  orderIds: number[];
  /** Grants in the ambiguous group, so the owner can open each one. */
  grantIds?: string[];
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
  hcbName: string;
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
  name?: unknown;
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
  const name = typeof item.name === "string" ? item.name.trim() : "";
  const amountCents = Number(item.amount_cents);
  const status = typeof item.status === "string" ? item.status : "active";
  const purpose = typeof item.purpose === "string" ? item.purpose.trim() : "";

  // The JSON export has emails; the bookmarklet CSV has the displayed name.
  // At least one is needed to match a grant to a waiting order.
  if (!hash || (!email.includes("@") && !name) || !Number.isSafeInteger(amountCents) || amountCents <= 0 || status !== "active") {
    return null;
  }

  const parsedDate = typeof item.created_at === "string" ? new Date(item.created_at) : null;
  const createdAt = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null;

  return {
    id: `${HCB_GRANT_ID_PREFIX}${hash}`,
    hash,
    email,
    name,
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
//   email, amount_cents, purpose, grant_link, created_at, status, name
// The table does not show emails, so `email` is blank and `name` is the
// displayed recipient. Hand-edited sheets are accepted too, as long as they
// have a grant link, an amount, and an email or name column. This is
// deliberately separate from the dashboard's own bulk-upload CSV: that file
// has no link and can't fill one.
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
  const nameIdx = headerIndex(headers, ["name", "recipient", "recipient_name", "to", "hcb_name"]);
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
  if (emailIdx < 0 && nameIdx < 0) {
    return {
      grants: [],
      ignored: 0,
      error: "This CSV needs an email or recipient name column so grants can be matched to orders.",
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
    const email = emailIdx >= 0 ? (row[emailIdx] ?? "").trim() : "";
    const name = nameIdx >= 0 ? (row[nameIdx] ?? "").trim() : "";
    const amountCents = parseCsvAmount(row[amountCol] ?? "", amountHeader);
    const statusText = (statusIdx >= 0 ? row[statusIdx] : "").trim().toLowerCase();
    // HCB's table says "Invited" for an active grant whose recipient hasn't
    // activated the card yet. Treat both as active; anything else is skipped.
    const status = statusText === "" || statusText === "active" || statusText === "invited" || statusText === "not activated"
      ? "active"
      : statusText;

    if (!hash || (!email.includes("@") && !name) || !amountCents) {
      ignored++;
      continue;
    }

    const grant = toHcbGrant({
      id: `${HCB_GRANT_ID_PREFIX}${hash}`,
      email,
      name,
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
      error: "No active grants with an email or name and an amount were found in that CSV. Check that it came from the right HCB organization.",
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

const normalizeWords = (value: string): string[] =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

// HCB's table shows a short name ("Ellie", "Dániel T", "damakerdev") while the
// dashboard has the player's full/display name. Score the shapes we can
// resolve: exact, first + last initial, a username containing both, or a
// shared first name. Anything weaker falls back to amount + item and is
// flagged for review.
function nameScore(hcbName: string, playerName: string): number {
  const a = normalizeWords(hcbName);
  const b = normalizeWords(playerName);
  if (a.length === 0 || b.length === 0) return 0;
  if (a.join(" ") === b.join(" ")) return 4;

  const aFirst = a[0]!;
  const bFirst = b[0]!;
  const aLast = a[a.length - 1]!;
  const bLast = b[b.length - 1]!;

  if (aFirst === bFirst) {
    if (a.length > 1 && b.length > 1) {
      if (aLast[0] === bLast[0] || aLast.startsWith(bLast) || bLast.startsWith(aLast)) return 3;
      return 2;
    }
    return 2;
  }

  // "suhanisehrawatcute" → Suhani Sehrawat; "damakerdev" → Damaker Dev.
  if (a.length === 1 && b.length > 1 && a[0]!.includes(bFirst) && a[0]!.includes(bLast)) return 2;
  if (b.length === 1 && a.length > 1 && b[0]!.includes(aFirst) && b[0]!.includes(aLast)) return 2;
  if (aFirst.startsWith(bFirst) || bFirst.startsWith(aFirst)) return 1;
  return 0;
}

const normalizeItem = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function itemScore(purpose: string, itemName: string): number {
  const a = normalizeItem(purpose);
  const b = normalizeItem(itemName);
  if (!a || !b) return 0;
  if (a === b) return 2;
  return a.includes(b) || b.includes(a) ? 1 : 0;
}

interface NameCandidate {
  order: GrantImportOrder;
  name: number;
  item: number;
}

interface NamePass {
  matches: GrantImportMatch[];
  warnings: GrantImportWarning[];
  unmatchedOrders: GrantImportUnmatchedOrder[];
  unusedGrants: GrantImportUnusedGrant[];
}

// Match the bookmarklet rows (no email) against the orders the email pass
// couldn't claim. Only auto-pair a unique best name, or a unique amount+item
// candidate with a warning. Ties are left in the preview for manual review.
function matchNameGrants(orders: GrantImportOrder[], grants: HcbGrant[]): NamePass {
  const remaining = [...orders].sort(byOrder);
  const matches: GrantImportMatch[] = [];
  const warnings: GrantImportWarning[] = [];
  const unusedGrants: GrantImportUnusedGrant[] = [];

  const timePlausible = (grant: HcbGrant, order: GrantImportOrder): boolean => {
    const orderMs = createdAtMs(order.createdAt);
    if (orderMs === null) return true;
    const grantMs = createdAtMs(grant.createdAt);
    return grantMs === null || grantMs >= orderMs - CLOCK_SKEW_MS;
  };

  const candidatesFor = (grant: HcbGrant): NameCandidate[] =>
    remaining
      .filter((order) => order.amountCents === grant.amountCents && timePlausible(grant, order))
      .map((order) => ({
        order,
        name: nameScore(grant.name, order.playerName),
        item: itemScore(grant.purpose, order.itemName),
      }));

  interface Proposal {
    grant: HcbGrant;
    order: GrantImportOrder;
    score: number;
    item: number;
  }

  // Phase 1: collect the unique best name match for each grant, then assign
  // the strongest proposals first. Doing this before the no-name warnings
  // stops a weak amount/item candidate from "claiming" an order that a real
  // name match owns (the Dániel T / Ellie Hardware case).
  const proposals: Proposal[] = [];
  for (const grant of grants) {
    const named = candidatesFor(grant)
      .filter((candidate) => candidate.name >= 2)
      .sort((a, b) => b.name - a.name || b.item - a.item || byOrder(a.order, b.order));
    const top = named[0];
    if (!top) continue;
    const tied = named.filter((candidate) => candidate.name === top.name);
    if (tied.length === 1) {
      proposals.push({ grant, order: top.order, score: top.name, item: top.item });
    }
  }

  proposals.sort((a, b) =>
    b.score - a.score ||
    b.item - a.item ||
    (createdAtMs(a.grant.createdAt) ?? Number.MAX_SAFE_INTEGER) -
      (createdAtMs(b.grant.createdAt) ?? Number.MAX_SAFE_INTEGER) ||
    a.grant.id.localeCompare(b.grant.id),
  );

  const matchedGrants = new Set<string>();
  for (const proposal of proposals) {
    if (matchedGrants.has(proposal.grant.id)) continue;
    const index = remaining.indexOf(proposal.order);
    if (index < 0) continue;
    remaining.splice(index, 1);
    matchedGrants.add(proposal.grant.id);
    matches.push({
      orderId: proposal.order.orderId,
      playerName: proposal.order.playerName,
      itemName: proposal.order.itemName,
      quantity: proposal.order.quantity,
      amountCents: proposal.order.amountCents,
      status: proposal.order.status,
      grantId: proposal.grant.id,
      grantLink: `${HCB_GRANT_LINK_PREFIX}${proposal.grant.hash}`,
      purpose: proposal.grant.purpose,
      grantCreatedAt: proposal.grant.createdAt,
      hcbName: proposal.grant.name,
      note: `Matched by HCB name + amount (${proposal.grant.name} → ${proposal.order.playerName}).`,
    });
  }

  // Phase 2: everything left needs a human. Never auto-pair on amount/item
  // alone: the same item and price can belong to a different person.
  for (const grant of grants) {
    if (matchedGrants.has(grant.id)) continue;
    const candidates = candidatesFor(grant);
    const named = candidates
      .filter((candidate) => candidate.name >= 2)
      .sort((a, b) => b.name - a.name || b.item - a.item || byOrder(a.order, b.order));
    if (named.length > 0) {
      warnings.push({
        orderIds: named.map((candidate) => candidate.order.orderId),
        grantIds: [grant.id],
        reason: `HCB grant ${grant.id} matches ${named.length} remaining order(s) by name and amount. Pick one by hand.`,
      });
    } else {
      const byItem = candidates.filter((candidate) => candidate.item > 0);
      if (byItem.length > 0) {
        warnings.push({
          orderIds: byItem.map((candidate) => candidate.order.orderId),
          grantIds: [grant.id],
          reason: `HCB grant ${grant.id} has no name match but ${byItem.length === 1 ? "one remaining order matches" : `${byItem.length} remaining orders match`} its amount/item. Pick one by hand.`,
        });
      }
    }
    if (remaining.some((order) => order.amountCents === grant.amountCents)) {
      unusedGrants.push({
        grantId: grant.id,
        grantLink: `${HCB_GRANT_LINK_PREFIX}${grant.hash}`,
        amountCents: grant.amountCents,
        purpose: grant.purpose,
        hcbName: grant.name,
        createdAt: grant.createdAt,
      });
    }
  }

  return {
    matches,
    warnings,
    unmatchedOrders: remaining.map((order) => ({
      orderId: order.orderId,
      playerName: order.playerName,
      itemName: order.itemName,
      amountCents: order.amountCents,
      reason: "No HCB grant with this name, amount or item.",
    })),
    unusedGrants,
  };
}

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
  // The CLI JSON has emails; the bookmarklet CSV has the displayed name. Use
  // the email path where possible and fall back to name + amount + item for
  // the rest.
  const emailGrants = available.filter((grant) => grant.email.includes("@"));
  const nameGrants = available.filter((grant) => !grant.email.includes("@"));
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

  for (const grant of emailGrants) {
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
    hcbName: grant.name,
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
        hcbName: grant.name,
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
        grantIds: groupGrants.map((grant) => grant.id),
        reason:
          `${groupOrders.length} order(s) and ${groupGrants.length} grant(s) share the same buyer email and amount.` +
          (groupGrants.length > groupOrders.length
            ? " There are more grants than orders — check which grant is real before marking."
            : " They were paired oldest-first; check each link before marking."),
      });
    }
  }

  // Name-only rows (the bookmarklet) only compete for orders the email pass
  // didn't already claim.
  if (nameGrants.length > 0) {
    const byId = new Map(orders.map((order) => [order.orderId, order]));
    const unmatchedFull = unmatchedOrders
      .map((row) => byId.get(row.orderId))
      .filter((order): order is GrantImportOrder => order !== undefined);
    const namePass = matchNameGrants(unmatchedFull, nameGrants);
    matches.push(...namePass.matches);
    warnings.push(...namePass.warnings);
    unusedGrants.push(...namePass.unusedGrants);
    unmatchedOrders.splice(0, unmatchedOrders.length, ...namePass.unmatchedOrders);
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
