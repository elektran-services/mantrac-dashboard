import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import path from 'path';
import { buildGPS51Url } from '@/lib/config';
import {
  computeOilChangeProgressKm,
  currentOdometerKmFromRecords,
  isLastDayOfMonth,
  isAt4000KmSegmentCompletion,
  MILEAGE_SCHEDULED_DAILY_SEGMENT_KM,
} from '@/lib/mileageServiceMath';
import {
  MILEAGE_REPORT_DIR,
  MILEAGE_OVERALL_REPORT_DIR,
  ensureMileageReportDir,
  ensureMileageOverallReportDir,
  purgeExpiredMileageReports,
} from '@/lib/mileageReportStorage';
import { sendMileageExcelEmail } from '@/lib/mileageReportEmail';

const RATE_LIMIT_DELAY_MS = 7500;
const MILEAGE_API_TIMEOUT_MS = 45000;
const MILEAGE_LOOKBACK_DAYS = 400;

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 2,
  timeout = 15000,
  silent = true
) {
  const maxAttempts = retries + 1;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(tid);
      return response;
    } catch (e) {
      if (i === maxAttempts - 1) throw e;
      await new Promise((r) => setTimeout(r, Math.pow(2, i) * 1000));
    }
  }
  throw new Error('fetchWithRetry failed');
}

function toYmdLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysToYmd(ymd: string, deltaDays: number) {
  const [y, mo, da] = ymd.split('-').map(Number);
  const dt = new Date(y, mo - 1, da);
  dt.setDate(dt.getDate() + deltaDays);
  return toYmdLocal(dt);
}

function isTokenExpiredPayload(data: { cause?: string } | null) {
  if (!data) return false;
  const cause = data.cause || '';
  return (
    cause.includes('token_expire') ||
    cause.includes('global_error_token_expire') ||
    cause === 'please login'
  );
}

type DeviceRow = { deviceid: string; name: string };

type MileageSnapshotRow = {
  deviceid: string;
  devicename: string;
  currentOdometerKm: string;
  threshold: string;
  kmPastThreshold: string;
  remainingToThreshold: string;
  lastStatisticsDay: string;
  notes: string;
};

const MAINTENANCE_THRESHOLD_KM = MILEAGE_SCHEDULED_DAILY_SEGMENT_KM;
const ALMOST_DUE_BUFFER_KM = 500;

type MaintenanceStatus = 'good' | 'almost' | 'due';

function evaluateMaintenance(currentOdoKm: number | null) {
  if (currentOdoKm == null || !Number.isFinite(currentOdoKm)) {
    return {
      status: 'good' as MaintenanceStatus,
      thresholdKm: MAINTENANCE_THRESHOLD_KM,
      kmPastThreshold: 0,
      remainingToThreshold: MAINTENANCE_THRESHOLD_KM,
      note: 'Good',
    };
  }

  const remaining = MAINTENANCE_THRESHOLD_KM - currentOdoKm;
  const past = Math.max(0, currentOdoKm - MAINTENANCE_THRESHOLD_KM);
  if (remaining <= 0) {
    return {
      status: 'due' as MaintenanceStatus,
      thresholdKm: MAINTENANCE_THRESHOLD_KM,
      kmPastThreshold: past,
      remainingToThreshold: remaining,
      note: past > 0 ? `Overdue for maintenance by ${past.toFixed(0)} km` : 'Due for maintenance',
    };
  }
  if (remaining <= ALMOST_DUE_BUFFER_KM) {
    return {
      status: 'almost' as MaintenanceStatus,
      thresholdKm: MAINTENANCE_THRESHOLD_KM,
      kmPastThreshold: 0,
      remainingToThreshold: remaining,
      note: 'Almost due for maintenance',
    };
  }
  return {
    status: 'good' as MaintenanceStatus,
    thresholdKm: MAINTENANCE_THRESHOLD_KM,
    kmPastThreshold: 0,
    remainingToThreshold: remaining,
    note: 'Good',
  };
}

function applySheetStyling(
  ws: ExcelJS.Worksheet,
  title: string,
  summary: string,
  lastCol: string,
  headerLabels: string[],
  columnDefs: { key: string; width: number }[],
  data: Record<string, string>[],
  rowStatusResolver?: (row: Record<string, string>) => MaintenanceStatus
) {
  ws.mergeCells(`A1:${lastCol}1`);
  const t = ws.getCell('A1');
  t.value = title;
  t.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 25;

  ws.mergeCells(`A2:${lastCol}2`);
  const s = ws.getCell('A2');
  s.value = summary;
  s.font = { italic: true, size: 10 };
  s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } };
  s.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 20;

  ws.columns = columnDefs as ExcelJS.Column[];

  const hr = ws.getRow(3);
  headerLabels.forEach((label, i) => {
    hr.getCell(i + 1).value = label;
  });
  hr.font = { bold: true };
  hr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC107' } };

  const notesColIdx = columnDefs.findIndex((c) => c.key === 'notes') + 1;
  data.forEach((row) => {
    const r = ws.addRow(row);
    if (!rowStatusResolver || notesColIdx <= 0) return;
    const status = rowStatusResolver(row);
    const notesCell = r.getCell(notesColIdx);
    if (status === 'due') {
      notesCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD32F2F' } };
      notesCell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    } else if (status === 'almost') {
      notesCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB3B' } };
      notesCell.font = { color: { argb: 'FF000000' }, bold: true };
    } else if (status === 'good') {
      notesCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
      notesCell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    }
  });
}

