/**
 * Automated Overspeed Monitoring Service
 * Runs every 5 minutes to check for overspeed violations
 */

// Load environment variables from .env.local
require('dotenv').config({ path: '.env.local' });

const cron = require('node-cron');
const fetch = require('node-fetch');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Configuration
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
// IMPORTANT: Reduced to once daily at 23:59 to conserve API calls for manual reports
// GPS51 API Limits: 1440 + (devices × 5) calls/day + 10 requests/minute
// With 256 devices: ~2,720 calls/day allowed
// At 1 check/day: ~257 calls/day (leaves 2,463 calls for manual reports)
// Check starts at 23:59 and completes ~40 minutes later (email sent around 00:30-00:40 next day)
// This ensures ALL violations from 00:00:00 to 23:59:59 are captured in the daily report
const CHECK_INTERVAL = '59 23 * * *'; // Once daily at 23:59 (11:59 PM)

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
  console.log('║   Mantrac Automated Overspeed Monitoring Service        ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log('Configuration:');
  console.log(`  - Speed Limit: 120 km/h`);
  console.log(`  - Duration Threshold: 60 seconds`);
  console.log(`  - Check Interval: Once daily at 23:59 (11:59 PM)`);
  console.log(`  - Catch-up Check: Runs immediately if today's report was missed`);
  console.log(`  - Email Reports: Sent around 00:30 AM (~40 min after check starts)`);
  console.log(`  - Data Coverage: Complete day 00:00:00 to 23:59:59`);
  console.log(`  - Rate Limit: 8 requests/minute (GPS51 limit: 10/min)`);
  console.log(`  - API URL: ${API_URL}`);
  console.log(`\n⚠️  API Usage Compliance:`);
  console.log(`  - Daily API limit: ~2,720 calls`);
  console.log(`  - Automated usage: ~257 calls/day (1 check)`);
  console.log(`  - Available for manual reports: ~2,463 calls/day (90% buffer)`);
  console.log(`  - All violations logged to overspeed_logs.txt as backup\n`);

  // Prompt for credentials
  await promptCredentials();

  // Wait for Next.js server to be ready (up to 20 seconds)
  await waitForServer(20, 1000);

  // Automatically retry any queued failed emails immediately on startup
  await retryFailedEmailsOnStartup();

  // Check if yesterday's report was sent (catch-up logic)
  let now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD format
  const reportsDir = path.join(process.cwd(), 'overspeed_reports');
  const yesterdayReportFile = path.join(reportsDir, `overspeed_daily_report_${yesterdayStr}.xlsx`);
  
  const reportExists = fs.existsSync(yesterdayReportFile);
  
  if (!reportExists) {
    console.log('⚠️  MISSED REPORT DETECTED!');
    console.log(`   Yesterday's report (${yesterdayStr}) was not sent.`);
    console.log(`   Running immediate catch-up check for ${yesterdayStr}...\n`);
    
    // Run immediate check for missed report (yesterday's data)
    await runOverspeedCheck(yesterdayStr);
    
    console.log('\n✅ Catch-up check complete. Resuming normal schedule...\n');
  } else {
    console.log('✅ Yesterday\'s report already sent.');
    console.log(`   Report file: overspeed_daily_report_${yesterdayStr}.xlsx\n`);
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
  console.log(`  - Backup logs: overspeed_reports/overspeed_logs.txt\n`);

  // Schedule recurring checks (no initial check to conserve API calls)
  console.log('✅ Service started successfully. Press Ctrl+C to stop.\n');
  console.log('⏳ Waiting for scheduled time (23:59)...\n');
  
  // Health monitoring: Track last successful activities
  let lastHeartbeat = new Date();
  let lastCronCheck = new Date();
  let cronJobActive = true;
  
  // Schedule with error handling and trigger confirmation
  let cronJob = cron.schedule(CHECK_INTERVAL, async () => {
    console.log(`\n🔔 [CRON TRIGGER] ${new Date().toLocaleString()} - Scheduled check triggered!`);
    cronJobActive = true;
    lastCronCheck = new Date();
    try {
      await runOverspeedCheck();
    } catch (error) {
      console.error(`\n❌ [CRON ERROR] ${new Date().toLocaleString()}`);
      console.error('Error during scheduled check:', error);
      console.error('Stack:', error.stack);
    }
  });
  
  // Verify cron job was scheduled
  console.log(`📋 Cron job scheduled: ${cronJob ? 'SUCCESS' : 'FAILED'}`);
  console.log(`📋 Cron pattern: ${CHECK_INTERVAL} (59 23 * * * = Every day at 23:59)\n`);

  // Heartbeat: Every 30 minutes - monitor service health and cron job
  setInterval(async () => {
    const currentTime = new Date();
    lastHeartbeat = currentTime;
    
    // Calculate next check time
    const nextCheckTime = new Date(currentTime);
    nextCheckTime.setHours(23, 59, 0, 0);
    
    // If past 23:59 today, next check is tomorrow
    if (currentTime.getHours() === 23 && currentTime.getMinutes() >= 59) {
      nextCheckTime.setDate(nextCheckTime.getDate() + 1);
    }
    
    const msUntilCheck = nextCheckTime - currentTime;
    const hoursRemaining = Math.floor(msUntilCheck / (1000 * 60 * 60));
    const minutesRemaining = Math.floor((msUntilCheck % (1000 * 60 * 60)) / (1000 * 60));
    
    // Check if cron job is still running
    const cronStatus = cronJobActive && cronJob ? '🟢 ACTIVE' : '🔴 INACTIVE';
    const cronHealth = cronJobActive && cronJob ? 'HEALTHY' : '⚠️ FAILED';
    
    // CHECK IF NEXT.JS SERVER IS ACTUALLY REACHABLE
    let nextjsStatus = '🔴 DOWN';
    let nextjsHealth = 'UNREACHABLE';
    try {
      const response = await fetch(`${API_URL}/dashboard`, { 
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      if (response.ok || response.status === 401 || response.status === 403) {
        nextjsStatus = '🟢 UP';
        nextjsHealth = 'HEALTHY';
      }
    } catch (error) {
      // Next.js server is down or unreachable
      nextjsStatus = '🔴 DOWN';
      nextjsHealth = 'UNREACHABLE';
    }
    
    console.log(`\n💚 [HEARTBEAT] ${currentTime.toLocaleString()}`);
    console.log(`   🟢 Monitoring Service: RUNNING`);
    console.log(`   ${nextjsStatus} Next.js Server: ${nextjsHealth}`);
    console.log(`   ${cronStatus} Cron Job: ${cronHealth}`);
    console.log(`   ⏰ Next check in: ${hoursRemaining}h ${minutesRemaining}m (at ${nextCheckTime.toLocaleTimeString()})`);
    
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
          console.log(`\n🔔 [CRON TRIGGER] ${new Date().toLocaleString()} - Scheduled check triggered!`);
          cronJobActive = true;
          lastCronCheck = new Date();
          try {
            await runOverspeedCheck();
          } catch (error) {
            console.error(`\n❌ [CRON ERROR] ${new Date().toLocaleString()}`);
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
