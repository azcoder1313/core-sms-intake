'use strict';
const express = require('express');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── CONFIG ────────────────────────────────────────────────
const GHL_TOKEN   = process.env.GHL_TOKEN   || 'pit-1e214c52-2442-47b6-a184-2ba78f12bdd4';
const LOCATION_ID = process.env.LOCATION_ID || 'NcJddt6h22VLqrHhSygt';
const PIPELINE_ID = process.env.PIPELINE_ID || 'SKQWcAOZruZpjfHBKzvJ';
const STAGE_NEW   = process.env.STAGE_NEW   || 'd6183c88-f08c-4df4-b849-fc8a158f6818';
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

const GHL_H = {
  'Authorization': `Bearer ${GHL_TOKEN}`,
  'Content-Type': 'application/json',
  'Version': '2021-07-28',
};

// ── IN-MEMORY STATE (resets on restart — fine for low volume) ──
const STATE = {};

function getState(phone) { return STATE[phone] || {}; }
function setState(phone, data) { STATE[phone] = { ...STATE[phone], ...data, ts: Date.now() }; }
function clearState(phone) { delete STATE[phone]; }

// ── GHL API ───────────────────────────────────────────────
async function ghl(path, method = 'GET', body = null) {
  const opts = { method, headers: GHL_H };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`https://services.leadconnectorhq.com${path}`, opts);
  if (r.status === 204) return {};
  return r.json().catch(() => ({}));
}

async function findOrCreateContact(phone, extras = {}) {
  // Search by phone
  const s = await ghl(`/contacts/search/duplicate?locationId=${LOCATION_ID}&number=${encodeURIComponent(phone)}`);
  if (s.contact?.id) return s.contact;
  // Create
  const c = await ghl('/contacts', 'POST', {
    locationId: LOCATION_ID, phone, ...extras,
  });
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
    ...(fields.name      ? { name:      fields.name      } : {}),
  });
}

async function addToPipeline(contactId, stageId = STAGE_NEW) {
  return ghl('/opportunities', 'POST', {
    pipelineId: PIPELINE_ID,
    locationId: LOCATION_ID,
    name: `SMS Lead`,
    pipelineStageId: stageId,
    contactId,
    status: 'open',
  });
}

async function getOrCreateConvo(contactId, phone) {
  const s = await ghl(`/conversations/search?locationId=${LOCATION_ID}&contactId=${contactId}`);
  if (s.conversations?.[0]?.id) return s.conversations[0].id;
  const n = await ghl('/conversations', 'POST', { locationId: LOCATION_ID, contactId });
  return n.conversation?.id;
}

async function sendSMS(toPhone, message, fromPhone = PRIMARY_NUM) {
  try {
    const contact = await findOrCreateContact(toPhone);
    if (!contact?.id) { console.error('No contact for', toPhone); return; }
    const convoId = await getOrCreateConvo(contact.id, toPhone);
    if (!convoId) { console.error('No convo for', toPhone); return; }
    return ghl('/conversations/messages', 'POST', {
      type: 'SMS',
      conversationId: convoId,
      message,
      fromNumber: fromPhone,
      toNumber: toPhone,
    });
  } catch (e) { console.error('sendSMS error:', e.message); }
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

  b_name: `Sure! First — what is your full name?`,
  b_upload: (n) => `Thanks ${n}! Please send your utility bill photos one at a time. Reply DONE when finished.`,
  b_got: `Got it! Send the next one or reply DONE when finished.`,
  b_done: (n, count) =>
`Got it ${n}! We received ${count} bill photo${count !== 1 ? 's' : ''}. Our team will have your custom energy analysis ready within 48 hours.

— Ag Equity`,

  c_link:
`No problem — share your PG&E data securely here:

${GREENBUTTON}

This lets us pull your exact usage directly from PG&E. Takes about 2 minutes. Reply DONE when finished, or send bill photos instead.`,

  c_done: (n) =>
`Thank you ${n || 'there'}! Our team will pull your utility data and have your custom analysis ready within 48 hours.

— Ag Equity`,

  missed:
`Hi! You just called Ag Equity. We help Central Valley farmers cut pump energy costs.

Text CORE to this number or call back at (559) 844-7093 — we will pick up.

— Ag Equity`,
};

