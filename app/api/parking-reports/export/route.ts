import { NextRequest, NextResponse } from 'next/server';
import {
  filterParkingReportsByDateParams,
  listParkingReportFiles,
  resolveSafeParkingReportPath,
} from '@/lib/parkingReportStorage';
import { buildSavedReportCsv } from '@/lib/savedReportCsv';

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

  const readable = [...files].reverse().flatMap((file) => {
    const filePath = resolveSafeParkingReportPath(file.filename);
    return filePath ? [{ reportDate: file.reportDate, filePath }] : [];
  });
  const csv = await buildSavedReportCsv(readable);
  if (!csv) {
    return NextResponse.json(
      { status: -1, cause: 'Saved parking files have no readable rows', error: 'EMPTY' },
      { status: 404 }
    );
  }

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
