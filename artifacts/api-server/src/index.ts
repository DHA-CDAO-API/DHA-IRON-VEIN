import app from "./app";
import { logger } from "./lib/logger";
import { startShipmentsTick } from "./lib/shipments-tick";

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
  // Background loop that keeps 30-45 in-flight shipments populated so the
  // network map always shows realistic convoy/aircraft motion across the AOR.
  startShipmentsTick();
});
