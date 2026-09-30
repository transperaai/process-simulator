// Escaping for the report's HTML and SVG strings. Every value from the
// content goes through `esc` (text and attributes) or `safeColor`, so a
// name like `<script>` prints as text.

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ENTITIES[ch]!);
}

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i;

/** A hex colour, or the fallback: role colours and the branding accent are user data. */
export function safeColor(value: string | null | undefined, fallback: string): string {
  return value && HEX.test(value.trim()) ? value.trim() : fallback;
}

/** Round for SVG coordinates. */
export const r1 = (v: number) => Math.round(v * 10) / 10;
