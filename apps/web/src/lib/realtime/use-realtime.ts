"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { DraftSession } from "@/lib/drafts/session";
import { RealtimeSync, type RealtimeState } from "./sync";
import type { RealtimeTransport, View, Viewer } from "./transport";

const OFF: RealtimeState = { status: "offline", others: [], activity: [], notes: 0 };
const noop = () => () => undefined;
const off = () => OFF;

/**
 * Presence and live changes for the process page (issue #10), for the
 * component's lifetime. Null (and nothing happens) without a transport or a
 * signed-in viewer. Leaves the channel when the tab is hidden for good
 * (pagehide) and rejoins if it comes back from the back-forward cache.
 */
export function useRealtime(
  session: DraftSession,
  transport: RealtimeTransport | null,
  me: Viewer | null,
  view: View,
): [RealtimeSync | null, RealtimeState] {
  const [sync] = useState(() => (transport && me ? new RealtimeSync(session, transport, me, { view }) : null));
  const state = useSyncExternalStore(sync ? sync.subscribe : noop, sync ? sync.getState : off, sync ? sync.getState : off);

  useEffect(() => {
    if (!sync) return;
    sync.start();
    const leave = () => sync.stop();
    const back = (e: PageTransitionEvent) => {
      if (e.persisted) sync.start();
    };
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", back);
    return () => {
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("pageshow", back);
      sync.stop();
    };
  }, [sync]);

  useEffect(() => {
    sync?.setView(view);
  }, [sync, view]);

  return [sync, state];
}
