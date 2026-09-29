import { signInWithGoogle } from "./actions";

export function LoginForm() {
  return (
    <div className="flex flex-col gap-3">
      <form action={signInWithGoogle}>
        <button type="submit" className="w-full rounded-token bg-accent px-3 py-2 font-semibold text-accent-fg">
          Continue with Google
        </button>
      </form>
      <p className="text-sm text-fg-3">Use your work Google account.</p>
    </div>
  );
}