/**
 * POST /api/mileage-scheduled
 * Body: { token, username, mode: 'daily' | 'monthly', reportDate?, forceMonthly?: boolean }
 * - daily: vehicles that completed the current 4000 km odometer segment → mileage_report/ + email (no reference columns in sheet).
 * - monthly: only on last calendar day of month unless forceMonthly=true; full rows with 4000 km segment columns + email.
 */
export async function POST(request: NextRequest) {
  try {
    let body: {
      token?: string;
      username?: string;
      mode?: string;
      reportDate?: string;
      forceMonthly?: boolean;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { status: -1, cause: 'Invalid JSON body', error: 'INVALID_BODY' },
        { status: 400 }
      );
    }

    const { token, username } = body;
    const mode = body.mode === 'monthly' ? 'monthly' : body.mode === 'daily' ? 'daily' : '';
    if (!token || !username) {
      return NextResponse.json(
        { status: -1, cause: 'Token and username are required', error: 'MISSING_CREDENTIALS' },
        { status: 401 }
      );
    }
    if (mode !== 'daily' && mode !== 'monthly') {
      return NextResponse.json(
        { status: -1, cause: 'mode must be daily or monthly', error: 'INVALID_MODE' },
        { status: 400 }
      );
    }

    const reportDate = body.reportDate ? new Date(body.reportDate) : new Date();
    const asOfYmd = toYmdLocal(reportDate);
    const startday = addDaysToYmd(asOfYmd, -MILEAGE_LOOKBACK_DAYS);
    const endday = asOfYmd;

    if (mode === 'monthly' && !isLastDayOfMonth(reportDate) && !body.forceMonthly) {
      return NextResponse.json(
        {
          status: -1,
          cause: 'Monthly job runs only on the last calendar day of the month (or set forceMonthly: true).',
          error: 'NOT_LAST_DAY_OF_MONTH',
        },
        { status: 400 }
      );
    }

    const devicesUrl = buildGPS51Url('querymonitorlist', token);
    let devicesResponse: Response;
    try {
      devicesResponse = await fetchWithRetry(
        devicesUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username }),
        },
        3,
        20000,
        false
      );
    } catch (e) {
      return NextResponse.json(
        {
          status: -1,
          cause: 'Failed to connect to GPS51',
          error: 'NETWORK_ERROR',
          details: e instanceof Error ? e.message : String(e),
        },
        { status: 503 }
      );
    }

    const devicesData = await devicesResponse.json();
    if (isTokenExpiredPayload(devicesData)) {
      return NextResponse.json(
        { status: -1, cause: devicesData.cause || 'Token expired', error: 'TOKEN_EXPIRED' },
        { status: 401 }
      );
    }
    if (devicesData.status !== 0 || !devicesData.groups) {
      return NextResponse.json(
        {
          status: -1,
          cause: devicesData.cause || 'Failed to load devices',
          error: 'DEVICE_FETCH_ERROR',
        },
        { status: 400 }
      );
    }

    const allDevices: DeviceRow[] = devicesData.groups.flatMap(
      (group: { devices?: { deviceid: string; devicename?: string }[] }) =>
        (group.devices || []).map((d: { deviceid: string; devicename?: string }) => ({
          deviceid: d.deviceid,
          name: d.devicename || d.deviceid,
        }))
    );

    const mileageUrl = buildGPS51Url('reportmileagedetail', token);
    const jobStartMs = Date.now();
    const rows: MileageSnapshotRow[] = [];
    let processed = 0;
    let mileageErrors = 0;
    console.log(
      `[MileageScheduled] Starting mode=${mode} asOf=${asOfYmd} devices=${allDevices.length} window=${startday}->${endday}`
    );

    for (const dev of allDevices) {
      processed++;
      if (processed > 1) {
        await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
      }

      let notes = '';
      let currentOdoKm: number | null = null;
      let lastStatsDay = '';
      let recordCount = 0;

      try {
        const res = await fetchWithRetry(
          mileageUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              deviceid: dev.deviceid,
              startday,
              endday,
              offset: 8,
            }),
          },
          0,
          MILEAGE_API_TIMEOUT_MS,
          true
        );
        const data = await res.json();
        if (isTokenExpiredPayload(data)) {
          return NextResponse.json(
            { status: -1, cause: data.cause || 'Token expired', error: 'TOKEN_EXPIRED' },
            { status: 401 }
          );
        }
        if (data.status !== 0 || !Array.isArray(data.records)) {
          notes = data.cause || `status ${data.status}`;
          mileageErrors++;
        } else {
          recordCount = data.records.length;
          currentOdoKm = currentOdometerKmFromRecords(data.records);
          const latest = data.records.length > 0 ? data.records[data.records.length - 1] : null;
          lastStatsDay = latest?.statisticsday ? String(latest.statisticsday) : '';
          if (currentOdoKm == null) {
            notes = notes || 'No odometer (enddis) in records';
            mileageErrors++;
          }
        }
      } catch {
        notes = 'Request failed';
        mileageErrors++;
      }

      const maintenance = evaluateMaintenance(currentOdoKm);

      rows.push({
        deviceid: dev.deviceid,
        devicename: dev.name,
        currentOdometerKm: currentOdoKm != null ? currentOdoKm.toFixed(2) : '',
        threshold: maintenance.thresholdKm.toFixed(0),
        kmPastThreshold: maintenance.kmPastThreshold.toFixed(2),
        remainingToThreshold: maintenance.remainingToThreshold.toFixed(2),
        lastStatisticsDay: lastStatsDay,
        notes: notes || maintenance.note,
      });

      const elapsedSec = ((Date.now() - jobStartMs) / 1000).toFixed(1);
      console.log(
        `[MileageScheduled] Progress mode=${mode} ${processed}/${allDevices.length} (${Math.round(
          (processed / Math.max(1, allDevices.length)) * 100
        )}%) device=${dev.deviceid} errors=${mileageErrors} elapsed=${elapsedSec}s`
      );
    }

    const columnDefsMonthly: { key: keyof MileageSnapshotRow; width: number }[] = [
      { key: 'deviceid', width: 18 },
      { key: 'devicename', width: 24 },
      { key: 'currentOdometerKm', width: 16 },
      { key: 'threshold', width: 12 },
      { key: 'kmPastThreshold', width: 18 },
      { key: 'remainingToThreshold', width: 20 },
      { key: 'lastStatisticsDay', width: 16 },
      { key: 'notes', width: 36 },
    ];
    const headerLabelsMonthly = [
      'Device ID',
      'Device name',
      `Current odometer (km, enddis)`,
      'Threshold',
      'Km past threshold',
      'Remaining to threshold',
      'Last statistics day',
      'Notes',
    ];
    const lastColMonthly = 'I';

    /** Daily export: qualifying vehicles only; odometer columns only (no reference columns). */
    const columnDefsDaily: { key: keyof Pick<
      MileageSnapshotRow,
      'deviceid' | 'devicename' | 'currentOdometerKm' | 'threshold' | 'remainingToThreshold' | 'notes'
    >; width: number }[] = [
      { key: 'deviceid', width: 18 },
      { key: 'devicename', width: 24 },
      { key: 'currentOdometerKm', width: 16 },
      { key: 'threshold', width: 12 },
      { key: 'remainingToThreshold', width: 20 },
      { key: 'notes', width: 40 },
    ];
    const headerLabelsDaily = [
      'Device ID',
      'Device name',
      'Current odometer (km, from enddis)',
      'Threshold',
      'Remaining to threshold',
      'Notes',
    ];
    const lastColDaily = 'F';

    if (mode === 'daily') {
      const qualifying = rows.filter((r) => {
        const odo = parseFloat(r.currentOdometerKm);
        if (!Number.isFinite(odo)) return false;
        return odo >= MAINTENANCE_THRESHOLD_KM;
      });

      if (qualifying.length === 0) {
        return NextResponse.json({
          status: 0,
          cause: 'OK',
          mode: 'daily',
          message: `No vehicles completed the current ${MILEAGE_SCHEDULED_DAILY_SEGMENT_KM} km odometer segment; no file or email.`,
          asOfYmd,
          deviceCount: allDevices.length,
          qualifyingCount: 0,
          mileageErrors,
        });
      }

      const dailyRows: Record<string, string>[] = qualifying.map((r) => ({
        deviceid: r.deviceid,
        devicename: r.devicename,
        currentOdometerKm: r.currentOdometerKm,
        threshold: r.threshold,
        remainingToThreshold: r.remainingToThreshold,
        notes: r.notes,
      }));

      ensureMileageReportDir();
      purgeExpiredMileageReports();

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('≥4000 km segment');
      const title = `Vehicles at ≥${MILEAGE_SCHEDULED_DAILY_SEGMENT_KM} km in current odometer segment — ${asOfYmd}`;
      const summary = `Listed: ${qualifying.length} of ${allDevices.length} (completed current ${MILEAGE_SCHEDULED_DAILY_SEGMENT_KM} km block; odometer = latest enddis/1000) | API errors: ${mileageErrors} | Window: ${startday} → ${endday}`;
      applySheetStyling(
        ws,
        title,
        summary,
        lastColDaily,
        headerLabelsDaily,
        columnDefsDaily,
        dailyRows,
        (row) => {
          const remaining = parseFloat(row.remainingToThreshold || '');
          if (Number.isFinite(remaining) && remaining <= 0) return 'due';
          if (Number.isFinite(remaining) && remaining <= ALMOST_DUE_BUFFER_KM) return 'almost';
          return 'good';
        }
      );

      const filename = `mileage_4000km_${asOfYmd}.xlsx`;
      const excelPath = path.join(MILEAGE_REPORT_DIR, filename);
      await wb.xlsx.writeFile(excelPath);

      const emailed = await sendMileageExcelEmail({
        subject: `📊 Mileage (≥${MILEAGE_SCHEDULED_DAILY_SEGMENT_KM} km segment) — ${asOfYmd} (${qualifying.length} vehicle(s))`,
        html: `<p><strong>${qualifying.length}</strong> vehicle(s) completed the current <strong>${MILEAGE_SCHEDULED_DAILY_SEGMENT_KM} km</strong> odometer segment (see attached Excel).</p>
          <p>As-of: <strong>${asOfYmd}</strong>. Odometer from latest GPS51 <code>enddis</code> in the lookback window.</p>`,
        attachmentPath: excelPath,
        attachmentFilename: filename,
      }).catch((err) => {
        console.error('[MileageScheduled] Email failed:', err);
        return false;
      });

      console.log(
        `[MileageScheduled] Done mode=daily asOf=${asOfYmd} qualifying=${qualifying.length}/${allDevices.length} errors=${mileageErrors} file=${filename} emailSent=${emailed}`
      );
      return NextResponse.json({
        status: 0,
        cause: 'OK',
        mode: 'daily',
        reportFile: filename,
        reportPath: excelPath,
        asOfYmd,
        deviceCount: allDevices.length,
        qualifyingCount: qualifying.length,
        mileageErrors,
        emailSent: emailed,
      });
    }

    // monthly
    ensureMileageOverallReportDir();
    purgeExpiredMileageReports();

    const ym = `${reportDate.getFullYear()}-${String(reportDate.getMonth() + 1).padStart(2, '0')}`;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Fleet mileage');
    const title = `Mileage overall — ${ym}`;
    const summary = `All devices: ${allDevices.length} | Mileage API errors: ${mileageErrors} | Window: ${startday} → ${endday} | Generated ${new Date().toISOString()}`;
    applySheetStyling(
      ws,
      title,
      summary,
      lastColMonthly,
      headerLabelsMonthly,
      columnDefsMonthly,
      rows,
      (row) => {
        const remaining = parseFloat(row.remainingToThreshold || '');
        if (Number.isFinite(remaining) && remaining <= 0) return 'due';
        if (Number.isFinite(remaining) && remaining <= ALMOST_DUE_BUFFER_KM) return 'almost';
        return 'good';
      }
    );

    const filename = `mileage_overall_${ym}.xlsx`;
    const excelPath = path.join(MILEAGE_OVERALL_REPORT_DIR, filename);
    await wb.xlsx.writeFile(excelPath);

    const emailed = await sendMileageExcelEmail({
      subject: `📊 Monthly mileage snapshot — ${ym}`,
      html: `<p>End-of-month mileage snapshot for <strong>${ym}</strong> (${allDevices.length} device(s)).</p>
        <p>Reference odometer uses a virtual ${MILEAGE_SCHEDULED_DAILY_SEGMENT_KM} km interval for the scheduled mileage report.</p>
        <p>Data window: ${startday} → ${endday}.</p>`,
      attachmentPath: excelPath,
      attachmentFilename: filename,
    }).catch((err) => {
      console.error('[MileageScheduled] Email failed:', err);
      return false;
    });

    console.log(
      `[MileageScheduled] Done mode=monthly month=${ym} devices=${allDevices.length} errors=${mileageErrors} file=${filename} emailSent=${emailed}`
    );
    return NextResponse.json({
      status: 0,
      cause: 'OK',
      mode: 'monthly',
      reportFile: filename,
      reportPath: excelPath,
      month: ym,
      deviceCount: allDevices.length,
      mileageErrors,
      emailSent: emailed,
    });
  } catch (error) {
    console.error('[MileageScheduled]', error);
    return NextResponse.json(
      {
        status: -1,
        cause: error instanceof Error ? error.message : 'Internal server error',
        error: 'UNKNOWN_ERROR',
      },
      { status: 500 }
    );
  }
}
