import { expect, test } from "bun:test";
import { requestPixlChannelEnrollment } from "./pixlSlack.js";

test("asks Pixorpheus to enroll the authenticated Slack user", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const result = await requestPixlChannelEnrollment(
    "U0123456789",
    { apiKey: "shared-secret", url: "https://pixo.example.com/" },
    async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ ok: true, membership: "joined" }), { status: 200 });
    },
  );

  expect(result).toEqual({ kind: "enrolled" });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    url: "https://pixo.example.com/api/external/pixl-channel/join",
    init: {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "shared-secret" },
      body: JSON.stringify({ slackId: "U0123456789" }),
    },
  });
});

test("does not attempt enrollment without both Pixorpheus settings", async () => {
  const result = await requestPixlChannelEnrollment(
    "U0123456789",
    { apiKey: "", url: "https://pixo.example.com" },
    async () => new Response(null, { status: 200 }),
  );

  expect(result).toEqual({ kind: "not_configured" });
});

test("reports an unavailable Pixorpheus service without throwing", async () => {
  const result = await requestPixlChannelEnrollment(
    "U0123456789",
    { apiKey: "shared-secret", url: "https://pixo.example.com" },
    async () => new Response(null, { status: 503 }),
  );

  expect(result).toEqual({ kind: "failed" });
});
