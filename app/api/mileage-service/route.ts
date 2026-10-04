import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { listMileageReportFiles, resolveSafeMileageReportPath } from '@/lib/mileageReportStorage';
import { appendServiceActivity, readServiceActivity, readServiceResets, serviceProgress, writeServiceReset } from '@/lib/mileageServiceCounter';
import { readMileageThresholdKm } from '@/lib/mileageThreshold';

interface FleetVehicle {
  deviceid: string;
  devicename: string;
  odometerKm: number;
  reportDate: string | null;
  filename: string;
  category: 'daily' | 'monthly';
}

let fleetCache: { key: string; vehicles: FleetVehicle[] } | null = null;

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

async function readVehiclesFromFile(file: {
  filename: string;
  reportDate: string | null;
  category: 'daily' | 'monthly';
}): Promise<FleetVehicle[]> {
  const filePath = resolveSafeMileageReportPath(file.category, file.filename);
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
  if (idCol < 0 || odoCol < 0) return [];

  const vehicles: FleetVehicle[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return;
    const deviceid = cellText(row.getCell(idCol + 1).value);
    const odometerKm = Number(cellText(row.getCell(odoCol + 1).value));
    if (!deviceid || !Number.isFinite(odometerKm)) return;
    vehicles.push({
      deviceid,
      devicename: nameCol >= 0 ? cellText(row.getCell(nameCol + 1).value) : deviceid,
      odometerKm,
      reportDate: file.reportDate,
      filename: file.filename,
      category: file.category,
    });
  });
  return vehicles;
}

async function latestFleet(): Promise<FleetVehicle[]> {
  const files = [...listMileageReportFiles('daily'), ...listMileageReportFiles('monthly')].sort((a, b) => {
    const dateCompare = (a.reportDate || '').localeCompare(b.reportDate || '');
    if (dateCompare !== 0) return dateCompare;
    return a.modifiedAt.localeCompare(b.modifiedAt);
  });
  const key = files.map((file) => `${file.category}:${file.filename}:${file.modifiedAt}`).join('|');
  if (fleetCache?.key === key) return fleetCache.vehicles;

  const byDevice = new Map<string, FleetVehicle>();
  for (const file of files) {
    const rows = await readVehiclesFromFile(file);
    for (const row of rows) byDevice.set(row.deviceid, row);
  }
  const vehicles = Array.from(byDevice.values()).sort((a, b) => a.devicename.localeCompare(b.devicename));
  fleetCache = { key, vehicles };
  return vehicles;
}

function withProgress(vehicle: FleetVehicle) {
  const resets = readServiceResets();
  const thresholdKm = readMileageThresholdKm();
  const reset = resets[vehicle.deviceid];
  const progress = serviceProgress(vehicle.odometerKm, thresholdKm, reset?.odometerKm ?? null);
  return {
    ...vehicle,
    thresholdKm,
    resetAt: reset && progress.hasReset ? reset.resetAt : null,
    ...progress,
  };
}

function formatActivityTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function activityWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('User activities');
  const headers = ['When', 'User', 'Action', 'Vehicle', 'IMEI', 'Odometer (km)', 'Remaining (km)', 'Overdue (km)'];
  sheet.mergeCells('A1:H1');
  const title = sheet.getCell('A1');
  title.value = 'User activities';
  title.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 25;

  sheet.mergeCells('A2:H2');
  const summary = sheet.getCell('A2');
  summary.value = 'Confirmed Serviced and Reset anyway actions on the mileage service button';
  summary.font = { italic: true, size: 10 };
  summary.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } };
  summary.alignment = { horizontal: 'center', vertical: 'middle' };

  sheet.columns = [
    { key: 'when', width: 22 },
    { key: 'user', width: 18 },
    { key: 'action', width: 16 },
    { key: 'vehicle', width: 22 },
    { key: 'imei', width: 22 },
    { key: 'odometer', width: 16 },
    { key: 'remaining', width: 16 },
    { key: 'overdue', width: 14 },
  ];
  const headerRow = sheet.getRow(3);
  headers.forEach((label, index) => {
    headerRow.getCell(index + 1).value = label;
  });
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC107' } };

  for (const item of readServiceActivity()) {
    sheet.addRow([
      formatActivityTime(item.at),
      item.username,
      item.action === 'reset_anyway' ? 'Reset anyway' : 'Serviced',
      item.devicename,
      item.deviceid,
      item.odometerKm,
      item.remainingKm,
      item.overdueKm,
    ]);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * GET /api/mileage-service — latest saved odometer per vehicle plus the service counter.
 * GET /api/mileage-service?report=activity — Excel export of confirmed service-button actions.
 * POST /api/mileage-service — reset one vehicle at its latest saved odometer. Does not call GPS51.
 */
export async function GET(request: NextRequest) {
  const token = extractToken(request);
  if (!token || token.length < 8) {
    return NextResponse.json({ status: -1, cause: 'Token required', error: 'UNAUTHORIZED' }, { status: 401 });
  }
  if (new URL(request.url).searchParams.get('report') === 'activity') {
    const filename = `user_activities_${new Date().toISOString().slice(0, 10)}.xlsx`;
    const buffer = await activityWorkbook();
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }
  const vehicles = await latestFleet();
  return NextResponse.json({
    status: 0,
    cause: 'OK',
    thresholdKm: readMileageThresholdKm(),
    vehicles: vehicles.map(withProgress),
  });
}

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
  const deviceid = typeof body.deviceid === 'string' ? body.deviceid.trim() : '';
  if (!deviceid) {
    return NextResponse.json({ status: -1, cause: 'Vehicle is required', error: 'MISSING_DEVICE' }, { status: 400 });
  }

  const vehicles = await latestFleet();
  const vehicle = vehicles.find((item) => item.deviceid === deviceid);
  if (!vehicle) {
    return NextResponse.json(
      { status: -1, cause: 'No saved odometer for that vehicle', error: 'NOT_FOUND' },
      { status: 404 }
    );
  }

  writeServiceReset(vehicle.deviceid, vehicle.odometerKm, vehicle.devicename);
  const due = body.due === true;
  const activity = appendServiceActivity({
    username: typeof body.username === 'string' && body.username.trim() ? body.username.trim() : 'Unknown',
    action: due ? 'serviced' : 'reset_anyway',
    deviceid: vehicle.deviceid,
    devicename: vehicle.devicename,
    odometerKm: vehicle.odometerKm,
    remainingKm: Number(body.remainingKm) || 0,
    overdueKm: Number(body.overdueKm) || 0,
    due,
  });
  return NextResponse.json({ status: 0, cause: 'OK', vehicle: withProgress(vehicle), activity });
}
