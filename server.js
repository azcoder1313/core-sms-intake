'use strict';
const express = require('express');
const { getAccessToken, exchangeCode, getAuthUrl, loadTokens } = require('./oauth');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── CONFIG ────────────────────────────────────────────────
const LOCATION_ID = process.env.LOCATION_ID || 'NcJddt6h22VLqrHhSygt';
const PIPELINE_ID = process.env.PIPELINE_ID || 'SKQWcAOZruZpjfHBKzvJ';
const STAGE_NEW      = process.env.STAGE_NEW      || 'd6183c88-f08c-4df4-b849-fc8a158f6818';
const STAGE_HOT_LEAD = process.env.STAGE_HOT_LEAD || 'aa2b01e1-704a-4d99-aa52-9575fd35d06f';
const AARON_PHONE = process.env.AARON_PHONE || '+14159090825';
const TIM_PHONE   = process.env.TIM_PHONE   || '+15102092955';
const PRIMARY_NUM = process.env.PRIMARY_NUM || '+15598447093';
const GREENBUTTON = 'https://utilityapi.com/pge/gb-oauth/tcali_powerequitygroup';

const FIELD_IDS = {
  crop:          'i4igaiT4AY69N2HTw3IK',
  utility:       'D25tSKkWhXGI3tA5ot9N',
  bill:          'fcc2LG0v4cmE2uPGalCE',
  watering:      'x5Khrfy5y3twesQmNOoM',
  rateSchedule:  'qNk5COQTIF3gdi9qQZaM',
  wateringMonths:'S0MYh8Cuv8OGr0HUg4zT',
  intakeMethod:  '2W6rJZzMhnGFo2J8JYY1',
  intakeSource:  '5Pb91i8u6aZ1q0ZuVLlE',
};

// ── HELPERS ──────────────────────────────────────────────
function toE164(phone) {
  // Strip everything except digits and leading +
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length === 10) return '+1' + digits;        // US 10-digit
  if (digits.length === 11 && digits[0] === '1') return '+' + digits; // US with country code
  return '+' + digits; // fallback
}

// ── IN-MEMORY STATE ───────────────────────────────────────
const STATE = {};
function getState(phone)        { return STATE[phone] || {}; }
function setState(phone, data)  { STATE[phone] = { ...STATE[phone], ...data, ts: Date.now() }; }
function clearState(phone)      { delete STATE[phone]; }

// ── GHL API ───────────────────────────────────────────────
async function ghl(path, method = 'GET', body = null) {
  const token = await getAccessToken();
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const url = `https://services.leadconnectorhq.com${path}`;
  console.log(`GHL ${method} ${path.split('?')[0]}`);
  const r = await fetch(url, opts);
  console.log(`GHL ${method} ${path.split('?')[0]} → ${r.status}`);
  if (r.status === 204) return {};
  const text = await r.text();
  try { return JSON.parse(text); } catch { console.error('GHL non-JSON:', text.slice(0,200)); return {}; }
}

async function findOrCreateContact(phone, extras = {}) {
  const s = await ghl(`/contacts/search/duplicate?locationId=${LOCATION_ID}&number=${encodeURIComponent(phone)}`);
  if (s.contact?.id) return s.contact;
  const c = await ghl('/contacts', 'POST', { locationId: LOCATION_ID, phone, ...extras });
  return c.contact || {};
}

async function updateContact(contactId, fields, tags = []) {
  const customFields = Object.entries(fields)
    .filter(([k]) => FIELD_IDS[k])
    .map(([k, v]) => ({ id: FIELD_IDS[k], field_value: String(v) }));
  return ghl(`/contacts/${contactId}`, 'PUT', {
    tags, customFields,
    ...(fields.firstName ? { firstName: fields.firstName } : {}),
    ...(fields.lastName  ? { lastName:  fields.lastName  } : {}),
    ...(fields.email     ? { email:     fields.email     } : {}),
  });
}

async function addToPipeline(contactId, stageId = STAGE_NEW) {
  const result = await ghl('/opportunities/', 'POST', {
    pipelineId: PIPELINE_ID,
    locationId: LOCATION_ID,
    name: 'SMS Lead',
    pipelineStageId: stageId,
    contactId,
    status: 'open',
  });
  console.log('addToPipeline result:', JSON.stringify(result).slice(0,200));
  return result;
}

async function getOrCreateConvo(contactId) {
  const s = await ghl(`/conversations/search?locationId=${LOCATION_ID}&contactId=${contactId}`);
  if (s.conversations?.[0]?.id) return s.conversations[0].id;
  const n = await ghl('/conversations', 'POST', { locationId: LOCATION_ID, contactId });
  return n.conversation?.id;
}

