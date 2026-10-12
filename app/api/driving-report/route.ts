import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { listTripReportFiles, tripsDailyXlsxPath } from '@/lib/tripsReportStorage';

const MAX_RANGE_DAYS = 31;

type DeviceOption = { deviceid: string; name: string };
let deviceCache: { key: string; devices: DeviceOption[]; earliestReportDate: string | null; latestReportDate: string | null } | null = null;

function extractToken(request: NextRequest, body?: Record<string, unknown>): string | null {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  const fromBody = body?.token;
  if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody;
  return null;
}

function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value && 'text' in value) {
    return String((value as { text: unknown }).text ?? '').trim();
  }
  if (typeof value === 'object' && value && 'result' in value) {
    return cellText((value as { result: unknown }).result);
  }
  return String(value).trim();
}

/** Saved trip times are en-US locale strings from the daily export, e.g. 5/2/2026, 8:10:43 AM. */
function parseSavedDateTime(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/i);
  if (!match) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  let hour = Number(match[4]);
  const ampm = match[7].toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  return new Date(
    Number(match[3]),
    Number(match[1]) - 1,
    Number(match[2]),
    hour,
    Number(match[5]),
    Number(match[6])
  ).getTime();
}

function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return out;
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, '0');
    const day = String(cursor.getDate()).padStart(2, '0');
    out.push(`${year}-${month}-${day}`);
  }
  return out;
}

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export interface SavedDrive {
  deviceid: string;
  devicename: string;
  startMs: number;
  endMs: number;
  durationMin: number;
  distanceKm: number;
  startMileageKm: number | null;
  endMileageKm: number | null;
  maxSpeedKmh: number;
  avgSpeedKmh: number;
  startAddress: string;
  endAddress: string;
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
  reportDate: string;
}

function headerIndex(headers: string[], labels: string[]): number {
  return headers.findIndex((header) => labels.some((label) => header.includes(label)));
}

function numOrNull(value: string): number | null {
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function readTripFile(dateStr: string): Promise<SavedDrive[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(tripsDailyXlsxPath(dateStr));
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  let headerRow = 0;
  const headers: string[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (headerRow || rowNumber > 8) return;
    const values: string[] = [];
    for (let col = 1; col <= 20; col++) values.push(cellText(row.getCell(col).value).toLowerCase());
    if (values.some((value) => value === 'device id' || value.startsWith('device id'))) {
      headerRow = rowNumber;
      headers.push(...values);
    }
  });
  if (!headerRow) return [];

  const idCol = headerIndex(headers, ['device id']);
  const nameCol = headerIndex(headers, ['device name']);
  const startCol = headerIndex(headers, ['start time']);
  const endCol = headerIndex(headers, ['end time']);
  const maxCol = headerIndex(headers, ['max speed']);
  const avgCol = headerIndex(headers, ['avg speed']);
  const distanceCol = headerIndex(headers, ['distance']);
  const durationCol = headerIndex(headers, ['trip time']);
  const startMileageCol = headerIndex(headers, ['start mileage']);
  const endMileageCol = headerIndex(headers, ['end mileage']);
  const slatCol = headerIndex(headers, ['start lat']);
  const slonCol = headerIndex(headers, ['start lon']);
  const elatCol = headerIndex(headers, ['end lat']);
  const elonCol = headerIndex(headers, ['end lon']);
  const startAddrCol = headerIndex(headers, ['start address']);
  const endAddrCol = headerIndex(headers, ['end address']);
  const cell = (row: ExcelJS.Row, col: number) => (col >= 0 ? cellText(row.getCell(col + 1).value) : '');

  const drives: SavedDrive[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return;
    const deviceid = cell(row, idCol);
    if (!deviceid || deviceid === 'Device ID') return;
    const startMs = parseSavedDateTime(cell(row, startCol));
    const endMs = parseSavedDateTime(cell(row, endCol));
    if (startMs == null || endMs == null) return;
    drives.push({
      deviceid,
      devicename: cell(row, nameCol) || deviceid,
      startMs,
      endMs,
      durationMin: Number(cell(row, durationCol)) || 0,
      distanceKm: Number(cell(row, distanceCol)) || 0,
      startMileageKm: numOrNull(cell(row, startMileageCol)),
      endMileageKm: numOrNull(cell(row, endMileageCol)),
      maxSpeedKmh: Number(cell(row, maxCol)) || 0,
      avgSpeedKmh: Number(cell(row, avgCol)) || 0,
      startAddress: cell(row, startAddrCol),
      endAddress: cell(row, endAddrCol),
      startLat: numOrNull(cell(row, slatCol)),
      startLon: numOrNull(cell(row, slonCol)),
      endLat: numOrNull(cell(row, elatCol)),
      endLon: numOrNull(cell(row, elonCol)),
      reportDate: dateStr,
    });
  });
  return drives;
}

