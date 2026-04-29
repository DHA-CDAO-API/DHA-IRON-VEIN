import app from "./app";
import { logger } from "./lib/logger";
import { startShipmentsTick } from "./lib/shipments-tick";
import { backfillZeroTotalOrders } from "./lib/backfill-order-prices";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // Repair any pre-existing $0 purchase orders by re-pricing them from
  // the live items catalog (task #222). Runs once after the server is
  // listening so it doesn't delay readiness; failures are logged but
  // don't crash the process.
  backfillZeroTotalOrders().then(
    (result) => {
      if (result.scanned > 0) {
        logger.info(result, "Backfilled $0 purchase orders at startup");
      }
    },
    (err) => {
      logger.error({ err }, "Failed to backfill $0 purchase orders at startup");
    },
  );
  // Background loop that keeps 30-45 in-flight shipments populated so the
  // network map always shows realistic convoy/aircraft motion across the AOR.
  startShipmentsTick();
});