async function sendSMS(toPhone, message, fromPhone = PRIMARY_NUM, knownContactId = null) {
  try {
    console.log(`sendSMS → ${toPhone} (${message.slice(0,40)})`);
    let contactId = knownContactId;
    if (!contactId) {
      const contact = await findOrCreateContact(toPhone);
      if (!contact?.id) { console.error('No contact for', toPhone); return; }
      contactId = contact.id;
    }
    console.log('contact id:', contactId);
    const convoId = await getOrCreateConvo(contactId);
    if (!convoId) { console.error('No convo for', toPhone); return; }
    console.log('convo id:', convoId);
    const result = await ghl('/conversations/messages', 'POST', {
      type: 'SMS',
      conversationId: convoId,
      contactId,
      message,
      fromNumber: fromPhone,
      toNumber: toPhone,
    });
    console.log('sendSMS result:', JSON.stringify(result).slice(0,200));
    return result;
  } catch (e) { console.error('sendSMS error:', e.message, e.stack); }
}

async function notifyTeam(data) {
  const msg =
`🌾 NEW CORE LEAD
Name: ${data.name || 'Unknown'}
Phone: ${data.phone}
Crop: ${data.crop || '—'}
County: ${data.county || '—'}
Bill: ${data.bill || '—'}
Utility: ${data.utility || '—'}
Method: ${data.method}`;
  await Promise.all([
    sendSMS(AARON_PHONE, msg),
    sendSMS(TIM_PHONE,   msg),
  ]);
}

// ── MESSAGE COPY ──────────────────────────────────────────
const M = {
  opening:
`Hi! Thanks for contacting Ag Equity.

We help Central Valley farmers cut pump energy costs — $0 upfront.

Reply:
A - Answer a few quick questions
B - Send a photo of your utility bill
C - Share your bill data securely online`,

  a_q1: `Great! What is your full name?`,
  a_q2: (n) => `Thanks ${n}! What county is your farm in?`,
  a_q3: `What crop do you grow? (almonds, walnuts, pistachios, grapes, grain, etc.)`,
  a_q4: `Who is your utility — PG&E or SCE?`,
  a_q5: `What is your approximate annual utility bill? (e.g. $45,000)`,
  a_q6: `Last one — what is your typical watering schedule? (e.g. 24 hrs on, 48 hrs off)`,
  a_done: (n) =>
`Thank you ${n}! We will build your custom 25-year energy analysis and reach out within 48 hours.

Questions? Call (559) 844-7093.

— Ag Equity`,

  b_name:   `Sure! First — what is your full name?`,
  b_upload: (n) => `Thanks ${n}! Please send your utility bill photos one at a time. Reply DONE when finished.`,
  b_got:    `Got it! Send the next one or reply DONE when finished.`,
  b_done:   (n, count) =>
`Got it ${n}! We received ${count} bill photo${count !== 1 ? 's' : ''}. Our team will have your custom energy analysis ready within 48 hours.

— Ag Equity`,

  c_link:
`No problem — share your PG&E data securely here:

${GREENBUTTON}

Takes about 2 minutes. Reply DONE when finished, or send bill photos instead.`,

  c_done: (n) =>
`Thank you ${n || 'there'}! Our team will pull your utility data and have your custom analysis ready within 48 hours.

— Ag Equity`,

  missed:
`Hi! You just called Ag Equity. We help Central Valley farmers cut pump energy costs.

Text CORE to this number or call back at (559) 844-7093 — we will pick up.

— Ag Equity`,
};