/**
 * POST /api/driving-report
 * Reads trips/trips_daily_report_YYYY-MM-DD.xlsx only. Does not call GPS51.
 * Body: { token?, mode: "devices" | "report", from?, to?, query?, startTime?, endTime? }
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const token = extractToken(request, body);
  if (!token || token.length < 8) {
    return NextResponse.json({ status: -1, cause: 'Token required', error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const files = listTripReportFiles().filter((file) => file.reportDate);
  const savedDates = files.map((file) => file.reportDate as string).sort();
  const earliestReportDate = savedDates[0] ?? null;
  const latestReportDate = savedDates[savedDates.length - 1] ?? null;

  const mode = body.mode === 'report' ? 'report' : 'devices';
  const from = typeof body.from === 'string' ? body.from.trim() : '';
  const to = typeof body.to === 'string' ? body.to.trim() : '';

  if (mode === 'devices') {
    const cacheKey = files.map((file) => `${file.filename}:${file.modifiedAt}`).join('|');
    let devices = deviceCache?.key === cacheKey ? deviceCache.devices : null;
    if (!devices) {
      const deviceMap = new Map<string, string>();
      for (const dateStr of savedDates) {
        const drives = await readTripFile(dateStr);
        for (const drive of drives) {
          if (!deviceMap.has(drive.deviceid)) deviceMap.set(drive.deviceid, drive.devicename);
        }
      }
      devices = Array.from(deviceMap, ([deviceid, name]) => ({ deviceid, name })).sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      deviceCache = {
        key: cacheKey,
        devices,
        earliestReportDate,
        latestReportDate,
      };
    }
    return NextResponse.json({
      status: 0,
      cause: 'OK',
      source: 'saved-trips',
      earliestReportDate,
      latestReportDate,
      fileCount: savedDates.length,
      devices,
    });
  }

  if (!from || !to || !isYmd(from) || !isYmd(to) || from > to) {
    return NextResponse.json(
      { status: -1, cause: 'A valid from and to date (YYYY-MM-DD) is required', error: 'INVALID_RANGE' },
      { status: 400 }
    );
  }

  const dates = eachDate(from, to);
  if (dates.length === 0 || dates.length > MAX_RANGE_DAYS) {
    return NextResponse.json(
      {
        status: -1,
        cause: `Date range must be 1 to ${MAX_RANGE_DAYS} days`,
        error: 'RANGE_TOO_WIDE',
      },
      { status: 400 }
    );
  }

  const query = typeof body.query === 'string' ? body.query.trim().toLowerCase() : '';
  if (query && query.length < 2) {
    return NextResponse.json(
      { status: -1, cause: 'Enter at least 2 characters of an IMEI or device name', error: 'QUERY_TOO_SHORT' },
      { status: 400 }
    );
  }

  const startTime = typeof body.startTime === 'string' && body.startTime ? body.startTime : '00:00';
  const endTime = typeof body.endTime === 'string' && body.endTime ? body.endTime : '23:59';
  const windowStart = new Date(`${from}T${startTime}:00`).getTime();
  const windowEnd = new Date(`${to}T${endTime}:00`).getTime() + 59999;

  const savedSet = new Set(savedDates);
  const missingDates = dates.filter((dateStr) => !savedSet.has(dateStr));
  const drives: SavedDrive[] = [];
  const seen = new Set<string>();

  for (const dateStr of dates) {
    if (!savedSet.has(dateStr)) continue;
    const rows = await readTripFile(dateStr);
    for (const drive of rows) {
      if (query && !drive.deviceid.toLowerCase().includes(query) && !drive.devicename.toLowerCase().includes(query)) continue;
      if (drive.endMs < windowStart || drive.startMs > windowEnd) continue;
      const key = `${drive.deviceid}|${drive.startMs}|${drive.endMs}`;
      if (seen.has(key)) continue;
      seen.add(key);
      drives.push(drive);
    }
  }

  drives.sort((a, b) => a.startMs - b.startMs);

  return NextResponse.json({
    status: 0,
    cause: 'OK',
    source: 'saved-trips',
    earliestReportDate,
    latestReportDate,
    missingDates,
    drives,
  });
}
