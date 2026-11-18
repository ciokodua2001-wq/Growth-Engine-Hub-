import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { pipeReadableHandled } from "../streamProxy.js";

describe("pipeReadableHandled", () => {
  it("handles upstream timeout/error instead of emitting an unhandled stream error", async () => {
    const source = new PassThrough();
    const destination = new PassThrough();
    const onError = vi.fn((_error: Error) => destination.end());
    const finished = new Promise<void>((resolve) => destination.once("finish", resolve));

    pipeReadableHandled(source, destination, onError);
    source.destroy(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    await finished;

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0].name).toBe("TimeoutError");
  });

  it("stops reading upstream when the client disconnects", async () => {
    const source = new PassThrough();
    const destination = new PassThrough();
    pipeReadableHandled(source, destination, vi.fn());

    const closed = new Promise<void>((resolve) => destination.once("close", resolve));
    destination.destroy();
    await closed;

    expect(source.destroyed).toBe(true);
  });
});
