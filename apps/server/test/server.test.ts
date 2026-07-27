import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OverviewView } from "@llm-usage-monitor/contracts";
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
  it("serves Host Groups in the catalog and names them in the overview", async () => {
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
    const [localHost] = running.ledger.sourceHosts();
    assert.ok(localHost, "the server registers its local Source Host on start");
    running.ledger.upsertRecords([
      {
        id: "record:1",
        sourceHostId: localHost.id,
        usageSourceId: "codex-local",
        harnessId: "codex",
        timestamp: "2026-07-20T09:00:00.000Z",
        taskName: "Task",
        provider: "openai",
        model: "gpt-test",
        modeFlags: { ultra: false, fast: false },
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
        lastTokenUsage: null,
        source: "codex-local",
      },
    ]);
    running.ledger.setHostGroup("group:one", "Laptops", [localHost.id], "2026-01-01T00:00:00.000Z");

    const catalog = (await fetch(`${running.discovery.dashboardUrl}api/catalog`).then((response) =>
      response.json(),
    )) as { hostGroups?: Array<{ id: string; name: string }> };
    assert.deepEqual(catalog.hostGroups, [{ id: "group:one", name: "Laptops" }]);

    const overview = (await fetch(
      `${running.discovery.dashboardUrl}api/overview?timeframe=all`,
    ).then((response) => response.json())) as OverviewView;
    assert.deepEqual(
      overview.byHostGroup.map((row) => row.key),
      ["Laptops"],
    );
  });
  it("serves credential observations in the catalog", async () => {
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

    const catalog = (await fetch(new URL("api/catalog", running.discovery.dashboardUrl)).then(
      (response) => response.json(),
    )) as { credentials?: unknown[] };
    const overview = (await fetch(new URL("api/overview", running.discovery.dashboardUrl)).then(
      (response) => response.json(),
    )) as OverviewView;

    // Present and empty, not absent: a fresh ledger has observed nothing, and
    // the view must still be able to render the unattributed state.
    assert.ok(Array.isArray(catalog.credentials));
    assert.deepEqual(overview.credentials, []);
    assert.ok(Array.isArray(overview.byCredential));
  });
});

describe("Harness filter transport", () => {
  it("echoes a harness filter back in the overview response", async () => {
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
    const response = await fetch(
      new URL("api/overview?timeframe=all&harnessId=codex", running.discovery.dashboardUrl),
    );
    const view = (await response.json()) as OverviewView;
    assert.equal(response.status, 200);
    assert.equal(view.filters.harnessId, "codex");
    assert.deepEqual(view.byHarness, []);
  });

  it("rejects an over-long harness filter", async () => {
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
    const response = await fetch(
      new URL(
        `api/overview?timeframe=all&harnessId=${"x".repeat(300)}`,
        running.discovery.dashboardUrl,
      ),
    );
    // parseFilters calls filtersSchema.parse, which throws a ZodError on a
    // string over the 200-char max. The route handler has no per-route try/catch
    // for api/overview — it relies on the server-wide wrapper
    // (`route(request, response).catch(() => sendJson(response, 500, ...))`) to
    // turn that throw into a response. Verified by running this test: the actual
    // status is 500, matching the plan.
    assert.equal(response.status, 500);
  });
});
