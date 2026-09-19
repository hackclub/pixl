import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import playerMeta from "./player-meta";
import projectMeta from "./project-meta";
import shopItemMeta from "./shop-item-meta";

const web = join(import.meta.dir, "..");
const PAYLOAD = "$'$`$&$$x";
const ESCAPED = "$'$`$&amp;$$x";
const PLAYER_ID = "00000000-0000-0000-0000-000000000000";
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

type Handler = (req: unknown, res: unknown) => Promise<void>;

async function render(handler: Handler, url: string, templatePath: string, body: unknown) {
  const template = readFileSync(join(web, templatePath), "utf8");
  globalThis.fetch = (async (u: string) =>
    String(u).endsWith(".html")
      ? { ok: true, text: async () => template }
      : { ok: true, json: async () => body }) as unknown as typeof fetch;
  let out = "";
  const res = { statusCode: 0, setHeader() {}, end: (c?: string) => void (out = c ?? "") };
  await handler({ url, headers: { host: "pixl.test" } }, res);
  return { out, template };
}

function expectIntact(out: string, template: string) {
  expect(out.split("</html>").length).toBe(2);
  expect(out.length).toBeLessThan(template.length + 3000);
}

describe("meta handlers treat replacement patterns as literal text", () => {
  test("project name", async () => {
    const body = { ok: true, project: { name: PAYLOAD, description: "d", status: "approved" }, owner: { display_name: "o" } };
    const { out, template } = await render(projectMeta, "/project/42", "projects/index.html", body);
    expectIntact(out, template);
    expect(out).toContain(`<title>Pixl · ${ESCAPED}</title>`);
  });

  test("project description", async () => {
    const body = { ok: true, project: { name: "n", description: PAYLOAD, status: "approved" }, owner: { display_name: "o" } };
    const { out, template } = await render(projectMeta, "/project/42", "projects/index.html", body);
    expectIntact(out, template);
    expect(out).toContain(`<meta name="description" content="${ESCAPED}">`);
  });

  test("player display name", async () => {
    const body = { ok: true, player: { display_name: PAYLOAD }, projects: [] };
    const { out, template } = await render(playerMeta, `/players/${PLAYER_ID}`, "explore/players/index.html", body);
    expectIntact(out, template);
    expect(out).toContain(`<title>Pixl · ${ESCAPED}</title>`);
  });

  test("shop item name", async () => {
    const body = { ok: true, item: { name: PAYLOAD, description: "d", price: 5 } };
    const { out, template } = await render(shopItemMeta, "/shop/1", "shop/item/index.html", body);
    expectIntact(out, template);
    expect(out).toContain(`<title>Pixl · ${ESCAPED}</title>`);
  });

  test("shop item description", async () => {
    const body = { ok: true, item: { name: "n", description: PAYLOAD, price: 5 } };
    const { out, template } = await render(shopItemMeta, "/shop/1", "shop/item/index.html", body);
    expectIntact(out, template);
    expect(out).toContain(`<meta name="description" content="${ESCAPED}">`);
  });
});
