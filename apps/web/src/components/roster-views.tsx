"use client";

import { useState, useSyncExternalStore } from "react";
import {
  createRosterClient,
  importRosterClients,
  removeRosterClient,
  saveClientAssignment,
  saveClientField,
  saveClientServices,
} from "@/app/w/[slug]/clients/actions";
import { MemoryRoster, type RosterBackend } from "@/lib/clients/backend";
import type { RosterData } from "@/lib/clients/roster";
import { ClientsRoster } from "./clients-roster";

/** The signed-in Clients page: edits go to Server Actions, which refresh the page. */
export function LiveRoster({ data }: { data: RosterData }) {
  const ws = data.workspace.id;
  const backend: RosterBackend = {
    saveField: saveClientField,
    saveServices: (clientId, base, next) => saveClientServices(clientId, ws, base, next),
    saveAssignment: (clientId, roleId, base, next) => saveClientAssignment(clientId, ws, roleId, base, next),
    create: (form) => createRosterClient(ws, {}, form),
    importClients: (clients) => importRosterClients(ws, clients),
    remove: removeRosterClient,
  };
  return <ClientsRoster data={data} backend={backend} />;
}

/** The public demo: the roster lives in this tab. */
export function DemoRoster({ initial }: { initial: RosterData }) {
  const [store] = useState(() => new MemoryRoster(initial));
  const data = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  return <ClientsRoster data={data} backend={store} />;
}
