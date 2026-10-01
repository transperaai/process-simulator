// The narration number check (issue #29; docs/PRD.md §7.3, decision D15): a
// language model may write "explain this run", but
// it may never state a figure the engine didn't produce. This module finds
// every number in a piece of text and matches each one against the figures
// the model was given. Pure and deterministic; the rules are recorded in
// docs/adr/0011-narration.md and tested in apps/web/test/narration-numbers.test.ts.
//
// In short:
// - A number is anything written with digits (with its sign, currency, scale
//   such as "k"/"m"/"thousand", and unit: %, percentage points, days, hours,
//   weeks), a spelled-out number from "two" upwards, or a date.
// - It matches a figure of a compatible kind: money only money, in the
//   run's currency; % only shares (0.94 is 94%); percentage points only
//   points; days also hours converted at the workspace's day length. Plain
//   counts, hours, days and weeks are otherwise interchangeable, because the
//   engine's own sentences write "falls by 9.7 days (range 1.2–18.2)".
// - It is that figure rounded at the precision it is written with, is no
//   more precise than the figure is known to (no "£4,213" from "£4.2k"), and
//   keeps two significant figures unless it is a whole unit (no "£4k" for
//   £4,213; "3 clients" for 3.4 is fine).
// - A signed number (+, −) must have the figure's sign; an unsigned one is
//   compared by size, because "falls by 9.7 days" states the sign in words.
// - Ranges ("£3.1–5.0k", "87–101%", "5 to 9 days") share their currency,
//   scale and unit across both ends, and each end is checked on its own.
// - Dates must be dates in the facts, and bare years those dates' years.
//   Percentile labels (P10/P50/P90, "10th–90th percentile") and digits inside
//   names the facts give (a scenario called "Hire 2 people") are not figures.
//   Multiples and fractions in words ("twice", "double", "half") and vague
//   number words ("hundreds", "a dozen") are refused: they state something
//   nobody computed.

export type NumberKind = "money" | "percent" | "points" | "days" | "hours" | "weeks" | "plain";

/** A figure the text may cite. `step` is the precision it is known to (0: exact). */
export interface Fact {
  key: string;
  kind: NumberKind;
  value: number;
  step: number;
}

/** A number found in text. `value` and `step` are in the units it is written in (£, %, days …). */
export interface NumberToken {
  text: string;
  index: number;
  kind: NumberKind;
  value: number;
  step: number;
  signed: boolean;
  currency: string | null;
}

export interface CheckContext {
  facts: readonly Fact[];
  /** ISO dates (YYYY-MM-DD) the text may mention. */
  dates: readonly string[];
  /** Names whose digits are part of the name, not figures. */
  names: readonly string[];
  /** The run's currency (ISO code). */
  currency: string;
  /** Working hours in a day (hours per week / 5), to read hours as days. */
  hoursPerDay: number;
  /** Lower-cased text the facts print: a ratio phrase that appears in it verbatim ("1 in 10") is not refused. */
  phrases?: readonly string[];
}

export interface CheckedNumber {
  text: string;
  kind: NumberKind | "date";
  /** The fact it matched. */
  matched: string;
}

export interface NumberProblem {
  text: string;
  reason: string;
}

