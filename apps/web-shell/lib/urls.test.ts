import { afterEach, describe, expect, test } from "bun:test";
import { currentUrl, gameUrl, loginUrl } from "./urls";

function setNodeEnv(value: string | undefined) {
  Object.defineProperty(process.env, "NODE_ENV", { value, configurable: true, writable: true });
}
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
afterEach(() => setNodeEnv(ORIGINAL_NODE_ENV));

describe("gameUrl", () => {
  test("root on the standalone play host", () => expect(gameUrl("play.pixl.hackclub.com")).toBe("/"));
  test("/play when proxied under the apex", () => expect(gameUrl("pixl.hackclub.com")).toBe("/play"));
});

describe("loginUrl", () => {
  test("points at this app's own login route, not straight at apps/server", () => {
    // F-8: /api/login is what drops the login-nonce cookie before the
    // browser ever leaves for apps/server - see proxy.ts and
    // app/api/login/route.ts.
    expect(loginUrl("https://pixl.hackclub.com/dashboard")).toBe(
      "/api/login?back=https%3A%2F%2Fpixl.hackclub.com%2Fdashboard",
    );
  });

  test("encodes a return url that carries its own query", () => {
    // ?embed=1 is what the Godot client appends (web_pages.gd), and
    // apps/server's safeWebRedirect keeps url.search, so it survives login.
    const url = loginUrl("https://pixl.hackclub.com/dashboard?embed=1");
    expect(url).toContain("back=https%3A%2F%2Fpixl.hackclub.com%2Fdashboard%3Fembed%3D1");
    expect(url).not.toContain("embed=1&");
  });

  test("an empty target leaves a base the client can append to", () => {
    expect(loginUrl("")).toBe("/api/login?back=");
  });
});

describe("currentUrl", () => {
  test("https in production, whatever the internal hop's scheme was", () => {
    setNodeEnv("production");
    expect(currentUrl("pixl.hackclub.com", "/dashboard?embed=1")).toBe(
      "https://pixl.hackclub.com/dashboard?embed=1",
    );
  });

  test("http in dev so a localhost login still resolves", () => {
    setNodeEnv("development");
    expect(currentUrl("localhost:4901", "/dashboard")).toBe("http://localhost:4901/dashboard");
  });
});
