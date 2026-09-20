import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const scripts = join(import.meta.dir, "..", "scripts");
const loginGd = readFileSync(join(scripts, "web_login.gd"), "utf8");
const pagesGd = readFileSync(join(scripts, "web_pages.gd"), "utf8");
const managerGd = readFileSync(join(scripts, "network_manager.gd"), "utf8");

function gdString(source: string, name: string): string {
  const m = source.match(new RegExp(`const ${name} := """([\\s\\S]*?)"""`));
  if (!m) throw new Error(`${name} missing`);
  return m[1];
}

function gdFunction(source: string, name: string): string {
  const start = source.indexOf(`func ${name}(`);
  if (start === -1) throw new Error(`${name} missing`);
  const next = source.indexOf("\nfunc ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

const beginJs = gdString(loginGd, "_begin_js");
const takeJs = gdString(loginGd, "_take_js");
const openJs = gdString(pagesGd, "_open_js");

const NONCE_KEY = "pixl_game_login_nonce";
const TTL_MS = 10 * 60 * 1000;
const ORIGIN = "https://pixl.hackclub.com";
const PLAY = `${ORIGIN}/play/`;
const ATTACKER_JWT = "attacker.jwt.value";

interface Taken {
  token: string;
  name: string;
  isNew: boolean;
}

function makeGame(
  opts: { store?: Map<string, string>; clock?: { now: number }; noCrypto?: boolean; storageThrows?: boolean } = {},
) {
  const store = opts.store ?? new Map<string, string>();
  const clock = opts.clock ?? { now: 1_000_000 };
  const entries: string[] = [PLAY];
  const replaced: string[] = [];
  const randomCalls: number[] = [];

  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts.storageThrows) throw new Error("storage blocked");
      store.set(k, String(v));
    },
    removeItem: (k: string) => void store.delete(k),
  };
  const crypto = {
    getRandomValues: (a: Uint8Array) => {
      if (opts.noCrypto) throw new Error("no secure randomness");
      randomCalls.push(a.length);
      return globalThis.crypto.getRandomValues(a);
    },
  };
  const math = {
    random: () => {
      throw new Error("Math.random must never be used for the login nonce");
    },
  };
  const date = { now: () => clock.now };
  const location = {
    get href() {
      return entries[entries.length - 1];
    },
  };
  const history = {
    replaceState: (_state: unknown, _title: string, url: string) => {
      entries[entries.length - 1] = new URL(url, location.href).href;
      replaced.push(url);
    },
  };
  const document = { title: "Pixl" };

  const begin = (): string =>
    new Function("crypto", "localStorage", "Date", "Math", `return ${beginJs}`)(crypto, localStorage, date, math);

  const navigate = (url: string) => void entries.push(url);

  const take = (url?: string): Taken | null => {
    if (url) navigate(url);
    const raw: string = new Function("location", "history", "document", "localStorage", "Date", `return ${takeJs}`)(
      location,
      history,
      document,
      localStorage,
      date,
    );
    return raw === "" ? null : (JSON.parse(raw) as Taken);
  };

  return { begin, take, navigate, store, clock, entries, replaced, randomCalls, location };
}

const storedNonce = (store: Map<string, string>) => (store.get(NONCE_KEY) ?? "").split(".")[0];

describe("game web login start", () => {
  test("the nonce is 16 bytes from crypto.getRandomValues, hex encoded, never Math.random", () => {
    const game = makeGame();
    const nonce = game.begin();
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(game.randomCalls).toEqual([16]);
    expect(beginJs).toContain("crypto.getRandomValues");
    expect(beginJs).not.toContain("Math.random");
  });

  test("it stores exactly the nonce it returns, expiring in ten minutes", () => {
    const game = makeGame();
    const nonce = game.begin();
    expect(game.store.get(NONCE_KEY)).toBe(`${nonce}.${game.clock.now + TTL_MS}`);
    expect(storedNonce(game.store)).toBe(nonce);
  });

  test("every login start gets a fresh nonce", () => {
    const game = makeGame();
    expect(game.begin()).not.toBe(game.begin());
  });

  test("without secure randomness it refuses to start and stores nothing", () => {
    const game = makeGame({ noCrypto: true });
    expect(game.begin()).toBe("");
    expect(game.store.size).toBe(0);
  });

  test("when the nonce cannot be stored it refuses to start", () => {
    const game = makeGame({ storageThrows: true });
    expect(game.begin()).toBe("");
    expect(game.store.size).toBe(0);
  });
});

