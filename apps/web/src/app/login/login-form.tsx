"use client";

import { useActionState } from "react";
import { sendCode, signInWithGoogle, verifyCode, type LoginState } from "./actions";

const input = "rounded-token border border-line-2 bg-panel px-3 py-2";
const primary = "rounded-token bg-accent px-3 py-2 font-semibold text-accent-fg disabled:opacity-60";

export function LoginForm() {
  const [sent, send, sending] = useActionState<LoginState, FormData>(sendCode, { status: "idle" });
  // Keyed by email so a fresh send starts the code step clean.
  if (sent.status === "sent") return <CodeForm key={sent.email} sent={sent} />;

  return (
    <div className="flex flex-col gap-5">
      <form action={signInWithGoogle}>
        <button type="submit" className={`${primary} w-full`}>
          Continue with Google
        </button>
      </form>
      <p className="text-center text-xs uppercase tracking-widest text-fg-3">or</p>
      <form action={send} className="flex flex-col gap-3">
        <label htmlFor="email" className="font-medium text-fg-2">
          Work email
        </label>
        <input id="email" name="email" type="email" autoComplete="email" required className={input} />
        <button
          type="submit"
          disabled={sending}
          className="rounded-token border border-line-2 px-3 py-2 font-semibold disabled:opacity-60"
        >
          {sending ? "Sending…" : "Email me a code"}
        </button>
        <p role="status" aria-live="polite" className="text-crit">
          {sent.message}
        </p>
      </form>
    </div>
  );
}

function CodeForm({ sent }: { sent: LoginState }) {
  const [state, verify, verifying] = useActionState<LoginState, FormData>(verifyCode, sent);
  const failed = state.message !== sent.message;
  return (
    <form action={verify} className="flex flex-col gap-3">
      <p className="text-fg-2">{sent.message}</p>
      <label htmlFor="code" className="font-medium text-fg-2">
        Sign-in code
      </label>
      <input
        id="code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        required
        className={`${input} font-mono tracking-widest`}
      />
      <button type="submit" disabled={verifying} className={primary}>
        {verifying ? "Checking…" : "Sign in"}
      </button>
      {failed ? (
        <p role="alert" className="text-crit">
          {state.message}
        </p>
      ) : null}
      <a href="/login" className="text-sm text-fg-3 underline">
        Use a different email
      </a>
    </form>
  );
}
