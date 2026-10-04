import fs from 'fs';
import path from 'path';
import { MILEAGE_REPORT_DIR, ensureMileageReportDir } from '@/lib/mileageReportStorage';

/** Default daily/monthly mileage threshold. Existing reports were built at this value. */
export const DEFAULT_MILEAGE_THRESHOLD_KM = 4000;

const MIN_THRESHOLD_KM = 1;
const MAX_THRESHOLD_KM = 1_000_000;

const THRESHOLD_FILE = path.join(MILEAGE_REPORT_DIR, 'mileage-threshold.json');

export function readMileageThresholdKm(): number {
  try {
    const raw = fs.readFileSync(THRESHOLD_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { thresholdKm?: unknown };
    const value = Number(parsed.thresholdKm);
    if (Number.isFinite(value) && value >= MIN_THRESHOLD_KM && value <= MAX_THRESHOLD_KM) {
      return Math.round(value);
    }
  } catch {
    /* missing or unreadable file uses the default */
  }
  return DEFAULT_MILEAGE_THRESHOLD_KM;
}

export function writeMileageThresholdKm(thresholdKm: number): number {
  const value = Math.round(Number(thresholdKm));
  if (!Number.isFinite(value) || value < MIN_THRESHOLD_KM || value > MAX_THRESHOLD_KM) {
    throw new Error(`Threshold must be between ${MIN_THRESHOLD_KM} and ${MAX_THRESHOLD_KM} km`);
  }
  ensureMileageReportDir();
  fs.writeFileSync(
    THRESHOLD_FILE,
    JSON.stringify({ thresholdKm: value, updatedAt: new Date().toISOString() }, null, 2)
  );
  return value;
}
