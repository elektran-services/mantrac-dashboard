import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import {
  filterParkingReportsByDateParams,
  listParkingReportFiles,
  resolveSafeParkingReportPath,
} from '@/lib/parkingReportStorage';

const MAX_RANGE_DAYS = 366;

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

/**
 * POST /api/parking-reports/export
 * Reads saved daily parking Excel files only. Does not call the tracker.
 * Body: { token?, date?, from?, to? }
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

  const date = typeof body.date === 'string' ? body.date.trim() : '';
  const from = typeof body.from === 'string' ? body.from.trim() : '';
  const to = typeof body.to === 'string' ? body.to.trim() : '';
  if (!date && !from && !to) {
    return NextResponse.json(
      { status: -1, cause: 'Choose a date or a from and to period', error: 'MISSING_PERIOD' },
      { status: 400 }
    );
  }
  if (!date && from && to && daySpan(from, to) > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { status: -1, cause: `Period must be ${MAX_RANGE_DAYS} days or less`, error: 'RANGE_TOO_WIDE' },
      { status: 400 }
    );
  }

  const files = filterParkingReportsByDateParams(listParkingReportFiles(), { date, from, to }).filter(
    (file) => file.reportDate
  );
  if (files.length === 0) {
    return NextResponse.json(
      { status: -1, cause: 'No saved parking files in that period', error: 'NO_FILES' },
      { status: 404 }
    );
  }

  const rows: string[][] = [];
  let headers: string[] = [];

  for (const file of [...files].reverse()) {
    const filePath = resolveSafeParkingReportPath(file.filename);
    if (!filePath) continue;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) continue;

    let headerRow = 0;
    const fileHeaders: string[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (headerRow || rowNumber > 8) return;
      const values: string[] = [];
      for (let col = 1; col <= 20; col++) values.push(cellText(row.getCell(col).value));
      if (values.some((value) => value.toLowerCase() === 'device id' || value.toLowerCase().startsWith('device name'))) {
        headerRow = rowNumber;
        while (values.length > 0 && !values[values.length - 1]) values.pop();
        fileHeaders.push(...values);
      }
    });
    if (!headerRow) continue;
    if (headers.length === 0) headers = ['Report date', ...fileHeaders];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRow) return;
      const values = fileHeaders.map((_, index) => cellText(row.getCell(index + 1).value));
      if (values.every((value) => !value)) return;
      rows.push([file.reportDate || '', ...values]);
    });
  }

  if (headers.length === 0) {
    return NextResponse.json(
      { status: -1, cause: 'Saved parking files have no readable rows', error: 'EMPTY' },
      { status: 404 }
    );
  }

  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const startLabel = date || from || files[files.length - 1]?.reportDate || 'start';
  const endLabel = date || to || files[0]?.reportDate || 'end';
  const filename = startLabel === endLabel ? `parking_report_${startLabel}.csv` : `parking_report_${startLabel}_to_${endLabel}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
