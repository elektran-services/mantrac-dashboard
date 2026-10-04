import { buildGPS51Url } from '@/lib/config';

export interface TrackPoint {
  timeMs: number;
  speedKmh: number;
}

export interface OverspeedAnalysis {
  totalOverspeedDurationMs: number;
  crossingCount: number;
  maxSpeedKmh: number;
}

export interface TripOverspeedViolation {
  deviceid: string;
  devicename?: string;
  begintime: number;
  endtime: number;
  maxspeed: number;
  avgspeed: number;
  speedlimit: number;
  overspeed: number;
  duration: number;
  overspeedduration: number;
  overspeedcrossings: number;
  distance: number;
  startlat: number;
  startlon: number;
  endlat: number;
  endlon: number;
}

/** GPS51 speed values are meters/hour; divide by 1000 for km/h. */
export function gpsSpeedToKmh(speed: number): number {
  return speed / 1000;
}

/** GPS51 may return epoch timestamps in seconds or milliseconds. */
export function toEpochMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 1e12 ? value * 1000 : value;
}

export function formatGps51DateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function parseTrackRecords(records: unknown[]): TrackPoint[] {
  return records
    .map((record) => {
      const row = record as { updatetime?: number; speed?: number };
      return {
        timeMs: toEpochMs(Number(row.updatetime)),
        speedKmh: gpsSpeedToKmh(Number(row.speed) || 0),
      };
    })
    .filter((point) => point.timeMs > 0)
    .sort((a, b) => a.timeMs - b.timeMs);
}

export function filterPointsInWindow(
  points: TrackPoint[],
  startMs: number,
  endMs: number
): TrackPoint[] {
  return points.filter((point) => point.timeMs >= startMs && point.timeMs <= endMs);
}

/** Sum time above limit and count upward crossings using GPS track points. */
export function analyzeOverspeedFromPoints(
  points: TrackPoint[],
  speedLimitKmh: number
): OverspeedAnalysis {
  if (points.length === 0) {
    return { totalOverspeedDurationMs: 0, crossingCount: 0, maxSpeedKmh: 0 };
  }

  let crossingCount = 0;
  let totalOverspeedDurationMs = 0;
  let maxSpeedKmh = 0;
  let previousOver = false;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    maxSpeedKmh = Math.max(maxSpeedKmh, point.speedKmh);
    const isOver = point.speedKmh > speedLimitKmh;

    if (isOver && !previousOver) {
      crossingCount++;
    }
    previousOver = isOver;

    if (i >= points.length - 1) continue;

    const next = points[i + 1];
    const deltaMs = next.timeMs - point.timeMs;
    if (deltaMs <= 0) continue;

    totalOverspeedDurationMs += overspeedSegmentDurationMs(
      point.speedKmh,
      next.speedKmh,
      deltaMs,
      speedLimitKmh
    );
  }

  return {
    totalOverspeedDurationMs: Math.round(totalOverspeedDurationMs),
    crossingCount,
    maxSpeedKmh,
  };
}

function overspeedSegmentDurationMs(
  startSpeedKmh: number,
  endSpeedKmh: number,
  deltaMs: number,
  speedLimitKmh: number
): number {
  if (startSpeedKmh > speedLimitKmh && endSpeedKmh > speedLimitKmh) {
    return deltaMs;
  }

  if (startSpeedKmh <= speedLimitKmh && endSpeedKmh <= speedLimitKmh) {
    return 0;
  }

  if (startSpeedKmh === endSpeedKmh) {
    return startSpeedKmh > speedLimitKmh ? deltaMs : 0;
  }

  if (startSpeedKmh > speedLimitKmh && endSpeedKmh <= speedLimitKmh) {
    const fraction = (startSpeedKmh - speedLimitKmh) / (startSpeedKmh - endSpeedKmh);
    return deltaMs * clampFraction(fraction);
  }

  const fraction = (endSpeedKmh - speedLimitKmh) / (endSpeedKmh - startSpeedKmh);
  return deltaMs * clampFraction(fraction);
}

function clampFraction(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export async function fetchDeviceTracks(
  token: string,
  deviceid: string,
  begintime: string,
  endtime: string,
  timezone = 8,
  timeoutMs = 60000
): Promise<TrackPoint[]> {
  const apiUrl = buildGPS51Url('querytracks', token);
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceid,
      lbs: 1,
      timezone,
      begintime,
      endtime,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  if (data.status !== 0 || !Array.isArray(data.records)) {
    return [];
  }

  return parseTrackRecords(data.records);
}

interface TripLike {
  starttime: number;
  endtime: number;
  maxspeed?: number;
  averagespeed?: number;
  triptime?: number;
  tripdistance?: number;
  slat?: number;
  slon?: number;
  elat?: number;
  elon?: number;
}

export function buildTripOverspeedViolation(
  deviceid: string,
  devicename: string | undefined,
  trip: TripLike,
  speedLimitKmh: number,
  trackPoints: TrackPoint[]
): TripOverspeedViolation | null {
  const tripStartMs = toEpochMs(Number(trip.starttime));
  const tripEndMs = toEpochMs(Number(trip.endtime));
  const tripDuration = Number(trip.triptime) || Math.max(0, tripEndMs - tripStartMs);
  const avgSpeedKmh = trip.averagespeed ? gpsSpeedToKmh(Number(trip.averagespeed)) : 0;
  const windowPoints = filterPointsInWindow(trackPoints, tripStartMs, tripEndMs);
  const analysis = analyzeOverspeedFromPoints(windowPoints, speedLimitKmh);
  const maxSpeedKmh = Math.max(
    trip.maxspeed ? gpsSpeedToKmh(Number(trip.maxspeed)) : 0,
    analysis.maxSpeedKmh
  );

  if (maxSpeedKmh <= speedLimitKmh) {
    return null;
  }

  return {
    deviceid,
    devicename,
    begintime: tripStartMs,
    endtime: tripEndMs,
    maxspeed: maxSpeedKmh,
    avgspeed: avgSpeedKmh,
    speedlimit: speedLimitKmh,
    overspeed: maxSpeedKmh - speedLimitKmh,
    duration: tripDuration,
    overspeedduration: analysis.totalOverspeedDurationMs,
    overspeedcrossings: analysis.crossingCount,
    distance: trip.tripdistance ? Number(trip.tripdistance) / 1000 : 0,
    startlat: Number(trip.slat) || 0,
    startlon: Number(trip.slon) || 0,
    endlat: Number(trip.elat) || 0,
    endlon: Number(trip.elon) || 0,
  };
}
