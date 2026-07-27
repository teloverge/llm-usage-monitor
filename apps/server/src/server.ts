import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, extname, join, resolve } from "node:path";
import {
  filtersSchema,
  type CredentialSighting,
  type DashboardActionOutcome,
  type UsageFilters,
} from "@llm-usage-monitor/contracts";
import { createDashboardActions } from "@llm-usage-monitor/dashboard-actions";
import { analyzeHistory, analyzeUsage } from "@llm-usage-monitor/usage-analysis";
import { UsageLedger } from "@llm-usage-monitor/usage-ledger";
import { ClaudeSessionProvider } from "./claude-importer.ts";
import { claudeCredentialSighting } from "./claude-credential.ts";
import { readClaudeConfig } from "./claude-quota.ts";
import { CodexSessionProvider } from "./codex-importer.ts";
import { codexCredentialSighting } from "./codex-credential.ts";
import { mergeDefaultPrices } from "./default-prices.ts";
import { resolveLocalSourceHost } from "./local-source-host.ts";
import { runProviderImport } from "./run-import.ts";

const MAX_BODY_BYTES = 10 * 1024 * 1024;
export interface DiscoveryRecord {
  pid: number;
  origin: string;
  dashboardUrl: string;
  healthUrl: string;
  shutdownUrl: string;
  startedAt: string;
  runtimeId: string | null;
}

