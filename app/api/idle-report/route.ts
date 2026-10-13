import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { filterParkingReportsByDateParams, listParkingReportFiles, resolveSafeParkingReportPath } from '@/lib/parkingReportStorage';
import { overlapsWindow, timeWindow } from '@/lib/reportTimeWindow';

const MAX_RANGE_DAYS = 366;
const MAX_MATCHES = 400;

type IdleRow = {
  reportDate: string;
  devicename: string;
  deviceid: string;
  startTime: string;
  endTime: string;
  idleMin: string;
  location: string;
};

function extractToken(request: NextRequest, body?: Record<string, unknown>): string | null {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token) return token;
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

function columnIndex(headers: string[], labels: string[]): number {
  return headers.findIndex((header) => labels.some((label) => header.includes(label)));
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function daySpan(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

async function readIdleRows(filePath: string, reportDate: string, query: string): Promise<IdleRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  let headerRow = 0;
  const headers: string[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (headerRow || rowNumber > 8) return;
    const values: string[] = [];
    for (let col = 1; col <= 24; col++) values.push(cellText(row.getCell(col).value).toLowerCase());
    if (values.some((value) => value === 'device id' || value.startsWith('device id') || value.includes('device name'))) {
      headerRow = rowNumber;
      headers.push(...values);
    }
  });
  if (!headerRow) return [];

  const nameCol = columnIndex(headers, ['device name']);
  const idCol = columnIndex(headers, ['device id', 'imei']);
  const startCol = columnIndex(headers, ['start time']);
  const endCol = columnIndex(headers, ['end time']);
  const idleCol = columnIndex(headers, ['idle duration']);
  const addressCol = columnIndex(headers, ['address']);
  const latCol = columnIndex(headers, ['latitude']);
  const lonCol = columnIndex(headers, ['longitude']);
  if (idleCol < 0) return [];

  const rows: IdleRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return;
    const idleMin = Number(cellText(row.getCell(idleCol + 1).value));
    if (!Number.isFinite(idleMin) || idleMin <= 0) return;
    const deviceid = idCol >= 0 ? cellText(row.getCell(idCol + 1).value) : '';
    const devicename = nameCol >= 0 ? cellText(row.getCell(nameCol + 1).value) : '';
    if (query && !deviceid.toLowerCase().includes(query) && !devicename.toLowerCase().includes(query)) return;
    const address = addressCol >= 0 ? cellText(row.getCell(addressCol + 1).value) : '';
    const lat = latCol >= 0 ? cellText(row.getCell(latCol + 1).value) : '';
    const lon = lonCol >= 0 ? cellText(row.getCell(lonCol + 1).value) : '';
    rows.push({
      reportDate,
      devicename: devicename || deviceid,
      deviceid,
      startTime: startCol >= 0 ? cellText(row.getCell(startCol + 1).value) : '',
      endTime: endCol >= 0 ? cellText(row.getCell(endCol + 1).value) : '',
      idleMin: String(idleMin),
      location: address || (lat && lon ? `${lat}, ${lon}` : ''),
    });
  });
  return rows;
}

/**
 * POST /api/idle-report
 * Reads saved parking Excel files. Keeps stops with idle time (engine on, not moving).
 * Body: { token?, from?, to?, query?, startTime?, endTime?, export? }
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

  const from = typeof body.from === 'string' ? body.from.trim() : '';
  const to = typeof body.to === 'string' ? body.to.trim() : '';
  const query = typeof body.query === 'string' ? body.query.trim().toLowerCase() : '';
  const startTime = typeof body.startTime === 'string' && body.startTime ? body.startTime : '00:00';
  const endTime = typeof body.endTime === 'string' && body.endTime ? body.endTime : '23:59';
  const window = timeWindow(from, to, startTime, endTime);
  const asCsv = body.export === true;
  if (query && query.length < 2) {
    return NextResponse.json(
      { status: -1, cause: 'Enter at least 2 characters of an IMEI or device name', error: 'QUERY_TOO_SHORT' },
      { status: 400 }
    );
  }
  if (from && to && daySpan(from, to) > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { status: -1, cause: `Period must be ${MAX_RANGE_DAYS} days or less`, error: 'RANGE_TOO_WIDE' },
      { status: 400 }
    );
  }

  const files = filterParkingReportsByDateParams(listParkingReportFiles(), { from, to }).filter((file) => file.reportDate);
  const rows: IdleRow[] = [];
  let truncated = false;
  for (const file of [...files].reverse()) {
    const filePath = resolveSafeParkingReportPath(file.filename);
    if (!filePath || !file.reportDate) continue;
    const hits = await readIdleRows(filePath, file.reportDate, query);
    for (const hit of hits) {
      if (!overlapsWindow(hit.startTime, hit.endTime, window)) continue;
      if (!asCsv && rows.length >= MAX_MATCHES) {
        truncated = true;
        break;
      }
      rows.push(hit);
    }
    if (truncated) break;
  }

  if (asCsv) {
    if (rows.length === 0) {
      return NextResponse.json(
        { status: -1, cause: 'No idle stops in that period', error: 'EMPTY' },
        { status: 404 }
      );
    }
    const headers = ['Report date', 'Name', 'IMEI', 'Start date/time', 'End date/time', 'Idle (min)', 'Start location', 'End location'];
    const csv = [headers, ...rows.map((row) => [
      row.reportDate,
      row.devicename,
      row.deviceid,
      row.startTime,
      row.endTime,
      row.idleMin,
      row.location,
      row.location,
    ])].map((line) => line.map(csvCell).join(',')).join('\r\n');
    const startLabel = from || rows[0]?.reportDate || 'start';
    const endLabel = to || rows[rows.length - 1]?.reportDate || 'end';
    const slug = query.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 40);
    const range = startLabel === endLabel ? startLabel : `${startLabel}_to_${endLabel}`;
    const filename = `idle_report_${range}${slug ? `_${slug}` : ''}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  return NextResponse.json({
    status: 0,
    cause: 'OK',
    filesSearched: files.length,
    truncated,
    matches: rows,
  });
}
