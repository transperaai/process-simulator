import Link from "next/link";

export function AppHeader({ workspace, signedIn }: { workspace?: string; signedIn: boolean }) {
  return (
    <header className="flex items-center gap-4 border-b border-line py-3">
      <Link href="/" className="font-display text-lg font-bold">
        Transpera Flow
      </Link>
      {workspace && <span className="text-fg-3">{workspace}</span>}
      <span className="flex-1" />
      {signedIn && (
        <Link href="/settings/tokens" className="rounded-token px-2 py-1 text-fg-2 hover:bg-panel-2">
          API tokens
        </Link>
      )}
      {signedIn && (
        <form action="/auth/signout" method="post">
          <button type="submit" className="rounded-token px-2 py-1 text-fg-2 hover:bg-panel-2">
            Sign out
          </button>
        </form>
      )}
    </header>
  );
}