export async function startUsageMonitorServer(options: {
  dataDirectory: string;
  webDirectory: string;
  port?: number;
  runtimeId?: string;
}) {
  await fs.mkdir(options.dataDirectory, { recursive: true });
  const ledger = new UsageLedger(join(options.dataDirectory, "usage-ledger.sqlite"));
  const local = await resolveLocalSourceHost(options.dataDirectory);
  ledger.upsertSourceHost(local.host, local.observations);
  const configuredPrices = ledger.prices();
  const mergedPrices = mergeDefaultPrices(configuredPrices);
  if (mergedPrices.length !== configuredPrices.length) ledger.replacePrices(mergedPrices);
  const importer = new CodexSessionProvider();
  const claudeImporter = new ClaudeSessionProvider();
  // Each provider keeps its own import state and its own records, so the two
  // imports are independent: one failing or finding nothing leaves the other's
  // history untouched. `runProviderImport` extends that independence to the two
  // halves of a single import — see its comment for why the quota write must
  // not be able to take the records down with it.
  const runImport = (
    provider: CodexSessionProvider | ClaudeSessionProvider,
    home: string | undefined,
    observeCredential: (home: string, observedAt: string) => Promise<CredentialSighting | null>,
  ) =>
    runProviderImport(
      provider,
      ledger,
      local.host.id,
      home,
      (providerId, error) => {
        console.warn(`auxiliary write refused for ${providerId}:`, error);
      },
      observeCredential,
    );
  const actions = createDashboardActions({
    localSourceHostId: local.host.id,
    importCodex: (codexHome) =>
      runImport(importer, codexHome, (home, observedAt) =>
        codexCredentialSighting(home, local.host.id, observedAt),
      ),
    importClaude: (claudeHome) =>
      runImport(claudeImporter, claudeHome, async (home, observedAt) =>
        claudeCredentialSighting(
          await readClaudeConfig(home),
          process.env,
          local.host.id,
          observedAt,
        ),
      ),
    migrateLegacy: (id, records) => ledger.applyMigration(id, records),
    replacePrices: (prices) => ledger.replacePrices(prices),
    clearRecords: () => ledger.clearRecords(),
    setHostGroup: (id, name, sourceHostIds, effectiveAt) =>
      ledger.setHostGroup(id, name, sourceHostIds, effectiveAt),
  });
  const routeKey = randomBytes(32).toString("base64url");
  const routeBase = `/${routeKey}/`;
  let origin = "http://127.0.0.1";
  const server = createServer((request, response) =>
    route(request, response).catch(() => sendJson(response, 500, { error: "request-failed" })),
  );

  async function route(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", origin);
    if (!url.pathname.startsWith(routeBase)) return sendJson(response, 404, { error: "not-found" });
    const resource = url.pathname.slice(routeBase.length);
    if (request.method === "GET" && resource === "health")
      return sendJson(response, 200, {
        ok: true,
        pid: process.pid,
        runtimeId: options.runtimeId ?? null,
      });
    if (request.method === "POST" && resource === "shutdown") {
      if (request.headers.origin !== origin)
        return sendJson(response, 403, { error: "origin-denied" });
      sendJson(response, 202, { ok: true });
      setImmediate(() => {
        void close();
      });
      return;
    }
    if (request.method === "GET" && resource === "api/overview") {
      const filters = parseFilters(url.searchParams);
      return sendJson(
        response,
        200,
        analyzeUsage({
          records: ledger.records(),
          prices: ledger.prices(),
          hostGroups: ledger.hostGroups(),
          memberships: ledger.memberships(),
          quotaSnapshots: ledger.quotaSnapshots(),
          credentials: ledger.credentialObservations(),
          filters,
        }),
      );
    }
    if (request.method === "GET" && resource === "api/history") {
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 200));
      return sendJson(response, 200, {
        records: analyzeHistory(ledger.records().slice(0, limit), ledger.prices()),
      });
    }
    if (request.method === "GET" && resource === "api/catalog")
      return sendJson(response, 200, {
        prices: ledger.prices(),
        sourceHosts: ledger.sourceHosts(),
        hostGroups: ledger.hostGroups(),
        memberships: ledger.memberships(),
        credentials: ledger.credentialObservations(),
      });
    if (request.method === "POST" && resource === "api/actions") {
      if (request.headers.origin !== origin)
        return sendJson(response, 403, { error: "origin-denied" });
      let outcome: DashboardActionOutcome;
      try {
        outcome = await actions.execute(JSON.parse(await readBody(request)));
      } catch {
        return sendJson(response, 400, { error: "invalid-action" });
      }
      return sendJson(response, 200, outcome);
    }
    if (request.method === "GET" && (resource === "" || resource === "index.html"))
      return sendFile(response, join(options.webDirectory, "index.html"));
    if (request.method === "GET" && /^assets\/[A-Za-z0-9._-]+$/.test(resource))
      return sendFile(response, join(options.webDirectory, "assets", basename(resource)));
    return sendJson(response, 404, { error: "not-found" });
  }

  await new Promise<void>((resolveStart, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolveStart();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Usage Monitor Server did not bind a TCP port.");
  origin = `http://127.0.0.1:${address.port}`;
  const discovery: DiscoveryRecord = {
    pid: process.pid,
    origin,
    dashboardUrl: `${origin}${routeBase}`,
    healthUrl: `${origin}${routeBase}health`,
    shutdownUrl: `${origin}${routeBase}shutdown`,
    startedAt: new Date().toISOString(),
    runtimeId: options.runtimeId ?? null,
  };
  await writeDiscovery(options.dataDirectory, discovery);
  let closePromise: Promise<void> | null = null;
  const close = () =>
    (closePromise ??= (async () => {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      ledger.close();
      await fs.rm(join(options.dataDirectory, "server.json"), { force: true });
    })());
  return { discovery, ledger, close };
}

export async function readDiscovery(dataDirectory: string): Promise<DiscoveryRecord | null> {
  try {
    const value = JSON.parse(
      await fs.readFile(join(dataDirectory, "server.json"), "utf8"),
    ) as DiscoveryRecord;
    const response = await fetch(value.healthUrl, { signal: AbortSignal.timeout(1_000) });
    return response.ok ? value : null;
  } catch {
    return null;
  }
}

async function writeDiscovery(dataDirectory: string, discovery: DiscoveryRecord): Promise<void> {
  const target = join(dataDirectory, "server.json");
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(discovery, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.rename(temporary, target);
}
function parseFilters(params: URLSearchParams): UsageFilters {
  const value = Object.fromEntries(
    [
      "timeframe",
      "from",
      "to",
      "provider",
      "model",
      "reasoningLevel",
      "query",
      "sourceHostId",
      "hostGroupId",
      "harnessId",
      "usageSourceId",
    ].flatMap((key) => {
      const item = params.get(key);
      return item === null || item === "" ? [] : [[key, item]];
    }),
  );
  return filtersSchema.parse(value);
}
async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    length += value.length;
    if (length > MAX_BODY_BYTES) throw new Error("body-too-large");
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function sendFile(response: ServerResponse, file: string) {
  const root = resolve(file);
  const body = await fs.readFile(root);
  const type =
    (
      {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
      } as Record<string, string>
    )[extname(file)] ?? "application/octet-stream";
  send(response, 200, body, type);
}
function sendJson(response: ServerResponse, status: number, value: unknown) {
  send(response, status, Buffer.from(JSON.stringify(value)), "application/json; charset=utf-8");
}
function send(response: ServerResponse, status: number, body: Buffer, contentType: string) {
  if (response.headersSent) return response.end();
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(body);
}
