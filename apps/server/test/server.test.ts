import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startUsageMonitorServer } from "../src/server.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});
describe("Usage Monitor Server", () => {
  it("publishes the staged runtime identity to clients", async () => {
    const root = await mkdtemp(join(tmpdir(), "usage-monitor-server-"));
    const web = join(root, "web");
    await mkdir(web);
    await writeFile(join(web, "index.html"), "<!doctype html><title>test</title>");
    const running = await startUsageMonitorServer({
      dataDirectory: join(root, "data"),
      webDirectory: web,
      runtimeId: "runtime-fixture",
    });
    cleanup.push(async () => {
      await running.close();
      await rm(root, { recursive: true, force: true });
    });
    const health = (await fetch(running.discovery.healthUrl).then((response) =>
      response.json(),
    )) as { runtimeId?: string };
    assert.equal(running.discovery.runtimeId, "runtime-fixture");
    assert.equal(health.runtimeId, "runtime-fixture");
  });
  it("binds privately and rejects cross-origin Dashboard Actions", async () => {
    const root = await mkdtemp(join(tmpdir(), "usage-monitor-server-"));
    const web = join(root, "web");
    await mkdir(web);
    await writeFile(join(web, "index.html"), "<!doctype html><title>test</title>");
    const running = await startUsageMonitorServer({
      dataDirectory: join(root, "data"),
      webDirectory: web,
    });
    cleanup.push(async () => {
      await running.close();
      await rm(root, { recursive: true, force: true });
    });
    assert.ok(running.discovery.origin.startsWith("http://127.0.0.1:"));
    const response = await fetch(new URL("api/actions", running.discovery.dashboardUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://example.com" },
      body: JSON.stringify({ version: 1, type: "import-codex" }),
    });
    assert.equal(response.status, 403);
  });
  it("accepts a same-origin graceful shutdown request", async () => {
    const root = await mkdtemp(join(tmpdir(), "usage-monitor-server-"));
    const web = join(root, "web");
    await mkdir(web);
    await writeFile(join(web, "index.html"), "<!doctype html><title>test</title>");
    const running = await startUsageMonitorServer({
      dataDirectory: join(root, "data"),
      webDirectory: web,
    });
    cleanup.push(async () => {
      await running.close();
      await rm(root, { recursive: true, force: true });
    });
    const response = await fetch(running.discovery.shutdownUrl, {
      method: "POST",
      headers: { Origin: running.discovery.origin },
    });
    assert.equal(response.status, 202);
    await running.close();
    await assert.rejects(fetch(running.discovery.healthUrl));
  });
});
