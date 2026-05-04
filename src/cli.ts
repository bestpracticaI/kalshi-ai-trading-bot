#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { randomUUID } from "node:crypto";

import { Command } from "commander";
import initSqlJs from "sql.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync, existsSync } from "node:fs";

import { settings } from "./config/settings.js";
import {
  KalshiClient,
  kalshiTradingEnvReady,
} from "./clients/kalshiClient.js";
import { BeastModeBot } from "./beastModeBot.js";
import { resolveProjectFile } from "./utils/paths.js";
import { enforcePriceGate } from "./utils/priceGate.js";

async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function cmdStatus(): Promise<void> {
  if (!kalshiTradingEnvReady()) {
    console.log(
      "Kalshi credentials are not fully configured (API key and/or private key).\n" +
        "Fix `.env` when you are ready — see README. Exiting without error.",
    );
    return;
  }

  let client: KalshiClient;
  try {
    client = new KalshiClient();
  } catch (e) {
    console.log(
      `Kalshi client could not load signing keys: ${e instanceof Error ? e.message : String(e)}\n` +
        "Check `KALSHI_PRIVATE_KEY` / PEM file matches your API key.",
    );
    return;
  }

  try {
    const balanceResp = (await client.getBalance()) as Record<string, number>;
    const balanceCents = (balanceResp.balance as number) ?? 0;
    const balanceUsd = balanceCents / 100;
    const portfolioValueCents = (balanceResp.portfolio_value as number) ?? 0;
    const portfolioValueUsd = portfolioValueCents / 100;

    const positionsResp = (await client.getPositions()) as Record<
      string,
      unknown
    >;
    const eventPositions = (positionsResp.event_positions as Record<
      string,
      unknown
    >[]) ?? [];
    const activePositions = eventPositions.filter(
      (p) => Number(p.event_exposure_dollars ?? 0) > 0,
    );

    console.log("=".repeat(56));
    console.log("  PORTFOLIO STATUS");
    console.log("=".repeat(56));
    console.log(`  Available Cash:     $${balanceUsd.toFixed(2).padStart(12)}`);
    console.log(
      `  Position Value:     $${portfolioValueUsd.toFixed(2).padStart(12)}`,
    );
    console.log(
      `  Total Portfolio:    $${(balanceUsd + portfolioValueUsd).toFixed(2).padStart(12)}`,
    );
    console.log(
      `  Active Positions:   ${String(activePositions.length).padStart(12)}`,
    );

    let totalExposure = 0;
    let totalRealizedPnl = 0;
    let totalFees = 0;

    if (activePositions.length > 0) {
      console.log();
      console.log(
        `  ${"Event".padEnd(30)} ${"Exposure".padStart(10)} ${"Cost".padStart(10)} ${"P&L".padStart(10)} ${"Fees".padStart(8)}`,
      );
      console.log(
        `  ${"-".repeat(30)} ${"-".repeat(10)} ${"-".repeat(10)} ${"-".repeat(10)} ${"-".repeat(8)}`,
      );

      for (const pos of activePositions) {
        const ticker = String(pos.event_ticker ?? "???");
        const exposure = Number(pos.event_exposure_dollars ?? 0);
        const cost = Number(pos.total_cost_dollars ?? 0);
        const pnl = Number(pos.realized_pnl_dollars ?? 0);
        const fees = Number(pos.fees_paid_dollars ?? 0);
        totalExposure += exposure;
        totalRealizedPnl += pnl;
        totalFees += fees;
        console.log(
          `  ${ticker.slice(0, 30).padEnd(30)} $${exposure.toFixed(2).padStart(8)} $${cost.toFixed(2).padStart(8)} $${pnl.toFixed(2).padStart(8)} $${fees.toFixed(2).padStart(6)}`,
        );
      }

      console.log();
      console.log(`  Total Exposure:     $${totalExposure.toFixed(2)}`);
      console.log(`  Total Realized P&L: $${totalRealizedPnl.toFixed(2)}`);
      console.log(`  Total Fees Paid:    $${totalFees.toFixed(2)}`);
    }

    console.log("=".repeat(56));
  } catch (e) {
    console.log(
      `Could not fetch Kalshi status: ${e instanceof Error ? e.message : String(e)}\n` +
        "(Configure `.env` or fix connectivity — exit code remains 0.)",
    );
  }
}

