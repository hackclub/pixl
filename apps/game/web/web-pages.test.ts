import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const gd = readFileSync(join(import.meta.dir, "..", "scripts", "web_pages.gd"), "utf8");
const pixl = readFileSync(join(import.meta.dir, "pixl.js"), "utf8");

function gdString(name: string): string {
  const m = gd.match(new RegExp(`const ${name} := """([\\s\\S]*?)"""`));
  if (!m) throw new Error(`${name} missing from web_pages.gd`);
  return m[1];
}

function gdFunction(name: string): string {
  const start = gd.indexOf(`func ${name}(`);
  if (start === -1) throw new Error(`${name} missing from web_pages.gd`);
  const next = gd.indexOf("\nfunc ", start + 1);
  const body = gd.slice(start, next === -1 ? undefined : next);
  return body
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.trim().startsWith("#"))
    .join("\n");
}

const openJs = gdString("_open_js");
const signOutJs = gdString("_sign_out_js");

const SESSION = "game.session.jwt";
const ATTACKER_JWT = "attacker.jwt.value";

function makeBrowser(origin: string, opts: { popupBlocked?: boolean; storageThrows?: boolean } = {}, store = new Map<string, string>()) {
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts.storageThrows) throw new Error("storage blocked");
      store.set(k, String(v));
    },
    removeItem: (k: string) => void store.delete(k),
  };
  const opened: { url: string; name: string }[] = [];
  const messages: { data: unknown; target: string }[] = [];
  const popup = {
    closed: false,
    postMessage: (data: unknown, target: string) => void messages.push({ data, target }),
  };
  const overlay: { children: any[] }[] = [];
  const makeEl = (): any => ({
    style: {},
    children: [] as any[],
    appendChild(c: any) {
      this.children.push(c);
    },
    remove() {},
  });
  const document = {
    getElementById: () => null,
    createElement: makeEl,
    body: { appendChild: (n: any) => void overlay.push(n) },
    addEventListener() {},
    removeEventListener() {},
  };
  const window: Record<string, unknown> = {
    open: (url: string, name: string) => {
      opened.push({ url, name });
      return opts.popupBlocked ? null : popup;
    },
  };
  const location = { origin, href: origin + "/play/" };

  const open = (url: string, token: string) => {
    const code = openJs.replace("%s", () => JSON.stringify(url)).replace("%s", () => JSON.stringify(token));
    new Function("window", "document", "location", "localStorage", code)(window, document, location, localStorage);
  };
  const signOut = () => {
    new Function("window", "localStorage", signOutJs)(window, localStorage);
  };
  return { open, signOut, store, opened, messages, overlay, window };
}

const LOGIN_START = "// <login-intake>";
const LOGIN_END = "// </login-intake>";
const intakeBlock = pixl.slice(pixl.indexOf(LOGIN_START), pixl.indexOf(LOGIN_END));

function makePage(store: Map<string, string>, origin: string, pathname = "/shop/") {
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  const api = new Function(
    "localStorage",
    "crypto",
    "Date",
    "API",
    "location",
    `${intakeBlock}\nreturn { loginNonce, takeReturnedToken };`,
  )(localStorage, globalThis.crypto, Date, "https://server.pixl.hackclub.com", { origin, pathname }) as {
    loginNonce: () => string;
    takeReturnedToken: (p: URLSearchParams) => string;
  };
  const resolveToken = (openedUrl: string) => {
    const token = api.takeReturnedToken(new URL(openedUrl).searchParams);
    return token || localStorage.getItem("pixl_token") || "";
  };
  return { ...api, resolveToken };
}

const APEX = "https://pixl.hackclub.com";
const PLAY = "https://play.pixl.hackclub.com";

