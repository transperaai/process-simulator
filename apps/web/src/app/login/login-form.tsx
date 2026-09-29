"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, { status: "idle" });
  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="email" className="font-medium text-fg-2">
        Work email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        className="rounded-token border border-line-2 bg-panel px-3 py-2"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-token bg-accent px-3 py-2 font-semibold text-accent-fg disabled:opacity-60"
      >
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
      <p role="status" aria-live="polite" className={state.status === "error" ? "text-crit" : "text-fg-2"}>
        {state.message}
      </p>
    </form>
  );
}
