import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";

/** The bar above the pages that sit outside a workspace (the workspace list, API tokens). */
export function AppHeader({ workspace, signedIn }: { workspace?: string; signedIn: boolean }) {
  return (
    <header className="flex items-center gap-2 border-b py-3">
      <Link href="/" className="flex items-center gap-2.5 font-display text-lg font-bold tracking-tight">
        <span aria-hidden className="size-[22px] rounded-md bg-[conic-gradient(from_200deg,var(--accent),var(--chart-1),var(--chart-5),var(--accent))]" />
        Transpera Flow
      </Link>
      {workspace && <span className="text-muted-foreground">{workspace}</span>}
      <span className="flex-1" />
      {signedIn && (
        <Link href="/settings/tokens" className={buttonVariants({ variant: "ghost" })}>
          API tokens
        </Link>
      )}
      {signedIn && (
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="ghost">
            Sign out
          </Button>
        </form>
      )}
    </header>
  );
}