export interface CheckResult {
  ok: boolean;
  numbers: CheckedNumber[];
  problems: NumberProblem[];
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const MONTH_RE = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DAY_MONTH_YEAR = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\b\\.?(?:,?\\s+(\\d{4}))?`, "gi");
const MONTH_DAY_YEAR = new RegExp(`\\b(${MONTH_RE})\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, "gi");
const MONTH_YEAR = new RegExp(`\\b(${MONTH_RE})\\b\\.?\\s+(\\d{4})\\b`, "gi");
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const SLASH_DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g;
const PERCENTILE = /\b(?:P(?:10|50|90)\b|(?:10|50|90)th(?:\s*(?:–|-|to)\s*(?:10|50|90)th)?\s+percentiles?\b)/gi;
const WEEK_NUMBER = /\b(?:week|wk)\s+(\d{1,3})\b/gi;
const QUARTER = /\b(?:Q[1-4]|H[12]|FY\s?\d{2,4})\b/g;
// Fractions and ratios in words or slashes ("a third", "three quarters of", "3/4", "one in ten", "1 in 10", "seven figures"):
// like "half" and "twice", they state a ratio nobody computed, and the digits or number words in them would otherwise
// pass for figures.
/** Slash phrases that are idioms, not fractions: "24/7" (always on) and "50/50" (an even split no run computed, and no figure is claimed). */
const IDIOMS = /^(?:24\s?\/\s?7|50\s?\/\s?50)$/;
const FRACTION_WORD =String.raw`(?:thirds?|fourths?|quarters?|fifths?|sixths?|sevenths?|eighths?|ninths?|tenths?)`;
const RATIOS = new RegExp(
  [
    // "a quarter of", "three thirds of": the "of" is what makes it a share ("Wins in a quarter" is a period, not a fraction).
    String.raw`\b(?:a|an|one|two|three|four|five|six|seven|eight|nine)[-\s]${FRACTION_WORD}\s+of\b`,
    String.raw`(?<![\d/.])\d{1,3}\s?/\s?\d{1,3}(?![\d/])`,
    String.raw`\b(?:one|two|three|four|five|1|2|3|4|5)\s+(?:in|out\s+of)\s+(?:\d[\d,]*|a\s+(?:hundred|thousand|million)|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand)\b`,
    String.raw`\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[-\s]figures?\b`,
  ].join("|"),
  "gi",
);
const MULTIPLES =/\b(?:twice|thrice|double[sd]?|doubling|triple[sd]?|tripling|quadruple[sd]?|halve[sd]?|halving|half|(?:two|three|four|five|ten)fold)\b/gi;

