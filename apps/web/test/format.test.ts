import { describe, expect, it } from "vitest";
import { formatCurrency, formatDays, formatNumber, formatPercent, formatRange } from "@/lib/format";

describe("format", () => {
  it("rounds numbers to the requested precision", () => {
    expect(formatNumber(7.26)).toBe("7.3");
    expect(formatNumber(121, 0)).toBe("121");
    expect(formatNumber(1234.5, 0)).toBe("1,235");
  });

  it("formats shares as whole percentages", () => {
    expect(formatPercent(0.914)).toBe("91%");
  });

  it("converts working hours to working days", () => {
    expect(formatDays(40, 40)).toBe("5 d");
    expect(formatDays(223, 40)).toBe("28 d");
    expect(formatDays(12, 40)).toBe("1.5 d");
  });

  it("formats money, compacting large values", () => {
    expect(formatCurrency(3800, "GBP")).toBe("£3,800");
    expect(formatCurrency(27_360, "GBP")).toBe("£27.4k");
    expect(formatCurrency(1_250_000, "GBP")).toBe("£1.3m");
  });

  it("formats a range, collapsing when both ends round the same", () => {
    expect(formatRange({ mean: 7.2, p10: 5, p90: 10 }, (v) => formatNumber(v, 0))).toBe("range 5–10");
    expect(formatRange({ mean: 3, p10: 3, p90: 3 }, (v) => formatNumber(v, 0))).toBe("range 3");
  });
});