describe("game web login return", () => {
  test("a bare /play/?token= does not establish a session", () => {
    const game = makeGame();
    expect(game.take(`${PLAY}?token=${ATTACKER_JWT}`)).toBeNull();
  });

  test("a bare token is rejected even while this browser has a login pending", () => {
    const game = makeGame();
    game.begin();
    expect(game.take(`${PLAY}?token=${ATTACKER_JWT}`)).toBeNull();
  });

  test("a token with the wrong, empty or absent ln does not establish a session", () => {
    const game = makeGame();
    game.begin();
    expect(game.take(`${PLAY}?token=${ATTACKER_JWT}&ln=deadbeef`)).toBeNull();
    expect(game.take(`${PLAY}?token=${ATTACKER_JWT}&ln=`)).toBeNull();
    expect(game.take(`${PLAY}?token=${ATTACKER_JWT}&name=x`)).toBeNull();
  });

  test("an attacker's own completed login link fails in a browser that never started it", () => {
    const attacker = makeGame();
    const attackerNonce = attacker.begin();
    const victim = makeGame();
    victim.begin();
    expect(victim.take(`${PLAY}?token=${ATTACKER_JWT}&name=evil&ln=${attackerNonce}`)).toBeNull();
    const cold = makeGame();
    expect(cold.take(`${PLAY}?token=${ATTACKER_JWT}&ln=${attackerNonce}`)).toBeNull();
  });

  test("a token with the correct browser-generated ln establishes a session", () => {
    const game = makeGame();
    const nonce = game.begin();
    expect(game.take(`${PLAY}?token=real.jwt&name=Ricky&new=1&ln=${nonce}`)).toEqual({
      token: "real.jwt",
      name: "Ricky",
      isNew: true,
    });
  });

  test("an existing player's return is not flagged as a new account", () => {
    const game = makeGame();
    const nonce = game.begin();
    expect(game.take(`${PLAY}?token=real.jwt&name=Ricky&ln=${nonce}`)?.isNew).toBe(false);
  });

  test("the nonce is single use, so replaying the same return fails", () => {
    const game = makeGame();
    const nonce = game.begin();
    const url = `${PLAY}?token=real.jwt&name=Ricky&ln=${nonce}`;
    expect(game.take(url)?.token).toBe("real.jwt");
    expect(game.store.has(NONCE_KEY)).toBe(false);
    expect(game.take(url)).toBeNull();
  });

  test("an expired login attempt is rejected, right up to the expiry instant", () => {
    const early = makeGame();
    const earlyNonce = early.begin();
    early.clock.now += TTL_MS - 1;
    expect(early.take(`${PLAY}?token=real.jwt&ln=${earlyNonce}`)?.token).toBe("real.jwt");

    const late = makeGame();
    const lateNonce = late.begin();
    late.clock.now += TTL_MS;
    expect(late.take(`${PLAY}?token=real.jwt&ln=${lateNonce}`)).toBeNull();
  });

  test("malformed stored nonces never match", () => {
    for (const junk of ["", "abc", "abc.", ".123", "abc.notanumber", "..."]) {
      const game = makeGame({ store: new Map([[NONCE_KEY, junk]]) });
      expect(game.take(`${PLAY}?token=real.jwt&ln=abc`)).toBeNull();
      expect(game.take(`${PLAY}?token=real.jwt&ln=`)).toBeNull();
    }
  });

  test("a rejected return does not burn the visitor's own pending login", () => {
    const game = makeGame();
    const nonce = game.begin();
    expect(game.take(`${PLAY}?token=${ATTACKER_JWT}`)).toBeNull();
    expect(game.take(`${PLAY}?token=${ATTACKER_JWT}&ln=wrong`)).toBeNull();
    expect(game.take(`${PLAY}?token=real.jwt&ln=${nonce}`)?.token).toBe("real.jwt");
  });

  test("a rejected return touches no stored state, so a saved session is left alone", () => {
    const store = new Map([
      ["pixl_token", "legit.session"],
      [NONCE_KEY, `pending.${1_000_000 + TTL_MS}`],
    ]);
    const before = new Map(store);
    const game = makeGame({ store });
    expect(game.take(`${PLAY}?token=${ATTACKER_JWT}&ln=wrong`)).toBeNull();
    expect(store).toEqual(before);
  });

  test("a callback with no login params is a no-op", () => {
    const game = makeGame();
    expect(game.take(PLAY)).toBeNull();
    expect(game.take(`${PLAY}?utm=1`)).toBeNull();
    expect(game.replaced).toEqual([]);
  });
});

