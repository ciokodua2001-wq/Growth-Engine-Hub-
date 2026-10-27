export type StartupTask = () => void | Promise<void>;

export interface StartupDatabaseTasks {
  schemaChanges: StartupTask[];
  stripeInitialization: StartupTask;
}

export interface StartupDatabaseTaskResult {
  schemaChangesStarted: boolean;
  stripeInitializationStarted: boolean;
}

/** Return the explicit bind host, preserving Node's default when unset. */
export function getListenHost(env: NodeJS.ProcessEnv): string | undefined {
  const host = env.HOST?.trim();
  return host || undefined;
}

/**
 * Global retains its established startup behavior. Nigeria startup fails
 * closed: no implicit DDL/drop helpers and no Stripe migration, webhook
 * registration, or backfill. Those operations require separate approval and
 * an explicitly isolated staging database.
 */
export function runStartupDatabaseTasks(
  env: NodeJS.ProcessEnv,
  tasks: StartupDatabaseTasks,
): StartupDatabaseTaskResult {
  if (env.APP_REGION?.trim().toLowerCase() === "nigeria") {
    return { schemaChangesStarted: false, stripeInitializationStarted: false };
  }

  for (const task of tasks.schemaChanges) void task();
  void tasks.stripeInitialization();
  return { schemaChangesStarted: true, stripeInitializationStarted: true };
}
