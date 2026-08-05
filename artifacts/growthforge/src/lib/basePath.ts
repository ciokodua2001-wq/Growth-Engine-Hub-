/** The app's base path (e.g. "" or "/app"), with any trailing slash stripped. */
export const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}