describe("the returned JWT never stays in the visible url or history", () => {
  const cleaned = (game: ReturnType<typeof makeGame>) => {
    expect(game.entries.every((e) => !e.includes("token=") && !e.includes("real.jwt") && !e.includes(ATTACKER_JWT))).toBe(true);
    expect(game.location.href).not.toMatch(/[?&](token|name|new|ln)=/);
  };

  test("after an accepted login", () => {
    const game = makeGame();
    const nonce = game.begin();
    game.take(`${PLAY}?token=real.jwt&name=Ricky&new=1&ln=${nonce}`);
    cleaned(game);
    expect(game.location.href).toBe(PLAY);
  });

  test("after a bare-token rejection", () => {
    const game = makeGame();
    game.take(`${PLAY}?token=${ATTACKER_JWT}&name=evil`);
    cleaned(game);
  });

  test("after a wrong-nonce rejection", () => {
    const game = makeGame();
    game.begin();
    game.take(`${PLAY}?token=${ATTACKER_JWT}&ln=nope`);
    cleaned(game);
  });

  test("the entry is replaced rather than pushed, so it does not survive in history", () => {
    const game = makeGame();
    game.take(`${PLAY}?token=${ATTACKER_JWT}`);
    expect(game.replaced).toHaveLength(1);
    expect(takeJs).toContain("history.replaceState");
    expect(takeJs).not.toContain("pushState");
  });

  test("unrelated params and the hash survive the cleanup", () => {
    const game = makeGame();
    const nonce = game.begin();
    game.take(`${PLAY}?a=1&token=real.jwt&name=x&ln=${nonce}&b=two#frag`);
    expect(game.location.href).toBe(`${PLAY}?a=1&b=two#frag`);
  });

  test("the url is cleaned even when the nonce check throws", () => {
    const game = makeGame({ store: new Map() });
    const throwing = {
      getItem: () => {
        throw new Error("storage blocked");
      },
      removeItem: () => {},
    };
    game.navigate(`${PLAY}?token=${ATTACKER_JWT}&ln=x`);
    const raw = new Function("location", "history", "document", "localStorage", "Date", `return ${takeJs}`)(
      game.location,
      { replaceState: (_s: unknown, _t: string, u: string) => (game.entries[game.entries.length - 1] = new URL(u, game.location.href).href) },
      { title: "Pixl" },
      throwing,
      { now: () => 1 },
    );
    expect(raw).toBe("");
    expect(game.location.href).toBe(PLAY);
  });
});

