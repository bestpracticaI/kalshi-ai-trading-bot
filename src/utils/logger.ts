import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";

export const logger = pino({
  name: "kalshi-ai-trading-bot",
  level,
});

/** Namespace-style child loggers (mirrors Python `get_trading_logger`). */
export function getTradingLogger(module: string) {
  return logger.child({ module: `trading_system.${module}` });
}
