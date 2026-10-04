import { NextRequest, NextResponse } from 'next/server';
import { readMileageThresholdKm, writeMileageThresholdKm } from '@/lib/mileageThreshold';

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
 * GET/POST /api/mileage-settings
 * Reads and writes the local mileage threshold. Does not call GPS51.
 */
export async function GET(request: NextRequest) {
  const token = extractToken(request);
  if (!token || token.length < 8) {
    return NextResponse.json({ status: -1, cause: 'Token required', error: 'UNAUTHORIZED' }, { status: 401 });
  }
  return NextResponse.json({
    status: 0,
    cause: 'OK',
    thresholdKm: readMileageThresholdKm(),
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

  try {
    const thresholdKm = writeMileageThresholdKm(Number(body.thresholdKm));
    return NextResponse.json({ status: 0, cause: 'OK', thresholdKm });
  } catch (error) {
    return NextResponse.json(
      {
        status: -1,
        cause: error instanceof Error ? error.message : 'Invalid threshold',
        error: 'INVALID_THRESHOLD',
      },
      { status: 400 }
    );
  }
}
