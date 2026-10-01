import { redirect } from "next/navigation";
import { NORTHBEAM_PROCESS_ID } from "@transpera-flow/db";

/** `/demo/history` is the sales pipeline's History, which lives at `/demo/p/<id>/history`. */
export default function DemoHistoryRedirect() {
  redirect(`/demo/p/${NORTHBEAM_PROCESS_ID}/history`);
}