// ── CONVERSATION HANDLER ──────────────────────────────────
async function handle(phone, rawMsg, replyFrom = PRIMARY_NUM) {
  const msg   = (rawMsg || '').trim().toUpperCase();
  const s     = getState(phone);
  const first = (name) => (name || '').split(' ')[0] || 'there';

  // ── New lead trigger ──
  if (!s.step) {
    if (msg.includes('CORE') || msg.includes('SOLAR') || msg.includes('PUMP') ||
        msg.includes('ENERGY') || msg.includes('BILL') || msg === 'CORE') {
      const contact = await findOrCreateContact(phone);
      const cid = contact?.id;
      if (cid) {
        await addToPipeline(cid);
        await updateContact(cid, { intakeSource: 'SMS' }, ['sms-intake']);
      }
      setState(phone, { step: 'opening', contactId: cid, replyFrom });
      await sendSMS(phone, M.opening, replyFrom, cid);
    }
    return;
  }

  // ── Branch selection ──
  const cid = s.contactId;
  const rf  = s.replyFrom || replyFrom;
  if (s.step === 'opening') {
    if (msg === 'A') { setState(phone, { step: 'a_q1', branch: 'questions' }); await sendSMS(phone, M.a_q1, rf, cid); return; }
    if (msg === 'B') { setState(phone, { step: 'b_name', branch: 'bills', billCount: 0 }); await sendSMS(phone, M.b_name, rf, cid); return; }
    if (msg === 'C') { setState(phone, { step: 'c_wait', branch: 'greenbutton' }); await sendSMS(phone, M.c_link, rf, cid); return; }
    await sendSMS(phone, `Please reply A, B, or C to continue.`, rf, cid);
    return;
  }

  // ── Branch A: Questions ──
  if (s.branch === 'questions') {
    switch (s.step) {
      case 'a_q1': setState(phone, { step: 'a_q2', name: rawMsg.trim() }); await sendSMS(phone, M.a_q2(first(rawMsg)), rf, cid); break;
      case 'a_q2': setState(phone, { step: 'a_q3', county: rawMsg.trim() }); await sendSMS(phone, M.a_q3, rf, cid); break;
      case 'a_q3': setState(phone, { step: 'a_q4', crop: rawMsg.trim() }); await sendSMS(phone, M.a_q4, rf, cid); break;
      case 'a_q4': setState(phone, { step: 'a_q5', utility: rawMsg.trim() }); await sendSMS(phone, M.a_q5, rf, cid); break;
      case 'a_q5': setState(phone, { step: 'a_q6', bill: rawMsg.trim() }); await sendSMS(phone, M.a_q6, rf, cid); break;
      case 'a_q6': {
        setState(phone, { step: 'done', watering: rawMsg.trim() });
        const st = getState(phone);
        await sendSMS(phone, M.a_done(first(st.name)), rf, cid);
        if (st.contactId) {
          const parts = (st.name || '').split(' ');
          await updateContact(st.contactId, {
            firstName: parts[0], lastName: parts.slice(1).join(' '),
            crop: st.crop, utility: st.utility, bill: st.bill,
            watering: st.watering, intakeMethod: 'Questions',
          }, ['postcard-lead', 'sms-intake', 'questions-complete']);
        }
        await notifyTeam({ name: st.name, phone, crop: st.crop, county: st.county, bill: st.bill, utility: st.utility, method: 'Branch A — Questions' });
        clearState(phone);
        break;
      }
    }
    return;
  }

  // ── Branch B: Bill photos ──
  if (s.branch === 'bills') {
    if (s.step === 'b_name') {
      setState(phone, { step: 'b_upload', name: rawMsg.trim(), billCount: 0 });
      await sendSMS(phone, M.b_upload(first(rawMsg)), rf, cid);
      return;
    }
    if (s.step === 'b_upload') {
      if (msg === 'DONE') {
        const st = getState(phone);
        await sendSMS(phone, M.b_done(first(st.name), st.billCount || 0), rf, cid);
        if (st.contactId) {
          const parts = (st.name || '').split(' ');
          await updateContact(st.contactId, {
            firstName: parts[0], lastName: parts.slice(1).join(' '),
            intakeMethod: 'Bills',
          }, ['postcard-lead', 'sms-intake', 'bill-upload']);
        }
        await notifyTeam({ name: st.name, phone, method: `Branch B — Bill Photos (${st.billCount || 0} received)` });
        clearState(phone);
      } else {
        setState(phone, { billCount: (s.billCount || 0) + 1 });
        await sendSMS(phone, M.b_got, rf, cid);
      }
      return;
    }
  }

  // ── Branch C: Green Button ──
  if (s.branch === 'greenbutton' && msg === 'DONE') {
    const st = getState(phone);
    await sendSMS(phone, M.c_done(first(st.name)), rf, cid);
    if (st.contactId) {
      await updateContact(st.contactId, { intakeMethod: 'GreenButton' }, ['postcard-lead', 'sms-intake', 'greenbutton-sent']);
    }
    await notifyTeam({ name: st.name || 'Unknown', phone, method: 'Branch C — Green Button Auth' });
    clearState(phone);
  }
}