async function cmdHealth(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const ok = (label: string, detail = "") => {
    passed++;
    console.log(`  [PASS] ${label}${detail ? ` -- ${detail}` : ""}`);
  };
  const fail = (label: string, detail = "") => {
    failed++;
    console.log(`  [FAIL] ${label}${detail ? ` -- ${detail}` : ""}`);
  };

  console.log("=".repeat(56));
  console.log("  HEALTH CHECK");
  console.log("=".repeat(56));
  console.log();

  const envPath = resolveProjectFile(".env");
  if (existsSync(envPath)) ok(".env file exists", envPath);
  else fail(".env file missing", "copy env.template to .env");

  const placeholders = new Set(["", "your_kalshi_api_key_here", "your_openrouter_api_key_here"]);
  const kalshi = process.env.KALSHI_API_KEY ?? "";
  const orKey = process.env.OPENROUTER_API_KEY ?? "";
  if (kalshi && !placeholders.has(kalshi)) ok("KALSHI_API_KEY is set");
  else fail("KALSHI_API_KEY is missing or placeholder");
  if (orKey && !placeholders.has(orKey)) ok("OPENROUTER_API_KEY is set");
  else fail("OPENROUTER_API_KEY is missing or placeholder");

  try {
    const client = new KalshiClient();
    const balanceResp = (await client.getBalance()) as Record<string, number>;
    const balanceUsd = ((balanceResp.balance as number) ?? 0) / 100;
    ok("Kalshi API connection", `balance=$${balanceUsd.toFixed(2)}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fail("Kalshi API connection", msg);
    if (msg.includes("401") || msg.toLowerCase().includes("authentication")) {
      console.log(`
         A 401 from Kalshi usually means API key ID / private key mismatch,
         wrong KALSHI_PRIVATE_KEY_PATH, or demo vs production environment mismatch.`);
    }
  }

  const dbPath = resolveProjectFile("trading_system.db");
  try {
    if (!existsSync(dbPath)) {
      fail("Database file", `not found at ${dbPath}`);
    } else {
      const wasmDir = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "node_modules",
        "sql.js",
        "dist",
      );
      const SQL = await initSqlJs({
        locateFile: (f: string) => path.join(wasmDir, f),
      });
      const filebuffer = readFileSync(dbPath);
      const db = new SQL.Database(filebuffer);
      db.run("SELECT 1;");
      db.close();
      ok("Database readable", dbPath);
    }
  } catch (e) {
    fail("Database initialization", e instanceof Error ? e.message : String(e));
  }

  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 18) ok("Node.js version", process.version);
  else fail("Node.js version", `requires >=18, found ${process.version}`);

  console.log();
  console.log(`  ${passed}/${passed + failed} checks passed`);
  if (failed) console.log(`  ${failed} issue(s) need attention`);
  else console.log("  All systems operational.");
  console.log("=".repeat(56));

  if (failed) {
    console.log(
      "\n  (Hints shown above — exit code is still 0 so tooling keeps running.)",
    );
  }
}

async function cmdHistory(limit: number): Promise<void> {
  const dbPath = resolveProjectFile("trading_system.db");
  if (!existsSync(dbPath)) {
    console.log("No trading database found.");
    return;
  }

  const wasmDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "node_modules",
    "sql.js",
    "dist",
  );
  const SQL = await initSqlJs({
    locateFile: (f: string) => path.join(wasmDir, f),
  });
  const db = new SQL.Database(readFileSync(dbPath));

  console.log("=".repeat(70));
  console.log("  TRADE HISTORY");
  console.log("=".repeat(70));

  const overview = db.exec(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
           SUM(pnl) as total_pnl,
           AVG(pnl) as avg_pnl
    FROM trade_logs`);

  if (overview[0]?.values[0]) {
    const row = overview[0].values[0];
    const total = Number(row[0]);
    const wins = Number(row[1] ?? 0);
    const pnl = Number(row[2] ?? 0);
    console.log(`  Total Trades:  ${total}`);
    console.log(`  Win Rate:      ${total ? ((wins / total) * 100).toFixed(1) : "0"}%`);
    console.log(`  Total P&L:     $${pnl.toFixed(2)}`);
    console.log(`  Avg per trade: $${total ? (pnl / total).toFixed(2) : "0.00"}`);
  }
  console.log();

  const cats = db.exec(`
    SELECT strategy as category, COUNT(*) as trades,
           SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
           SUM(pnl) as total_pnl
    FROM trade_logs GROUP BY strategy ORDER BY total_pnl DESC`);

  if (cats[0]?.values.length) {
    console.log(`  ${"Category".padEnd(22)} ${"Trades".padStart(7)} ${"WR".padStart(6)} ${"P&L".padStart(10)}`);
    console.log(`  ${"-".repeat(22)} ${"-".repeat(7)} ${"-".repeat(6)} ${"-".repeat(10)}`);
    for (const row of cats[0].values) {
      const cat = String(row[0] ?? "unknown");
      const t = Number(row[1]);
      const w = Number(row[2] ?? 0);
      const p = Number(row[3] ?? 0);
      const wr = t > 0 ? `${Math.round((w / t) * 100)}%` : "n/a";
      console.log(`  ${cat.slice(0, 22).padEnd(22)} ${String(t).padStart(7)} ${wr.padStart(6)} $${p.toFixed(2).padStart(9)}`);
    }
    console.log();
  }

  const trades = db.exec(`
    SELECT market_id, side, entry_price, exit_price, quantity, pnl,
           entry_timestamp, strategy FROM trade_logs
    ORDER BY entry_timestamp DESC LIMIT ${Number(limit)}`);

  if (trades[0]?.values.length) {
    console.log(`  Recent ${limit} trades:`);
    console.log(
      `  ${"Market".padEnd(28)} ${"Side".padStart(4)} ${"Entry".padStart(6)} ${"Exit".padStart(6)} ${"Qty".padStart(4)} ${"P&L".padStart(8)} Category`,
    );
    for (const t of trades[0].values) {
      const ts = String(t[6] ?? "").slice(0, 10);
      void ts;
      console.log(
        `  ${String(t[0]).slice(0, 28).padEnd(28)} ${String(t[1]).padStart(4)} ${Number(t[2]).toFixed(2).padStart(6)} ${Number(t[3]).toFixed(2).padStart(6)} ${String(t[4]).padStart(4)} $${Number(t[5]).toFixed(2).padStart(7)}  ${String(t[7] ?? "")}`,
      );
    }
  }

  try {
    const blocked = db.exec(`SELECT COUNT(*) FROM blocked_trades`);
    const n = blocked[0]?.values[0]?.[0];
    if (n != null && Number(n) > 0) {
      console.log(`\n  ⛔ ${n} trades blocked by portfolio enforcer (see 'health')`);
    }
  } catch {
    /* table may not exist */
  }

  db.close();
  console.log("=".repeat(70));
}

async function cmdCloseAll(live: boolean, yes: boolean): Promise<void> {
  console.log("=".repeat(56));
  console.log("  CLOSE ALL POSITIONS");
  console.log("=".repeat(56));
  if (!live) console.log("  DRY RUN — no orders will be sent. Pass --live to actually sell.");
  console.log();
  console.log("  WARNING: limit sells at best bid — may realize losses.");
  console.log();

  if (live && !yes) {
    const confirm = await promptLine("  Type 'CLOSE ALL' to proceed: ");
    if (confirm !== "CLOSE ALL") {
      console.log("  Aborted.");
      return;
    }
  }

  let client: KalshiClient;
  try {
    client = new KalshiClient();
  } catch (e) {
    console.log(
      `Kalshi client could not load signing keys: ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }

  try {
    const positionsResp = (await client.getPositions()) as Record<
      string,
      unknown
    >;
    const marketPositions = ((positionsResp.market_positions as Record<
      string,
      unknown
    >[]) ?? []).filter((p) => Number(p.position ?? 0) !== 0);

    if (marketPositions.length === 0) {
      console.log("  No open positions on Kalshi.");
      return;
    }

    console.log(`  Found ${marketPositions.length} open position(s).`);
    console.log();

    let placed = 0;
    let failed = 0;

    for (const pos of marketPositions) {
      const ticker = String(pos.ticker);
      const contracts = Number(pos.position);
      const side = contracts > 0 ? "yes" : "no";
      const quantity = Math.abs(contracts);

      let bestBidCents: number;
      try {
        const bookResp = (await client.getOrderbook(ticker, 1)) as Record<
          string,
          unknown
        >;
        const book = (bookResp.orderbook as Record<string, unknown[][]>) ?? {};
        const sideBids = book[side] ?? [];
        if (!sideBids.length) {
          console.log(`  ⚠️  ${ticker}: no ${side.toUpperCase()} bids — skipping`);
          failed++;
          continue;
        }
        bestBidCents = Math.max(...sideBids.map((level) => Number(level[0])));
      } catch (e) {
        console.log(`  ❌ ${ticker}: orderbook fetch failed — ${e}`);
        failed++;
        continue;
      }

      if (!live) {
        console.log(
          `  [DRY] would sell ${quantity} ${side.toUpperCase()} of ${ticker} at ${bestBidCents}¢`,
        );
        placed++;
        continue;
      }

      try {
        const resp = (await client.placeOrder({
          ticker,
          clientOrderId: randomUUID(),
          side,
          action: "sell",
          count: quantity,
          type: "limit",
          yesPrice: side === "yes" ? bestBidCents : undefined,
          noPrice: side === "no" ? bestBidCents : undefined,
        })) as Record<string, unknown>;
        const order = resp.order as Record<string, unknown> | undefined;
        if (order) {
          console.log(
            `  ✅ ${ticker}: sell ${quantity} ${side.toUpperCase()} @ ${bestBidCents}¢ — order_id=${order.order_id ?? "?"}`,
          );
          placed++;
        } else {
          console.log(`  ❌ ${ticker}: unexpected response ${JSON.stringify(resp)}`);
          failed++;
        }
      } catch (e) {
        console.log(`  ❌ ${ticker}: order failed — ${e}`);
        failed++;
      }
    }

    console.log();
    console.log(`  Placed: ${placed} | Failed: ${failed}`);
    console.log();
  } finally {
    void client;
  }
}

async function cmdRun(opts: {
  live?: boolean;
  paper?: boolean;
  beast?: boolean;
  safeCompounder?: boolean;
  loop?: boolean;
  interval: number;
  logLevel?: string;
}): Promise<void> {
  if (opts.live && opts.paper) {
    console.error("Error: --live and --paper are mutually exclusive.");
    process.exit(1);
  }

  const liveMode = Boolean(opts.live && !opts.paper);

  if (opts.safeCompounder) {
    console.log("Safe Compounder strategy is not implemented in this CLI yet.");
    process.exit(1);
  }

  if (liveMode) {
    console.log("⚠️  WARNING: LIVE TRADING MODE ENABLED");
    console.log("   Real-money execution depends on completed strategy ports.");
  }

  if (opts.beast) {
    console.log("⚠️  BEAST MODE: aggressive Python parity not fully implemented in JS.");
    settings.trading.minConfidenceToTrade = 0.35;
    settings.trading.maxPositionSizePct = 5;
    settings.trading.kellyFraction = 0.5;
  } else {
    settings.trading.minConfidenceToTrade = 0.45;
    settings.trading.maxPositionSizePct = 3;
    settings.trading.kellyFraction = 0.25;
  }

  process.env.LOG_LEVEL = (opts.logLevel ?? "info").toLowerCase();

  const bot = new BeastModeBot(liveMode);
  await bot.run();
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.log(`kalshi-bot — no command given.

Examples:
  npm run dev -- health              Check .env, keys, Kalshi, DB
  npm run dev -- status              Balance and positions
  npm run dev -- run --paper         Run bot stub (paper)
  npm run dev -- --help              Full command list

After build:
  npm start -- health
  node dist/cli.js status
`);
    process.exitCode = 1;
    return;
  }

  settings.validate();

  const program = new Command();
  program
    .name("kalshi-bot")
    .description("Kalshi AI trading bot — JavaScript / TypeScript CLI");

  program
    .command("run")
    .description("Start the trading bot (strategy stack stub until full port)")
    .option("--live", "Enable live trading flag (strategies still limited in JS)")
    .option("--paper", "Paper mode")
    .option("--beast", "Looser thresholds (mirrors Python beast hint only)")
    .option("--safe-compounder", "Not implemented in JS — exits with hint")
    .option("--loop", "Ignored in JS stub")
    .option("--interval <sec>", "Ignored in JS stub", "300")
    .option("--log-level <level>", "DEBUG|INFO|WARNING|ERROR", "INFO")
    .action(async (o) => {
      await cmdRun({
        live: o.live,
        paper: o.paper,
        beast: o.beast,
        safeCompounder: o.safeCompounder,
        loop: o.loop,
        interval: Number(o.interval),
        logLevel: o.logLevel,
      });
    });

  program
    .command("status")
    .description("Portfolio balance and positions")
    .action(async () => {
      await cmdStatus();
    });

  program
    .command("health")
    .description("Configuration and connectivity checks")
    .action(async () => {
      await cmdHealth();
    });

  program
    .command("history")
    .description("Trade history from SQLite (if present)")
    .option("--limit <n>", "Recent trades", "50")
    .action(async (o) => {
      await cmdHistory(Number(o.limit)).catch((e) => {
        console.error(String(e));
      });
    });

  program.command("scores").description("Category scores (not ported to JS yet)").action(() => {
    console.log("`scores` is not implemented yet — extend the CLI or add a scorer module.");
  });

  program.command("dashboard").description("Launch dashboard").action(() => {
    console.log("No web dashboard ships with this repo yet — add your own or use external tooling.");
  });

  program.command("backtest").description("Backtests placeholder").action(() => {
    console.log("Backtesting engine — coming soon (same as Python placeholder).");
  });

  program
    .command("close-all")
    .description("Close all Kalshi positions (limit @ best bid)")
    .option("--live", "Place real orders")
    .option("--yes", "Skip CLOSE ALL confirmation")
    .action(async (o) => {
      if (!kalshiTradingEnvReady()) {
        console.log(
          "Kalshi credentials are not fully configured — cannot query positions or place orders.\n" +
            "Set `KALSHI_API_KEY` and a private key in `.env` (see README).",
        );
        return;
      }
      await cmdCloseAll(Boolean(o.live), Boolean(o.yes)).catch((e) => {
        console.error(String(e));
      });
    });

  program.hook("preAction", async () => {
    await enforcePriceGate();
  });

  program.parseAsync().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

main();
