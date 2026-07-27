// Shared API base URL pointing to the api-server artifact
export const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/../api`;

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    credentials: "include",
    ...options,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw Object.assign(new Error(err.error ?? "Request failed"), { status: resp.status, body: err });
  }
  return resp.json() as Promise<T>;
}