describe("game to companion page handoff", () => {
  test.each(["shop", "dashboard", "projects", "quests"])(
    "same-origin %s page gets the session in pixl_token and a token-free url",
    (page) => {
      const game = makeBrowser(APEX);
      const url = `${APEX}/${page}/?embed=1`;
      game.open(url, SESSION);
      expect(game.store.get("pixl_token")).toBe(SESSION);
      expect(game.opened).toEqual([{ url, name: "pixl_web" }]);
      expect(game.opened[0].url).not.toContain(SESSION);
      expect(game.opened[0].url).not.toContain("token=");
    },
  );

  test("the same-origin play host hands off to itself", () => {
    const game = makeBrowser(PLAY);
    game.open(`${PLAY}/shop/?embed=1`, SESSION);
    expect(game.store.get("pixl_token")).toBe(SESSION);
  });

  test("localhost dev (game and shell on one origin) hands off", () => {
    const game = makeBrowser("http://localhost:8000");
    game.open("http://localhost:8000/shop/?embed=1", SESSION);
    expect(game.store.get("pixl_token")).toBe(SESSION);
  });

  test("the handoff overwrites a stale session from another account", () => {
    const game = makeBrowser(APEX, {}, new Map([["pixl_token", "old.account.jwt"]]));
    game.open(`${APEX}/shop/?embed=1`, SESSION);
    expect(game.store.get("pixl_token")).toBe(SESSION);
  });

  test("a signed-out game leaves the stored session alone and still opens the page", () => {
    const game = makeBrowser(APEX, {}, new Map([["pixl_token", "web.login.jwt"]]));
    game.open(`${APEX}/shop/?embed=1`, "");
    expect(game.store.get("pixl_token")).toBe("web.login.jwt");
    expect(game.opened).toHaveLength(1);
  });

  test("a token with quotes or script-ish characters is stored verbatim, never executed", () => {
    const game = makeBrowser(APEX);
    const nasty = `a"b');window.evil=1;//</script>`;
    game.open(`${APEX}/shop/?embed=1`, nasty);
    expect(game.store.get("pixl_token")).toBe(nasty);
    expect((game.window as any).evil).toBeUndefined();
  });

  test("blocked storage does not stop the page from opening", () => {
    const game = makeBrowser(APEX, { storageThrows: true });
    game.open(`${APEX}/shop/?embed=1`, SESSION);
    expect(game.opened).toHaveLength(1);
    expect(game.store.size).toBe(0);
  });

  test("the popup-blocked fallback still opens the same token-free url", () => {
    const game = makeBrowser(APEX, { popupBlocked: true });
    const url = `${APEX}/shop/?embed=1`;
    game.open(url, SESSION);
    expect(game.store.get("pixl_token")).toBe(SESSION);
    expect(game.overlay).toHaveLength(1);
    const button = game.overlay[0].children[0].children[1];
    button.onclick();
    expect(game.opened.map((o) => o.url)).toEqual([url, url]);
    expect(game.opened.every((o) => !o.url.includes(SESSION))).toBe(true);
  });
});

describe("cross-origin targets never receive the session", () => {
  const cases: [string, string, string][] = [
    ["game on the play host, page on the apex", PLAY, `${APEX}/shop/?embed=1`],
    ["game on the apex, page on the play host", APEX, `${PLAY}/shop/?embed=1`],
    ["scheme downgrade", APEX, "http://pixl.hackclub.com/shop/?embed=1"],
    ["lookalike suffix host", APEX, "https://pixl.hackclub.com.evil.com/shop/?embed=1"],
    ["userinfo host confusion", APEX, "https://pixl.hackclub.com@evil.com/shop/?embed=1"],
    ["different port", "http://localhost:8000", "http://localhost:9000/shop/?embed=1"],
    ["retired domain", PLAY, "https://pixl.rsvp/shop/?embed=1"],
    ["javascript url", APEX, "javascript:alert(1)"],
    ["unparseable url", APEX, "http://"],
  ];

  test.each(cases)("%s", (_label, gameOrigin, url) => {
    const game = makeBrowser(gameOrigin);
    game.open(url, SESSION);
    expect(game.store.has("pixl_token")).toBe(false);
    expect(game.messages).toEqual([]);
    expect(game.opened.every((o) => !o.url.includes(SESSION))).toBe(true);
  });

  test("the handoff script has no postMessage and never builds a token url", () => {
    expect(openJs).not.toContain("postMessage");
    expect(openJs).not.toMatch(/token=/);
    expect(openJs).not.toContain("'*'");
  });
});

