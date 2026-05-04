import { getTradingLogger } from "../utils/logger.js";

const log = getTradingLogger("trading_job");

/**
 * Main trading loop hook — implement orchestration here (market scan, decisions, execution).
 */
export async function runTradingJob(): Promise<null> {
  log.warn(
    "runTradingJob() is a stub — wire Kalshi + OpenRouter into your strategy modules.",
  );
  console.log(`
This CLI already exposes:
  • Kalshi authenticated REST (src/clients/kalshiClient.ts)
  • OpenRouter chat helper (src/clients/openrouterClient.ts)
  • Typed config (src/config/settings.ts)

Implement your loop here or import new modules from src/strategies/ (create as needed).
`);
  return null;
}
