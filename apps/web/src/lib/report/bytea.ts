// Postgres `bytea` as PostgREST reads and writes it in JSON: `\\x` and hex.

export const toByteaHex = (bytes: Uint8Array) => `\\x${Buffer.from(bytes).toString("hex")}`;

export function fromByteaHex(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !value.startsWith("\\x")) return null;
  return new Uint8Array(Buffer.from(value.slice(2), "hex"));
}
