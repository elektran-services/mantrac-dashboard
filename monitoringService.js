/**
 * Fleet monitoring service: overspeed (23:59), trips export (01:30), mileage (12:00), offline (10:00), parking (15:00).
 */

const path = require('path');
require('dotenv').config({ path: path.join(process.cwd(), '.env.production') });
require('dotenv').config({ path: path.join(process.cwd(), '.env.local'), override: true });

const cron = require('node-cron');
const fetch = require('node-fetch');
const readline = require('readline');
const fs = require('fs');

// Configuration
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
// IMPORTANT: Reduced to once daily at 23:59 to conserve API calls for manual reports
// GPS51 API Limits: 1440 + (devices × 5) calls/day + 10 requests/minute
// With 256 devices: ~2,720 calls/day allowed
// At 1 check/day: ~257 calls/day (leaves 2,463 calls for manual reports)
// Check starts at 23:59 and completes ~40 minutes later (email sent around 00:30-00:40 next day)
// This ensures ALL violations from 00:00:00 to 23:59:59 are captured in the daily report
const CHECK_INTERVAL = '59 23 * * *'; // Once daily at 23:59 (11:59 PM)
/** After midnight: export previous calendar day to trips/ (staggered from overspeed to reduce GPS51 contention). */
const TRIPS_DAILY_CRON = '30 1 * * *'; // 01:30 — ~1.5h after typical overspeed run completes
/** Daily mileage threshold scan + end-of-month full fleet snapshot (local server time). */
const MILEAGE_CRON = '0 12 * * *';
/** Daily offline snapshot export (local server time). */
const OFFLINE_CRON = '0 10 * * *';
/** Daily parking report — previous calendar day, ≥5 min stops (local server time). */
const PARKING_CRON = '0 15 * * *';

let credentials = {
  token: process.env.MONITOR_TOKEN || '',
  username: process.env.MONITOR_USERNAME || '',
  password: process.env.MONITOR_PASSWORD || '' // MD5-hashed password for auto-refresh
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function promptCredentials() {
  // Skip prompting if credentials are already loaded from environment
  if (credentials.username && credentials.token) {
    console.log('✓ Using credentials from .env.local');
    if (!credentials.password) {
      console.log('⚠ Warning: MONITOR_PASSWORD not set - auto-refresh disabled');
      console.log('  Add MONITOR_PASSWORD (MD5-hashed) to .env.local for auto-refresh\n');
    } else {
      console.log('✓ Auto-refresh enabled\n');
    }
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    rl.question('Enter your username: ', (username) => {
      rl.question('Enter your token: ', (token) => {
        credentials = { username, token, password: '' };
        console.log('\n✓ Credentials saved\n');
        resolve();
      });
    });
  });
}

/**
 * Refresh the authentication token by logging in again
 */
async function refreshToken() {
  if (!credentials.password) {
    console.error('Cannot refresh token: MONITOR_PASSWORD not set in .env.local');
    return false;
  }

  console.log('🔄 Token expired, attempting to refresh...');
  
  try {
    const response = await fetch('https://api.gps51.com/openapi?action=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'DEVICE',
        from: 'web',
        username: credentials.username,
        password: credentials.password,
        browser: 'MonitoringService',
      }),
    });

    const data = await response.json();
    
    if (data.status === 0 && data.token) {
      credentials.token = data.token;
      console.log('✓ Token refreshed successfully');
      return true;
    } else {
      console.error(`✗ Token refresh failed: ${data.cause}`);
      return false;
    }
  } catch (error) {
    console.error(`✗ Token refresh error: ${error.message}`);
    return false;
  }
}

/**
 * Check if an error response indicates token expiration
 */
function isTokenExpired(data) {
  if (!data) return false;
  const cause = data.cause || '';
  return (
    cause.includes('token_expire') ||
    cause.includes('global_error_token_expire') ||
    cause === 'please login'
  );
}

