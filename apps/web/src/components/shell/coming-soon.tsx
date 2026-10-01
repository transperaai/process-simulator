import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Page } from "./page";

/** A page of the new sidebar that is not built yet (issue #98): says what will be here, and where to go meanwhile. */
export function ComingSoon({
  title,
  eyebrow,
  ticket,
  icon: Icon,
  description,
  willHave,
  meanwhile,
}: {
  title: string;
  eyebrow?: string;
  /** The ticket that builds it, "A35". */
  ticket: string;
  icon: LucideIcon;
  description: string;
  /** A short list of what it will show. */
  willHave: string[];
  /** Where to go in the meantime. */
  meanwhile?: { label: string; href: string };
}) {
  return (
    <Page title={title} eyebrow={eyebrow} description={description} width="max-w-3xl">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Icon className="size-4" />
            </span>
            <Badge variant="outline">Coming in {ticket}</Badge>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">What will be here</p>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {willHave.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
          {meanwhile && (
            <div>
              <Link href={meanwhile.href} className={cn(buttonVariants({ variant: "outline" }))}>
                {meanwhile.label}
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </Page>
  );
}
