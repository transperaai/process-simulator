import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// "No setting, lever or rule without an (i)" (issue #123, A58), checked on the source. Every screen that holds
// settings is read as TypeScript, and each control a person can change must carry help: a field component given a
// `help` prop, or a raw control (an input, switch, select, checkbox) with a `help` prop or an (i) next to it in
// the same row. Levers and rules are checked as data in lever-catalogue.test.ts and analysis-rules.test.ts.

const SRC = join(__dirname, "..", "src");

/** The screens that hold settings, as paths under src/ (directories are read recursively). */
const SETTINGS_SOURCES = ["app/w/[slug]/settings", "components/rules", "components/levers", "app/new-workspace-form.tsx", "app/settings"];

/** Components that draw a label, a control and (when given `help`) its (i). */
const FIELD_COMPONENTS = new Set(["TextField", "DateField", "NumberField", "SelectField", "ToggleField", "ChecklistField", "Field", "Setting"]);
/** Raw controls: each needs an (i) of its own. */
const CONTROLS = new Set(["MoneyBox", "Input", "Textarea", "Switch", "Select", "Checkbox", "Slider", "NativeSelect", "input", "textarea", "select"]);
/** Components that draw an (i) inside themselves (a rule's name carries its own). */
const HELP_BEARERS = new Set(["RuleName"]);
/** Controls that are not settings: hidden form fields, buttons, file pickers. */
const NOT_SETTINGS_TYPES = new Set(["hidden", "submit", "button", "file"]);

function files(path: string): string[] {
  const full = join(SRC, path);
  try {
    if (!statSync(full).isDirectory()) return [full];
  } catch {
    return [];
  }
  return readdirSync(full, { recursive: true, encoding: "utf8" })
    .map((f) => join(full, f))
    .filter((f) => f.endsWith(".tsx") && statSync(f).isFile());
}

const tagName = (n: ts.JsxOpeningLikeElement) => n.tagName.getText();
const attr = (n: ts.JsxOpeningLikeElement, name: string) =>
  n.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name);
const opening = (n: ts.Node): ts.JsxOpeningLikeElement | null =>
  ts.isJsxSelfClosingElement(n) ? n : ts.isJsxElement(n) ? n.openingElement : null;

/** Does `el` have an (i) among its children (a `<Help>`, or a component given help), one level down? */
function hasHelpChild(el: ts.JsxElement | ts.JsxFragment): boolean {
  const found = (n: ts.Node): boolean => {
    const o = opening(n);
    if (o && (tagName(o).startsWith("Help") || HELP_BEARERS.has(tagName(o)))) return true;
    // A fragment or a plain wrapper keeps its children in the same row.
    if (ts.isJsxFragment(n) || (ts.isJsxElement(n) && /^[a-z]/.test(tagName(n.openingElement)))) return n.children.some(found);
    return false;
  };
  return el.children.some(found);
}

function hasJsxAncestor(n: ts.Node): boolean {
  for (let p = n.parent; p; p = p.parent) if (ts.isJsxElement(p) || ts.isJsxFragment(p)) return true;
  return false;
}

function problems(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const where = (n: ts.Node) => `${relative(SRC, file)}:${source.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const visit = (n: ts.Node) => {
    const o = opening(n);
    if (o) {
      const name = tagName(o);
      if (FIELD_COMPONENTS.has(name) && !attr(o, "help")) out.push(`${where(n)}: <${name}> has no help`);
      if (CONTROLS.has(name) && !attr(o, "help")) {
        const type = attr(o, "type")?.initializer;
        const typeText = type && ts.isStringLiteral(type) ? type.text : "";
        if (!NOT_SETTINGS_TYPES.has(typeText)) {
          // An (i) beside it: one of its nearest JSX ancestors shows one in the same row.
          // A control at the very root of a component is that component's own internals: its callers are checked.
          let ok = !hasJsxAncestor(n);
          let p: ts.Node | undefined = n.parent;
          for (let levels = 0; p && levels < 4 && !ok; p = p.parent) {
            if (!ts.isJsxElement(p) && !ts.isJsxFragment(p)) continue;
            levels++;
            const po = ts.isJsxElement(p) ? p.openingElement : null;
            if (po && FIELD_COMPONENTS.has(tagName(po)) && attr(po, "help")) ok = true;
            else if (hasHelpChild(p)) ok = true;
          }
          if (!ok) out.push(`${where(n)}: <${name}> has no (i)`);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return out;
}

describe("every setting has an (i)", () => {
  const all = SETTINGS_SOURCES.flatMap(files);

  it("reads the settings screens", () => {
    expect(all.length).toBeGreaterThan(10);
  });

  it("finds no field or control on a settings screen without help", () => {
    expect(all.flatMap(problems)).toEqual([]);
  });
});
