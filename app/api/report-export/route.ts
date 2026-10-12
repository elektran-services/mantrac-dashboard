import { NextRequest, NextResponse } from 'next/server';
import { filterReportsByDateParams, listGeneratedReportFiles, resolveSafeGeneratedReportPath } from '@/lib/generatedReportsStorage';
import { filterMileageReportsByDateParams, listMileageReportFiles, resolveSafeMileageReportPath } from '@/lib/mileageReportStorage';
import { filterOfflineReportsByDateParams, listOfflineReportFiles, resolveSafeOfflineReportPath } from '@/lib/offlineReportStorage';
import { filterParkingReportsByDateParams, listParkingReportFiles, resolveSafeParkingReportPath } from '@/lib/parkingReportStorage';
import { buildSavedReportCsv } from '@/lib/savedReportCsv';
import { filterTripReportsByDateParams, listTripReportFiles, resolveSafeTripReportPath } from '@/lib/tripsReportStorage';

const MAX_RANGE_DAYS = 366;

type ListedFile = { filename: string; reportDate: string | null };

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

function filesForSource(source: string, category: string, date: string, from: string, to: string): ListedFile[] {
  const params = { date, from, to };
  if (source === 'parking') return filterParkingReportsByDateParams(listParkingReportFiles(), params);
  if (source === 'trips') return filterTripReportsByDateParams(listTripReportFiles(), params);
  if (source === 'offline') return filterOfflineReportsByDateParams(listOfflineReportFiles(), params);
  if (source === 'overspeed') {
    return filterReportsByDateParams(
      listGeneratedReportFiles().filter((file) => /^overspeed_daily_report_/i.test(file.filename)),
      params
    );
  }
  if (source === 'mileage') {
    const kind = category === 'monthly' ? 'monthly' : 'daily';
    return filterMileageReportsByDateParams(listMileageReportFiles(kind), params);
  }
  return [];
}

function resolvePath(source: string, category: string, filename: string): string | null {
  if (source === 'parking') return resolveSafeParkingReportPath(filename);
  if (source === 'trips') return resolveSafeTripReportPath(filename);
  if (source === 'offline') return resolveSafeOfflineReportPath(filename);
  if (source === 'overspeed') return resolveSafeGeneratedReportPath(filename);
  if (source === 'mileage') return resolveSafeMileageReportPath(category === 'monthly' ? 'monthly' : 'daily', filename);
  return null;
}

/**
 * POST /api/report-export
 * Combines saved Excel files for one report and period into a CSV. Does not call the tracker.
 * Body: { token?, source, category?, date?, from?, to?, query? }
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

  const source = typeof body.source === 'string' ? body.source : '';
  if (!['parking', 'trips', 'overspeed', 'offline', 'mileage'].includes(source)) {
    return NextResponse.json({ status: -1, cause: 'Unknown report', error: 'BAD_SOURCE' }, { status: 400 });
  }
  const category = typeof body.category === 'string' ? body.category : 'daily';
  const date = typeof body.date === 'string' ? body.date.trim() : '';
  const from = typeof body.from === 'string' ? body.from.trim() : '';
  const to = typeof body.to === 'string' ? body.to.trim() : '';
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (query && query.length < 2) {
    return NextResponse.json(
      { status: -1, cause: 'Enter at least 2 characters of an IMEI or device name', error: 'QUERY_TOO_SHORT' },
      { status: 400 }
    );
  }
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

  const files = filesForSource(source, category, date, from, to).filter((file) => file.reportDate);
  if (files.length === 0) {
    return NextResponse.json(
      { status: -1, cause: 'No saved files in that period', error: 'NO_FILES' },
      { status: 404 }
    );
  }

  const readable = [...files].reverse().flatMap((file) => {
    const filePath = resolvePath(source, category, file.filename);
    return filePath ? [{ reportDate: file.reportDate, filePath }] : [];
  });
  const csv = await buildSavedReportCsv(readable, query);
  if (!csv) {
    return NextResponse.json(
      {
        status: -1,
        cause: query
          ? 'No vehicle matched that IMEI or name in that period'
          : 'Saved files have no readable rows',
        error: 'EMPTY',
      },
      { status: 404 }
    );
  }

  const prefix = source === 'mileage' ? `mileage_${category === 'monthly' ? 'monthly' : 'daily'}` : `${source}_report`;
  const startLabel = date || from || files[files.length - 1]?.reportDate || 'start';
  const endLabel = date || to || files[0]?.reportDate || 'end';
  const slug = query.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 40);
  const range = startLabel === endLabel ? `${prefix}_${startLabel}` : `${prefix}_${startLabel}_to_${endLabel}`;
  const filename = `${slug ? `${range}_${slug}` : range}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
