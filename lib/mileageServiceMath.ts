/**
 * Matches dashboard MileageReport.tsx oil-change logic (serviceIntervals.oilChange = 5000).
 */

export const MILEAGE_OIL_INTERVAL_KM = 5000;

/**
 * Minimum km since virtual reference (floor(odo/5000)*5000) to include in daily alert export/email.
 * Dashboard segment length approaches 5000 from below; GPS odometer noise / float makes `>= 5000`
 * unreliable, so we treat >= 4999 km in-segment as "at full interval" (same intent as overdue line).
 */
export const MILEAGE_DAILY_ALERT_MIN_KM_SINCE_REFERENCE = 4999;

export interface OilServiceProgressKm {
  currentOdometerKm: number;
  lastServiceReferenceKm: number;
  distanceSinceReferenceKm: number;
  remainingKm: number;
  percentage: number;
}

/** Same as getServiceStatus('oilChange') in MileageReport.tsx */
export function computeOilChangeProgressKm(currentOdometerKm: number, intervalKm = MILEAGE_OIL_INTERVAL_KM): OilServiceProgressKm {
  const currentOdo = Number.isFinite(currentOdometerKm) ? currentOdometerKm : 0;
  const lastServiceReferenceKm = Math.floor(currentOdo / intervalKm) * intervalKm;
  const distanceSinceReferenceKm = currentOdo - lastServiceReferenceKm;
  const remainingKm = intervalKm - distanceSinceReferenceKm;
  const percentage = intervalKm > 0 ? (distanceSinceReferenceKm / intervalKm) * 100 : 0;
  return {
    currentOdometerKm: currentOdo,
    lastServiceReferenceKm,
    distanceSinceReferenceKm,
    remainingKm,
    percentage,
  };
}

export function qualifiesDailyMileageAlert(progress: OilServiceProgressKm): boolean {
  return progress.distanceSinceReferenceKm >= MILEAGE_DAILY_ALERT_MIN_KM_SINCE_REFERENCE;
}

/** Scheduled daily mileage export: 4000 km odometer blocks (not dashboard 5000 km oil UI). */
export const MILEAGE_SCHEDULED_DAILY_SEGMENT_KM = 4000;

/**
 * True when the vehicle has completed the current 4000 km odometer segment
 * (km into segment ≥ 3999, same noise margin as the 5000 km alert rule).
 */
export function isAt4000KmSegmentCompletion(currentOdometerKm: number): boolean {
  const p = computeOilChangeProgressKm(currentOdometerKm, MILEAGE_SCHEDULED_DAILY_SEGMENT_KM);
  return p.distanceSinceReferenceKm >= MILEAGE_SCHEDULED_DAILY_SEGMENT_KM - 1;
}

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
