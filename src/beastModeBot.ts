import { settings } from "./config/settings.js";
import { getTradingLogger } from "./utils/logger.js";
import { runTradingJob } from "./jobs/trade.js";

const log = getTradingLogger("beast_mode_bot");

export class BeastModeBot {
  constructor(
    public liveMode = false,
    public dashboardMode = false,
  ) {
    settings.trading.liveTradingEnabled = liveMode;
    settings.trading.paperTradingMode = !liveMode;
    log.info(
      {
        liveMode,
        paperTradingMode: settings.trading.paperTradingMode,
      },
      "BeastModeBot initialized",
    );
    if (liveMode) {
      log.warn("LIVE TRADING MODE — real orders may be placed when strategies are implemented.");
    }
  }

  async run(): Promise<void> {
    if (this.dashboardMode) {
      console.log(
        "Dashboard mode: no built-in web UI yet — implement one or use external monitoring.",
      );
      return;
    }
    await runTradingJob();
  }
}
