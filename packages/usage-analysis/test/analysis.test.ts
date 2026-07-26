import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UsageRecord } from "@llm-usage-monitor/contracts";
import { analyzeHistory, analyzeUsage, timeframeRange } from "../src/index.ts";

const record = (
  timestamp: string,
  reasoningLevel: string | undefined = undefined,
  modeFlags = { ultra: false, fast: false },
  overrides: Partial<UsageRecord> = {},
): UsageRecord => ({
  id: timestamp,
  sourceHostId: "host:a",
  usageSourceId: "codex-local",
  harnessId: "codex",
  timestamp,
  taskName: "Architecture",
  provider: "openai",
  model: "gpt-test",
  reasoningLevel,
  modeFlags,
  inputTokens: 1_000_000,
  cachedInputTokens: 500_000,
  outputTokens: 100_000,
  reasoningOutputTokens: 50_000,
  totalTokens: 1_100_000,
  lastTokenUsage: null,
  modelContextWindowTokens: 400_000,
  source: "codex-local",
  ...overrides,
});

describe("Cache-aware costing", () => {
  const price = {
    provider: "anthropic",
    model: "claude-test",
    input: 15,
    cachedInput: 1.5,
    cacheWrite: 18.75,
    output: 75,
    source: "test",
    effectiveDate: "2026-07-26",
  };
  const claude = (overrides: Partial<UsageRecord> = {}) =>
    record(
      "2026-07-25T12:00:00.000Z",
      undefined,
      { ultra: false, fast: false },
      {
        provider: "anthropic",
        model: "claude-test",
        inputTokens: 1_000_000,
        cachedInputTokens: 600_000,
        cacheCreationInputTokens: 300_000,
        outputTokens: 0,
        reasoningOutputTokens: undefined,
        totalTokens: 1_000_000,
        ...overrides,
      },
    );

  it("bills reads, writes, and fresh input at their own rates", () => {
    // 100k fresh @15 + 600k read @1.50 + 300k write @18.75 = 1.5 + 0.9 + 5.625
    const [priced] = analyzeHistory([claude()], [price], []);
    assert.equal(priced?.estimatedCost, 8.025);
  });

  it("charges cache writes at the base input rate when the card omits one", () => {
    const { cacheWrite: _cacheWrite, ...noWriteRate } = price;
    // Without the surcharge the 300k write joins the 100k fresh at $15/M.
    const [priced] = analyzeHistory([claude()], [noWriteRate], []);
    assert.equal(priced?.estimatedCost, 6 + 0.9);
  });

  it("prices a Codex record exactly as it did before the split existed", () => {
    const openai = {
      provider: "openai",
      model: "gpt-test",
      input: 10,
      cachedInput: 1,
      output: 20,
      source: "test",
      effectiveDate: "2026-07-26",
    };
    // 500k fresh @10 + 500k cached @1 + 100k output @20 = 5 + 0.5 + 2
    const [priced] = analyzeHistory([record("2026-07-25T12:00:00.000Z")], [openai], []);
    assert.equal(priced?.estimatedCost, 7.5);
  });

  it("never lets overstated cache subsets bill more than the input total", () => {
    const [priced] = analyzeHistory(
      [claude({ cachedInputTokens: 900_000, cacheCreationInputTokens: 900_000 })],
      [price],
      [],
    );
    // Reads clamp to 900k, writes to the remaining 100k, fresh to nothing.
    assert.equal(priced?.estimatedCost, (900_000 * 1.5 + 100_000 * 18.75) / 1_000_000);
  });

  it("keeps cache writes out of the cache-efficiency ratio", () => {
    const view = analyzeUsage({
      records: [claude()],
      prices: [price],
      sourceHosts: [],
      memberships: [],
      quotaSnapshots: [],
      filters: { timeframe: "all" },
    });
    assert.equal(view.totals.cacheCreationInputTokens, 300_000);
    assert.equal(view.totals.cacheEfficiency, 0.6);
  });
});

