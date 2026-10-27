export const NIGERIA_STAGING_DATABASE_NAME = "growthforge_nigeria_staging";

export interface DatabaseTargetEnvironment {
  APP_REGION?: string;
  DATABASE_URL?: string;
  NIGERIA_STAGING_DATABASE_URL?: string;
  NIGERIA_STAGING_DATABASE_HOST?: string;
  NIGERIA_STAGING_DATABASE_USER?: string;
}

/**
 * Fail closed before creating a DB pool in Nigeria. The dedicated URL must be
 * duplicated into DATABASE_URL, its hostname and role must match independently
 * pinned values, and its database name must be the Nigeria-only fixed name.
 */
export function assertDatabaseTarget(env: DatabaseTargetEnvironment): void {
  if (env.APP_REGION?.trim().toLowerCase() !== "nigeria") return;

  const databaseUrl = env.DATABASE_URL?.trim();
  const dedicatedUrl = env.NIGERIA_STAGING_DATABASE_URL?.trim();
  const expectedHost = env.NIGERIA_STAGING_DATABASE_HOST?.trim().toLowerCase();
  const expectedUser = env.NIGERIA_STAGING_DATABASE_USER?.trim();

  if (!databaseUrl || !dedicatedUrl || databaseUrl !== dedicatedUrl || !expectedHost || !expectedUser) {
    throw new Error(
      "Nigeria startup blocked: configure matching staging URL, pinned staging host, and staging DB user",
    );
  }

  let target: URL;
  try {
    target = new URL(databaseUrl);
  } catch {
    throw new Error("Nigeria startup blocked: staging database URL is invalid");
  }

  const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (target.protocol !== "postgres:" && target.protocol !== "postgresql:") {
    throw new Error("Nigeria startup blocked: staging database URL must use PostgreSQL");
  }
  if (target.hostname.toLowerCase() !== expectedHost) {
    throw new Error("Nigeria startup blocked: database hostname does not match pinned Nigeria staging host");
  }
  if (decodeURIComponent(target.username) !== expectedUser) {
    throw new Error("Nigeria startup blocked: database user does not match pinned Nigeria staging user");
  }
  if (databaseName !== NIGERIA_STAGING_DATABASE_NAME) {
    throw new Error("Nigeria startup blocked: database name is not the dedicated Nigeria staging database");
  }
}

export interface ConnectedDatabaseIdentity {
  database: string;
  role: string;
}

export function assertConnectedDatabaseIdentity(
  env: DatabaseTargetEnvironment,
  identity: ConnectedDatabaseIdentity,
): void {
  if (env.APP_REGION?.trim().toLowerCase() !== "nigeria") return;
  if (identity.database !== NIGERIA_STAGING_DATABASE_NAME) {
    throw new Error("Nigeria startup blocked: connected database identity is not Nigeria staging");
  }
  if (identity.role !== env.NIGERIA_STAGING_DATABASE_USER) {
    throw new Error("Nigeria startup blocked: connected database role is not the pinned Nigeria staging user");
  }
}
