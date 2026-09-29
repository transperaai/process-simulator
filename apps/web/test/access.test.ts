import { describe, expect, it } from "vitest";
import { accessErrorMessage, emailDomain, isAssignableRole, normalizeDomain, normalizeEmail } from "@/lib/access";

describe("access helpers", () => {
  it("normalises what people paste as a domain", () => {
    expect(normalizeDomain("  Acme.COM ")).toBe("acme.com");
    expect(normalizeDomain("@acme.com")).toBe("acme.com");
    expect(normalizeDomain("jo@acme.com")).toBe("acme.com");
    expect(normalizeDomain("https://www.acme.com/about")).toBe("acme.com");
    expect(normalizeDomain("acme.co.uk.")).toBe("acme.co.uk");
  });

  it("normalises emails and extracts their domain", () => {
    expect(normalizeEmail(" Jo.Smith@Acme.com ")).toBe("jo.smith@acme.com");
    expect(emailDomain("jo@Acme.com")).toBe("acme.com");
  });

  it("only allows roles an owner can assign", () => {
    expect(isAssignableRole("editor")).toBe(true);
    expect(isAssignableRole("agency_admin")).toBe(false);
    expect(isAssignableRole(null)).toBe(false);
  });

  it("explains database rejections", () => {
    const check = (constraint: string) => ({ code: "23514", message: `new row violates check constraint "${constraint}"` });
    expect(accessErrorMessage(check("workspace_domains_not_free_mail"))).toMatch(/Free email providers/);
    expect(accessErrorMessage(check("workspace_domains_domain_format"))).toMatch(/doesn't look like a domain/);
    expect(
      accessErrorMessage({ code: "23505", message: 'duplicate key value violates unique constraint "workspace_domains_domain_key"' }),
    ).toMatch(/already used/);
    expect(accessErrorMessage({ code: "42501", message: "new row violates row-level security policy" })).toMatch(/permission/);
    expect(accessErrorMessage({ message: "boom" })).toMatch(/Something went wrong/);
  });
});