async function runOverspeedCheck(reportDate = null) {
  const now = new Date();
  const timestamp = now.toISOString();
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  
  if (reportDate) {
    console.log(`\n╔════════════════════════════════════════════════════════════╗`);
    console.log(`║  🔄 CATCH-UP CHECK: ${timeStr} (Report Date: ${reportDate})     ║`);
    console.log(`╚════════════════════════════════════════════════════════════╝`);
    console.log(`[${timestamp}] Starting catch-up overspeed check for ${reportDate}...`);
  } else {
    console.log(`\n╔════════════════════════════════════════════════════════════╗`);
    console.log(`║  🕐 SCHEDULED CHECK: ${timeStr} (Daily Report - 23:59 Start)  ║`);
    console.log(`╚════════════════════════════════════════════════════════════╝`);
    console.log(`[${timestamp}] Starting automated overspeed check...`);
  }
  console.log(`📧 Email will be sent in ~40 minutes (processing time)\n`);

  try {
    const requestBody = {
      token: credentials.token,
      username: credentials.username
    };
    
    // Add reportDate if this is a catch-up check
    if (reportDate) {
      requestBody.reportDate = reportDate;
    }
    
    let response = await fetch(`${API_URL}/api/monitor-overspeed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    // Check if response is JSON before parsing
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error(`✗ API returned non-JSON response (status ${response.status}):`);
      console.error(text.substring(0, 200)); // Show first 200 chars
      console.log(`Next check tomorrow at 23:59...\n`);
      return;
    }

    let data = await response.json();

    // Check if token expired and try to refresh
    if (isTokenExpired(data)) {
      const refreshed = await refreshToken();
      
      if (refreshed) {
        // Retry with new token (preserve reportDate for catch-up checks)
        console.log('🔄 Retrying with new token...');
        const retryBody = {
          token: credentials.token,
          username: credentials.username
        };
        
        // Preserve reportDate if this is a catch-up check
        if (reportDate) {
          retryBody.reportDate = reportDate;
        }
        
        response = await fetch(`${API_URL}/api/monitor-overspeed`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(retryBody),
        });
        
        // Check content-type again
        const retryContentType = response.headers.get('content-type');
        if (!retryContentType || !retryContentType.includes('application/json')) {
          const text = await response.text();
          console.error(`✗ API returned non-JSON response after retry (status ${response.status}):`);
          console.error(text.substring(0, 200));
          console.log(`Next check tomorrow at 23:59...\n`);
          return;
        }
        
        data = await response.json();
      } else {
        console.error('✗ Failed to refresh token. Please update MONITOR_PASSWORD in .env.local');
        console.log(`Next check tomorrow at 23:59...\n`);
        return;
      }
    }

    if (data.status === 0) {
      if (data.violations > 0) {
        console.log(`✓ Check complete: ${data.violations} violations found`);
        console.log(`  Report saved: ${data.reportFile}`);
      } else {
        console.log('✓ Check complete: No violations found');
      }
    } else {
      console.error(`✗ Check failed: ${data.cause || 'Unknown error'}`);
    }
  } catch (error) {
    console.error(`✗ Error running check:`, error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack.split('\n').slice(0, 3).join('\n'));
    }
  }

  console.log(`✅ Check complete. Next check tomorrow at 23:59...\n`);
}

async function runTripsDailyExport(reportDate = null) {
  const now = new Date();
  const timestamp = now.toISOString();
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

  if (reportDate) {
    console.log(`\n[TripsDaily] ${timeStr} — export for calendar day ${reportDate} (${timestamp})`);
  } else {
    console.log(`\n[TripsDaily] ${timeStr} — scheduled export (${timestamp})`);
  }

  try {
    const requestBody = {
      token: credentials.token,
      username: credentials.username,
    };
    if (reportDate) {
      requestBody.reportDate = reportDate;
    }

    let response = await fetch(`${API_URL}/api/trips-daily`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error(`[TripsDaily] Non-JSON response (${response.status}): ${text.substring(0, 200)}`);
      return;
    }

    let data = await response.json();

    if (isTokenExpired(data)) {
      const refreshed = await refreshToken();
      if (refreshed) {
        const retryBody = { token: credentials.token, username: credentials.username };
        if (reportDate) retryBody.reportDate = reportDate;
        response = await fetch(`${API_URL}/api/trips-daily`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(retryBody),
        });
        const ct2 = response.headers.get('content-type');
        if (!ct2 || !ct2.includes('application/json')) {
          const text = await response.text();
          console.error(`[TripsDaily] Non-JSON after retry (${response.status}): ${text.substring(0, 200)}`);
          return;
        }
        data = await response.json();
      } else {
        console.error('[TripsDaily] Token refresh failed; skipping export.');
        return;
      }
    }

    if (data.status === 0) {
      console.log(
        `[TripsDaily] OK — file=${data.reportFile || 'n/a'} tripRows=${data.tripRows ?? '?'} devices=${data.deviceCount ?? '?'}`
      );
    } else {
      console.error(`[TripsDaily] Failed: ${data.cause || 'Unknown error'}`);
    }
  } catch (error) {
    console.error(`[TripsDaily] Error: ${error.message}`);
  }
}

function isLastDayOfMonth(d) {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return next.getDate() === 1;
}

async function runMileageScheduled(mode, reportDate = null) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  console.log(`\n[MileageScheduled] ${timeStr} — mode=${mode}${reportDate ? ` reportDate=${reportDate}` : ''}`);

  try {
    const requestBody = {
      token: credentials.token,
      username: credentials.username,
      mode,
    };
    if (reportDate) {
      requestBody.reportDate = reportDate;
    }

    let response = await fetch(`${API_URL}/api/mileage-scheduled`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      timeout: 2 * 60 * 60 * 1000,
    });

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error(`[MileageScheduled] Non-JSON (${response.status}): ${text.substring(0, 200)}`);
      return;
    }

    let data = await response.json();

    if (isTokenExpired(data)) {
      const refreshed = await refreshToken();
      if (refreshed) {
        const retryBody = { token: credentials.token, username: credentials.username, mode };
        if (reportDate) retryBody.reportDate = reportDate;
        response = await fetch(`${API_URL}/api/mileage-scheduled`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(retryBody),
          timeout: 2 * 60 * 60 * 1000,
        });
        const ct2 = response.headers.get('content-type');
        if (!ct2 || !ct2.includes('application/json')) {
          const text = await response.text();
          console.error(`[MileageScheduled] Non-JSON after retry (${response.status}): ${text.substring(0, 200)}`);
          return;
        }
        data = await response.json();
      } else {
        console.error('[MileageScheduled] Token refresh failed; skipping.');
        return;
      }
    }

    if (data.status === 0) {
      console.log(
        `[MileageScheduled] OK mode=${mode} file=${data.reportFile || 'none'} emailSent=${data.emailSent ?? 'n/a'} qualifying=${data.qualifyingCount ?? 'n/a'}`
      );
    } else {
      console.error(`[MileageScheduled] Failed: ${data.cause || 'Unknown error'}`);
    }
  } catch (error) {
    console.error(`[MileageScheduled] Error: ${error.message}`);
  }
}

async function runOfflineScheduled(reportDate = null) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  console.log(`\n[OfflineScheduled] ${timeStr}${reportDate ? ` reportDate=${reportDate}` : ''}`);

  try {
    const requestBody = {
      token: credentials.token,
      username: credentials.username,
      offlinehours: 0,
    };
    if (reportDate) {
      requestBody.reportDate = reportDate;
    }

    let response = await fetch(`${API_URL}/api/offline-scheduled`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      timeout: 60 * 60 * 1000,
    });

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error(`[OfflineScheduled] Non-JSON (${response.status}): ${text.substring(0, 200)}`);
      return;
    }

    let data = await response.json();
    if (isTokenExpired(data)) {
      const refreshed = await refreshToken();
      if (!refreshed) {
        console.error('[OfflineScheduled] Token refresh failed; skipping.');
        return;
      }
      const retryBody = { token: credentials.token, username: credentials.username, offlinehours: 0 };
      if (reportDate) retryBody.reportDate = reportDate;
      response = await fetch(`${API_URL}/api/offline-scheduled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retryBody),
        timeout: 60 * 60 * 1000,
      });
      const ct2 = response.headers.get('content-type');
      if (!ct2 || !ct2.includes('application/json')) {
        const text = await response.text();
        console.error(`[OfflineScheduled] Non-JSON after retry (${response.status}): ${text.substring(0, 200)}`);
        return;
      }
      data = await response.json();
    }

    if (data.status === 0) {
      console.log(
        `[OfflineScheduled] OK file=${data.reportFile || 'n/a'} offline=${data.offlineCount ?? '?'} devices=${data.deviceCount ?? '?'}`
      );
    } else {
      console.error(`[OfflineScheduled] Failed: ${data.cause || 'Unknown error'}`);
    }
  } catch (error) {
    console.error(`[OfflineScheduled] Error: ${error.message}`);
  }
}