describe("the companion page after a game handoff", () => {
  test("the opened url carries no token, so pixl.js intake yields none, and the page adopts the stored session", () => {
    const store = new Map<string, string>();
    const game = makeBrowser(APEX, {}, store);
    game.open(`${APEX}/shop/?embed=1`, SESSION);
    const page = makePage(store, APEX);
    expect(page.takeReturnedToken(new URL(game.opened[0].url).searchParams)).toBe("");
    expect(page.resolveToken(game.opened[0].url)).toBe(SESSION);
  });

  test("pixl.js still falls back to the stored session when the url has no token", () => {
    expect(pixl).toContain('token = localStorage.getItem("pixl_token") || "";');
  });

  test("a bare ?token= is still rejected even while a game session is stored", () => {
    const store = new Map<string, string>();
    const game = makeBrowser(APEX, {}, store);
    game.open(`${APEX}/shop/?embed=1`, SESSION);
    const page = makePage(store, APEX);
    expect(page.takeReturnedToken(new URLSearchParams("token=" + ATTACKER_JWT))).toBe("");
    expect(page.takeReturnedToken(new URLSearchParams(`token=${ATTACKER_JWT}&ln=deadbeef`))).toBe("");
  });

  test("the real HCA login return, bound to this browser's nonce, still completes", () => {
    const store = new Map<string, string>();
    const page = makePage(store, APEX);
    const nonce = page.loginNonce();
    expect(page.takeReturnedToken(new URLSearchParams(`token=real.jwt&name=x&ln=${nonce}`))).toBe("real.jwt");
  });

  test("game logout removes the stored session so the companion page loses it", () => {
    const store = new Map<string, string>();
    const game = makeBrowser(APEX, {}, store);
    game.open(`${APEX}/shop/?embed=1`, SESSION);
    expect(store.get("pixl_token")).toBe(SESSION);
    game.signOut();
    expect(store.has("pixl_token")).toBe(false);
    expect(makePage(store, APEX).resolveToken(game.opened[0].url)).toBe("");
  });

  test("logout also clears the tour flags and knocks the opened window without sending a token", () => {
    const store = new Map([
      ["pixl_token", SESSION],
      ["pixl_tour_step", "3"],
      ["pixl_onboarded", "1"],
      ["pixl_theme", "dark"],
    ]);
    const game = makeBrowser(PLAY, {}, store);
    game.open(`${APEX}/shop/?embed=1`, SESSION);
    game.signOut();
    expect([...store.keys()]).toEqual(["pixl_theme"]);
    expect(game.messages).toEqual([{ data: { pixl: "logout" }, target: "*" }]);
    expect(JSON.stringify(game.messages)).not.toContain(SESSION);
  });
});

describe("web_pages.gd never puts the session in a url", () => {
  test("the gd string constants are raw-safe (no escapes GDScript would rewrite)", () => {
    expect(openJs).not.toContain("\\");
    expect(signOutJs).not.toContain("\\");
    expect(openJs.match(/%/g)).toHaveLength(2);
  });

  test("_build_url does not read or append the session", () => {
    const body = gdFunction("_build_url");
    expect(body).not.toContain("session_token");
    expect(body).not.toMatch(/token/i);
  });

  test("session_token is read once, by open(), and only to feed the same-origin handoff", () => {
    expect(gd.match(/session_token/g)).toHaveLength(1);
    const open = gdFunction("open");
    expect(open).toContain("JSON.stringify(NetworkManager.session_token)");
    expect(open).toContain("OS.shell_open(url)");
  });

  test("native builds open the configured site, not a retired host", () => {
    expect(gd).not.toContain("CANONICAL_BASE");
    expect(gdFunction("_web_base")).toContain('PixlConfig.url("site"');
    expect(gdFunction("_web_base")).toMatch(/return PixlConfig\.url\("site", "https:\/\/pixl\.hackclub\.com"\)/);
  });
});