describe("Usage Analysis", () => {
  it("treats Last 24 hours as a rolling window", () => {
    const now = new Date("2026-07-23T12:00:00Z");
    assert.equal(
      timeframeRange({ timeframe: "last24" }, now)[0],
      Date.parse("2026-07-22T12:00:00Z"),
    );
  });
  it("produces the same canonical cost and graph totals", () => {
    const view = analyzeUsage({
      records: [record("2026-07-23T10:00:00Z")],
      prices: [
        {
          provider: "openai",
          model: "gpt-test",
          input: 2,
          cachedInput: 0.5,
          output: 10,
          source: "test",
          effectiveDate: "2026-01-01",
        },
      ],
      sourceHosts: [
        {
          id: "host:a",
          hostname: "workstation",
          platform: "win32",
          architecture: "x64",
          firstSeenAt: "2026-01-01T00:00:00Z",
          lastSeenAt: "2026-07-23T10:00:00Z",
        },
      ],
      memberships: [],
      filters: { timeframe: "last24" },
      now: new Date("2026-07-23T12:00:00Z"),
    });
    assert.equal(view.totals.estimatedCost, 2.25);
    assert.equal(view.timeline[0]?.estimatedCost, view.totals.estimatedCost);
    assert.equal(view.bySourceHost[0]?.key, "workstation");
  });
  it("rolls reasoning levels and recorded modes into one base model", () => {
    const records = [
      record("2026-07-23T10:00:00Z", "high"),
      record("2026-07-23T11:00:00Z", "ultra", { ultra: true, fast: true }),
    ];
    const view = analyzeUsage({
      records,
      prices: [
        {
          provider: "openai",
          model: "gpt-test",
          input: 2,
          cachedInput: 0.5,
          output: 10,
          source: "test",
          effectiveDate: "2026-01-01",
        },
      ],
      sourceHosts: [
        {
          id: "host:a",
          hostname: "workstation",
          platform: "win32",
          architecture: "x64",
          firstSeenAt: "2026-01-01T00:00:00Z",
          lastSeenAt: "2026-07-23T11:00:00Z",
        },
      ],
      memberships: [],
      filters: { timeframe: "last24" },
      now: new Date("2026-07-23T12:00:00Z"),
    });
    assert.equal(view.byModel.length, 1);
    assert.deepEqual(
      view.byModel[0]?.children?.map((row) => row.reasoningLevel),
      ["ultra", "high"],
    );
    assert.deepEqual(view.byModel[0]?.modeFlags, { ultra: true, fast: true });
  });
  it("does not expose a hardware address as a Source Host label", () => {
    const records = [{ ...record("2026-07-23T10:00:00Z"), sourceHostId: "AA:BB:CC:DD:EE:FF" }];
    const hosts = [
      {
        id: "AA:BB:CC:DD:EE:FF",
        hostname: "AA:BB:CC:DD:EE:FF",
        platform: "win32",
        architecture: "x64",
        firstSeenAt: "2026-01-01T00:00:00Z",
        lastSeenAt: "2026-07-23T10:00:00Z",
      },
    ];
    const prices = [
      {
        provider: "openai",
        model: "gpt-test",
        input: 2,
        cachedInput: 0.5,
        output: 10,
        source: "test",
        effectiveDate: "2026-01-01",
      },
    ];
    const view = analyzeUsage({
      records,
      prices,
      sourceHosts: hosts,
      memberships: [],
      filters: { timeframe: "last24" },
      now: new Date("2026-07-23T12:00:00Z"),
    });
    const history = analyzeHistory(records, prices, hosts);
    assert.equal(view.bySourceHost[0]?.key, "Source Host 1");
    assert.equal(history[0]?.sourceHostLabel, "Source Host 1");
    assert.equal("sourceHostId" in history[0]!, false);
  });
});