describe("network_manager.gd wiring", () => {
  const start = gdFunction(managerGd, "_start_login_web");
  const callback = gdFunction(managerGd, "_check_web_login_callback");

  test("login start sends exactly the generated nonce to /auth/hackclub and keeps web_redirect", () => {
    expect(managerGd).toContain('const WebLogin := preload("res://scripts/web_login.gd")');
    expect(start).toContain("var nonce := WebLogin.begin()");
    expect(start).toMatch(
      /SERVER_HTTP_URL \+ "\/auth\/hackclub\?web_redirect=" \+ String\(current_url\)\.uri_encode\(\) \+ "&nonce=" \+ nonce\n/,
    );
  });

  test("login start bails out before navigating when no nonce could be made", () => {
    const guard = start.indexOf('if nonce == "":');
    expect(guard).toBeGreaterThan(-1);
    expect(start.slice(guard, guard + 80)).toContain("return");
    expect(guard).toBeLessThan(start.indexOf("window.location.href"));
  });

  test("the callback reads nothing from the url itself, only what WebLogin.take() accepted", () => {
    expect(callback).toContain("WebLogin.take()");
    expect(callback).not.toContain("_extract_query_param");
    expect(callback).not.toContain("location.search");
  });

  test("the session is only assigned after the empty-result guard returns", () => {
    expect(callback).toMatch(/if login\.is_empty\(\):\n\t\treturn\n/);
    const guard = callback.indexOf("login.is_empty()");
    const firstAssign = callback.indexOf("session_token =");
    expect(guard).toBeGreaterThan(-1);
    expect(firstAssign).toBeGreaterThan(guard);
    expect(callback.match(/session_token =/g)).toHaveLength(1);
  });

  test("the native localhost:7777 login stays separate and never needs the browser nonce", () => {
    const desktopStart = gdFunction(managerGd, "_start_login_desktop");
    const desktopListener = gdFunction(managerGd, "_process_login_listener");
    expect(desktopStart).toContain('OS.shell_open(SERVER_HTTP_URL + "/auth/hackclub")');
    expect(desktopStart).not.toMatch(/nonce|WebLogin/);
    expect(desktopListener).not.toMatch(/nonce|WebLogin|\bln\b/);
    expect(desktopListener).toContain('_extract_query_param(request, "token")');
  });

  test("the login js strings are raw-safe for GDScript and take no format arguments", () => {
    for (const js of [beginJs, takeJs]) {
      expect(js).not.toContain("\\");
      expect(js).not.toContain('"""');
    }
  });
});

describe("game login then companion page handoff", () => {
  function handoff(store: Map<string, string>, session: string, url: string) {
    const opened: string[] = [];
    const window = { open: (u: string) => (opened.push(u), {}) };
    const location = { origin: ORIGIN, href: PLAY };
    const localStorage = {
      setItem: (k: string, v: string) => void store.set(k, String(v)),
    };
    const code = openJs.replace("%s", () => JSON.stringify(url)).replace("%s", () => JSON.stringify(session));
    new Function("window", "document", "location", "localStorage", code)(window, {}, location, localStorage);
    return opened;
  }

  test("a real login return flows into the shop through same-origin storage with a token-free url", () => {
    const store = new Map<string, string>();
    const game = makeGame({ store });
    const nonce = game.begin();
    const login = game.take(`${PLAY}?token=real.jwt&name=Ricky&ln=${nonce}`);
    expect(login?.token).toBe("real.jwt");
    const opened = handoff(store, login!.token, `${ORIGIN}/shop/?embed=1`);
    expect(store.get("pixl_token")).toBe("real.jwt");
    expect(opened).toEqual([`${ORIGIN}/shop/?embed=1`]);
    expect(opened[0]).not.toContain("real.jwt");
  });

  test("a planted /play/?token= never becomes a session, so nothing reaches the shell", () => {
    const store = new Map<string, string>();
    const game = makeGame({ store });
    const login = game.take(`${PLAY}?token=${ATTACKER_JWT}&name=evil`);
    expect(login).toBeNull();
    handoff(store, login?.token ?? "", `${ORIGIN}/shop/?embed=1`);
    expect(store.has("pixl_token")).toBe(false);
    expect([...store.values()].join()).not.toContain(ATTACKER_JWT);
  });
});