async function runParkingScheduled(reportDate = null) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  console.log(`\n[ParkingScheduled] ${timeStr}${reportDate ? ` reportDate=${reportDate}` : ''}`);

  try {
    const requestBody = {
      token: credentials.token,
      username: credentials.username,
    };
    if (reportDate) {
      requestBody.reportDate = reportDate;
    }

    let response = await fetch(`${API_URL}/api/parking-scheduled`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      timeout: 60 * 60 * 1000,
    });

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error(`[ParkingScheduled] Non-JSON (${response.status}): ${text.substring(0, 200)}`);
      return;
    }

    let data = await response.json();
    if (isTokenExpired(data)) {
      const refreshed = await refreshToken();
      if (!refreshed) {
        console.error('[ParkingScheduled] Token refresh failed; skipping.');
        return;
      }
      const retryBody = { token: credentials.token, username: credentials.username };
      if (reportDate) retryBody.reportDate = reportDate;
      response = await fetch(`${API_URL}/api/parking-scheduled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retryBody),
        timeout: 60 * 60 * 1000,
      });
      const ct2 = response.headers.get('content-type');
      if (!ct2 || !ct2.includes('application/json')) {
        const text = await response.text();
        console.error(`[ParkingScheduled] Non-JSON after retry (${response.status}): ${text.substring(0, 200)}`);
        return;
      }
      data = await response.json();
    }

    if (data.status === 0) {
      console.log(
        `[ParkingScheduled] OK file=${data.reportFile || 'n/a'} rows=${data.rowCount ?? '?'} devices=${data.deviceCount ?? '?'}`
      );
    } else {
      console.error(`[ParkingScheduled] Failed: ${data.cause || 'Unknown error'}`);
    }
  } catch (error) {
    console.error(`[ParkingScheduled] Error: ${error.message}`);
  }
}

async function waitForServer(maxAttempts = 20, delayMs = 1000) {
  console.log('⏳ Waiting for Next.js server to be ready...');
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${API_URL}/dashboard`, { 
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      });
      
      if (response.ok || response.status === 401 || response.status === 403) {
        // Server is responding (200, 401, 403 all mean server is up)
        console.log('✓ Next.js server is ready!\n');
        return true;
      }
    } catch (error) {
      // Server not ready yet, continue waiting
    }
    
    // Wait before next attempt
    if (i < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  console.log('⚠ Server check timeout - proceeding anyway...\n');
  return false;
}

