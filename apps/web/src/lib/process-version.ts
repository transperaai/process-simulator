/** The version a `?version=` names (a whole number from 1), or null for live. */
export function parseVersion(value: string | string[] | undefined): number | null {
  const v = Array.isArray(value) ? value[0] : value;
  const n = Number(v);
  return v && Number.isInteger(n) && n >= 1 ? n : null;
}
