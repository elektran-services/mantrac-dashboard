export function parseReportDateTime(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (slash) {
    let hour = Number(slash[4]);
    const ampm = slash[7].toUpperCase();
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    return new Date(
      Number(slash[3]),
      Number(slash[1]) - 1,
      Number(slash[2]),
      hour,
      Number(slash[5]),
      slash[6] ? Number(slash[6]) : 0
    ).getTime();
  }
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const named = text.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4}),\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (named) {
    const month = months.indexOf(named[1].slice(0, 3).toLowerCase());
    if (month >= 0) {
      let hour = Number(named[4]);
      const ampm = named[7].toUpperCase();
      if (ampm === 'PM' && hour < 12) hour += 12;
      if (ampm === 'AM' && hour === 12) hour = 0;
      return new Date(Number(named[3]), month, Number(named[2]), hour, Number(named[5]), named[6] ? Number(named[6]) : 0).getTime();
    }
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function timeWindow(from: string, to: string, startTime: string, endTime: string): { start: number; end: number } | null {
  const startDate = from.trim() || to.trim();
  const endDate = to.trim() || from.trim();
  if (!startDate || !endDate) return null;
  const start = new Date(`${startDate}T${startTime || '00:00'}:00`).getTime();
  const end = new Date(`${endDate}T${endTime || '23:59'}:00`).getTime() + 59999;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null;
  return { start, end };
}

export function overlapsWindow(startValue: string, endValue: string, window: { start: number; end: number } | null): boolean {
  if (!window) return true;
  const startMs = parseReportDateTime(startValue);
  const endMs = parseReportDateTime(endValue);
  if (startMs == null && endMs == null) return true;
  const start = startMs ?? endMs ?? 0;
  const end = endMs ?? startMs ?? 0;
  return end >= window.start && start <= window.end;
}
