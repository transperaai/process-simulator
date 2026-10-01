import { Button } from "@/components/ui/button";
import { signInWithGoogle } from "./actions";

export function LoginForm() {
  return (
    <div className="flex flex-col gap-3">
      <form action={signInWithGoogle}>
        <Button type="submit" size="lg" className="w-full">
          Continue with Google
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">Use your work Google account.</p>
    </div>
  );
}
