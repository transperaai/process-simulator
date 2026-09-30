import { describe, expect, it } from "vitest";
import { northbeamBundle, northbeamClientIds, northbeamPersonIds, northbeamRoleIds, northbeamServiceIds } from "@transpera-flow/db";
import { MemoryRoster } from "@/lib/clients/backend";
import { detectDelimiter, parseAmount, parseDate, parseRosterCsv, splitCsv } from "@/lib/clients/csv";
import { checkNewClient, parseClientField, personClientLoads, rosterSummary, type RosterData } from "@/lib/clients/roster";

// The Clients page's pure parts (issue #18): input checks, CSV paste, each
// person's client load, and the demo's in-memory roster.

function northbeam(): RosterData {
  const b = northbeamBundle();
  return {
    workspace: b.workspace,
    canEdit: true,
    roles: b.roles,
    people: b.people,
    personRoles: b.personRoles,
    services: b.services,
    clients: b.clients!,
    clientServices: b.clientServices!,
    clientAssignments: b.clientAssignments!,
  };
}

const person = (name: string) => northbeamPersonIds[name]!;
const first = northbeamClientIds.c01!;

describe("input checks", () => {
  it("accepts each field's valid values and trims text; blank notes become null", () => {
    expect(parseClientField(first, "name", "A", "  Harbour Lane  ")).toMatchObject({ value: "Harbour Lane" });
    expect(parseClientField(first, "health", 88, null)).toMatchObject({ value: null });
    expect(parseClientField(first, "notes", "x", "   ")).toMatchObject({ value: null });
    expect(parseClientField(first, "start_date", null, "2024-02-29")).toMatchObject({ value: "2024-02-29" });
  });

  it("rejects bad values, unknown fields and bad ids", () => {
    expect(parseClientField(first, "health", 88, 101)).toBeNull();
    expect(parseClientField(first, "mrr", 1, -5)).toBeNull();
    expect(parseClientField(first, "name", "A", " ")).toBeNull();
    expect(parseClientField(first, "workspace_id", "a", "b")).toBeNull();
    expect(parseClientField("nope", "name", "a", "b")).toBeNull();
    expect(parseClientField(first, "start_date", null, "2024-13-01")).toBeNull();
  });

  it("checks a new client as a whole", () => {
    expect(checkNewClient({ name: " New Co ", mrr: 1200 })).toEqual({
      name: "New Co",
      start_date: null,
      mrr: 1200,
      health: null,
      notes: null,
      active: true,
      serviceIds: [],
      assignments: {},
    });
    expect(checkNewClient({ name: "X", mrr: -1 })).toEqual({ error: "X: enter an MRR of 0 or more." });
    expect(checkNewClient({ name: "X", mrr: 1, assignments: { a: "b" } })).toEqual({ error: "X: those assignments aren't valid." });
  });
});

describe("CSV paste", () => {
  const data = northbeam();

  it("splits quoted cells, doubled quotes and line breaks, and detects tabs from a spreadsheet", () => {
    expect(splitCsv('Name,Notes\n"Smith, Jones & Co","Said ""hi""\nthen left"\n', ",")).toEqual([
      ["Name", "Notes"],
      ["Smith, Jones & Co", 'Said "hi"\nthen left'],
    ]);
    expect(detectDelimiter("Name\tMRR\nA\t1")).toBe("\t");
    expect(detectDelimiter("Name;MRR;Health\nA;1;2")).toBe(";");
    expect(parseAmount("£3,500")).toBe(3500);
    expect(parseAmount("4.2k")).toBe(4200);
    expect(parseAmount("lots")).toBeNull();
    expect(parseDate("05/03/2024")).toBe("2024-03-05");
    expect(parseDate("31/02/2024")).toBeNull();
  });

  it("matches services, roles and people by name, and says what it couldn't use", () => {
    const text = [
      "Client,Services,Start date,MRR,Health,Account manager,SEO specialist,PPC specialist,Notes,Colour",
      "Acme Ltd,SEO retainer; PPC management,01/04/2025,\"£5,200\",72,Dan,Chloe Evans,nina,Big one,blue",
      "Beta LLP,Social media,2025-05-01,1800,,Leah Brooks,Someone,,,",
      "Harbour Lane Dental,SEO retainer,,3500,,,,,,",
      ",SEO retainer,,1,,,,,,",
      "Gamma,seo retainer,,abc,,,,,,",
    ].join("\n");
    const parsed = parseRosterCsv(text, data);
    expect(parsed.errors).toEqual([]);
    expect(parsed.ignoredColumns).toEqual(["Colour"]);
    const [acme, beta, harbour, blank, gamma] = parsed.rows;
    expect(acme!.client).toEqual({
      name: "Acme Ltd",
      start_date: "2025-04-01",
      mrr: 5200,
      health: 72,
      notes: "Big one",
      active: true,
      serviceIds: [northbeamServiceIds.seo, northbeamServiceIds.ppc],
      assignments: {
        [northbeamRoleIds.am]: person("Dan Okafor"),
        [northbeamRoleIds.seo]: person("Chloe Evans"),
        [northbeamRoleIds.ppc]: person("Nina Kowalski"),
      },
    });
    expect(acme!.warnings).toEqual([]);
    expect(beta!.client!.serviceIds).toEqual([]);
    expect(beta!.client!.health).toBeNull();
    expect(beta!.warnings).toEqual(['No service called "Social media".', 'No one called "Someone" for SEO specialist; left to the role.']);
    expect(harbour!.client).toBeNull();
    expect(harbour!.error).toMatch(/already on the roster/);
    expect(blank!.error).toBe("No name.");
    expect(gamma!.error).toBe('MRR "abc" isn\'t an amount.');
  });

  it("needs a name column", () => {
    expect(parseRosterCsv("Company name,MRR\nA,1", data).errors).toEqual(['The header needs a "Name" (or "Client") column.']);
    expect(parseRosterCsv("Name\nHarbour Lane Dental", data).errors).toEqual(["None of the rows can be imported."]);
  });
});

