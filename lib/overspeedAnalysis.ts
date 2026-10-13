import { buildGPS51Url } from '@/lib/config';

export interface TrackPoint {
  timeMs: number;
  speedKmh: number;
  lat?: number;
  lon?: number;
}

export interface OverspeedStretch {
  begintime: number;
  endtime: number;
  durationMs: number;
  maxSpeedKmh: number;
  avgSpeedKmh: number;
  distanceKm: number;
  startlat: number;
  startlon: number;
  endlat: number;
  endlon: number;
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
      const row = record as { updatetime?: number; speed?: number; callat?: number; callon?: number };
      const lat = Number(row.callat);
      const lon = Number(row.callon);
      return {
        timeMs: toEpochMs(Number(row.updatetime)),
        speedKmh: gpsSpeedToKmh(Number(row.speed) || 0),
        ...(Number.isFinite(lat) ? { lat } : {}),
        ...(Number.isFinite(lon) ? { lon } : {}),
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

function crossingTimeMs(start: TrackPoint, end: TrackPoint, speedLimitKmh: number): number {
  const deltaMs = end.timeMs - start.timeMs;
  if (deltaMs <= 0 || start.speedKmh === end.speedKmh) return end.timeMs;
  const fraction = (speedLimitKmh - start.speedKmh) / (end.speedKmh - start.speedKmh);
  return start.timeMs + clampFraction(fraction) * deltaMs;
}

/** One stretch each time speed goes above the limit and comes back down. Durations are not added together. */
export function listOverspeedStretches(points: TrackPoint[], speedLimitKmh: number): OverspeedStretch[] {
  const stretches: OverspeedStretch[] = [];
  let open: {
    startMs: number;
    startlat: number;
    startlon: number;
    maxSpeed: number;
    speedTime: number;
    timeMs: number;
    distanceKm: number;
    endlat: number;
    endlon: number;
  } | null = null;

  const close = (endMs: number) => {
    if (!open) return;
    const durationMs = Math.max(0, Math.round(endMs - open.startMs));
    stretches.push({
      begintime: open.startMs,
      endtime: open.startMs + durationMs,
      durationMs,
      maxSpeedKmh: open.maxSpeed,
      avgSpeedKmh: open.timeMs > 0 ? open.speedTime / open.timeMs : open.maxSpeed,
      distanceKm: open.distanceKm,
      startlat: open.startlat,
      startlon: open.startlon,
      endlat: open.endlat,
      endlon: open.endlon,
    });
    open = null;
  };

  const addPortion = (speedA: number, speedB: number, portionMs: number) => {
    if (!open || portionMs <= 0) return;
    const avg = (speedA + speedB) / 2;
    open.speedTime += avg * portionMs;
    open.timeMs += portionMs;
    open.distanceKm += avg * (portionMs / 3600000);
  };

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const over = point.speedKmh > speedLimitKmh;
    const next = i < points.length - 1 ? points[i + 1] : null;

    if (over && !open) {
      const previous = i > 0 ? points[i - 1] : null;
      const startMs = previous && previous.speedKmh <= speedLimitKmh
        ? crossingTimeMs(previous, point, speedLimitKmh)
        : point.timeMs;
      open = {
        startMs,
        startlat: point.lat ?? 0,
        startlon: point.lon ?? 0,
        maxSpeed: point.speedKmh,
        speedTime: 0,
        timeMs: 0,
        distanceKm: 0,
        endlat: point.lat ?? 0,
        endlon: point.lon ?? 0,
      };
      if (startMs < point.timeMs) {
        addPortion(speedLimitKmh, point.speedKmh, point.timeMs - startMs);
      }
    }

    if (open && over) {
      open.maxSpeed = Math.max(open.maxSpeed, point.speedKmh);
      if (point.lat != null) open.endlat = point.lat;
      if (point.lon != null) open.endlon = point.lon;
    }

    if (!next) {
      if (open) close(point.timeMs);
      break;
    }

    const deltaMs = next.timeMs - point.timeMs;
    if (deltaMs <= 0) continue;
    const nextOver = next.speedKmh > speedLimitKmh;

    if (open && over && nextOver) {
      addPortion(point.speedKmh, next.speedKmh, deltaMs);
    } else if (open && over && !nextOver) {
      const endMs = crossingTimeMs(point, next, speedLimitKmh);
      addPortion(point.speedKmh, speedLimitKmh, Math.max(0, endMs - point.timeMs));
      close(endMs);
    }
  }

  return stretches;
}

export async function fetchDeviceTracks(
  token: string,
  deviceid: string,
  begintime: string,
  endtime: string,
  timezone = 1,
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

/** One saved row per speeding stretch. A stretch shorter than minDurationMs is left out. */
export function buildTripOverspeedEvents(
  deviceid: string,
  devicename: string | undefined,
  trip: TripLike,
  speedLimitKmh: number,
  trackPoints: TrackPoint[],
  minDurationMs: number
): TripOverspeedViolation[] {
  const tripStartMs = toEpochMs(Number(trip.starttime));
  const tripEndMs = toEpochMs(Number(trip.endtime));
  const windowPoints = filterPointsInWindow(trackPoints, tripStartMs, tripEndMs);
  return listOverspeedStretches(windowPoints, speedLimitKmh)
    .filter((stretch) => stretch.durationMs >= minDurationMs)
    .map((stretch) => ({
      deviceid,
      devicename,
      begintime: stretch.begintime,
      endtime: stretch.endtime,
      maxspeed: stretch.maxSpeedKmh,
      avgspeed: stretch.avgSpeedKmh,
      speedlimit: speedLimitKmh,
      overspeed: stretch.maxSpeedKmh - speedLimitKmh,
      duration: stretch.durationMs,
      overspeedduration: stretch.durationMs,
      overspeedcrossings: 1,
      distance: stretch.distanceKm,
      startlat: stretch.startlat || Number(trip.slat) || 0,
      startlon: stretch.startlon || Number(trip.slon) || 0,
      endlat: stretch.endlat || Number(trip.elat) || 0,
      endlon: stretch.endlon || Number(trip.elon) || 0,
    }));
}
