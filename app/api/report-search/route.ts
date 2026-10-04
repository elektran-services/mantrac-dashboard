import { NextRequest, NextResponse } from 'next/server';
import { searchExcelDevices, type ExcelDeviceHit } from '@/lib/excelDeviceSearch';
import { filterReportsByDateParams, listGeneratedReportFiles, resolveSafeGeneratedReportPath } from '@/lib/generatedReportsStorage';
import { filterOfflineReportsByDateParams, listOfflineReportFiles, resolveSafeOfflineReportPath } from '@/lib/offlineReportStorage';
import { filterParkingReportsByDateParams, listParkingReportFiles, resolveSafeParkingReportPath } from '@/lib/parkingReportStorage';
import { filterTripReportsByDateParams, listTripReportFiles, resolveSafeTripReportPath } from '@/lib/tripsReportStorage';

const MAX_MATCHES = 400;

type ReportFile = { filename: string; reportDate: string | null };

const SOURCES = {
  parking: {
    list: listParkingReportFiles,
    filter: filterParkingReportsByDateParams,
    resolve: resolveSafeParkingReportPath,
    fields: [
      { key: 'startTime', labels: ['start time'] },
      { key: 'endTime', labels: ['end time'] },
      { key: 'idle', labels: ['idle duration'] },
      { key: 'address', labels: ['address'] },
    ],
  },
  offline: {
    list: listOfflineReportFiles,
    filter: filterOfflineReportsByDateParams,
    resolve: resolveSafeOfflineReportPath,
    fields: [
      { key: 'lastUpdate', labels: ['last update'] },
      { key: 'offlineDuration', labels: ['offline duration'] },
      { key: 'lastLocation', labels: ['last location'] },
      { key: 'status', labels: ['status'] },
    ],
  },
  overspeed: {
    list: listGeneratedReportFiles,
    filter: filterReportsByDateParams,
    resolve: resolveSafeGeneratedReportPath,
    fields: [
      { key: 'startTime', labels: ['start time'] },
      { key: 'endTime', labels: ['end time'] },
      { key: 'maxSpeed', labels: ['max speed'] },
      { key: 'overspeed', labels: ['overspeed (km/h)'] },
    ],
  },
  trips: {
    list: listTripReportFiles,
    filter: filterTripReportsByDateParams,
    resolve: resolveSafeTripReportPath,
    fields: [
      { key: 'startTime', labels: ['start time'] },
      { key: 'endTime', labels: ['end time'] },
      { key: 'distance', labels: ['distance'] },
      { key: 'tripTime', labels: ['trip time'] },
    ],
  },
} as const;

type SourceName = keyof typeof SOURCES;

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

/**
 * POST /api/report-search
 * Reads saved Excel files only. Does not call GPS51.
 * Body: { token?, source: 'parking' | 'offline' | 'overspeed' | 'trips', query, date?, from?, to? }
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

  const sourceName = typeof body.source === 'string' ? body.source : '';
  if (!(sourceName in SOURCES)) {
    return NextResponse.json({ status: -1, cause: 'Unknown report', error: 'BAD_SOURCE' }, { status: 400 });
  }
  const source = SOURCES[sourceName as SourceName];

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
  const files = source.filter(source.list(), { date, from, to });
  const matches: ExcelDeviceHit[] = [];
  let truncated = false;

  for (const file of files as ReportFile[]) {
    if (matches.length >= MAX_MATCHES) {
      truncated = true;
      break;
    }
    const filePath = source.resolve(file.filename);
    if (!filePath) continue;
    const hits = await searchExcelDevices({
      filePath,
      filename: file.filename,
      reportDate: file.reportDate,
      query,
      fields: source.fields,
    });
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
    source: sourceName,
    filesSearched: files.length,
    truncated,
    matches,
  });
}
