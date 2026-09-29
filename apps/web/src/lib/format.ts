const WORKING_DAYS_PER_WEEK = 5;

export function formatNumber(value: number, digits = 1): string {
  return value.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function formatPercent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** Working hours to working days, given the workspace's hours per week. */
export function formatDays(hours: number, hoursPerWeek: number): string {
  const days = hours / (hoursPerWeek / WORKING_DAYS_PER_WEEK);
  return `${formatNumber(days, days < 10 ? 1 : 0)} d`;
}

export function formatHours(hours: number): string {
  return `${formatNumber(hours, 1)} h`;
}