// ── WEBHOOK ENDPOINTS ─────────────────────────────────────
app.post('/sms', async (req, res) => {
  res.sendStatus(200);
  try {
    const b = req.body;
    const rawPhone = b.from || b.Phone || b.phone || b.contactPhone || b.caller || '';
    const phone   = toE164(rawPhone);
    // Use whichever GHL number they texted — fall back to PRIMARY_NUM
    const rawTo   = b.to || b.To || b.toNumber || b.locationPhone || '';
    const replyFrom = rawTo ? toE164(rawTo) : PRIMARY_NUM;
    const message = b.body || b.message || b.text || 'CORE';
    if (!phone || phone === '+') { console.log('No phone in payload:', JSON.stringify(b).slice(0,200)); return; }
    console.log('SMS from', phone, 'to', replyFrom, ':', message.slice(0,50));
    await handle(phone, message, replyFrom);
  } catch (e) { console.error('SMS error:', e.message); }
});

app.post('/missed-call', async (req, res) => {
  res.sendStatus(200);
  try {
    const b = req.body;
    const rawPhone = b.from || b.Phone || b.phone || b.contactPhone || b.caller || '';
    const rawTo    = b.to || b.To || b.toNumber || b.locationPhone || '';
    const phone    = toE164(rawPhone);
    const replyFrom = rawTo ? toE164(rawTo) : PRIMARY_NUM;
    if (!phone || phone === '+') return;
    console.log('Missed call from', phone);
    // Send auto-text from the number they called
    await sendSMS(phone, M.missed, replyFrom);
    // Create/find contact + add to pipeline at Hot Lead (caller is warmer than texter)
    const contact = await findOrCreateContact(phone);
    if (contact?.id) {
      await addToPipeline(contact.id, STAGE_HOT_LEAD);
      await updateContact(contact.id, { intakeSource: 'Call' }, ['call-lead', 'missed-call', 'sms-intake']);
      // Notify team
      await notifyTeam({ name: contact.firstName || 'Unknown', phone, method: 'Missed Call — auto-texted' });
    }
  } catch (e) { console.error('Missed call error:', e.message); }
});

// ── OAUTH ENDPOINTS ───────────────────────────────────────

// Step 1: Visit this to start OAuth — redirects to GHL
app.get('/oauth/authorize', (req, res) => {
  const url = getAuthUrl('agequity-setup');
  console.log('OAuth authorize redirect to GHL');
  res.redirect(url);
});

// Step 2: GHL redirects here with ?code=xxx after user approves
app.get('/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    console.error('OAuth error:', error);
    return res.send(`<h2>OAuth Error: ${error}</h2>`);
  }
  if (!code) {
    return res.send('<h2>No code received</h2>');
  }
  try {
    const tokens = await exchangeCode(code);
    console.log('OAuth complete — location:', tokens.locationId);
    res.send(`
      <html><body style="font-family:sans-serif;padding:40px;background:#0C2340;color:white;">
        <h2 style="color:#F5A623;">✅ Ag Equity — GHL Connected!</h2>
        <p>OAuth authorization complete. Tokens saved.</p>
        <p>Location ID: <strong>${tokens.locationId || LOCATION_ID}</strong></p>
        <p>Access token expires in: <strong>${tokens.expires_in} seconds</strong></p>
        <p style="color:#68d391;">The server will auto-refresh tokens before they expire. No further action needed.</p>
      </body></html>
    `);
  } catch (e) {
    console.error('Token exchange error:', e.message);
    res.send(`<h2>Error: ${e.message}</h2>`);
  }
});

// Status page
app.get('/oauth/status', (req, res) => {
  const tokens = loadTokens();
  if (!tokens) return res.json({ status: 'not_authorized', action: 'Visit /oauth/authorize to connect GHL' });
  const savedAt   = tokens.savedAt || 0;
  const expiresIn = tokens.expires_in || 86400;
  const expiresAt = new Date(savedAt + expiresIn * 1000);
  res.json({
    status: 'authorized',
    locationId: tokens.locationId,
    expiresAt: expiresAt.toISOString(),
    hasRefreshToken: !!tokens.refresh_token,
  });
});

// Reset state for a phone (testing)
app.get('/reset/:phone', (req, res) => {
  const phone = toE164(decodeURIComponent(req.params.phone));
  const had = !!STATE[phone];
  clearState(phone);
  console.log('Reset state for', phone);
  res.json({ cleared: had, phone });
});

// Show current state (testing)
app.get('/state/:phone', (req, res) => {
  const phone = toE164(decodeURIComponent(req.params.phone));
  res.json(STATE[phone] || { status: 'no state' });
});

// Health
app.get('/',       (req, res) => res.json({ status: 'ok', service: 'CORE SMS Intake', version: '2.0.0' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CORE SMS Intake v2 (OAuth) running on port ${PORT}`);
  // Self-ping every 4 min to prevent Railway sleep
  setInterval(() => {
    fetch(`http://localhost:${PORT}/health`).catch(() => {});
  }, 4 * 60 * 1000);
});
