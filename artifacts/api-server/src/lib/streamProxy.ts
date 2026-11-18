import type { Readable, Writable } from "node:stream";

/** Pipe a remote response body without allowing its async errors to become
 * unhandled process-level errors. Also stop consuming upstream data when the
 * downstream client disconnects before the response completes. */
export function pipeReadableHandled(
  source: Readable,
  destination: Writable,
  onError: (error: Error) => void,
): void {
  source.once("error", onError);
  destination.once("close", () => {
    if (!destination.writableFinished && !source.destroyed) source.destroy();
  });
  source.pipe(destination);
}