describe("Harness ranking", () => {
  const prices = [
    {
      provider: "openai",
      model: "gpt-test",
      input: 2,
      cachedInput: 0.5,
      output: 10,
      source: "test",
      effectiveDate: "2026-01-01",
    },
    {
      provider: "anthropic",
      model: "claude-test",
      input: 3,
      cachedInput: 0.3,
      output: 15,
      source: "test",
      effectiveDate: "2026-01-01",
    },
  ];
  const hosts = [
    {
      id: "host:a",
      hostname: "workstation",
      platform: "win32",
      architecture: "x64",
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-07-23T10:00:00.000Z",
    },
  ];

  it("groups records by harness and sorts by estimated cost", () => {
    const view = analyzeUsage({
      records: [
        record("2026-07-23T10:00:00.000Z"),
        record(
          "2026-07-23T11:00:00.000Z",
          "high",
          { ultra: false, fast: false },
          {
            id: "claude-1",
            usageSourceId: "claude-code-local",
            harnessId: "claude-code",
            provider: "anthropic",
            model: "claude-test",
          },
        ),
      ],
      prices,
      sourceHosts: hosts,
      memberships: [],
      filters: { timeframe: "all" },
    });
    assert.deepEqual(
      view.byHarness.map((row) => row.key),
      ["claude-code", "codex"],
    );
    assert.equal(view.byHarness.length, 2);
  });

  it("keeps harness and provider independently filterable", () => {
    // Crossover fixture: harness "codex" is used with BOTH providers (openai and
    // anthropic), and provider "openai" is reached through BOTH harnesses (codex
    // and codex-fork). Two records sharing only harnessId or only provider makes
    // it impossible for a filter that accidentally keys off the wrong field (e.g.
    // usageSourceId standing in for harnessId, or provider standing in for
    // harnessId) to pass by coincidence.
    const records = [
      record("2026-07-23T10:00:00.000Z"), // harness codex, provider openai
      record(
        "2026-07-23T11:00:00.000Z",
        "high",
        { ultra: false, fast: false },
        {
          id: "claude-1",
          usageSourceId: "claude-code-local",
          harnessId: "claude-code",
          provider: "anthropic",
          model: "claude-test",
        },
      ),
      record(
        "2026-07-23T12:00:00.000Z",
        "high",
        { ultra: false, fast: false },
        {
          id: "codex-fork-1",
          usageSourceId: "codex-fork-local",
          harnessId: "codex-fork",
          provider: "openai",
          model: "gpt-test",
        },
      ), // different harness, same provider as the first record
      record(
        "2026-07-23T13:00:00.000Z",
        "high",
        { ultra: false, fast: false },
        {
          id: "codex-via-anthropic",
          usageSourceId: "codex-local",
          harnessId: "codex",
          provider: "anthropic",
          model: "claude-test",
        },
      ), // same harness as the first record, different provider
    ];

    const byHarness = analyzeUsage({
      records,
      prices,
      sourceHosts: hosts,
      memberships: [],
      filters: { timeframe: "all", harnessId: "codex" },
    });
    // Filtering by harnessId "codex" must pick up BOTH providers that harness
    // used, and must exclude "codex-fork" despite it sharing provider "openai".
    assert.equal(byHarness.totals.records, 2);
    assert.deepEqual(byHarness.byModel.map((row) => row.model).sort(), ["claude-test", "gpt-test"]);

    const byProvider = analyzeUsage({
      records,
      prices,
      sourceHosts: hosts,
      memberships: [],
      filters: { timeframe: "all", provider: "openai" },
    });
    // Filtering by provider "openai" must pick up BOTH harnesses that used it,
    // and must exclude the codex/anthropic record despite sharing harness "codex".
    assert.equal(byProvider.totals.records, 2);
    assert.deepEqual(byProvider.byHarness.map((row) => row.key).sort(), ["codex", "codex-fork"]);

    const byUsageSource = analyzeUsage({
      records,
      prices,
      sourceHosts: hosts,
      memberships: [],
      filters: { timeframe: "all", usageSourceId: "codex-fork-local" },
    });
    assert.equal(byUsageSource.totals.records, 1);
    assert.equal(byUsageSource.byHarness[0]?.key, "codex-fork");
  });
});

