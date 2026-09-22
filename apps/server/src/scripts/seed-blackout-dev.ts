import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must be set");
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
  console.error(`refusing to seed: ${host} is not a local database`);
  process.exit(1);
}

const arg = (name: string, fallback: number): number => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const n = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number`);
  return n;
};
const startHours = arg("start-hours", -1);
const endHours = arg("end-hours", 168);

const sql = postgres(url, { max: 1, onnotice: () => {} });
const H = 3_600_000;
const now = Date.now();

const [existing] = await sql`select id, status, starts_at, ends_at from operations where slug = 'operation-blackout'`;
if (existing) {
  console.log("operation-blackout already exists:", existing);
} else {
  // rate=1, mode=additive: a flat +$1/hr bonus on top of each contributor's
  // own rate, Blackout's real config - not a $5 minimum. See domain.ts's
  // RateMode doc comment.
  const [res] = await sql`select operation_create(
    'operation-blackout', 'Operation Blackout',
    ${new Date(now + startHours * H).toISOString()}::timestamptz,
    ${new Date(now + endHours * H).toISOString()}::timestamptz,
    1, 72, 'seed-blackout-dev', 'additive') as r`;
  console.log("created:", res.r);
}
await sql.end();
