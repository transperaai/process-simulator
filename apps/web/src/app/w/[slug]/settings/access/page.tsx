import { notFound } from "next/navigation";
import { Help } from "@/components/help";
import { Page } from "@/components/shell/page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ASSIGNABLE_ROLES } from "@/lib/access";
import { loadAccessSettings, type WorkspaceMember } from "@/lib/access-data";
import { createClient } from "@/lib/supabase/server";
import {
  addDomain,
  addEmail,
  removeDomain,
  removeEmail,
  setMemberActive,
  setMemberRole,
  updateEmail,
} from "./actions";

const SOURCE_LABEL: Record<WorkspaceMember["source"], string> = {
  access_list: "Pre-assigned email",
  domain: "Allowed domain",
  manual: "Added by Transpera",
};

function RoleSelect({ value, name = "role" }: { value?: string; name?: string }) {
  return (
    <NativeSelect name={name} defaultValue={value ?? "member"} aria-label="Role" className="w-auto">
      {ASSIGNABLE_ROLES.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </NativeSelect>
  );
}

function PersonSelect({ people, value }: { people: { id: string; name: string }[]; value?: string | null }) {
  return (
    <NativeSelect name="person_id" defaultValue={value ?? ""} aria-label="Person record" className="w-auto">
      <option value="">No person record</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </NativeSelect>
  );
}

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Never";

export default async function AccessPage(props: PageProps<"/w/[slug]/settings/access">) {
  const { slug } = await props.params;
  const search = await props.searchParams;
  const error = typeof search.error === "string" ? search.error : null;
  const notice = typeof search.notice === "string" ? search.notice : null;

  const settings = await loadAccessSettings(slug);
  if (!settings) notFound();
  const { workspace, domains, emails, members, people, isAgencyAdmin } = settings;
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  const listed = new Map(emails.map((e) => [e.email, e]));

  return (
    <Page
      title="Access"
      eyebrow="Company"
      description="People get in by signing in with Google. Nobody is emailed. Changes apply on their next page load."
    >
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert role="status">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <Card role="region" aria-labelledby="domains-heading">
        <CardHeader>
          <h2 id="domains-heading" className="flex items-center font-heading text-base font-medium">
            Allowed domains
            <Help
              label="Allowed domains"
              description="Anyone who signs in with a company Google account on one of these domains gets into this workspace as a member. Free email providers can't be added."
              example="Add northbeam.example and everyone with a @northbeam.example Google account can sign in."
            />
          </h2>
          <CardDescription>Personal Google accounts made with a work address don&apos;t qualify.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="flex flex-wrap gap-2">
            {domains.length === 0 && <li className="text-muted-foreground">No domains yet.</li>}
            {domains.map((d) => (
              <li key={d.id} className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
                <span className="font-mono">{d.domain}</span>
                <form action={removeDomain.bind(null, slug)}>
                  <input type="hidden" name="id" value={d.id} />
                  <Button type="submit" variant="ghost" size="xs" className="text-destructive" aria-label={`Remove ${d.domain}`}>
                    Remove
                  </Button>
                </form>
              </li>
            ))}
          </ul>
          <form action={addDomain.bind(null, slug, workspace.id)} className="flex flex-wrap gap-2">
            <Input name="domain" required placeholder="acme.com" aria-label="Domain" className="w-full sm:w-64" />
            <Button type="submit">Add domain</Button>
          </form>
        </CardContent>
      </Card>

      <Card role="region" aria-labelledby="emails-heading">
        <CardHeader>
          <h2 id="emails-heading" className="flex items-center font-heading text-base font-medium">
            Pre-assigned emails
            <Help
              label="Pre-assigned emails"
              description="Whoever signs in with one of these emails gets exactly the role you choose, whatever their domain. Use it for owners, editors and contractors on personal addresses."
              example="Add sam@gmail.com as an editor and Sam can edit the process even though gmail.com isn't an allowed domain."
            />
          </h2>
          <CardDescription>Exact roles for named people.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role and person</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {emails.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground">
                    Nobody yet.
                  </TableCell>
                </TableRow>
              )}
              {emails.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono">{e.email}</TableCell>
                  <TableCell>
                    <form action={updateEmail.bind(null, slug)} className="flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={e.id} />
                      <RoleSelect value={e.role} />
                      <PersonSelect people={people} value={e.person_id} />
                      <Button type="submit" variant="outline">
                        Save
                      </Button>
                    </form>
                  </TableCell>
                  <TableCell>
                    <form action={removeEmail.bind(null, slug)}>
                      <input type="hidden" name="id" value={e.id} />
                      <Button type="submit" variant="ghost" size="sm" className="text-destructive">
                        Remove
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <form action={addEmail.bind(null, slug, workspace.id)} className="flex flex-wrap gap-2">
            <Input name="email" type="email" required placeholder="name@company.com" aria-label="Email" className="w-full sm:w-64" />
            <RoleSelect />
            <PersonSelect people={people} />
            <Button type="submit">Add email</Button>
          </form>
        </CardContent>
      </Card>

      <Card role="region" aria-labelledby="members-heading">
        <CardHeader>
          <h2 id="members-heading" className="font-heading text-base font-medium">
            Members
          </h2>
          <CardDescription>
            Everyone who has signed in to this workspace. Change a pre-assigned person&apos;s role in the list above.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>How they got in</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    Nobody has signed in yet.
                  </TableCell>
                </TableRow>
              )}
              {members.map((m) => {
                const locked = m.userId === user?.id || (m.role === "agency_admin" && !isAgencyAdmin);
                const onList = m.source === "access_list" && listed.has(m.email.toLowerCase());
                return (
                  <TableRow key={m.membershipId} className={m.active ? undefined : "text-muted-foreground"}>
                    <TableCell className="font-mono">{m.email}</TableCell>
                    <TableCell>
                      {locked || onList || !m.active ? (
                        m.role
                      ) : (
                        <form action={setMemberRole.bind(null, slug)} className="flex gap-2">
                          <input type="hidden" name="id" value={m.membershipId} />
                          <RoleSelect value={m.role} />
                          <Button type="submit" variant="outline">
                            Save
                          </Button>
                        </form>
                      )}
                    </TableCell>
                    <TableCell>{SOURCE_LABEL[m.source]}</TableCell>
                    <TableCell>{formatDate(m.lastSignInAt)}</TableCell>
                    <TableCell>
                      {locked ? null : onList ? (
                        <span className="text-muted-foreground">Remove from the list above</span>
                      ) : (
                        <form action={setMemberActive.bind(null, slug)}>
                          <input type="hidden" name="id" value={m.membershipId} />
                          <input type="hidden" name="active" value={m.active ? "false" : "true"} />
                          <Button type="submit" variant="ghost" size="sm" className={m.active ? "text-destructive" : undefined}>
                            {m.active ? "Remove access" : "Restore access"}
                          </Button>
                        </form>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Page>
  );
}