const SMALL: Record<string, number> = {
  zero: 0, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const UNITS_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const WORD_NUMBER = new RegExp(
  `\\b(?:(${Object.keys(TENS).join("|")})(?:[-\\s](${Object.keys(UNITS_WORDS).join("|")}))?|(${Object.keys(SMALL).join("|")})|(dozens?|hundreds?|thousands?|millions?|billions?))\\b`,
  "gi",
);

// One quantity: optional sign, currency, the number, a scale and a unit.
const CURRENCY = String.raw`(?:[A-Z]{1,2}\$|[£$€¥]|(?:GBP|USD|EUR|AUD|NZD|CAD|JPY)\s?)`;
const NUM = String.raw`(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)`;
const SCALE = String.raw`(?:\s?(?:bn|[kKmM])(?![A-Za-z])|\s(?:thousand|million|billion)\b)`;
const UNIT = String.raw`(?:\s?%|\s(?:percentage\s+points?|percent|per\s+cent)\b|\s?-?(?:pp|pts?|points?)\b|\s?-?(?:working\s+days?|days?|d)(?![A-Za-z])|\s?-?(?:hours?|hrs?|h)(?![A-Za-z])|\s?-?(?:weeks?|wks?)(?![A-Za-z]))`;
const QUANTITY_RE = new RegExp(String.raw`(?<sign>[+−-]\s?)?(?<cur>${CURRENCY})?(?<num>${NUM})(?<scale>${SCALE})?(?<unit>${UNIT})?`, "y");
const RANGE_SEP = /\s*(?:–|—|-|to|and)\s*/y;

/** What names, dates and labels are replaced with: not a digit, letter or sign. */
const BLANK = "§";

/** The printed currency symbol for an ISO code ("£" for GBP, "A$" for AUD). */
export function currencySymbol(code: string): string {
  try {
    const part = new Intl.NumberFormat("en-GB", { style: "currency", currency: code }).formatToParts(1).find((p) => p.type === "currency");
    return part?.value ?? code;
  } catch {
    return code;
  }
}

function currencyMatches(written: string, code: string): boolean {
  const w = written.trim();
  const symbol = currencySymbol(code);
  return w === symbol || w.toUpperCase() === code.toUpperCase() || (w === "$" && symbol.endsWith("$"));
}

function unitKind(unit: string | undefined): NumberKind | null {
  if (!unit) return null;
  const u = unit.trim().replace(/^-/, "").toLowerCase();
  if (u.startsWith("percentage") || u === "pp" || u.startsWith("pt") || u.startsWith("point")) return "points";
  if (u === "%" || u.startsWith("percent") || u.startsWith("per")) return "percent";
  if (u.startsWith("working") || u.startsWith("day") || u === "d") return "days";
  if (u.startsWith("hour") || u.startsWith("hr") || u === "h") return "hours";
  if (u.startsWith("week") || u.startsWith("wk")) return "weeks";
  return null;
}

function scaleFactor(scale: string | undefined): number {
  const s = scale?.trim().toLowerCase();
  if (s === "k" || s === "thousand") return 1e3;
  if (s === "m" || s === "million") return 1e6;
  if (s === "bn" || s === "billion") return 1e9;
  return 1;
}

interface RawQuantity {
  text: string;
  index: number;
  sign: string;
  currency: string | null;
  num: string;
  scale: string | undefined;
  unit: string | undefined;
}

function readQuantity(text: string, at: number): RawQuantity | null {
  QUANTITY_RE.lastIndex = at;
  const m = QUANTITY_RE.exec(text);
  if (!m?.groups) return null;
  return {
    text: m[0],
    index: at,
    sign: (m.groups.sign ?? "").trim(),
    currency: m.groups.cur?.trim() || null,
    num: m.groups.num!,
    scale: m.groups.scale,
    unit: m.groups.unit,
  };
}

function toToken(q: RawQuantity, shared: { scale?: string | undefined; unit?: string | undefined; currency?: string | null }): NumberToken {
  const scale = q.scale ?? shared.scale;
  const unit = q.unit ?? shared.unit;
  const currency = q.currency ?? shared.currency ?? null;
  const digits = q.num.replace(/,/g, "");
  const decimals = digits.includes(".") ? digits.split(".")[1]!.length : 0;
  const factor = scaleFactor(scale);
  const magnitude = Number(digits) * factor;
  const negative = q.sign === "-" || q.sign === "−";
  return {
    text: q.text.trim(),
    index: q.index,
    kind: currency ? "money" : (unitKind(unit) ?? "plain"),
    value: negative ? -magnitude : magnitude,
    step: 10 ** -decimals * factor,
    signed: q.sign !== "",
    currency,
  };
}

/** A sign may start a number only after a space, bracket or punctuation (after a digit or letter it's a range or a word). */
function signAllowed(text: string, at: number): boolean {
  const before = text[at - 1];
  return before === undefined || /[\s(\[“"'‘:;,/§]/.test(before);
}

/** Blank out `re`'s matches (keeping offsets), calling `each` for every one; `each` returning false keeps the match. */
function blank(text: string, re: RegExp, each?: (m: RegExpExecArray) => boolean | void): string {
  re.lastIndex = 0;
  let out = "";
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (each && each(m) === false) continue;
    out += text.slice(last, m.index) + BLANK.repeat(m[0].length);
    last = m.index + m[0].length;
  }
  return out + text.slice(last);
}

export interface Scan {
  tokens: NumberToken[];
  dates: { text: string; date: { y: number | null; m: number; d: number | null } }[];
  /** "week 6" (a week number) and quarters ("Q3"): periods the facts rarely name. */
  periods: { text: string; week: number | null }[];
  /** Multiples and fractions in words ("twice", "half"). */
  multiples: string[];
  /** Number words that name no exact value ("hundreds", "a dozen"). */
  words: string[];
}

/** Every number, date and number word in `input`. Names in `names` are removed first. */
export function scanNumbers(input: string, names: readonly string[] = [], phrases: readonly string[] = []): Scan {
  let text = input.replace(/[   ]/g, " ");
  for (const name of [...names].filter((n) => /\d/.test(n)).sort((a, b) => b.length - a.length)) {
    text = text.split(name).join(BLANK.repeat(name.length));
  }
  const dates: Scan["dates"] = [];
  const month = (s: string) => MONTHS[s.toLowerCase()]!;
  // "May" without a year is read as the verb ("the queue of 9 may grow").
  const isMay = (s: string) => s.toLowerCase() === "may";
  text = blank(text, ISO_DATE, (m) => void dates.push({ text: m[0], date: { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } }));
  text = blank(text, SLASH_DATE, (m) => {
    const y = Number(m[3]!.length === 2 ? `20${m[3]}` : m[3]);
    dates.push({ text: m[0], date: { y, m: Number(m[2]), d: Number(m[1]) } });
  });
  text = blank(text, DAY_MONTH_YEAR, (m) => {
    if (isMay(m[2]!) && !m[3]) return false;
    dates.push({ text: m[0], date: { y: m[3] ? Number(m[3]) : null, m: month(m[2]!), d: Number(m[1]) } });
  });
  text = blank(text, MONTH_DAY_YEAR, (m) => {
    if (isMay(m[1]!) && !m[3]) return false;
    dates.push({ text: m[0], date: { y: m[3] ? Number(m[3]) : null, m: month(m[1]!), d: Number(m[2]) } });
  });
  text = blank(text, MONTH_YEAR, (m) => void dates.push({ text: m[0], date: { y: Number(m[2]), m: month(m[1]!), d: null } }));
  text = blank(text, PERCENTILE);
  const periods: Scan["periods"] = [];
  text = blank(text, WEEK_NUMBER, (m) => void periods.push({ text: m[0], week: Number(m[1]) }));
  text = blank(text, QUARTER, (m) => void periods.push({ text: m[0], week: null }));
  const multiples: string[] = [];
  text = blank(text, RATIOS, (m) => {
    const said = m[0].toLowerCase().replace(/\s+/g, " ");
    // Idioms that are not fractions, and a ratio the facts themselves print (the engine's "add back about 1 in 10"), are not refused.
    if (IDIOMS.test(said) || phrases.some((p) => p.includes(said))) return;
    multiples.push(m[0]);
  });
  text = blank(text, MULTIPLES, (m) => void multiples.push(m[0]));

  const tokens: NumberToken[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    const isSign = ch === "+" || ch === "-" || ch === "−";
    const isCurrencyStart = /[£$€¥A-Z]/.test(ch);
    if (!(/\d/.test(ch) || isSign || isCurrencyStart || (ch === "." && /\d/.test(text[i + 1] ?? "")))) {
      i++;
      continue;
    }
    if ((isSign && !signAllowed(text, i)) || (/[A-Z]/.test(ch) && /[A-Za-z]/.test(text[i - 1] ?? ""))) {
      i++;
      continue;
    }
    const q = readQuantity(text, i);
    if (!q || (/[A-Z]/.test(ch) && !q.currency)) {
      i++;
      continue;
    }
    let end = i + q.text.length;
    // A range: "5–9", "£3.1–5.0k", "87 to 101%", "−£1,400 to £22.4k".
    RANGE_SEP.lastIndex = end;
    const sep = RANGE_SEP.exec(text);
    let second: RawQuantity | null = null;
    if (sep) {
      const next = readQuantity(text, end + sep[0].length);
      const word = sep[0].trim();
      if (next && (word !== "and" || next.unit || next.currency)) second = next;
    }
    if (second) {
      const dash = /[–—-]/.test(sep![0]);
      // "£3.1–5.0k": the scale on the right applies to the left, across a dash only, and not to "£900 to £1.2k".
      const left = toToken(q, { unit: second.unit, scale: dash && !(q.currency && second.currency) ? second.scale : undefined });
      const right = toToken(second, { currency: q.currency });
      tokens.push(left, right);
      end = second.index + second.text.length;
    } else {
      tokens.push(toToken(q, {}));
    }
    i = end;
  }
  // Spelled-out numbers ("three clients", "twenty-five"). "one" is left alone ("one more person").
  for (const t of tokens) text = text.slice(0, t.index) + BLANK.repeat(t.text.length) + text.slice(t.index + t.text.length);
  const words: string[] = [];
  WORD_NUMBER.lastIndex = 0;
  for (let m = WORD_NUMBER.exec(text); m; m = WORD_NUMBER.exec(text)) {
    if (m[4]) {
      words.push(m[0]);
      continue;
    }
    const value = m[1] ? TENS[m[1].toLowerCase()]! + (m[2] ? UNITS_WORDS[m[2].toLowerCase()]! : 0) : SMALL[m[3]!.toLowerCase()]!;
    tokens.push({ text: m[0], index: m.index, kind: "plain", value, step: 1, signed: false, currency: null });
  }
  tokens.sort((a, b) => a.index - b.index);
  return { tokens, dates, periods, multiples, words };
}

const LOOSE: readonly NumberKind[] = ["plain", "hours", "days", "weeks"];

/** Facts a number of `kind` may be compared with, in that kind's units. */
function candidates(kind: NumberKind, ctx: CheckContext): Fact[] {
  const out: Fact[] = [];
  for (const f of ctx.facts) {
    if (f.kind === kind) out.push(f);
    else if (kind === "days" && f.kind === "hours") out.push({ ...f, key: `${f.key} (in days)`, value: f.value / ctx.hoursPerDay, step: f.step / ctx.hoursPerDay });
    else if (LOOSE.includes(kind) && LOOSE.includes(f.kind)) out.push(f);
  }
  return out;
}

const EPS = 1e-9;

/** Whether `t` states `f` under the rounding rules above (same units). */
export function matchesFact(t: NumberToken, f: Fact): boolean {
  if (t.signed && t.value !== 0 && f.value !== 0 && Math.sign(t.value) !== Math.sign(f.value)) return false;
  const v = t.signed ? t.value : Math.abs(t.value);
  const target = t.signed ? f.value : Math.abs(f.value);
  const tol = t.step / 2 + f.step / 2 + EPS * Math.max(1, Math.abs(target));
  if (Math.abs(v - target) > tol) return false;
  // No invented precision: not finer than the figure is known to.
  if (f.step > 0 && t.step < f.step * (1 - 1e-6)) return false;
  // Not so coarse that it says little ("£4k" for £4,213); whole units always pass.
  if (t.step > Math.max(1, Math.abs(target) / 10) * (1 + 1e-6)) return false;
  return true;
}

function dateAllowed(d: { y: number | null; m: number; d: number | null }, allowed: readonly string[]): boolean {
  return allowed.some((iso) => {
    const [y, m, day] = iso.split("-").map(Number);
    return m === d.m && (d.d === null || d.d === day) && (d.y === null || d.y === y);
  });
}

const KIND_WORDS: Record<NumberKind, string> = {
  money: "sum of money",
  percent: "percentage",
  points: "change in percentage points",
  days: "number of days",
  hours: "number of hours",
  weeks: "number of weeks",
  plain: "number",
};

/** Check every number in `text` against the context's facts. */
export function checkNumbers(text: string, ctx: CheckContext): CheckResult {
  const scan = scanNumbers(text, ctx.names, ctx.phrases);
  const numbers: CheckedNumber[] = [];
  const problems: NumberProblem[] = [];
  const years = new Set(ctx.dates.map((d) => Number(d.slice(0, 4))));

  for (const d of scan.dates) {
    if (dateAllowed(d.date, ctx.dates)) numbers.push({ text: d.text, kind: "date", matched: "date" });
    else problems.push({ text: d.text, reason: "a date that isn't in the facts" });
  }
  const weeks = ctx.facts.filter((f) => f.kind === "weeks").map((f) => f.value);
  for (const p of scan.periods) {
    if (p.week !== null && weeks.includes(p.week)) numbers.push({ text: p.text, kind: "weeks", matched: "weeks" });
    else problems.push({ text: p.text, reason: p.week === null ? "a quarter or year the facts don't name" : "a week number the facts don't give" });
  }
  for (const w of scan.multiples) problems.push({ text: w, reason: "a multiple or fraction in words, a ratio nobody computed" });
  for (const w of scan.words) problems.push({ text: w, reason: "a vague number in words; use a figure from the facts" });

  for (const t of scan.tokens) {
    if (t.kind === "money" && t.currency && !currencyMatches(t.currency, ctx.currency)) {
      problems.push({ text: t.text, reason: `the wrong currency (the figures are in ${ctx.currency})` });
      continue;
    }
    if (t.kind === "plain" && !t.signed && t.step === 1 && years.has(t.value)) {
      numbers.push({ text: t.text, kind: "plain", matched: "date.year" });
      continue;
    }
    const hit = candidates(t.kind, ctx).find((f) => matchesFact(t, f));
    if (hit) {
      numbers.push({ text: t.text, kind: t.kind, matched: hit.key });
      continue;
    }
    const other = (["money", "percent", "points", "days", "plain"] as const).find(
      (k) => !(LOOSE.includes(k) && LOOSE.includes(t.kind)) && k !== t.kind && candidates(k, ctx).some((f) => matchesFact({ ...t, kind: k }, f)),
    );
    problems.push({
      text: t.text,
      reason: other ? `not a ${KIND_WORDS[t.kind]} in the facts (the facts have it as a ${KIND_WORDS[other]})` : "not in the facts at the precision written",
    });
  }
  return { ok: problems.length === 0, numbers, problems };
}

/** Facts read from text the engine wrote (templates, verdicts, formatted figures), known to the precision printed. */
export function factsFromText(key: string, text: string, names: readonly string[] = []): { facts: Fact[]; dates: string[] } {
  const scan = scanNumbers(text, names);
  const facts = scan.tokens.map((t) => ({ key: `${key}: “${t.text}”`, kind: t.kind, value: t.value, step: t.step }));
  const dates = scan.dates
    .filter((d) => d.date.y !== null && d.date.d !== null)
    .map((d) => `${d.date.y}-${String(d.date.m).padStart(2, "0")}-${String(d.date.d).padStart(2, "0")}`);
  return { facts, dates };
}
