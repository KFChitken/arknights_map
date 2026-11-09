import type { Instrumentation } from "next";

/** Runs once when the server starts: bring the database up to date and, in development, add the demo players. */
export async function register() {
  // Written this way so the edge build drops the Node-only import entirely
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}

/**
 * An error a page or route did not handle itself: counted for the site's own checks
 * (src/lib/server/watch.ts) by path and error name only, never its message.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request) => {
  const { errorCode, note } = await import("./lib/server/signals");
  note("error", `${request.path.split("?")[0]} ${errorCode(err)}`);
};
