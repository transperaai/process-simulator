import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Magic-link landing: exchange the code for a session, then go home. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  const code = url.searchParams.get("code");
  // Supabase appends these when the link itself was rejected (expired, already used).
  let error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  url.search = "";
  if (code && !error) {
    const supabase = await createClient();
    const result = await supabase.auth.exchangeCodeForSession(code);
    if (result.error) {
      console.error("auth callback: code exchange failed", result.error.code, result.error.message);
      error = result.error.message;
    }
  } else if (!error) {
    error = "The sign-in link was missing its code.";
  }
  if (error) {
    url.pathname = "/login";
    url.searchParams.set("error", error);
  } else {
    url.pathname = "/";
  }
  return NextResponse.redirect(url);
}
