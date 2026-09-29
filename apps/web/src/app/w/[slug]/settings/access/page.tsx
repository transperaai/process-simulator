import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
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

const input = "rounded-token border border-line bg-panel px-2 py-1";
const button = "rounded-token border border-line px-2 py-1 font-semibold hover:bg-panel-2";
const primary = "rounded-token bg-accent px-3 py-1 font-semibold text-accent-fg";
const cell = "border-b border-line px-2 py-2 align-middle";

const SOURCE_LABEL: Record<WorkspaceMember["source"], string> = {
  access_list: "Pre-assigned email",
  domain: "Allowed domain",
  manual: "Added by Transpera",
};

function RoleSelect({ value, name = "role" }: { value?: string; name?: string }) {
  return (
    <select name={name} defaultValue={value ?? "member"} className={input} aria-label="Role">
      {ASSIGNABLE_ROLES.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </select>
  );
}

function PersonSelect({ people, value }: { people: { id: string; name: string }[]; value?: string | null }) {
  return (
    <select name="person_id" defaultValue={value ?? ""} className={input} aria-label="Person record">
      <option value="">No person record</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
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
    <main className="mx-auto w-full max-w-5xl px-4 pb-12">
      <AppHeader workspace={workspace.name} signedIn />
      <p className="mt-4 text-sm">
        <Link href={`/w/${workspace.slug}`} className="text-fg-3 underline">
          Back to {workspace.name}
        </Link>
      </p>
      <h1 className="mt-2 mb-1 text-xl font-bold">Access</h1>
      <p className="mb-4 text-fg-2">
        People get in by signing in with Google. Nobody is emailed. Changes apply on their next page load.
      </p>
      {error && (
        <p role="alert" className="mb-4 rounded-token bg-crit-soft px-3 py-2 text-crit">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-token bg-good-soft px-3 py-2">
          {notice}
        </p>
      )}

      <section className="mb-8">
        <h2 className="mb-1 text-lg font-bold">Allowed domains</h2>
        <p className="mb-3 text-sm text-fg-2">
          Anyone with a company-managed Google account on these domains joins as <strong>member</strong>. Personal Google
          accounts made with a work address don&apos;t qualify. Free email providers can&apos;t be added.
        </p>
        <ul className="mb-3 flex flex-wrap gap-2">
          {domains.length === 0 && <li className="text-fg-3">No domains yet.</li>}
          {domains.map((d) => (
            <li key={d.id} className="flex items-center gap-2 rounded-token border border-line bg-panel px-3 py-1">
              <span className="font-mono">{d.domain}</span>
              <form action={removeDomain.bind(null, slug)}>
                <input type="hidden" name="id" value={d.id} />
                <button type="submit" className="text-sm text-crit underline" aria-label={`Remove ${d.domain}`}>
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form action={addDomain.bind(null, slug, workspace.id)} className="flex flex-wrap gap-2">
          <input name="domain" required placeholder="acme.com" className={input} aria-label="Domain" />
          <button type="submit" className={primary}>
            Add domain
          </button>
        </form>
      </section>

      <section className="mb-8">
        <h2 className="mb-1 text-lg font-bold">Pre-assigned emails</h2>
        <p className="mb-3 text-sm text-fg-2">
          Whoever signs in with one of these emails gets exactly this role, whatever their domain. Use it for owners,
          editors and contractors on personal addresses.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-fg-3">
              <tr>
                <th className={cell}>Email</th>
                <th className={cell}>Role and person</th>
                <th className={cell} />
              </tr>
            </thead>
            <tbody>
              {emails.length === 0 && (
                <tr>
                  <td className={cell} colSpan={3}>
                    <span className="text-fg-3">Nobody yet.</span>
                  </td>
                </tr>
              )}
              {emails.map((e) => (
                <tr key={e.id}>
                  <td className={`${cell} font-mono`}>{e.email}</td>
                  <td className={cell}>
                    <form action={updateEmail.bind(null, slug)} className="flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={e.id} />
                      <RoleSelect value={e.role} />
                      <PersonSelect people={people} value={e.person_id} />
                      <button type="submit" className={button}>
                        Save
                      </button>
                    </form>
                  </td>
                  <td className={cell}>
                    <form action={removeEmail.bind(null, slug)}>
                      <input type="hidden" name="id" value={e.id} />
                      <button type="submit" className="text-crit underline">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form action={addEmail.bind(null, slug, workspace.id)} className="mt-3 flex flex-wrap gap-2">
          <input name="email" type="email" required placeholder="name@company.com" className={input} aria-label="Email" />
          <RoleSelect />
          <PersonSelect people={people} />
          <button type="submit" className={primary}>
            Add email
          </button>
        </form>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-bold">Members</h2>
        <p className="mb-3 text-sm text-fg-2">
          Everyone who has signed in to this workspace. Change a pre-assigned person&apos;s role in the list above.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-fg-3">
              <tr>
                <th className={cell}>Email</th>
                <th className={cell}>Role</th>
                <th className={cell}>How they got in</th>
                <th className={cell}>Last sign-in</th>
                <th className={cell} />
              </tr>
            </thead>
            <tbody>
              {members.length === 0 && (
                <tr>
                  <td className={cell} colSpan={5}>
                    <span className="text-fg-3">Nobody has signed in yet.</span>
                  </td>
                </tr>
              )}
              {members.map((m) => {
                const locked = m.userId === user?.id || (m.role === "agency_admin" && !isAgencyAdmin);
                const onList = m.source === "access_list" && listed.has(m.email.toLowerCase());
                return (
                  <tr key={m.membershipId} className={m.active ? undefined : "text-fg-3"}>
                    <td className={`${cell} font-mono`}>{m.email}</td>
                    <td className={cell}>
                      {locked || onList || !m.active ? (
                        m.role
                      ) : (
                        <form action={setMemberRole.bind(null, slug)} className="flex gap-2">
                          <input type="hidden" name="id" value={m.membershipId} />
                          <RoleSelect value={m.role} />
                          <button type="submit" className={button}>
                            Save
                          </button>
                        </form>
                      )}
                    </td>
                    <td className={cell}>{SOURCE_LABEL[m.source]}</td>
                    <td className={cell}>{formatDate(m.lastSignInAt)}</td>
                    <td className={cell}>
                      {locked ? null : onList ? (
                        <span className="text-fg-3">Remove from the list above</span>
                      ) : (
                        <form action={setMemberActive.bind(null, slug)}>
                          <input type="hidden" name="id" value={m.membershipId} />
                          <input type="hidden" name="active" value={m.active ? "false" : "true"} />
                          <button type="submit" className={m.active ? "text-crit underline" : "underline"}>
                            {m.active ? "Remove access" : "Restore access"}
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