// ── MAIN HANDLER ──────────────────────────────────────────
async function handle(phone, rawMsg, hasAttachment = false) {
  const msg  = (rawMsg || '').trim().toUpperCase();
  const s    = getState(phone);
  const first = (name) => (name || '').split(' ')[0] || 'there';

  // ── Trigger ──
  if (!s.step) {
    if (msg.includes('CORE') || msg.includes('SOLAR') || msg.includes('PUMP') || msg.includes('ENERGY') || msg.includes('BILL')) {
      const contact = await findOrCreateContact(phone);
      if (contact?.id) {
        await addToPipeline(contact.id);
        await updateContact(contact.id, { intakeSource: 'SMS', intakeMethod: 'Inbound' }, ['sms-intake']);
      }
      setState(phone, { step: 'opening', contactId: contact?.id });
      await sendSMS(phone, M.opening);
    }
    return;
  }

  // ── Branch selection ──
  if (s.step === 'opening') {
    if (msg === 'A') { setState(phone, { step: 'a_q1', branch: 'questions' }); await sendSMS(phone, M.a_q1); return; }
    if (msg === 'B') { setState(phone, { step: 'b_name', branch: 'bills', billCount: 0 }); await sendSMS(phone, M.b_name); return; }
    if (msg === 'C') { setState(phone, { step: 'c_wait', branch: 'greenbutton' }); await sendSMS(phone, M.c_link); return; }
    // Re-show menu if unrecognized
    await sendSMS(phone, `Please reply A, B, or C.\n\n${M.opening}`);
    return;
  }

  // ── Branch A: Questions ──
  if (s.branch === 'questions') {
    switch (s.step) {
      case 'a_q1': setState(phone, { step: 'a_q2', name: rawMsg.trim() }); await sendSMS(phone, M.a_q2(first(rawMsg))); break;
      case 'a_q2': setState(phone, { step: 'a_q3', county: rawMsg.trim() }); await sendSMS(phone, M.a_q3); break;
      case 'a_q3': setState(phone, { step: 'a_q4', crop: rawMsg.trim() }); await sendSMS(phone, M.a_q4); break;
      case 'a_q4': setState(phone, { step: 'a_q5', utility: rawMsg.trim() }); await sendSMS(phone, M.a_q5); break;
      case 'a_q5': setState(phone, { step: 'a_q6', bill: rawMsg.trim() }); await sendSMS(phone, M.a_q6); break;
      case 'a_q6': {
        setState(phone, { step: 'done', watering: rawMsg.trim() });
        const st = getState(phone);
        const fn = first(st.name);
        await sendSMS(phone, M.a_done(fn));
        // Update GHL
        if (st.contactId) {
          const nameParts = (st.name || '').split(' ');
          await updateContact(st.contactId, {
            firstName: nameParts[0],
            lastName: nameParts.slice(1).join(' '),
            crop: st.crop,
            utility: st.utility,
            bill: st.bill,
            watering: st.watering,
            intakeMethod: 'Questions',
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
      await sendSMS(phone, M.b_upload(first(rawMsg)));
      return;
    }
    if (s.step === 'b_upload') {
      if (msg === 'DONE') {
        const st = getState(phone);
        await sendSMS(phone, M.b_done(first(st.name), st.billCount || 0));
        if (st.contactId) {
          const nameParts = (st.name || '').split(' ');
          await updateContact(st.contactId, {
            firstName: nameParts[0],
            lastName: nameParts.slice(1).join(' '),
            intakeMethod: 'Bills',
          }, ['postcard-lead', 'sms-intake', 'bill-upload']);
        }
        await notifyTeam({ name: st.name, phone, method: `Branch B — Bill Photos (${st.billCount || 0} received)` });
        clearState(phone);
      } else {
        // Photo received (or any other message = another photo)
        setState(phone, { billCount: (s.billCount || 0) + 1 });
        await sendSMS(phone, M.b_got);
      }
      return;
    }
  }

  // ── Branch C: Green Button ──
  if (s.branch === 'greenbutton') {
    if (msg === 'DONE') {
      const st = getState(phone);
      await sendSMS(phone, M.c_done(first(st.name)));
      if (st.contactId) {
        await updateContact(st.contactId, { intakeMethod: 'GreenButton' }, ['postcard-lead', 'sms-intake', 'greenbutton-sent']);
      }
      await notifyTeam({ name: st.name || 'Unknown', phone, method: 'Branch C — Green Button Auth' });
      clearState(phone);
    }
    return;
  }
}

// ── WEBHOOK ENDPOINTS ─────────────────────────────────────

// GHL inbound SMS webhook
// GHL native InboundMessage format: { type, from, body, contactId, locationId, messageType, attachments }
app.post('/sms', async (req, res) => {
  res.sendStatus(200);
  console.log('SMS webhook:', JSON.stringify(req.body).slice(0, 300));
  try {
    const b = req.body;
    // Handle GHL native format AND custom mapped format
    const phone   = b.from || b.phone || b.contactPhone || b.caller || '';
    const message = b.body || b.message || b.text || '';
    const hasAtt  = !!(b.attachments?.length || b.mediaUrls?.length);
    if (!phone) { console.log('No phone in payload'); return; }
    await handle(phone, message, hasAtt);
  } catch (e) { console.error('SMS handler error:', e); }
});

// GHL missed call webhook
// GHL native format: { type: 'MissedCall', from, contactId, locationId }
app.post('/missed-call', async (req, res) => {
  res.sendStatus(200);
  console.log('Missed call:', JSON.stringify(req.body).slice(0, 300));
  try {
    const b = req.body;
    const phone = b.from || b.phone || b.contactPhone || b.caller || '';
    if (!phone) { console.log('No phone in missed call payload'); return; }
    await sendSMS(phone, M.missed);
    const contact = await findOrCreateContact(phone);
    if (contact?.id) {
      await addToPipeline(contact.id);
      await updateContact(contact.id, { intakeSource: 'Call' }, ['call-lead', 'missed-call']);
    }
    console.log('Missed call auto-text sent to', phone);
  } catch (e) { console.error('Missed call error:', e); }
});

// Health check
app.get('/',       (req, res) => res.json({ status: 'ok', service: 'CORE SMS Intake', version: '1.0.0' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CORE SMS Intake running on port ${PORT}`));
