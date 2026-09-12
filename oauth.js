'use strict';
const fs   = require('fs');
const path = require('path');

const TOKEN_FILE    = path.join(__dirname, 'ghl_tokens.json');
const CLIENT_ID     = process.env.GHL_CLIENT_ID     || '6aa48e56b7b07a5f06ec2c7c-mtxm1u4v';
const CLIENT_SECRET = process.env.GHL_CLIENT_SECRET || '3566736d-522b-442b-b0de-3207ab033dfd';
const REDIRECT_URI  = process.env.GHL_REDIRECT_URI  || 'https://core-sms-intake-production.up.railway.app/oauth/callback';
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
  if (!tokens || !tokens.refresh_token) throw new Error('No refresh token — visit /oauth/authorize first');

  const r = await fetch(GHL_BASE + '/oauth/token', {
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
  if (!tokens || !tokens.access_token) return refreshAccessToken();

  const savedAt   = tokens.savedAt  || 0;
  const expiresIn = tokens.expires_in || 86400;
  const expiresAt = savedAt + (expiresIn * 1000);
  const tenMin    = 10 * 60 * 1000;

  if (Date.now() > expiresAt - tenMin) {
    console.log('Token expiring soon — refreshing...');
    return refreshAccessToken();
  }
  return tokens.access_token;
}

async function exchangeCode(code) {
  const r = await fetch(GHL_BASE + '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type:    'authorization_code',
      code:          code,
      redirect_uri:  REDIRECT_URI,
    }),
  });
  const data = await r.json();
  if (!data.access_token) throw new Error('Code exchange failed: ' + JSON.stringify(data));
  saveTokens(data);
  console.log('OAuth complete — location:', data.locationId);
  return data;
}

function getAuthUrl(state) {
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri:  REDIRECT_URI,
    client_id:     CLIENT_ID,
    scope: [
      'contacts.readonly','contacts.write',
      'conversations.readonly','conversations.write',
      'conversations/message.readonly','conversations/message.write',
      'opportunities.write','locations.readonly',
    ].join(' '),
    state: state || 'agequity',
  });
  return 'https://marketplace.gohighlevel.com/oauth/chooselocation?' + params.toString();
}

module.exports = { getAccessToken, refreshAccessToken, exchangeCode, getAuthUrl, loadTokens };
