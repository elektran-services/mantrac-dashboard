import { listGeneratedReportFiles } from '@/lib/generatedReportsStorage';
import { listMileageReportFiles } from '@/lib/mileageReportStorage';
import { listOfflineReportFiles } from '@/lib/offlineReportStorage';
import { listParkingReportFiles } from '@/lib/parkingReportStorage';
import { listTripReportFiles } from '@/lib/tripsReportStorage';

export interface ReportBucketStats {
  count: number;
  /** Latest report day from filename when available (daily: YYYY-MM-DD, monthly: YYYY-MM-01). */
  latestReportDate: string | null;
}

export interface DashboardReportStats {
  overspeed: ReportBucketStats;
  trips: ReportBucketStats;
  mileageDaily: ReportBucketStats;
  mileageMonthly: ReportBucketStats;
  offline: ReportBucketStats;
  parking: ReportBucketStats;
  generatedAt: string;
}

function latestLex(dates: (string | null | undefined)[]): string | null {
  const xs = dates.filter((d): d is string => Boolean(d && String(d).trim()));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => (a >= b ? a : b));
}

/**
 * Snapshot counts of saved Excel reports (after retention purge rules for each folder).
 */
export function getDashboardReportStats(): DashboardReportStats {
  const overspeedFiles = listGeneratedReportFiles().filter((f) =>
    /^overspeed_daily_report_\d{4}-\d{2}-\d{2}\.xlsx$/i.test(f.filename)
  );

  const tripFiles = listTripReportFiles();
  const mileageDailyFiles = listMileageReportFiles('daily');
  const mileageMonthlyFiles = listMileageReportFiles('monthly');
  const offlineFiles = listOfflineReportFiles();
  const parkingFiles = listParkingReportFiles();

  return {
    overspeed: {
      count: overspeedFiles.length,
      latestReportDate: latestLex(overspeedFiles.map((f) => f.reportDate)),
    },
    trips: {
      count: tripFiles.length,
      latestReportDate: latestLex(tripFiles.map((f) => f.reportDate)),
    },
    mileageDaily: {
      count: mileageDailyFiles.length,
      latestReportDate: latestLex(mileageDailyFiles.map((f) => f.reportDate)),
    },
    mileageMonthly: {
      count: mileageMonthlyFiles.length,
      latestReportDate: latestLex(mileageMonthlyFiles.map((f) => f.reportDate)),
    },
    offline: {
      count: offlineFiles.length,
      latestReportDate: latestLex(offlineFiles.map((f) => f.reportDate)),
    },
    parking: {
      count: parkingFiles.length,
      latestReportDate: latestLex(parkingFiles.map((f) => f.reportDate)),
    },
    generatedAt: new Date().toISOString(),
  };
}
