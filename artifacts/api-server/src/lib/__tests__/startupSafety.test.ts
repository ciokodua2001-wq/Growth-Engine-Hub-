import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { getListenHost, runStartupDatabaseTasks, verifyDatabaseBeforeListen } from "../startupSafety.js";

describe("API listener host configuration", () => {
  it("preserves the existing default when HOST is unset or blank", () => {
    expect(getListenHost({})).toBeUndefined();
    expect(getListenHost({ HOST: "  " })).toBeUndefined();
  });

  it("binds explicitly to the configured loopback host", async () => {
    const host = getListenHost({ HOST: "127.0.0.1" });
    const server = createServer();

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, host, () => resolve());
    });

    try {
      const address = server.address();
      expect(address).not.toBeNull();
      expect(typeof address).not.toBe("string");
      if (!address || typeof address === "string") throw new Error("Expected TCP address");
      expect(address.address).toBe("127.0.0.1");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

describe("Nigeria database identity startup gate", () => {
  it("verifies connected identity before allowing listen", async () => {
    const events: string[] = [];
    await verifyDatabaseBeforeListen(
      async () => { events.push("verified"); },
      () => { events.push("listening"); },
    );
    expect(events).toEqual(["verified", "listening"]);
  });

  it("never listens when identity verification fails", async () => {
    const listen = vi.fn();
    await expect(verifyDatabaseBeforeListen(
      async () => { throw new Error("wrong database identity"); },
      listen,
    )).rejects.toThrow("wrong database identity");
    expect(listen).not.toHaveBeenCalled();
  });
});

describe("startup database and billing safety", () => {
  it("starts no schema changes or Stripe initialization for Nigeria", () => {
    const schemaChange = vi.fn();
    const stripeInitialization = vi.fn();

    const result = runStartupDatabaseTasks(
      { APP_REGION: "nigeria", DATABASE_URL: "synthetic://must-not-be-used" },
      { schemaChanges: [schemaChange], stripeInitialization },
    );

    expect(result).toEqual({ schemaChangesStarted: false, stripeInitializationStarted: false });
    expect(schemaChange).not.toHaveBeenCalled();
    expect(stripeInitialization).not.toHaveBeenCalled();
  });

  it("preserves existing startup tasks outside Nigeria", () => {
    const schemaChange = vi.fn();
    const stripeInitialization = vi.fn();

    const result = runStartupDatabaseTasks(
      { APP_REGION: "global" },
      { schemaChanges: [schemaChange], stripeInitialization },
    );

    expect(result).toEqual({ schemaChangesStarted: true, stripeInitializationStarted: true });
    expect(schemaChange).toHaveBeenCalledOnce();
    expect(stripeInitialization).toHaveBeenCalledOnce();
  });
});
