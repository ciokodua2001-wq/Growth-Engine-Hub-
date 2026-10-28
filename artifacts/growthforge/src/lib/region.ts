export type Region = "global" | "nigeria";

const NIGERIA_HOSTS = new Set([
  "ng.usegrowthforge.com",
  "ng.dev.usegrowthforge.com",
]);

export function resolveClientRegion(hostname: string | undefined | null): Region {
  const host = (hostname ?? "").trim().toLowerCase().split(":")[0];
  return NIGERIA_HOSTS.has(host) ? "nigeria" : "global";
}

export function getClientRegion(): Region {
  if (typeof window === "undefined") return "global";
  return resolveClientRegion(window.location.hostname);
}

export function isNigeriaRegion(): boolean {
  return getClientRegion() === "nigeria";
}