describe("Unavailable metrics are not zero", () => {
  const prices = [
    {
      provider: "openai",
      model: "gpt-test",
      input: 2,
      cachedInput: 0.5,
      output: 10,
      source: "test",
      effectiveDate: "2026-01-01",
    },
  ];
  const hosts = [
    {
      id: "host:a",
      hostname: "workstation",
      platform: "win32",
      architecture: "x64",
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-07-23T10:00:00.000Z",
    },
  ];

  it("excludes records that do not report caching from cache efficiency", () => {
    const view = analyzeUsage({
      records: [
        record("2026-07-23T10:00:00.000Z"),
        record(
          "2026-07-23T11:00:00.000Z",
          "high",
          { ultra: false, fast: false },
          {
            id: "no-cache",
            cachedInputTokens: undefined,
          },
        ),
      ],
      prices,
      sourceHosts: hosts,
      memberships: [],
      filters: { timeframe: "all" },
    });
    assert.equal(view.totals.cacheEfficiency, 0.5);
    assert.equal(view.totals.cacheReportingRecords, 1);
    assert.equal(view.totals.records, 2);
  });

  it("reports zero cached tokens as evidence, not as unreported", () => {
    const view = analyzeUsage({
      records: [
        record(
          "2026-07-23T10:00:00.000Z",
          "high",
          { ultra: false, fast: false },
          {
            cachedInputTokens: 0,
          },
        ),
      ],
      prices,
      sourceHosts: hosts,
      memberships: [],
      filters: { timeframe: "all" },
    });
    assert.equal(view.totals.cacheEfficiency, 0);
    assert.equal(view.totals.cacheReportingRecords, 1);
  });

  it("groups records with no reasoning level under an explicit unreported key", () => {
    const view = analyzeUsage({
      records: [
        record("2026-07-23T10:00:00.000Z", undefined),
        record("2026-07-23T11:00:00.000Z", "high", { ultra: false, fast: false }, { id: "b" }),
      ],
      prices,
      sourceHosts: hosts,
      memberships: [],
      filters: { timeframe: "all" },
    });
    const levels = view.byModel[0]?.children?.map((child) => child.key) ?? [];
    assert.ok(levels.includes("not reported"));
    assert.ok(!levels.includes("none"));
    assert.ok(!levels.includes("unknown"));
  });
});

describe("Task session children", () => {
  const prices = [
    {
      provider: "openai",
      model: "gpt-test",
      input: 2,
      cachedInput: 0.5,
      output: 10,
      source: "test",
      effectiveDate: "2026-01-01",
    },
  ];
  const hosts = [
    {
      id: "host:a",
      hostname: "workstation",
      platform: "win32",
      architecture: "x64",
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-07-23T10:00:00.000Z",
    },
  ];

  it("nests sessions under their task, ranked by cost", () => {
    // The two sessions are deliberately assigned so that cost disagrees with
    // every other signal that could produce the same order by coincidence:
    // "session-1" sorts first alphabetically and is the first record inserted,
    // yet it holds the single cheapest record (low cost, low totalTokens). If
    // rankTasks ever stopped sorting children by cost — falling back to
    // group()'s alphabetical pre-sort, insertion order, or totalTokens instead
    // — "session-1" would incorrectly land first. Only a genuine cost-descending
    // sort puts "session-2" (two full-price records, higher cost AND higher
    // totalTokens) ahead of it.
    const view = analyzeUsage({
      records: [
        record(
          "2026-07-23T10:00:00.000Z",
          "high",
          { ultra: false, fast: false },
          {
            id: "a",
            sessionId: "session-2",
          },
        ),
        record(
          "2026-07-23T11:00:00.000Z",
          "high",
          { ultra: false, fast: false },
          {
            id: "b",
            sessionId: "session-2",
          },
        ),
        record(
          "2026-07-23T12:00:00.000Z",
          "high",
          { ultra: false, fast: false },
          {
            id: "c",
            sessionId: "session-1",
            outputTokens: 10,
            totalTokens: 1_010_000,
          },
        ),
      ],
      prices,
      sourceHosts: hosts,
      memberships: [],
      filters: { timeframe: "all" },
    });
    const task = view.byTask[0];
    assert.equal(task?.children?.length, 2);
    assert.equal(task?.children?.[0]?.key, "session-2");
    assert.equal(task?.children?.[0]?.records, 2);
  });

  it("falls back to the record id when a session id is absent", () => {
    const view = analyzeUsage({
      records: [
        record(
          "2026-07-23T10:00:00.000Z",
          "high",
          { ultra: false, fast: false },
          {
            id: "solo",
          },
        ),
      ],
      prices,
      sourceHosts: hosts,
      memberships: [],
      filters: { timeframe: "all" },
    });
    assert.equal(view.byTask[0]?.children?.[0]?.key, "solo");
  });
});

