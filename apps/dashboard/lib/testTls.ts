import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

export const TEST_HOSTS = [
  "gitea.example.test",
  "glab.example.test",
  "blog.example.test",
  "html.example.test",
  "codeberg.org",
];

function createFixture(): { key: string; cert: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "commits-cert-"));
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");
  try {
    execFileSync(
      "openssl",
      [
        "req", "-x509", "-newkey", "rsa:2048", "-keyout", keyPath, "-out", certPath,
        "-days", "1", "-nodes", "-subj", "/CN=gitea.example.test",
        "-addext", `subjectAltName=${TEST_HOSTS.map((h) => `DNS:${h}`).join(",")}`,
      ],
      { stdio: "pipe" },
    );
    return { key: readFileSync(keyPath, "utf8"), cert: readFileSync(certPath, "utf8") };
  } catch (err) {
    throw new Error(`openssl is required to build the throwaway TLS cert for the SSRF/credential tests: ${(err as Error).message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const tlsFixture = createFixture();

export type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
export type TestServer = { port: number; close: () => Promise<void> };

function listen(server: http.Server | https.Server): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ port, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

export function startHttpsServer(handler: Handler): Promise<TestServer> {
  return listen(https.createServer({ key: tlsFixture.key, cert: tlsFixture.cert }, handler));
}

export function startHttpServer(handler: Handler): Promise<TestServer> {
  return listen(http.createServer(handler));
}
