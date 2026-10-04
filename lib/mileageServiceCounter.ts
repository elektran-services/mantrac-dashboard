import fs from 'fs';
import path from 'path';
import { MILEAGE_REPORT_DIR, ensureMileageReportDir } from '@/lib/mileageReportStorage';

export const ALMOST_DUE_BUFFER_KM = 500;

const RESETS_FILE = path.join(MILEAGE_REPORT_DIR, 'service-resets.json');
const ACTIVITY_FILE = path.join(MILEAGE_REPORT_DIR, 'service-activity.json');
const ACTIVITY_LIMIT = 1000;

export interface ServiceActivity {
  at: string;
  username: string;
  action: 'serviced' | 'reset_anyway';
  deviceid: string;
  devicename: string;
  odometerKm: number;
  remainingKm: number;
  overdueKm: number;
  due: boolean;
}

export type ServiceStatus = 'ok' | 'almost' | 'due' | 'overdue';

export interface ServiceReset {
  odometerKm: number;
  resetAt: string;
  devicename?: string;
}

export interface ServiceProgress {
  sinceServiceKm: number;
  remainingKm: number;
  overdueKm: number;
  nextServiceKm: number;
  status: ServiceStatus;
  hasReset: boolean;
  resetOdometerKm: number | null;
  note: string;
}

function roundKm(value: number): number {
  return Math.round(value * 100) / 100;
}

export function readServiceResets(): Record<string, ServiceReset> {
  try {
    const parsed = JSON.parse(fs.readFileSync(RESETS_FILE, 'utf8')) as Record<string, ServiceReset>;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

export function writeServiceReset(deviceid: string, odometerKm: number, devicename?: string): ServiceReset {
  const value = Number(odometerKm);
  if (!deviceid.trim() || !Number.isFinite(value) || value < 0) {
    throw new Error('A vehicle and a valid odometer are required');
  }
  const resets = readServiceResets();
  const entry: ServiceReset = {
    odometerKm: roundKm(value),
    resetAt: new Date().toISOString(),
    ...(devicename ? { devicename } : {}),
  };
  resets[deviceid] = entry;
  ensureMileageReportDir();
  fs.writeFileSync(RESETS_FILE, JSON.stringify(resets, null, 2));
  return entry;
}

export function readServiceActivity(): ServiceActivity[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf8')) as ServiceActivity[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendServiceActivity(entry: Omit<ServiceActivity, 'at'> & { at?: string }): ServiceActivity {
  const record: ServiceActivity = {
    at: entry.at || new Date().toISOString(),
    username: entry.username || 'Unknown',
    action: entry.action === 'reset_anyway' ? 'reset_anyway' : 'serviced',
    deviceid: entry.deviceid,
    devicename: entry.devicename,
    odometerKm: roundKm(entry.odometerKm),
    remainingKm: roundKm(entry.remainingKm),
    overdueKm: roundKm(entry.overdueKm),
    due: Boolean(entry.due),
  };
  const next = [record, ...readServiceActivity()].slice(0, ACTIVITY_LIMIT);
  ensureMileageReportDir();
  fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(next, null, 2));
  return record;
}

/**
 * Km since the last service reset. Before the first reset, the counter is the
 * position inside the current threshold block. After a reset, overdue km stay
 * in the count because the new start is the odometer at the time of service.
 */
export function serviceProgress(
  currentOdometerKm: number,
  thresholdKm: number,
  resetOdometerKm: number | null
): ServiceProgress {
  const current = Number.isFinite(currentOdometerKm) ? currentOdometerKm : 0;
  const threshold = Number.isFinite(thresholdKm) && thresholdKm > 0 ? thresholdKm : 1;
  const hasReset = resetOdometerKm != null && Number.isFinite(resetOdometerKm) && resetOdometerKm >= 0 && resetOdometerKm <= current;

  if (!hasReset) {
    const intoBlock = current % threshold;
    const onBoundary = intoBlock === 0 && current > 0;
    const sinceServiceKm = onBoundary ? threshold : intoBlock;
    const remainingKm = onBoundary ? 0 : threshold - intoBlock;
    const nextServiceKm = onBoundary ? current : current + remainingKm;
    const status: ServiceStatus = remainingKm === 0 ? 'due' : remainingKm <= ALMOST_DUE_BUFFER_KM ? 'almost' : 'ok';
    return {
      sinceServiceKm: roundKm(sinceServiceKm),
      remainingKm: roundKm(remainingKm),
      overdueKm: 0,
      nextServiceKm: roundKm(nextServiceKm),
      status,
      hasReset: false,
      resetOdometerKm: null,
      note: statusNote(status, 0, remainingKm, false),
    };
  }

  const baseline = resetOdometerKm as number;
  const sinceServiceKm = Math.max(0, current - baseline);
  const overdueKm = Math.max(0, sinceServiceKm - threshold);
  const remainingKm = Math.max(0, threshold - sinceServiceKm);
  const nextServiceKm = baseline + threshold;
  const status: ServiceStatus = overdueKm > 0 ? 'overdue' : remainingKm === 0 ? 'due' : remainingKm <= ALMOST_DUE_BUFFER_KM ? 'almost' : 'ok';
  return {
    sinceServiceKm: roundKm(sinceServiceKm),
    remainingKm: roundKm(remainingKm),
    overdueKm: roundKm(overdueKm),
    nextServiceKm: roundKm(nextServiceKm),
    status,
    hasReset: true,
    resetOdometerKm: roundKm(baseline),
    note: statusNote(status, overdueKm, remainingKm, true),
  };
}

function statusNote(status: ServiceStatus, overdueKm: number, remainingKm: number, hasReset: boolean): string {
  const basis = hasReset ? 'since last service' : 'in the current service block';
  if (status === 'overdue') return `Overdue by ${overdueKm.toFixed(0)} km ${basis}`;
  if (status === 'due') return `Due for service ${basis}`;
  if (status === 'almost') return `Almost due, ${remainingKm.toFixed(0)} km left ${basis}`;
  return `${remainingKm.toFixed(0)} km until next service ${basis}`;
}
