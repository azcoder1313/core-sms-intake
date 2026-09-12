'use strict';
/**
 * GHL Token Manager — Private Integration
 * Token is set via GHL_TOKEN env var, auto-rotated by cron every 80 days
 */

const GHL_TOKEN = process.env.GHL_TOKEN || 'pit-3e039855-a474-4336-95af-5bf7ab2e5cbd';

async function getAccessToken() {
  return GHL_TOKEN;
}

// Stub for compatibility
function loadTokens() { return { access_token: GHL_TOKEN }; }

module.exports = { getAccessToken, loadTokens };
