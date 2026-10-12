import { NextRequest, NextResponse } from 'next/server';
import { buildGPS51Url } from '@/lib/config';
import { reverseGeocode } from '@/lib/reverseGeocode';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { deviceid, begintime, endtime, timezone, interval, token } = body;

    if (!token) {
      return NextResponse.json(
        { status: -1, cause: 'No token provided', error: 'MISSING_TOKEN' },
        { status: 401 }
      );
    }

    if (!deviceid) {
      return NextResponse.json(
        { status: -1, cause: 'Device ID is required', error: 'MISSING_DEVICEID' },
        { status: 400 }
      );
    }

    if (!begintime || !endtime) {
      return NextResponse.json(
        { status: -1, cause: 'Begin time and end time are required', error: 'MISSING_TIME_RANGE' },
        { status: 400 }
      );
    }

    const apiUrl = buildGPS51Url('reportparkdetailbytime', token);
    
    const requestBody = {
      deviceid,
      begintime,
      endtime,
      timezone: timezone || 1,
      interval: interval || 5
    };

    console.log('Parking API Request:', { deviceid, begintime, endtime, timezone, interval });

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    if (!response.ok) {
      console.error('GPS API Error:', response.status, response.statusText);
      return NextResponse.json(
        { status: -1, cause: `API request failed: ${response.statusText}`, error: 'API_ERROR' },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('Parking API Response status:', data.status, 'Records:', data.records?.length || 0);

    if (data.status !== 0) {
      console.error('GPS API returned error:', data.cause);
      return NextResponse.json(
        { status: data.status || -1, cause: data.cause || 'API request failed', error: 'API_ERROR' },
        { status: 400 }
      );
    }

    if (data.status === 0 && data.records && data.records.length > 0) {
      const MAX_GEOCODE_RECORDS = 50; // Limit geocoding to prevent timeouts
      
      const recordsToGeocode = data.records.slice(0, MAX_GEOCODE_RECORDS);
      
      for (const record of recordsToGeocode) {
        if (record.callat && record.callon && 
            !isNaN(record.callat) && !isNaN(record.callon) &&
            Math.abs(record.callat) <= 90 && Math.abs(record.callon) <= 180 &&
            !record.address) {
          const address = await reverseGeocode(record.callat, record.callon);
          if (address) record.address = address;
          await new Promise(resolve => setTimeout(resolve, 150));
        }
      }
      
      if (data.records.length > MAX_GEOCODE_RECORDS) {
        console.log(`Geocoded ${MAX_GEOCODE_RECORDS} of ${data.records.length} records to prevent timeout`);
      }
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in parking API route:', error);
    
    // Provide more specific error messages
    let errorMessage = 'Internal server error';
    let statusCode = 500;
    
    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        errorMessage = 'Request timeout - the operation took too long';
        statusCode = 504;
      } else if (error.message.includes('fetch')) {
        errorMessage = 'Network error - failed to connect to API';
        statusCode = 503;
      } else {
        errorMessage = error.message;
      }
    }
    
    return NextResponse.json(
      { 
        status: -1, 
        cause: errorMessage, 
        error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: statusCode }
    );
  }
}