describe("Quota snapshots in the overview", () => {
  it("passes supplied snapshots through unchanged", () => {
    const snapshots = [
      {
        usageSourceId: "codex-local",
        sourceHostId: "host:a",
        plan: "plus",
        observedAt: "2026-07-23T10:00:00.000Z",
        windows: [{ id: "primary", label: "5-hour window", usedPercent: 41.5 }],
      },
    ];
    const view = analyzeUsage({
      records: [],
      prices: [],
      sourceHosts: [],
      memberships: [],
      quotaSnapshots: snapshots,
      filters: { timeframe: "all" },
    });
    assert.deepEqual(view.quotaSnapshots, snapshots);
  });

  it("defaults to no snapshots when none are supplied", () => {
    const view = analyzeUsage({
      records: [],
      prices: [],
      sourceHosts: [],
      memberships: [],
      filters: { timeframe: "all" },
    });
    assert.deepEqual(view.quotaSnapshots, []);
  });

  // Quota is not usage: it is the account's standing with the provider, which
  // does not change because the reader narrowed the date range or typed in the
  // search box. Filtering it would make the meter read differently depending on
  // an unrelated control, and read as 0% for any filter that matches nothing.
  it("reports quota unchanged regardless of the active filters", () => {
    const snapshots = [
      {
        usageSourceId: "codex-local",
        sourceHostId: "host:a",
        plan: "plus",
        observedAt: "2026-07-23T10:00:00.000Z",
        windows: [{ id: "primary", label: "5-hour window", usedPercent: 41.5 }],
      },
    ];
    const view = analyzeUsage({
      records: [],
      prices: [],
      sourceHosts: [],
      memberships: [],
      quotaSnapshots: snapshots,
      filters: { timeframe: "today", query: "matches-nothing", sourceHostId: "host:zzz" },
    });
    assert.equal(view.totals.records, 0);
    assert.deepEqual(view.quotaSnapshots, snapshots);
  });
});

describe("Host Group labelling", () => {
  const membership = (hostGroupId: string) => ({
    hostGroupId,
    sourceHostId: "host:a",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
  });
  const view = (
    hostGroups: Array<{ id: string; name: string }>,
    memberships: Array<ReturnType<typeof membership>>,
  ) =>
    analyzeUsage({
      records: [record("2026-07-20T09:00:00.000Z")],
      prices: [],
      sourceHosts: [],
      hostGroups,
      memberships,
      filters: { timeframe: "all" },
    });

  it("keys rows by the group's name", () => {
    assert.deepEqual(
      view([{ id: "group:one", name: "Laptops" }], [membership("group:one")]).byHostGroup.map(
        (row) => row.key,
      ),
      ["Laptops"],
    );
  });

  // A membership can outlive knowledge of its group only if the two reads
  // disagree. Dropping the row would hide real spend, so the id is shown.
  it("falls back to the group id when no group row matches", () => {
    assert.deepEqual(
      view([], [membership("group:one")]).byHostGroup.map((row) => row.key),
      ["group:one"],
    );
  });

  it("keeps Ungrouped for a host with no effective membership", () => {
    assert.deepEqual(
      view([{ id: "group:one", name: "Laptops" }], []).byHostGroup.map((row) => row.key),
      ["Ungrouped"],
    );
  });

  it("still resolves when hostGroups is omitted entirely", () => {
    assert.deepEqual(
      analyzeUsage({
        records: [record("2026-07-20T09:00:00.000Z")],
        prices: [],
        sourceHosts: [],
        memberships: [membership("group:one")],
        filters: { timeframe: "all" },
      }).byHostGroup.map((row) => row.key),
      ["group:one"],
    );
  });
});
