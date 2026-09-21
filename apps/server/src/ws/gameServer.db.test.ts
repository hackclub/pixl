import { afterAll, afterEach, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import postgres from "postgres";
import WebSocket from "ws";

const adminUrl = process.env.PIXL_TEST_DATABASE_URL;

if (!adminUrl) {
  test("websocket tests need a Postgres", () => {
    throw new Error(
      "PIXL_TEST_DATABASE_URL is not set. Start one with: docker run -d --name pixl-test-pg -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:16 " +
        "then PIXL_TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres bun test src/ws/gameServer.db.test.ts",
    );
  });
} else {
  const dbName = `pixl_ws_${randomBytes(4).toString("hex")}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const goodUrl = new URL(adminUrl);
  goodUrl.pathname = `/${dbName}`;

  type Msg = { type: string; [key: string]: any };

  class Client {
    messages: Msg[] = [];
    cursor = 0;
    closed: Promise<{ code: number; reason: string }>;
    private wake = new Set<() => void>();

    constructor(readonly ws: WebSocket) {
      ws.on("message", (raw) => {
        this.messages.push(JSON.parse(raw.toString()));
        this.wake.forEach((fn) => fn());
      });
      this.closed = new Promise((resolve) =>
        ws.on("close", (code, reason) => {
          resolve({ code, reason: reason.toString() });
          this.wake.forEach((fn) => fn());
        }),
      );
      ws.on("error", () => {});
    }

    async waitFor(types: string[], ms = 5000): Promise<Msg> {
      const deadline = Date.now() + ms;
      for (;;) {
        const index = this.messages.findIndex((m, i) => i >= this.cursor && types.includes(m.type));
        if (index >= 0) {
          this.cursor = index + 1;
          return this.messages[index];
        }
        if (Date.now() >= deadline) throw new Error(`timed out waiting for ${types.join("|")}`);
        await new Promise<void>((resolve) => {
          const fn = () => {
            this.wake.delete(fn);
            resolve();
          };
          this.wake.add(fn);
          setTimeout(fn, 50);
        });
      }
    }

    async ask(payload: object, types = ["lobby_joined", "lobby_denied"]): Promise<Msg> {
      this.ws.send(JSON.stringify(payload));
      return this.waitFor(types);
    }

    close() {
      this.ws.close();
    }
  }

  let db: postgres.Sql;
  let server: Server;
  let port = 0;
  let issueSessionToken: typeof import("../auth/session.js").issueSessionToken;
  let rev: typeof import("../auth/revocation.js");
  let game: typeof import("./gameServer.js");
  let lobbiesMod: typeof import("./lobbies.js");
  let connect: (url: string | null) => Promise<void>;
  const setEnv: string[] = [];
  const open: Client[] = [];
  let ipCounter = 0;
  const freshIp = () => `198.51.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

  function issueAt(userId: string, ms: number): string {
    setSystemTime(new Date(ms));
    try {
      return issueSessionToken({ userId, displayName: "t" });
    } finally {
      setSystemTime();
    }
  }

  async function createUser() {
    const [row] = await db<{ id: string }[]>`
      insert into users (oauth_provider, oauth_id, display_name) values ('test', ${randomBytes(6).toString("hex")}, 't') returning id`;
    return row.id;
  }

  function dial(token: string, headers: Record<string, string> = { "x-forwarded-for": freshIp() }) {
    const client = new Client(new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, { headers }));
    open.push(client);
    return client;
  }

  async function signIn(userId: string, headers?: Record<string, string>) {
    const client = dial(issueAt(userId, Date.now() - 30_000), headers);
    await client.waitFor(["init"]);
    return client;
  }

  const ipHeader = (ip: string) => ({ "x-forwarded-for": ip });

  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    db = postgres(goodUrl.toString(), { max: 1, onnotice: () => {} });
    const dir = join(import.meta.dirname, "..", "..", "drizzle");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await db.unsafe(readFileSync(join(dir, file), "utf8"));
    }
    if (process.env.JWT_SECRET === undefined) {
      process.env.JWT_SECRET = randomBytes(16).toString("hex");
      setEnv.push("JWT_SECRET");
    }
    ({ issueSessionToken } = await import("../auth/session.js"));
    rev = await import("../auth/revocation.js");
    lobbiesMod = await import("./lobbies.js");
    game = await import("./gameServer.js");
    const pgCompat = await import("../db/pgCompat.js");
    connect = pgCompat.connectForTests;
    await connect(goodUrl.toString());
    const [{ name }] = await pgCompat.sql.unsafe("select current_database() as name");
    if (name !== dbName) throw new Error(`refusing to run against ${name}`);

    server = createServer();
    game.attachWebSocketServer(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  }, 120_000);

  afterEach(() => setSystemTime());

  afterAll(async () => {
    open.forEach((c) => c.ws.terminate());
    server?.closeAllConnections();
    server?.close();
    await connect?.(null);
    for (const key of setEnv) delete process.env[key];
    await db?.end();
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  }, 30_000);

  describe("weak lobby passwords already in the database", () => {
    test("are replaced with a strong one on load and persisted", async () => {
      const owner = await createUser();
      await db`insert into lobbies (id, name, is_public, password, owner_id) values ('LEGA1', 'legacy', false, '1234', ${owner})`;
      await db`insert into lobbies (id, name, is_public, password, owner_id) values ('LEGA2', 'blank', false, '', ${owner})`;
      await db`insert into lobbies (id, name, is_public, password, owner_id) values ('LEGA3', 'open', true, '', ${owner})`;
      await lobbiesMod.loadLobbies();

      for (const id of ["LEGA1", "LEGA2"]) {
        const lobby = lobbiesMod.lobbies.get(id)!;
        expect(lobby.password).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      }
      expect(lobbiesMod.lobbies.get("LEGA3")!.password).toBe("");

      const deadline = Date.now() + 5000;
      let stored: { id: string; password: string }[] = [];
      while (Date.now() < deadline) {
        stored = await db`select id, password from lobbies where id in ('LEGA1', 'LEGA2') order by id`;
        if (stored.every((r) => r.password.length === 8)) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(stored.map((r) => r.password)).toEqual([
        lobbiesMod.lobbies.get("LEGA1")!.password,
        lobbiesMod.lobbies.get("LEGA2")!.password,
      ]);
    });
  });

  describe("private lobby password guessing over real sockets", () => {
    async function makeLobby(ownerHeaders: Record<string, string>, isPublic = false) {
      const owner = await createUser();
      const client = await signIn(owner, ownerHeaders);
      const created = await client.ask({ type: "lobby_create", isPublic, name: "t" });
      expect(created.type).toBe("lobby_joined");
      return { owner, client, lobby: created.lobby as { id: string; password?: string } };
    }

    test("a new private lobby gets a strong secret the owner can see", async () => {
      const { lobby } = await makeLobby(ipHeader(freshIp()));
      expect(lobby.password).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    });

    test("four accounts behind one IP share one guess budget, and the right password from that IP is refused too", async () => {
      const shared = freshIp();
      const { lobby } = await makeLobby(ipHeader(freshIp()));
      const guessers = await Promise.all(Array.from({ length: 4 }, async () => signIn(await createUser(), ipHeader(shared))));

      let wrong = 0;
      let blocked = 0;
      const perAccount = new Map<Client, number>();
      for (let i = 0; i < 60; i++) {
        const guesser = guessers[i % guessers.length];
        const reply = await guesser.ask({ type: "lobby_join", id: lobby.id, password: "WRONG000" });
        if (reply.reason === "Wrong password.") {
          wrong++;
          perAccount.set(guesser, (perAccount.get(guesser) ?? 0) + 1);
        } else {
          expect(reply.reason).toBe("Too many attempts. Wait a bit and try again.");
          blocked++;
        }
      }
      expect(wrong).toBe(game.LOBBY_JOIN_IP_LIMIT.max);
      expect(blocked).toBe(60 - wrong);
      for (const count of perAccount.values()) expect(count).toBeLessThanOrEqual(game.LOBBY_JOIN_ATTEMPT_LIMIT.max);

      const correct = await guessers[0].ask({ type: "lobby_join", id: lobby.id, password: lobby.password });
      expect(correct.type).toBe("lobby_denied");
    });

    test("a friend on another IP with the right password gets in while the attacker is throttled", async () => {
      const { lobby } = await makeLobby(ipHeader(freshIp()));
      const attackerIp = freshIp();
      const attackers = await Promise.all(Array.from({ length: 4 }, async () => signIn(await createUser(), ipHeader(attackerIp))));
      for (let i = 0; i < 40; i++) {
        await attackers[i % 4].ask({ type: "lobby_join", id: lobby.id, password: "WRONG000" });
      }

      const friend = await signIn(await createUser(), ipHeader(freshIp()));
      const reply = await friend.ask({ type: "lobby_join", id: lobby.id, password: lobby.password!.toLowerCase() });
      expect(reply.type).toBe("lobby_joined");
    });

    test("reconnecting does not reset an account's budget, even from a new IP", async () => {
      const { lobby } = await makeLobby(ipHeader(freshIp()));
      const user = await createUser();
      const first = await signIn(user, ipHeader(freshIp()));
      for (let i = 0; i < game.LOBBY_JOIN_ATTEMPT_LIMIT.max; i++) {
        const reply = await first.ask({ type: "lobby_join", id: lobby.id, password: "WRONG000" });
        expect(reply.reason).toBe("Wrong password.");
      }
      first.close();
      await first.closed;

      const second = await signIn(user, ipHeader(freshIp()));
      const reply = await second.ask({ type: "lobby_join", id: lobby.id, password: "WRONG000" });
      expect(reply.reason).toBe("Too many attempts. Wait a bit and try again.");
      const right = await second.ask({ type: "lobby_join", id: lobby.id, password: lobby.password });
      expect(right.reason).toBe("Too many attempts. Wait a bit and try again.");
    });

    async function exhaust(lobbyId: string, guessers: Client[], attempts = 80) {
      let wrong = 0;
      for (let i = 0; i < attempts; i++) {
        const reply = await guessers[i % guessers.length].ask({ type: "lobby_join", id: lobbyId, password: "WRONG000" });
        if (reply.reason === "Wrong password.") wrong++;
      }
      return wrong;
    }

    test("a forged X-Forwarded-For prefix does not rotate the source identity", async () => {
      const { lobby } = await makeLobby(ipHeader(freshIp()));
      const guessers: Client[] = [];
      for (let i = 0; i < 4; i++) {
        guessers.push(await signIn(await createUser(), ipHeader(`9.9.9.${i + 1}, 198.51.100.222`)));
      }
      expect(await exhaust(lobby.id, guessers)).toBe(game.LOBBY_JOIN_IP_LIMIT.max);
    });

    test("a forged CF-Connecting-IP from a non-Cloudflare peer does not rotate the source identity", async () => {
      const { lobby } = await makeLobby(ipHeader(freshIp()));
      const guessers: Client[] = [];
      for (let i = 0; i < 4; i++) {
        guessers.push(await signIn(await createUser(), { "cf-connecting-ip": `203.0.113.${i + 10}` }));
      }
      expect(await exhaust(lobby.id, guessers)).toBe(game.LOBBY_JOIN_IP_LIMIT.max);
    });

    test("the owner rejoins their own lobby from a burned IP without a password", async () => {
      const burned = freshIp();
      const { lobby, client } = await makeLobby(ipHeader(burned));
      const attackers = await Promise.all(Array.from({ length: 4 }, async () => signIn(await createUser(), ipHeader(burned))));
      for (let i = 0; i < 50; i++) {
        await attackers[i % 4].ask({ type: "lobby_join", id: lobby.id, password: "WRONG000" });
      }
      const reply = await client.ask({ type: "lobby_join", id: lobby.id });
      expect(reply.type).toBe("lobby_joined");
    });

    test("public lobbies stay joinable from a fully throttled account and IP", async () => {
      const burned = freshIp();
      const priv = await makeLobby(ipHeader(freshIp()));
      const pub = await makeLobby(ipHeader(freshIp()), true);
      const attackers = await Promise.all(Array.from({ length: 4 }, async () => signIn(await createUser(), ipHeader(burned))));
      for (let i = 0; i < 50; i++) {
        await attackers[i % 4].ask({ type: "lobby_join", id: priv.lobby.id, password: "WRONG000" });
      }
      const reply = await attackers[0].ask({ type: "lobby_join", id: pub.lobby.id });
      expect(reply.type).toBe("lobby_joined");
    });
  });

  describe("revoked sessions over a real websocket", () => {
    test("a token works before revocation, is closed after, and a new login works", async () => {
      const victim = await createUser();
      const bystander = await createUser();
      const leaked = issueAt(victim, Date.now() - 30_000);

      const live = dial(leaked);
      await live.waitFor(["init"]);
      const bystanderClient = await signIn(bystander);

      const revokedAt = Date.now();
      expect(await rev.revokeUserSessions(victim, revokedAt)).toBe("revoked");
      expect(game.endUserSession(victim, revokedAt)).toBe(true);
      expect((await live.closed).code).toBe(4001);

      const again = dial(leaked);
      expect((await again.closed).code).toBe(4001);
      expect(again.messages.some((m) => m.type === "init")).toBe(false);

      const fresh = dial(issueAt(victim, Date.now() + 3_000));
      await fresh.waitFor(["init"]);
      expect(bystanderClient.ws.readyState).toBe(WebSocket.OPEN);
    });

    test("a live socket is closed by the sweep when another replica revoked the session", async () => {
      const victim = await createUser();
      const other = await createUser();
      const live = await signIn(victim);
      const untouched = await signIn(other);

      expect(await rev.revokeUserSessions(victim)).toBe("revoked");
      expect(live.ws.readyState).toBe(WebSocket.OPEN);
      await game.sweepRevokedSessions();

      expect((await live.closed).code).toBe(4001);
      expect(untouched.ws.readyState).toBe(WebSocket.OPEN);
    });

    test("a socket opened with a fresh token is not swept after an older revocation", async () => {
      const user = await createUser();
      const old = issueAt(user, Date.now() - 30_000);
      expect(await rev.revokeUserSessions(user)).toBe("revoked");
      const relogin = dial(issueAt(user, Date.now() + 3_000));
      await relogin.waitFor(["init"]);
      await game.sweepRevokedSessions();
      expect(relogin.ws.readyState).toBe(WebSocket.OPEN);
      expect((await dial(old).closed).code).toBe(4001);
    });

    test("when revocation state cannot be read the socket is refused with a retryable close", async () => {
      const user = await createUser();
      const token = issueAt(user, Date.now() - 30_000);
      await connect("postgres://postgres:test@127.0.0.1:1/none");
      try {
        const client = dial(token);
        expect((await client.closed).code).toBe(1013);
        expect(client.messages.some((m) => m.type === "init")).toBe(false);
      } finally {
        await connect(goodUrl.toString());
      }
    });
  });
}
