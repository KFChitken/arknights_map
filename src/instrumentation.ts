/** Runs once when the server starts: bring the database up to date and, in development, add the demo players. */
export async function register() {
  // Written this way so the edge build drops the Node-only import entirely
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
