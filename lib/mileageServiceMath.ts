/** Latest end odometer (km) from reportmileagedetail records (meters). */
export function currentOdometerKmFromRecords(records: { enddis?: number }[] | undefined): number | null {
  if (!records || records.length === 0) return null;
  const latest = records[records.length - 1];
  const end = Number(latest?.enddis);
  if (!Number.isFinite(end)) return null;
  return end / 1000;
}

/** True if `d` is the last calendar day of its month (in local date parts). */
export function isLastDayOfMonth(d: Date): boolean {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return next.getDate() === 1;
}
