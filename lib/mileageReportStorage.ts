import fs from 'fs';
import path from 'path';

/** Daily threshold reports (only written when at least one vehicle qualifies). */
export const MILEAGE_REPORT_DIR = path.join(process.cwd(), 'mileage_report');

/** End-of-month full-fleet snapshots. */
export const MILEAGE_OVERALL_REPORT_DIR = path.join(process.cwd(), 'mileage_overall_report');

export const MILEAGE_REPORT_RETENTION_DAYS = 365;

export function ensureMileageReportDir() {
  if (!fs.existsSync(MILEAGE_REPORT_DIR)) {
    fs.mkdirSync(MILEAGE_REPORT_DIR, { recursive: true });
  }
}

export function ensureMileageOverallReportDir() {
  if (!fs.existsSync(MILEAGE_OVERALL_REPORT_DIR)) {
    fs.mkdirSync(MILEAGE_OVERALL_REPORT_DIR, { recursive: true });
  }
}

function purgeDir(dir: string, filenamePrefix: string, maxAgeDays: number) {
  if (!fs.existsSync(dir)) return;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().startsWith(filenamePrefix.toLowerCase())) continue;
    if (!name.toLowerCase().endsWith('.xlsx')) continue;
    const full = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    try {
      if (stat.mtimeMs < cutoff) fs.unlinkSync(full);
    } catch {
      /* ignore */
    }
  }
}

export function purgeExpiredMileageReports(maxAgeDays = MILEAGE_REPORT_RETENTION_DAYS) {
  ensureMileageReportDir();
  ensureMileageOverallReportDir();
  purgeDir(MILEAGE_REPORT_DIR, 'mileage_alert_', maxAgeDays);
  purgeDir(MILEAGE_REPORT_DIR, 'mileage_daily_', maxAgeDays);
  purgeDir(MILEAGE_REPORT_DIR, 'mileage_4000km_', maxAgeDays);
  purgeDir(MILEAGE_OVERALL_REPORT_DIR, 'mileage_overall_', maxAgeDays);
}
