// Pasting the client roster from a spreadsheet or CSV (docs/PRD.md §4.1
// "Paste from CSV supported"; issue #18). Pure: turns pasted text into new
// clients, matching services, roles and people by name, and says what it
// couldn't use. Nothing is written until the preview is confirmed.

import { MAX_IMPORT, MAX_NAME, MAX_NOTES, MAX_MRR, type NewClient, type RosterData } from "./roster";

/** One pasted row: the client it becomes, or why it is skipped, and anything worth a second look. */
export interface ImportRow {
  /** 1-based line in the paste (the header is line 1). */
  line: number;
  client: NewClient | null;
  /** Why the row can't be imported. */
  error?: string;
  /** Values that were ignored. */
  warnings: string[];
}

export interface ParsedImport {
  rows: ImportRow[];
  /** Problems with the paste as a whole (no name column, nothing to import). */
  errors: string[];
  /** Headers that matched nothing and were ignored. */
  ignoredColumns: string[];
}

/** Split CSV text into rows of cells: quoted cells may hold the delimiter, quotes ("") and line breaks. */
export function splitCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

/** Tab when pasted from a spreadsheet; otherwise whichever of comma or semicolon the header uses more. */
export function detectDelimiter(text: string): string {
  const header = text.split(/\r?\n/, 1)[0] ?? "";
  if (header.includes("\t")) return "\t";
  return (header.match(/;/g)?.length ?? 0) > (header.match(/,/g)?.length ?? 0) ? ";" : ",";
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Recognised headers (lower case) for each column. */
const HEADERS: Record<Exclude<keyof NewClient, "serviceIds" | "assignments"> | "services", string[]> = {
  name: ["name", "client", "client name", "company"],
  services: ["services", "service"],
  start_date: ["start date", "start", "started", "client since", "start_date"],
  mrr: ["mrr", "monthly fee", "monthly revenue", "retainer", "fee"],
  health: ["health", "health score"],
  notes: ["notes", "note", "comments"],
  active: ["active", "status"],
};

/** A money or plain number: "£3,500", "3500.00", "3 500". Null if it isn't one. */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[£$€\s,]/g, "").replace(/^(-?\d+(?:\.\d+)?)k$/i, (_, n: string) => String(Number(n) * 1000));
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** A date as YYYY-MM-DD, from that or DD/MM/YYYY (UK order). Null if it isn't a real date. */
export function parseDate(text: string): string | null {
  let iso: string | null = null;
  const t = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) iso = t;
  const uk = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (uk) iso = `${uk[3]}-${uk[2]!.padStart(2, "0")}-${uk[1]!.padStart(2, "0")}`;
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Yes/no-ish text to a boolean; null if unclear. */
function parseActive(text: string): boolean | null {
  const t = norm(text);
  if (["", "yes", "y", "true", "1", "active", "current"].includes(t)) return true;
  if (["no", "n", "false", "0", "inactive", "churned", "left", "former"].includes(t)) return false;
  return null;
}

/**
 * Something named, matched case-insensitively: exactly, or failing that by a
 * unique first word or prefix ("Sam" for Sam Patel). Null if none or several match.
 */
function matchName<T extends { name: string }>(items: readonly T[], text: string): T | null {
  const t = norm(text);
  const exact = items.filter((x) => norm(x.name) === t);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const partial = items.filter((x) => norm(x.name).startsWith(t) || norm(x.name).split(" ")[0] === t);
  return partial.length === 1 ? partial[0]! : null;
}

/**
 * Parse pasted roster text. The first row is the header: a name column is
 * required; services (separated by ; | + or /), start date, MRR, health,
 * notes and active are optional, and a column named after a role (or
 * "<role> owner", "assigned <role>") assigns that role's person by name.
 * Clients whose name is already on the roster, or repeated in the paste, are
 * skipped: the import only adds.
 */
