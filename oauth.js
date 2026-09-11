'use strict';
/**
 * GHL OAuth 2.0 Token Manager
 * Handles authorization, token storage, and auto-refresh
 */

const fs = require('fs');
const path = require('path');

const TOKEN_FILE = path.join(__dirname, 'ghl_tokens.json');

const CLIENT_ID     = proces…NT_ID     || '6aa48e56b7b07a5f06ec2c7c-mtxm1u4v';
const CLIENT_SECRET = proces…NT_SECRET || '3566736d-522b-442b-b0de-3207ab033dfd';
const REDIRECT_URI  = proces…IRECT_URI || 'https://core-sms-intake-production.up.railway.app/oauth/callback';
const GHL_BASE      = 'https://services.leadconnectorhq.com';

function loadTokens() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); }
  catch { return null; }
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ ...tokens, savedAt: Date.now() }, null, 2));
}

async function refreshAccessToken() {
  const tokens = loadTokens();
  if (!tokens?.refresh_token) throw new Error('No refresh token stored — need to authorize first');

  const r = await fetch(`${GHL_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: tokens.refresh_token,
      redirect_uri:  REDIRECT_URI,
    }),
  });

  const data = await r.json();
  if (!data.access_token) throw new Error('Refresh failed: ' + JSON.stringify(data));

  saveTokens(data);
  console.log('GHL token refreshed — expires in', data.expires_in, 'seconds');
  return data.access_token;
}

async function getAccessToken() {
  const tokens = loadTokens();
  if (!tokens?.access_token) {
    // Try to refresh
    return refreshAccessToken();
  }

  // Check if token expires in less than 10 minutes
  const savedAt  = tokens.savedAt || 0;
  const expiresIn = tokens.expires_in || 86400;
  const expiresAt = savedAt + (expiresIn * 1000);
  const tenMinMs  = 10 * 60 * 1000;

  if (Date.now() > expiresAt - tenMinMs) {
    console.log('GHL token expiring soon — refreshing...');
    return refreshAccessToken();
  }

  return tokens.access_token;
}

// Exchange authorization code for tokens (called once during setup)
async function exchangeCode(code) {
  const r = await fetch(`${GHL_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type:    'authorization_code',
      code,
      redirect_uri:  REDIRECT_URI,
    }),
  });

  const data = await r.json();
  if (!data.access_token) throw new Error('Code exchange failed: ' + JSON.stringify(data));

  saveTokens(data);
  console.log('GHL OAuth authorized — location:', data.locationId);
  return data;
}

// Build the authorization URL to send user to
function getAuthUrl(state = 'agequity') {
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri:  REDIRECT_URI,
    client_id:     CLIENT_ID,
    scope: [
      'contacts.readonly',
      'contacts.write',
      'conversations.readonly',
      'conversations.write',
      'conversations/message.readonly',
      'conversations/message.write',
      'opportunities.write',
      'locations.readonly',
    ].join(' '),
    state,
  });
  return `https://marketplace.gohighlevel.com/oauth/chooselocation?${params}`;
}

module.exports = { getAccessToken, refreshAccessToken, exchangeCode, getAuthUrl, loadTokens };
