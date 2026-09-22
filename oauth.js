'use strict';
/**
 * GHL Token Manager — Private Integration
 * Token is set via GHL_TOKEN env var, auto-rotated by cron every 80 days
 */

const GHL_TOKEN = process.env.GHL_TOKEN;
if (!GHL_TOKEN) throw new Error('GHL_TOKEN env var is required — do not hardcode tokens in source');

async function getAccessToken() {
  return GHL_TOKEN;
}

// Stub for compatibility
function loadTokens() { return { access_token: GHL_TOKEN }; }

module.exports = { getAccessToken, loadTokens };