/**
 * For queued violation emails with a missing .xlsx (moved path or never written), run a full
 * monitor for that calendar day so generated_reports/ has the file before POST /failed-emails retries.
 */
async function ensureViolationReportsForFailedQueue() {
  const queuePath = path.join(process.cwd(), 'overspeed_reports', 'failed_email_queue.json');
  if (!fs.existsSync(queuePath)) return;

  let queue;
  try {
    queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  } catch {
    return;
  }
  if (!Array.isArray(queue)) return;

  const generatedDir = path.join(process.cwd(), 'generated_reports');
  const resolveViolationPath = (entry) => {
    if (entry.type !== 'violations' || !entry.dateStr) return true;
    if (entry.filePath && fs.existsSync(entry.filePath)) return true;
    const name = entry.filename || `overspeed_daily_report_${entry.dateStr}.xlsx`;
    return fs.existsSync(path.join(generatedDir, name));
  };

  const seen = new Set();
  for (const entry of queue) {
    if (entry.type !== 'violations' || !entry.dateStr) continue;
    if (resolveViolationPath(entry)) continue;
    if (seen.has(entry.dateStr)) continue;
    seen.add(entry.dateStr);
    console.log(`📄 Missing report file for queued email (${entry.dateStr}). Regenerating via monitor before resend...`);
    await runOverspeedCheck(entry.dateStr);
  }
}

