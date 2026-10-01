"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { Help } from "@/components/help";
import type { CreateProcessResult } from "@/app/w/[slug]/process-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type CreateProcess = (prev: CreateProcessResult, form: FormData) => Promise<CreateProcessResult>;

/** The Processes page's "New process" button: asks for a name, then opens the new process in a draft. */
export function NewProcessButton({ create }: { create: CreateProcess }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex items-center">
      <Button onClick={() => setOpen(true)}>
        <Plus /> New process
      </Button>
      <Help
        label="New process"
        description="Starts a recurring process for existing clients and opens it in the editor as a draft. Nothing is live until you publish it."
        example="Call it Monthly client report, add its steps in the editor, then publish."
      />
      <NewProcessDialog open={open} onOpenChange={setOpen} create={create} />
    </span>
  );
}

/** The "New servicing process" dialog, shared by the process switcher and the Processes page. Creating opens the new process in a draft. */
export function NewProcessDialog({ open, onOpenChange, create }: { open: boolean; onOpenChange: (open: boolean) => void; create: CreateProcess }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New servicing process</DialogTitle>
          <DialogDescription>A recurring process for existing clients, such as a monthly report. It simulates beside the pipeline.</DialogDescription>
        </DialogHeader>
        <NewServicingProcess create={create} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function NewServicingProcess({
  create,
  onCancel,
}: {
  create: CreateProcess;
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
