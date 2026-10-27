import { describe, expect, it } from "vitest";
import {
  assertConnectedDatabaseIdentity,
  assertDatabaseTarget,
  NIGERIA_STAGING_DATABASE_NAME,
} from "./targetGuard";

const valid = {
  APP_REGION: "nigeria",
  DATABASE_URL: `postgresql://ng_user:synthetic@staging-db.example:5432/${NIGERIA_STAGING_DATABASE_NAME}`,
  NIGERIA_STAGING_DATABASE_URL: `postgresql://ng_user:synthetic@staging-db.example:5432/${NIGERIA_STAGING_DATABASE_NAME}`,
  NIGERIA_STAGING_DATABASE_HOST: "staging-db.example",
  NIGERIA_STAGING_DATABASE_USER: "ng_user",
};

describe("Nigeria database target guard", () => {
  it("accepts only the dedicated, host- and role-pinned Nigeria staging target", () => {
    expect(() => assertDatabaseTarget(valid)).not.toThrow();
  });

  it("preserves non-Nigeria startup target behavior", () => {
    expect(() => assertDatabaseTarget({ APP_REGION: "global", DATABASE_URL: "postgres://global/db" })).not.toThrow();
  });

  it("fails closed when Nigeria target values are missing or disagree", () => {
    expect(() => assertDatabaseTarget({ APP_REGION: "nigeria" })).toThrow(/configure matching/);
    expect(() => assertDatabaseTarget({ ...valid, DATABASE_URL: "postgres://global-host/global" })).toThrow(/matching/);
    expect(() => assertDatabaseTarget({ ...valid, NIGERIA_STAGING_DATABASE_HOST: "other.example" })).toThrow(/hostname/);
    expect(() => assertDatabaseTarget({ ...valid, NIGERIA_STAGING_DATABASE_USER: "other_user" })).toThrow(/user/);
    expect(() => assertDatabaseTarget({
      ...valid,
      DATABASE_URL: "postgresql://ng_user:synthetic@staging-db.example:5432/global_dev",
      NIGERIA_STAGING_DATABASE_URL: "postgresql://ng_user:synthetic@staging-db.example:5432/global_dev",
    })).toThrow(/database name/);
    expect(() => assertDatabaseTarget({
      ...valid,
      DATABASE_URL: "mysql://ng_user:synthetic@staging-db.example/growthforge_nigeria_staging",
      NIGERIA_STAGING_DATABASE_URL: "mysql://ng_user:synthetic@staging-db.example/growthforge_nigeria_staging",
    })).toThrow(/PostgreSQL/);
  });

  it("verifies the live connection identity before the API can listen", () => {
    expect(() => assertConnectedDatabaseIdentity(valid, {
      database: NIGERIA_STAGING_DATABASE_NAME,
      role: "ng_user",
    })).not.toThrow();
    expect(() => assertConnectedDatabaseIdentity(valid, { database: "global_dev", role: "ng_user" })).toThrow(/database identity/);
    expect(() => assertConnectedDatabaseIdentity(valid, {
      database: NIGERIA_STAGING_DATABASE_NAME,
      role: "global_user",
    })).toThrow(/database role/);
  });
});