async function retryFailedEmailsOnStartup() {
  try {
    console.log('📨 Checking failed email queue for immediate resend...');
    const response = await fetch(`${API_URL}/api/monitor-overspeed/failed-emails`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.log(`⚠ Failed-email retry endpoint returned non-JSON (${response.status}): ${text.substring(0, 120)}`);
      return;
    }

    const data = await response.json();
    if (response.ok && data.status === 0) {
      if ((data.retried || 0) > 0) {
        console.log(`📨 Failed-email retry complete: retried=${data.retried}, sent=${data.sent}, failed=${data.failed}`);
      } else {
        console.log('📨 No failed emails pending');
      }
    } else {
      console.log(`⚠ Failed-email retry could not complete: ${data.message || data.cause || 'unknown error'}`);
    }
  } catch (error) {
    console.log(`⚠ Failed-email retry startup check failed: ${error.message}`);
  }
}

async function startService() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Mantrac Fleet Monitoring (overspeed + trips export)   ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log('Configuration:');
  console.log(`  - Speed Limit: 120 km/h`);
  console.log(`  - Duration Threshold: 60 seconds`);
  console.log(`  - Overspeed check: Once daily at 23:59 (11:59 PM)`);
  console.log(`  - Trips Excel export: Once daily at 01:30 — previous day → trips/ (no email)`);
  console.log(`  - Mileage: Daily at 12:00 — vehicles in completed 4000 km odometer segment → Excel+email; monthly full snapshot last day of month`);
  console.log(`  - Offline: Daily at 10:00 — offline snapshot Excel saved to offline_reports/`);
  console.log(`  - Catch-up: Runs on startup if prior day artifacts are missing`);
  console.log(`  - Email Reports: Overspeed only, sent around 00:30 AM (~40 min after 23:59 start)`);
  console.log(`  - Data Coverage: Complete day 00:00:00 to 23:59:59`);
  console.log(`  - Rate Limit: 8 requests/minute (GPS51 limit: 10/min)`);
  console.log(`  - API URL: ${API_URL}`);
  console.log(`\n⚠️  API Usage Compliance:`);
  console.log(`  - Daily API limit: ~2,720 calls`);
  console.log(`  - Automated usage: ~257 overspeed + ~256 trips ≈ 513 calls/day (plus manual)`);
  console.log(`  - All violations logged to overspeed_logs.txt as backup\n`);

  // Prompt for credentials
  await promptCredentials();

  // Wait for Next.js server to be ready (up to 20 seconds)
  await waitForServer(20, 1000);

  // Ensure Excel exists for any queued violation emails, then retry SMTP
  await ensureViolationReportsForFailedQueue();
  await retryFailedEmailsOnStartup();

  // Catch-up if previous calendar day has no completion marker and no daily Excel
  let now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD format
  const reportsDir = path.join(process.cwd(), 'generated_reports');
  const yesterdayXlsx = path.join(reportsDir, `overspeed_daily_report_${yesterdayStr}.xlsx`);
  const yesterdayMarker = path.join(reportsDir, `daily_complete_${yesterdayStr}.marker`);
  const reportComplete =
    fs.existsSync(yesterdayXlsx) || fs.existsSync(yesterdayMarker);

  if (!reportComplete) {
    console.log('⚠️  MISSED REPORT DETECTED!');
    console.log(`   Previous day (${yesterdayStr}) has no saved report or completion marker.`);
    console.log(`   Running immediate catch-up check for ${yesterdayStr}...\n`);
    
    // Run immediate check for missed report (yesterday's data)
    await runOverspeedCheck(yesterdayStr);
    
    console.log('\n✅ Catch-up check complete. Resuming normal schedule...\n');
  } else {
    console.log('✅ Previous calendar day already completed (Excel and/or completion marker).');
    if (fs.existsSync(yesterdayXlsx)) {
      console.log(`   Report file: overspeed_daily_report_${yesterdayStr}.xlsx\n`);
    } else {
      console.log(`   (No-violation day: daily_complete_${yesterdayStr}.marker)\n`);
    }
  }

  const tripsDir = path.join(process.cwd(), 'trips');
  const yesterdayTripsXlsx = path.join(tripsDir, `trips_daily_report_${yesterdayStr}.xlsx`);
  if (!fs.existsSync(yesterdayTripsXlsx)) {
    console.log(`⚠️  Missing trips export for ${yesterdayStr}. Running trips catch-up…\n`);
    await runTripsDailyExport(yesterdayStr);
    console.log('\n✅ Trips catch-up finished.\n');
  } else {
    console.log(`✅ Trips export present: trips_daily_report_${yesterdayStr}.xlsx\n`);
  }

  // Calculate next scheduled check time (23:59 today or tomorrow)
  // Update 'now' to get fresh timestamp after potential catch-up check
  now = new Date();
  const nextCheck = new Date(now);
  nextCheck.setHours(23, 59, 0, 0);
  
  // If it's already past 23:59 today, schedule for tomorrow
  if (now.getHours() === 23 && now.getMinutes() >= 59) {
    nextCheck.setDate(nextCheck.getDate() + 1);
  }
  
  const timeUntilCheck = nextCheck - now;
  const hoursUntil = Math.floor(timeUntilCheck / (1000 * 60 * 60));
  const minutesUntil = Math.floor((timeUntilCheck % (1000 * 60 * 60)) / (1000 * 60));
  
  console.log('📅 Schedule Information:');
  console.log(`  - Next check: ${nextCheck.toLocaleString()} (in ${hoursUntil}h ${minutesUntil}m)`);
  console.log(`  - Check starts at: 23:59 (11:59 PM) daily`);
  console.log(`  - Email sent around: 00:30-00:40 AM - ~40 min after check starts`);
  console.log(`  - Report will include: ALL violations from 00:00:00 to 23:59:59`);
  console.log(`  - Generated reports: generated_reports/ (365-day retention)`);
  console.log(`  - Trip exports: trips/ (365-day retention, list/download in dashboard)\n`);
  console.log(`  - Backup logs: overspeed_reports/overspeed_logs.txt\n`);

  // Schedule recurring checks (no initial check to conserve API calls)
  console.log('✅ Service started successfully. Press Ctrl+C to stop.\n');
  console.log('⏳ Waiting for scheduled time (23:59)...\n');
  
  // Health monitoring: Track last successful activities
  let lastHeartbeat = new Date();
  let lastCronCheck = new Date();
  let cronJobActive = true;

  /** Last time each cron callback started (local time string for logs). */
  const lastCronRunAt = {
    overspeed: null,
    trips: null,
    mileage: null,
    offline: null,
    parking: null,
  };

  function logCronRegistry() {
    console.log('📅 Registered cron jobs (server local time):');
    console.log(`   1) Overspeed   ${CHECK_INTERVAL}  → 23:59 daily`);
    console.log(`   2) Trips       ${TRIPS_DAILY_CRON}  → 01:30 daily (previous day → trips/)`);
    console.log(`   3) Offline     ${OFFLINE_CRON}  → 10:00 daily (offline_reports/)`);
    console.log(`   4) Mileage     ${MILEAGE_CRON}  → 12:00 daily (+ monthly on last calendar day)`);
    console.log(`   5) Parking     ${PARKING_CRON}  → 15:00 daily (parking_reports/, previous day)`);
    console.log('   Each job logs when it starts ([CRON …]) and when work finishes.\n');
  }
  logCronRegistry();

  // Schedule with error handling and trigger confirmation
  let cronJob = cron.schedule(CHECK_INTERVAL, async () => {
    const t = new Date().toLocaleString();
    lastCronRunAt.overspeed = t;
    console.log(`\n🔔 [CRON overspeed] START ${t} — pattern ${CHECK_INTERVAL}`);
    cronJobActive = true;
    lastCronCheck = new Date();
    try {
      await runOverspeedCheck();
      console.log(`✅ [CRON overspeed] END ${new Date().toLocaleString()}`);
    } catch (error) {
      console.error(`\n❌ [CRON overspeed] ERROR ${new Date().toLocaleString()}`);
      console.error(error);
      console.error('Stack:', error.stack);
    }
  });

  console.log(`📋 Overspeed cron: ${cronJob ? 'SUCCESS' : 'FAILED'} — ${CHECK_INTERVAL}`);

  const tripsCronJob = cron.schedule(TRIPS_DAILY_CRON, async () => {
    const t = new Date().toLocaleString();
    lastCronRunAt.trips = t;
    console.log(`\n🔔 [CRON trips] START ${t} — pattern ${TRIPS_DAILY_CRON}`);
    try {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const yStr = y.toISOString().split('T')[0];
      await runTripsDailyExport(yStr);
      console.log(`✅ [CRON trips] END ${new Date().toLocaleString()}`);
    } catch (error) {
      console.error(`❌ [CRON trips] ERROR ${new Date().toLocaleString()}`, error);
    }
  });
  console.log(`📋 Trips daily cron: ${tripsCronJob ? 'SUCCESS' : 'FAILED'} — ${TRIPS_DAILY_CRON}`);

  const mileageCronJob = cron.schedule(MILEAGE_CRON, async () => {
    const t = new Date().toLocaleString();
    lastCronRunAt.mileage = t;
    console.log(`\n🔔 [CRON mileage] START ${t} — pattern ${MILEAGE_CRON}`);
    try {
      await runMileageScheduled('daily');
      const now = new Date();
      if (isLastDayOfMonth(now)) {
        console.log(`   [CRON mileage] Last day of month → running monthly snapshot…`);
        await runMileageScheduled('monthly');
      }
      console.log(`✅ [CRON mileage] END ${new Date().toLocaleString()}`);
    } catch (error) {
      console.error(`❌ [CRON mileage] ERROR ${new Date().toLocaleString()}`, error);
    }
  });
  console.log(`📋 Mileage cron: ${mileageCronJob ? 'SUCCESS' : 'FAILED'} — ${MILEAGE_CRON}\n`);

  const offlineCronJob = cron.schedule(OFFLINE_CRON, async () => {
    const t = new Date().toLocaleString();
    lastCronRunAt.offline = t;
    console.log(`\n🔔 [CRON offline] START ${t} — pattern ${OFFLINE_CRON}`);
    try {
      await runOfflineScheduled();
      console.log(`✅ [CRON offline] END ${new Date().toLocaleString()}`);
    } catch (error) {
      console.error(`❌ [CRON offline] ERROR ${new Date().toLocaleString()}`, error);
    }
  });
  console.log(`📋 Offline cron: ${offlineCronJob ? 'SUCCESS' : 'FAILED'} — ${OFFLINE_CRON}`);

  const parkingCronJob = cron.schedule(PARKING_CRON, async () => {
    const t = new Date().toLocaleString();
    lastCronRunAt.parking = t;
    console.log(`\n🔔 [CRON parking] START ${t} — pattern ${PARKING_CRON}`);
    try {
      await runParkingScheduled();
      console.log(`✅ [CRON parking] END ${new Date().toLocaleString()}`);
    } catch (error) {
      console.error(`❌ [CRON parking] ERROR ${new Date().toLocaleString()}`, error);
    }
  });
  console.log(`📋 Parking cron: ${parkingCronJob ? 'SUCCESS' : 'FAILED'} — ${PARKING_CRON}`);

  /** Next wall-clock run from `from` (local): hour (0–23), minute (0–59). */
  function msUntilNextLocalWallClock(from, hour, minute) {
    const target = new Date(from.getFullYear(), from.getMonth(), from.getDate(), hour, minute, 0, 0);
    if (target <= from) {
      target.setDate(target.getDate() + 1);
    }
    return target - from;
  }

  function formatCountdown(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
  }

  // Heartbeat: Every 30 minutes — server health + all scheduled crons
  setInterval(async () => {
    const currentTime = new Date();
    lastHeartbeat = currentTime;

    // Overspeed next 23:59
    const nextOverspeed = new Date(currentTime);
    nextOverspeed.setHours(23, 59, 0, 0);
    if (currentTime.getHours() === 23 && currentTime.getMinutes() >= 59) {
      nextOverspeed.setDate(nextOverspeed.getDate() + 1);
    }
    const msOverspeed = nextOverspeed - currentTime;

    // Must match TRIPS_DAILY_CRON, OFFLINE_CRON, MILEAGE_CRON, PARKING_CRON
    const msTrips = msUntilNextLocalWallClock(currentTime, 1, 30);
    const msOffline = msUntilNextLocalWallClock(currentTime, 10, 0);
    const msMileage = msUntilNextLocalWallClock(currentTime, 12, 0);
    const msParking = msUntilNextLocalWallClock(currentTime, 15, 0);

    const overspeedReg = Boolean(cronJob);
    const tripsReg = Boolean(tripsCronJob);
    const offlineReg = Boolean(offlineCronJob);
    const mileageReg = Boolean(mileageCronJob);
    const parkingReg = Boolean(parkingCronJob);
    const cronStatus = cronJobActive && cronJob ? '🟢 ACTIVE' : '🔴 INACTIVE';
    const cronHealth = cronJobActive && cronJob ? 'HEALTHY' : '⚠️ FAILED';

    let nextjsStatus = '🔴 DOWN';
    let nextjsHealth = 'UNREACHABLE';
    try {
      const response = await fetch(`${API_URL}/dashboard`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok || response.status === 401 || response.status === 403) {
        nextjsStatus = '🟢 UP';
        nextjsHealth = 'HEALTHY';
      }
    } catch (error) {
      nextjsStatus = '🔴 DOWN';
      nextjsHealth = 'UNREACHABLE';
    }

    console.log(`\n💚 [HEARTBEAT] ${currentTime.toLocaleString()} (every 30m)`);
    console.log(`   🟢 Monitoring Service: RUNNING`);
    console.log(`   ${nextjsStatus} Next.js Server: ${nextjsHealth}`);
    console.log(`   📅 Scheduled crons (local server time):`);
    console.log(
      `      • Overspeed  ${CHECK_INTERVAL}  registered=${overspeedReg ? 'yes' : 'NO'}  ${cronStatus} ${cronHealth}  next in ${formatCountdown(msOverspeed)} (at ${nextOverspeed.toLocaleTimeString()})  last START=${lastCronRunAt.overspeed || '—'}`
    );
    console.log(
      `      • Trips      ${TRIPS_DAILY_CRON}  registered=${tripsReg ? 'yes' : 'NO'}  next in ${formatCountdown(msTrips)} (at 01:30)  last START=${lastCronRunAt.trips || '—'}`
    );
    console.log(
      `      • Offline    ${OFFLINE_CRON}  registered=${offlineReg ? 'yes' : 'NO'}  next in ${formatCountdown(msOffline)} (at 10:00)  last START=${lastCronRunAt.offline || '—'}`
    );
    console.log(
      `      • Mileage    ${MILEAGE_CRON}  registered=${mileageReg ? 'yes' : 'NO'}  next in ${formatCountdown(msMileage)} (at 12:00)  last START=${lastCronRunAt.mileage || '—'}`
    );
    console.log(
      `      • Parking    ${PARKING_CRON}  registered=${parkingReg ? 'yes' : 'NO'}  next in ${formatCountdown(msParking)} (at 15:00)  last START=${lastCronRunAt.parking || '—'}`
    );
    
    // CRITICAL WARNING if Next.js is down
    if (nextjsHealth === 'UNREACHABLE') {
      console.log(`\n   ⛔ CRITICAL: Next.js server is DOWN!`);
      console.log(`   ⛔ Scheduled checks at 23:59 will FAIL until server is restarted!`);
      console.log(`   ⛔ Run: npm run dev (starts both services together)\n`);
    }
    
    // Verify cron job is still scheduled - attempt restart if needed
    if (!cronJob || !cronJobActive) {
      console.log(`   ⚠️  WARNING: Cron job appears inactive - attempting restart...`);
      try {
        // Stop old job if it exists
        if (cronJob) {
          cronJob.stop();
        }
        
        // Recreate cron job
        cronJob = cron.schedule(CHECK_INTERVAL, async () => {
          const t = new Date().toLocaleString();
          lastCronRunAt.overspeed = t;
          console.log(`\n🔔 [CRON overspeed] START ${t} — pattern ${CHECK_INTERVAL}`);
          cronJobActive = true;
          lastCronCheck = new Date();
          try {
            await runOverspeedCheck();
            console.log(`✅ [CRON overspeed] END ${new Date().toLocaleString()}`);
          } catch (error) {
            console.error(`\n❌ [CRON overspeed] ERROR ${new Date().toLocaleString()}`);
            console.error('Error during scheduled check:', error);
            console.error('Stack:', error.stack);
          }
        });
        
        cronJobActive = true;
        console.log(`   ✅ Cron job restarted successfully!`);
      } catch (error) {
        console.error(`   ❌ Failed to restart cron job:`, error.message);
        cronJobActive = false;
      }
    }
    
    console.log();
  }, 30 * 60 * 1000); // Every 30 minutes
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down monitoring service...');
  rl.close();
  process.exit(0);
});

// Start the service
startService().catch(error => {
  console.error('Failed to start service:', error);
  process.exit(1);
});