export function parseRosterCsv(
  text: string,
  data: Pick<RosterData, "services" | "roles" | "people" | "personRoles" | "clients">,
): ParsedImport {
  const errors: string[] = [];
  const table = splitCsv(text.replace(/^﻿/, ""), detectDelimiter(text));
  if (!table.length) return { rows: [], errors: ["Paste a header row and at least one client."], ignoredColumns: [] };
  const [header, ...body] = table as [string[], ...string[][]];

  const column: Partial<Record<keyof typeof HEADERS, number>> = {};
  const roleColumn = new Map<number, string>();
  const ignoredColumns: string[] = [];
  header.forEach((h, i) => {
    const key = (Object.keys(HEADERS) as (keyof typeof HEADERS)[]).find((k) => HEADERS[k].includes(norm(h)));
    if (key && column[key] === undefined) {
      column[key] = i;
      return;
    }
    const roleText = norm(h).replace(/^assigned /, "").replace(/ (owner|lead|assigned)$/, "");
    const role = data.roles.find((r) => norm(r.name) === roleText);
    if (role && ![...roleColumn.values()].includes(role.id)) roleColumn.set(i, role.id);
    else if (h) ignoredColumns.push(h);
  });
  if (column.name === undefined) {
    return { rows: [], errors: ['The header needs a "Name" (or "Client") column.'], ignoredColumns };
  }
  if (!body.length) errors.push("There are no clients under the header.");
  if (body.length > MAX_IMPORT) errors.push(`Paste at most ${MAX_IMPORT} clients at a time.`);

  const taken = new Set(data.clients.map((c) => norm(c.name)));
  const activePeople = data.people.filter((p) => p.active);
  const cell = (row: string[], key: keyof typeof HEADERS) => (column[key] !== undefined ? (row[column[key]!] ?? "") : "");

  const rows = body.slice(0, MAX_IMPORT).map((row, i): ImportRow => {
    const line = i + 2;
    const warnings: string[] = [];
    const name = cell(row, "name");
    if (!name) return { line, client: null, error: "No name.", warnings };
    if (name.length > MAX_NAME) return { line, client: null, error: "The name is too long.", warnings };
    if (taken.has(norm(name))) return { line, client: null, error: `${name} is already on the roster (or earlier in the paste).`, warnings };
    taken.add(norm(name));

    const serviceIds: string[] = [];
    for (const part of cell(row, "services").split(/[;|+/]/).map((s) => s.trim()).filter(Boolean)) {
      const sv = matchName(data.services, part);
      if (sv && !serviceIds.includes(sv.id)) serviceIds.push(sv.id);
      else if (!sv) warnings.push(`No service called "${part}".`);
    }

    const mrrText = cell(row, "mrr");
    let mrr = 0;
    if (mrrText) {
      const v = parseAmount(mrrText);
      if (v === null || v < 0 || v > MAX_MRR) return { line, client: null, error: `MRR "${mrrText}" isn't an amount.`, warnings };
      mrr = v;
    }

    const startText = cell(row, "start_date");
    const start_date = startText ? parseDate(startText) : null;
    if (startText && !start_date) warnings.push(`Start date "${startText}" isn't a date (use YYYY-MM-DD or DD/MM/YYYY); left blank.`);

    const healthText = cell(row, "health");
    let health: number | null = null;
    if (healthText) {
      const v = parseAmount(healthText.replace(/%$/, ""));
      if (v === null || v < 0 || v > 100) warnings.push(`Health "${healthText}" isn't 0–100; left blank (estimated 80).`);
      else health = v;
    }

    const activeText = cell(row, "active");
    let active = parseActive(activeText);
    if (active === null) {
      warnings.push(`Active "${activeText}" isn't yes or no; taken as active.`);
      active = true;
    }

    const notesText = cell(row, "notes");
    const notes = notesText ? notesText.slice(0, MAX_NOTES) : null;

    const assignments: Record<string, string> = {};
    for (const [col, roleId] of roleColumn) {
      const text = row[col] ?? "";
      if (!text) continue;
      const inRole = activePeople.filter((p) => data.personRoles.some((r) => r.person_id === p.id && r.role_id === roleId));
      const person = matchName(inRole, text) ?? matchName(activePeople, text);
      const roleName = data.roles.find((r) => r.id === roleId)!.name;
      if (!person) {
        warnings.push(`No one called "${text}" for ${roleName}; left to the role.`);
        continue;
      }
      if (!inRole.includes(person)) warnings.push(`${person.name} isn't a ${roleName}, but is assigned as one.`);
      assignments[roleId] = person.id;
    }

    return { line, client: { name, start_date, mrr, health, notes, active, serviceIds, assignments }, warnings };
  });
  if (body.length && !rows.some((r) => r.client)) errors.push("None of the rows can be imported.");
  return { rows, errors, ignoredColumns };
}
