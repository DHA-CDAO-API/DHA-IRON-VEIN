import app from "./app";
import { logger } from "./lib/logger";
import { startShipmentsTick } from "./lib/shipments-tick";
import { backfillZeroTotalOrders } from "./lib/backfill-order-prices";
import { ensureCasualtyReferenceDataSeeded } from "./seed/casualty-reference";

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

// Self-heal the four casualty reference tables (patient_types,
// patient_item_requirements, event_types, event_patient_mix) when they
// come up empty BEFORE the HTTP listener accepts traffic. A partial DB
// restore that wipes only those tables would otherwise leave the Casualty
// Planner page non-functional, and any request landing during heal would
// observe empty data. The helper is a per-table no-op when rows are
// already present, and is wrapped to never reject so a self-heal failure
// can't prevent the server from starting.
async function bootstrap(): Promise<void> {
  await ensureCasualtyReferenceDataSeeded();
}

bootstrap().then(startListening, (err) => {
  // Defensive: ensureCasualtyReferenceDataSeeded already swallows its own
  // errors, so this branch should be unreachable. Log and start anyway so
  // an unexpected bootstrap failure doesn't leave the API offline.
  logger.error({ err }, "Bootstrap failed before HTTP listener; starting anyway");
  startListening();
});

function startListening(): void {
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
}
