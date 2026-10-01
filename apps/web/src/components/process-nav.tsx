"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { companyMap, flattenCompanyMap, type ProcessListing } from "@transpera-flow/db";
import type { CreateProcessResult } from "@/app/w/[slug]/process-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

/**
 * The workspace's processes (issue #76): the pipeline and its servicing
 * processes (issue #19), each opening on the canvas, never-published ones in
 * Draft view. It is the page's heading and the process picker in one: the
 * current process's name opens the list. Editors can start a new servicing
 * process from it.
 */
export function ProcessNav({
  processes,
  current,
  hrefs,
  create,
}: {
  processes: ProcessListing[];
  current: string;
  /** Where each process opens, by id. */
  hrefs: Record<string, string>;
  /** Start a servicing process (signed-in editors only). */
  create?: (prev: CreateProcessResult, form: FormData) => Promise<CreateProcessResult>;
}) {
  const [adding, setAdding] = useState(false);
  // The company map's order: top-level processes, each followed by the child processes inside it (issue #102).
  const ordered = flattenCompanyMap(companyMap(processes));
  const here = processes.find((p) => p.id === current);
  const name = here?.name ?? "Process";
  if (processes.length <= 1 && !create) return <h1 className="truncate px-1 font-display text-base font-bold">{name}</h1>;
  return (
    <>
      <h1 className="min-w-0 text-base">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="max-w-full gap-1.5 px-2 font-display text-base font-bold" aria-label={`Process: ${name}. Switch process`}>
              <span className="truncate">{name}</span>
              <ChevronsUpDown className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-64">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Processes</DropdownMenuLabel>
            {ordered.map(({ process: p, depth }) => (
              <DropdownMenuItem key={p.id} asChild>
                <Link href={hrefs[p.id]!} aria-current={p.id === current ? "page" : undefined}>
                  <span className="min-w-0 flex-1 truncate" style={depth > 1 ? { paddingLeft: (depth - 1) * 14 } : undefined}>
                    {depth > 1 && (
                      <span aria-hidden className="text-muted-foreground">
                        ↳{" "}
                      </span>
                    )}
                    {p.name}
                  </span>
                  {p.kind === "servicing" && <Badge variant="secondary">servicing</Badge>}
                  {!p.live && (
                    <Badge variant="outline" className="border-warn bg-warn-soft text-fg">
                      not published
                    </Badge>
                  )}
                  {p.id === current && <Check className="text-accent" aria-hidden />}
                </Link>
              </DropdownMenuItem>
            ))}
            {create && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setAdding(true)}>
                  <Plus /> New servicing process…
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </h1>
      {create && (
        <Dialog open={adding} onOpenChange={setAdding}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>New servicing process</DialogTitle>
              <DialogDescription>A recurring process for existing clients, such as a monthly report. It simulates beside the pipeline.</DialogDescription>
            </DialogHeader>
            <NewServicingProcess create={create} onCancel={() => setAdding(false)} />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function NewServicingProcess({
  create,
  onCancel,
}: {
  create: (prev: CreateProcessResult, form: FormData) => Promise<CreateProcessResult>;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState(create, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="sr-only" htmlFor="new-servicing-name">
        Name of the servicing process
      </label>
      <Input id="new-servicing-name" name="name" required maxLength={120} autoFocus placeholder="e.g. Quarterly review" />
      {state.error && (
        <p role="alert" className="text-destructive">
          {state.error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create"}
        </Button>
      </DialogFooter>
    </form>
  );
}
