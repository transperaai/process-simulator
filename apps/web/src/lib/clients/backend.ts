// Where roster edits go. The signed-in page passes Server Actions (which write
// through RLS and refresh the page); the public demo uses `MemoryRoster`,
// which keeps the edits in the tab (lost on reload) and is unit tested.

import type { ClientAssignmentRow, ClientRow, ClientServiceRow } from "@transpera-flow/db";
import type { SaveOutcome } from "@/lib/fields/field-controller";
import { checkNewClient, newClientProvenance, parseClientField, type NewClient, type RosterData } from "./roster";

type Scalar = string | number | boolean | null;

export interface ActionResult {
  error?: string;
  created?: number;
}

export interface RosterBackend {
  saveField(clientId: string, field: string, base: Scalar, value: Scalar): Promise<SaveOutcome<Scalar>>;
  saveServices(clientId: string, base: readonly string[], next: readonly string[]): Promise<SaveOutcome<readonly string[]>>;
  saveAssignment(clientId: string, roleId: string, base: string | null, next: string | null): Promise<SaveOutcome<string | null>>;
  create(form: FormData): Promise<ActionResult>;
  importClients(clients: NewClient[]): Promise<ActionResult>;
  remove(clientId: string): Promise<ActionResult>;
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/** The roster in memory, with the same checks and conflict rules as the database. */
export class MemoryRoster implements RosterBackend {
  private listeners = new Set<() => void>();

  constructor(
    private data: RosterData,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  snapshot = (): RosterData => this.data;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(change: Partial<RosterData>) {
    this.data = { ...this.data, ...change };
    for (const l of this.listeners) l();
  }

  async saveField(clientId: string, field: string, base: Scalar, value: Scalar): Promise<SaveOutcome<Scalar>> {
    const parsed = parseClientField(clientId, field, base, value);
    if (!parsed) return { status: "error", message: "That value isn't valid." };
    const row = this.data.clients.find((c) => c.id === clientId);
    if (!row) return { status: "not_found" };
    const stored = row[parsed.field] as Scalar;
    if (stored !== parsed.base && stored !== parsed.value) return { status: "conflict", theirs: stored };
    const provenance =
      parsed.field === "mrr" || parsed.field === "health"
        ? { ...row.provenance, [parsed.field]: { source: "entered" as const, at: new Date().toISOString() } }
        : row.provenance;
    this.set({ clients: this.data.clients.map((c) => (c.id === clientId ? { ...c, [parsed.field]: parsed.value, provenance } : c)) });
    return { status: "saved", value: parsed.value };
  }

  async saveServices(clientId: string, base: readonly string[], next: readonly string[]): Promise<SaveOutcome<readonly string[]>> {
    if (!this.data.clients.some((c) => c.id === clientId)) return { status: "not_found" };
    const stored = this.data.clientServices.filter((cs) => cs.client_id === clientId).map((cs) => cs.service_id);
    if (!sameSet(stored, base) && !sameSet(stored, next)) return { status: "conflict", theirs: stored };
    const rows: ClientServiceRow[] = [...new Set(next)].map((service_id) => ({
      client_id: clientId,
      service_id,
      workspace_id: this.data.workspace.id,
      start_date: this.data.clientServices.find((cs) => cs.client_id === clientId && cs.service_id === service_id)?.start_date ?? null,
    }));
    this.set({ clientServices: [...this.data.clientServices.filter((cs) => cs.client_id !== clientId), ...rows] });
    return { status: "saved", value: [...next] };
  }

  async saveAssignment(clientId: string, roleId: string, base: string | null, next: string | null): Promise<SaveOutcome<string | null>> {
    if (!this.data.clients.some((c) => c.id === clientId)) return { status: "not_found" };
    const stored = this.data.clientAssignments.find((a) => a.client_id === clientId && a.role_id === roleId)?.person_id ?? null;
    if (stored !== base && stored !== next) return { status: "conflict", theirs: stored };
    const others = this.data.clientAssignments.filter((a) => !(a.client_id === clientId && a.role_id === roleId));
    const row: ClientAssignmentRow[] = next ? [{ client_id: clientId, role_id: roleId, person_id: next, workspace_id: this.data.workspace.id }] : [];
    this.set({ clientAssignments: [...others, ...row] });
    return { status: "saved", value: next };
  }

  async create(form: FormData): Promise<ActionResult> {
    const mrrText = String(form.get("mrr") ?? "").trim();
    const service = String(form.get("service_id") ?? "");
    const checked = checkNewClient({
      name: String(form.get("name") ?? ""),
      mrr: mrrText === "" ? 0 : Number(mrrText),
      serviceIds: service ? [service] : [],
      assignments: {},
    });
    if ("error" in checked) return checked;
    return this.importClients([checked]);
  }

  async importClients(clients: NewClient[]): Promise<ActionResult> {
    const taken = new Set(this.data.clients.map((c) => c.name.trim().toLowerCase()));
    const ws = this.data.workspace.id;
    const added: ClientRow[] = [];
    const services: ClientServiceRow[] = [];
    const assignments: ClientAssignmentRow[] = [];
    for (const input of clients) {
      const c = checkNewClient(input);
      if ("error" in c) return c;
      if (taken.has(c.name.toLowerCase())) return { error: `${c.name} is already on the roster.` };
      taken.add(c.name.toLowerCase());
      const id = this.newId();
      added.push({ id, workspace_id: ws, name: c.name, start_date: c.start_date, mrr: c.mrr, health: c.health, provenance: newClientProvenance(c), notes: c.notes, active: c.active });
      for (const service_id of c.serviceIds) services.push({ client_id: id, service_id, workspace_id: ws, start_date: null });
      for (const [role_id, person_id] of Object.entries(c.assignments)) assignments.push({ client_id: id, role_id, person_id, workspace_id: ws });
    }
    this.set({
      clients: [...this.data.clients, ...added].sort((a, b) => a.name.localeCompare(b.name)),
      clientServices: [...this.data.clientServices, ...services],
      clientAssignments: [...this.data.clientAssignments, ...assignments],
    });
    return { created: added.length };
  }

  async remove(clientId: string): Promise<ActionResult> {
    if (!this.data.clients.some((c) => c.id === clientId)) return { error: "That client was already removed." };
    this.set({
      clients: this.data.clients.filter((c) => c.id !== clientId),
      clientServices: this.data.clientServices.filter((cs) => cs.client_id !== clientId),
      clientAssignments: this.data.clientAssignments.filter((a) => a.client_id !== clientId),
    });
    return {};
  }
}
