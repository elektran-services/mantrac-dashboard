import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import {
  filterMileageReportsByDateParams,
  listMileageReportFiles,
  resolveSafeMileageReportPath,
} from '@/lib/mileageReportStorage';
import { readServiceResets, serviceProgress } from '@/lib/mileageServiceCounter';
import { readMileageThresholdKm } from '@/lib/mileageThreshold';

const MAX_MATCHES = 400;

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

interface MileageHit {
  filename: string;
  reportDate: string | null;
  deviceid: string;
  devicename: string;
  odometerKm: string;
  threshold: string;
  remainingToThreshold: string;
  notes: string;
  sinceServiceKm: number;
  remainingKm: number;
  overdueKm: number;
  nextServiceKm: number;
  serviceStatus: string;
  hasReset: boolean;
}

async function searchFile(
  category: 'daily' | 'monthly',
  filename: string,
  reportDate: string | null,
  query: string,
  thresholdKm: number,
  resets: ReturnType<typeof readServiceResets>
): Promise<MileageHit[]> {
  const filePath = resolveSafeMileageReportPath(category, filename);
  if (!filePath) return [];

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  let headerRow = 0;
  const headers: string[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (headerRow) return;
    const values: string[] = [];
    for (let col = 1; col <= 12; col++) values.push(cellText(row.getCell(col).value).toLowerCase());
    if (values.some((value) => value === 'device id' || value.startsWith('device id'))) {
      headerRow = rowNumber;
      headers.push(...values);
    }
  });
  if (!headerRow) return [];

  const col = (label: string) => headers.findIndex((header) => header.includes(label));
  const idCol = col('device id');
  const nameCol = col('device name');
  const odoCol = col('odometer');
  const remainingCol = col('remaining');
  const notesCol = col('notes');
  if (idCol < 0 && nameCol < 0) return [];

  const hits: MileageHit[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return;
    const deviceid = idCol >= 0 ? cellText(row.getCell(idCol + 1).value) : '';
    const devicename = nameCol >= 0 ? cellText(row.getCell(nameCol + 1).value) : '';
    if (!deviceid && !devicename) return;
    const haystackId = deviceid.toLowerCase();
    const haystackName = devicename.toLowerCase();
    if (!haystackId.includes(query) && !haystackName.includes(query)) return;
    const odometerKm = odoCol >= 0 ? cellText(row.getCell(odoCol + 1).value) : '';
    const odometer = Number(odometerKm);
    const resetKm = resets[deviceid]?.odometerKm;
    const progress = serviceProgress(
      Number.isFinite(odometer) ? odometer : 0,
      thresholdKm,
      resetKm != null && resetKm <= odometer ? resetKm : null
    );
    hits.push({
      filename,
      reportDate,
      deviceid,
      devicename,
      odometerKm,
      threshold: String(thresholdKm),
      remainingToThreshold: remainingCol >= 0 ? cellText(row.getCell(remainingCol + 1).value) : '',
      notes: notesCol >= 0 ? cellText(row.getCell(notesCol + 1).value) : '',
      sinceServiceKm: progress.sinceServiceKm,
      remainingKm: progress.remainingKm,
      overdueKm: progress.overdueKm,
      nextServiceKm: progress.nextServiceKm,
      serviceStatus: progress.status,
      hasReset: progress.hasReset,
    });
  });
  return hits;
}

/**
 * POST /api/mileage-reports/search
 * Reads saved mileage Excel files only. Does not call GPS51.
 * Body: { token?, category: 'daily' | 'monthly', query, date?, from?, to? }
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

  const category = body.category === 'monthly' ? 'monthly' : body.category === 'daily' ? 'daily' : '';
  if (!category) {
    return NextResponse.json({ status: -1, cause: 'category must be daily or monthly' }, { status: 400 });
  }

  const query = typeof body.query === 'string' ? body.query.trim().toLowerCase() : '';
  if (query.length < 2) {
    return NextResponse.json(
      { status: -1, cause: 'Enter at least 2 characters of an IMEI or device name', error: 'QUERY_TOO_SHORT' },
      { status: 400 }
    );
  }

  const date = typeof body.date === 'string' ? body.date.trim() : undefined;
  const from = typeof body.from === 'string' ? body.from.trim() : undefined;
  const to = typeof body.to === 'string' ? body.to.trim() : undefined;

  const files = filterMileageReportsByDateParams(listMileageReportFiles(category), { date, from, to });
  const thresholdKm = readMileageThresholdKm();
  const resets = readServiceResets();
  const matches: MileageHit[] = [];
  let truncated = false;

  for (const file of files) {
    if (matches.length >= MAX_MATCHES) {
      truncated = true;
      break;
    }
    const hits = await searchFile(category, file.filename, file.reportDate, query, thresholdKm, resets);
    for (const hit of hits) {
      if (matches.length >= MAX_MATCHES) {
        truncated = true;
        break;
      }
      matches.push(hit);
    }
  }

  matches.sort((a, b) => {
    const dateCompare = (b.reportDate || '').localeCompare(a.reportDate || '');
    if (dateCompare !== 0) return dateCompare;
    return a.devicename.localeCompare(b.devicename);
  });

  return NextResponse.json({
    status: 0,
    cause: 'OK',
    source: 'saved-mileage',
    category,
    filesSearched: files.length,
    truncated,
    matches,
  });
}