describe("client load by person", () => {
  it("derives Northbeam's per-person counts and hours from the assignments and services", () => {
    const loads = Object.fromEntries(personClientLoads(northbeam()).map((l) => [l.name, l]));
    expect(loads["Nina Kowalski"]).toMatchObject({ clients: 8, status: "ok" });
    expect(loads["Nina Kowalski"]!.hours).toBeCloseTo((8 * 19) / 4.33, 10);
    expect(loads["Maya Collins"]!.clients).toBe(26);
    // Sales look after no clients.
    expect(loads["Priya Shah"]).toMatchObject({ clients: 0, hours: 0 });
  });

  it("flags who needs overtime and who is over even that, as the cap allows", () => {
    const data = northbeam();
    // Give Nina all of Ben's PPC clients: 12 × 19 h a month ≈ 52.7 h a week against 40.
    data.clientAssignments = data.clientAssignments.map((a) => (a.person_id === person("Ben Carter") ? { ...a, person_id: person("Nina Kowalski") } : a));
    const nina = () => personClientLoads(data).find((l) => l.name === "Nina Kowalski")!;
    expect(nina().status).toBe("over");
    data.workspace = { ...data.workspace, settings: { ...data.workspace.settings, overtime_cap: 0.35 } };
    expect(nina().status).toBe("overtime");
  });

  it("leaves inactive clients out, and sums the roster's MRR by service", () => {
    const data = northbeam();
    data.clients = data.clients.map((c) => (c.id === first ? { ...c, active: false } : c));
    const summary = rosterSummary(data);
    expect(summary.active).toBe(25);
    expect(summary.inactive).toBe(1);
    expect(summary.byService.get(northbeamServiceIds.ppc)).toBe(12);
    expect(summary.byService.get(northbeamServiceIds.seo)).toBe(16);
    expect(personClientLoads(data).find((l) => l.name === "Maya Collins")!.clients).toBe(25);
  });
});

describe("the demo's in-memory roster", () => {
  it("saves fields with the same conflict rule as the database, and stamps entered values", async () => {
    const store = new MemoryRoster(northbeam());
    expect(await store.saveField(first, "mrr", 3500, 3900)).toEqual({ status: "saved", value: 3900 });
    expect(store.snapshot().clients.find((c) => c.id === first)!.provenance.mrr!.source).toBe("entered");
    expect(await store.saveField(first, "mrr", 3500, 4000)).toEqual({ status: "conflict", theirs: 3900 });
    expect(await store.saveField(first, "health", 88, 400)).toMatchObject({ status: "error" });
  });

  it("reassigns, unassigns and changes services, telling listeners", async () => {
    const store = new MemoryRoster(northbeam());
    let changes = 0;
    store.subscribe(() => changes++);
    const seo = northbeamRoleIds.seo;
    expect(await store.saveAssignment(first, seo, person("Sam Patel"), person("Chloe Evans"))).toEqual({ status: "saved", value: person("Chloe Evans") });
    expect(await store.saveAssignment(first, seo, person("Sam Patel"), null)).toEqual({ status: "conflict", theirs: person("Chloe Evans") });
    expect(await store.saveAssignment(first, seo, person("Chloe Evans"), null)).toEqual({ status: "saved", value: null });
    expect(await store.saveServices(first, [northbeamServiceIds.seo], [northbeamServiceIds.ppc])).toMatchObject({ status: "saved" });
    expect(changes).toBe(3);
    const loads = personClientLoads(store.snapshot());
    expect(loads.find((l) => l.name === "Sam Patel")!.clients).toBe(6);
  });

  it("adds, imports and removes clients; names stay unique", async () => {
    let n = 0;
    const store = new MemoryRoster(northbeam(), () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
    const form = new FormData();
    form.set("name", "New Co");
    form.set("mrr", "1500");
    form.set("service_id", northbeamServiceIds.seo);
    expect(await store.create(form)).toEqual({ created: 1 });
    expect(await store.create(form)).toEqual({ error: "New Co is already on the roster." });
    const parsed = parseRosterCsv("Name,MRR,Account manager\nOne,1,Leah\nTwo,2,Dan", store.snapshot());
    expect(await store.importClients(parsed.rows.map((r) => r.client!))).toEqual({ created: 2 });
    expect(store.snapshot().clients).toHaveLength(29);
    expect(store.snapshot().clientAssignments.filter((a) => a.person_id === person("Leah Brooks"))).toHaveLength(15);
    const id = store.snapshot().clients.find((c) => c.name === "New Co")!.id;
    expect(await store.remove(id)).toEqual({});
    expect(store.snapshot().clientServices.some((cs) => cs.client_id === id)).toBe(false);
  });
});
