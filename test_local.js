'use strict';
/**
 * Pure local unit test — no Railway, no real SMS
 * Mocks GHL API calls, runs the full conversation state machine
 * Usage: node test_local.js [branch]
 *   branch: A (questions), B (bills), C (greenbutton), or omit for interactive
 */

// ── MOCK GHL ────────────────────────────────────────────────
const SENT_MESSAGES = [];
const mock = {
  contactId: 'mock-contact-123',
  convoId:   'mock-convo-456',
};

// Patch fetch before loading server logic
global.fetch = async (url, opts) => {
  const path = url.replace('https://services.leadconnectorhq.com', '');
  const method = opts?.method || 'GET';
  const body = opts?.body ? JSON.parse(opts.body) : null;

  if (path.includes('/contacts/search/duplicate')) {
    // Always return the mock contact so sendSMS works
    return { status: 200, json: async () => ({ contact: { id: mock.contactId } }), text: async () => JSON.stringify({ contact: { id: mock.contactId } }) };
  }
  if (path.includes('/contacts') && method === 'POST') {
    return { status: 200, json: async () => ({ contact: { id: mock.contactId } }), text: async () => JSON.stringify({ contact: { id: mock.contactId } }) };
  }
  if (path.includes('/contacts/') && method === 'PUT') {
    return { status: 200, json: async () => ({}), text: async () => '{}' };
  }
  if (path.includes('/opportunities')) {
    return { status: 201, json: async () => ({ opportunity: { id: 'mock-opp-789' } }), text: async () => '{}' };
  }
  if (path.includes('/conversations/search')) {
    const resp = { conversations: [{ id: mock.convoId }] };
    return { status: 200, json: async () => resp, text: async () => JSON.stringify(resp) };
  }
  if (path.includes('/conversations/messages') && method === 'POST') {
    SENT_MESSAGES.push(body?.message || body?.body || '');
    console.log(`\n← [AG EQUITY] ${body?.message || ''}\n`);
    const resp = { id: 'mock-msg-' + Date.now() };
    return { status: 200, json: async () => resp, text: async () => JSON.stringify(resp) };
  }
  if (path.includes('/conversations') && method === 'POST') {
    const resp = { conversation: { id: mock.convoId } };
    return { status: 200, json: async () => resp, text: async () => JSON.stringify(resp) };
  }
  // Default
  return { status: 200, json: async () => ({}), text: async () => '{}' };
};

// Suppress oauth module
require.extensions['.js_orig'] = require.extensions['.js'];
const Module = require('module');
const orig = Module._resolveFilename;

// ── LOAD SERVER LOGIC ────────────────────────────────────────
// Extract just the handle() function by re-implementing the minimal parts
// (avoids loading express/starting HTTP server)
process.env.GHL_TOKEN = 'mock-token';
process.env.LOCATION_ID = 'NcJddt6h22VLqrHhSygt';
process.env.PIPELINE_ID = 'SKQWcAOZruZpjfHBKzvJ';
process.env.STAGE_NEW   = 'd6183c88-f08c-4df4-b849-fc8a158f6818';
process.env.AARON_PHONE = '+15550009999';
process.env.TIM_PHONE   = '+15550008888';
process.env.PRIMARY_NUM = '+15598447093';
process.env.PORT        = '39999'; // won't actually bind

// We'll inline the core logic rather than fighting module loading
const PRIMARY_NUM = process.env.PRIMARY_NUM;
const LOCATION_ID = process.env.LOCATION_ID;
const PIPELINE_ID = process.env.PIPELINE_ID;
const STAGE_NEW   = process.env.STAGE_NEW;
const AARON_PHONE = process.env.AARON_PHONE;
const TIM_PHONE   = process.env.TIM_PHONE;
const GREENBUTTON = 'https://utilityapi.com/pge/gb-oauth/tcali_powerequitygroup';

const FIELD_IDS = {
  crop: 'i4igaiT4AY69N2HTw3IK', utility: 'D25tSKkWhXGI3tA5ot9N',
  bill: 'fcc2LG0v4cmE2uPGalCE', watering: 'x5Khrfy5y3twesQmNOoM',
  rateSchedule: 'qNk5COQTIF3gdi9qQZaM', wateringMonths: 'S0MYh8Cuv8OGr0HUg4zT',
  intakeMethod: '2W6rJZzMhnGFo2J8JYY1', intakeSource: '5Pb91i8u6aZ1q0ZuVLlE',
};

function toE164(phone) {
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return '+' + digits;
}

const STATE = {};
function getState(p)       { return STATE[p] || {}; }
function setState(p, data) { STATE[p] = { ...STATE[p], ...data, ts: Date.now() }; }
function clearState(p)     { delete STATE[p]; }

async function ghl(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Authorization': 'Bearer mock', 'Content-Type': 'application/json', 'Version': '2021-07-28' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch('https://services.leadconnectorhq.com' + path, opts);
  const text = await r.text();
  try { return JSON.parse(text); } catch { return {}; }
}

async function findOrCreateContact(phone) {
  const s = await ghl(`/contacts/search/duplicate?locationId=${LOCATION_ID}&number=${encodeURIComponent(phone)}`);
  if (s.contact?.id) return s.contact;
  const c = await ghl('/contacts', 'POST', { locationId: LOCATION_ID, phone });
  return c.contact || {};
}

async function updateContact(contactId, fields, tags = []) {
  const customFields = Object.entries(fields).filter(([k]) => FIELD_IDS[k]).map(([k, v]) => ({ id: FIELD_IDS[k], field_value: String(v) }));
  return ghl(`/contacts/${contactId}`, 'PUT', { tags, customFields, ...(fields.firstName ? { firstName: fields.firstName } : {}), ...(fields.lastName ? { lastName: fields.lastName } : {}), ...(fields.email ? { email: fields.email } : {}) });
}

async function addToPipeline(contactId) {
  return ghl('/opportunities/', 'POST', { pipelineId: PIPELINE_ID, locationId: LOCATION_ID, name: 'SMS Lead', pipelineStageId: STAGE_NEW, contactId, status: 'open' });
}

async function getOrCreateConvo(contactId) {
  const s = await ghl(`/conversations/search?locationId=${LOCATION_ID}&contactId=${contactId}`);
  if (s.conversations?.[0]?.id) return s.conversations[0].id;
  const n = await ghl('/conversations', 'POST', { locationId: LOCATION_ID, contactId });
  return n.conversation?.id;
}

async function sendSMS(toPhone, message, fromPhone = PRIMARY_NUM, knownContactId = null) {
  let contactId = knownContactId;
  if (!contactId) {
    const contact = await findOrCreateContact(toPhone);
    contactId = contact?.id;
  }
  if (!contactId) { console.error('No contact for', toPhone); return; }
  const convoId = await getOrCreateConvo(contactId);
  if (!convoId) { console.error('No convo'); return; }
  return ghl('/conversations/messages', 'POST', { type: 'SMS', conversationId: convoId, contactId, message, fromNumber: fromPhone, toNumber: toPhone });
}

async function notifyTeam(data) {
  const msg = `🌾 NEW CORE LEAD\nName: ${data.name||'Unknown'}\nPhone: ${data.phone}\nCrop: ${data.crop||'—'}\nCounty: ${data.county||'—'}\nBill: ${data.bill||'—'}\nUtility: ${data.utility||'—'}\nMethod: ${data.method}`;
  console.log('\n📲 TEAM ALERT:', msg);
}

const M = {
  opening: `Hi! Thanks for contacting Ag Equity.\n\nWe help Central Valley farmers cut pump energy costs — $0 upfront.\n\nReply:\nA - Answer a few quick questions\nB - Send a photo of your utility bill\nC - Share your bill data securely online`,
  a_q1: `Great! What is your full name?`,
  a_q2: (n) => `Thanks ${n}! What county is your farm in?`,
  a_q3: `What crop do you grow? (almonds, walnuts, pistachios, grapes, grain, etc.)`,
  a_q4: `Who is your utility — PG&E or SCE?`,
  a_q5: `What is your approximate annual utility bill? (e.g. $45,000)`,
  a_q6: `Last one — what is your typical watering schedule? (e.g. 24 hrs on, 48 hrs off)`,
  a_done: (n) => `Thank you ${n}! We will build your custom 25-year energy analysis and reach out within 48 hours.\n\nQuestions? Call (559) 844-7093.\n\n— Ag Equity`,
  b_name:   `Sure! First — what is your full name?`,
  b_upload: (n) => `Thanks ${n}! Please send your utility bill photos one at a time. Reply DONE when finished.`,
  b_got:    `Got it! Send the next one or reply DONE when finished.`,
  b_done:   (n, count) => `Got it ${n}! We received ${count} bill photo${count !== 1 ? 's' : ''}. Our team will have your custom energy analysis ready within 48 hours.\n\n— Ag Equity`,
  c_link:   `No problem — share your PG&E data securely here:\n\n${GREENBUTTON}\n\nTakes about 2 minutes. Reply DONE when finished, or send bill photos instead.`,
  c_done:   (n) => `Thank you ${n||'there'}! Our team will pull your utility data and have your custom analysis ready within 48 hours.\n\n— Ag Equity`,
};

const first = (name) => (name || '').split(' ')[0] || 'there';

async function handle(phone, rawMsg) {
  const msg = (rawMsg || '').trim().toUpperCase();
  const s   = getState(phone);

  if (!s.step) {
    if (msg.includes('CORE') || msg.includes('SOLAR') || msg.includes('PUMP') || msg.includes('ENERGY') || msg.includes('BILL')) {
      const contact = await findOrCreateContact(phone);
      const cid = contact?.id;
      if (cid) { await addToPipeline(cid); await updateContact(cid, { intakeSource: 'SMS' }, ['sms-intake']); }
      setState(phone, { step: 'opening', contactId: cid });
      await sendSMS(phone, M.opening, PRIMARY_NUM, cid);
    }
    return;
  }

  const cid = s.contactId;

  if (s.step === 'opening') {
    if (msg === 'A') { setState(phone, { step: 'a_q1', branch: 'questions' }); await sendSMS(phone, M.a_q1, PRIMARY_NUM, cid); return; }
    if (msg === 'B') { setState(phone, { step: 'b_name', branch: 'bills', billCount: 0 }); await sendSMS(phone, M.b_name, PRIMARY_NUM, cid); return; }
    if (msg === 'C') { setState(phone, { step: 'c_wait', branch: 'greenbutton' }); await sendSMS(phone, M.c_link, PRIMARY_NUM, cid); return; }
    await sendSMS(phone, `Please reply A, B, or C to continue.`, PRIMARY_NUM, cid);
    return;
  }

  if (s.branch === 'questions') {
    switch (s.step) {
      case 'a_q1': setState(phone, { step: 'a_q2', name: rawMsg.trim() }); await sendSMS(phone, M.a_q2(first(rawMsg)), PRIMARY_NUM, cid); break;
      case 'a_q2': setState(phone, { step: 'a_q3', county: rawMsg.trim() }); await sendSMS(phone, M.a_q3, PRIMARY_NUM, cid); break;
      case 'a_q3': setState(phone, { step: 'a_q4', crop: rawMsg.trim() }); await sendSMS(phone, M.a_q4, PRIMARY_NUM, cid); break;
      case 'a_q4': setState(phone, { step: 'a_q5', utility: rawMsg.trim() }); await sendSMS(phone, M.a_q5, PRIMARY_NUM, cid); break;
      case 'a_q5': setState(phone, { step: 'a_q6', bill: rawMsg.trim() }); await sendSMS(phone, M.a_q6, PRIMARY_NUM, cid); break;
      case 'a_q6': {
        setState(phone, { step: 'done', watering: rawMsg.trim() });
        const st = getState(phone);
        await sendSMS(phone, M.a_done(first(st.name)), PRIMARY_NUM, cid);
        if (st.contactId) {
          const parts = (st.name || '').split(' ');
          await updateContact(st.contactId, { firstName: parts[0], lastName: parts.slice(1).join(' '), crop: st.crop, utility: st.utility, bill: st.bill, watering: st.watering, intakeMethod: 'Questions' }, ['postcard-lead', 'sms-intake', 'questions-complete']);
        }
        await notifyTeam({ name: st.name, phone, crop: st.crop, county: st.county, bill: st.bill, utility: st.utility, method: 'Branch A — Questions' });
        clearState(phone);
        break;
      }
    }
    return;
  }

  if (s.branch === 'bills') {
    if (s.step === 'b_name') { setState(phone, { step: 'b_upload', name: rawMsg.trim(), billCount: 0 }); await sendSMS(phone, M.b_upload(first(rawMsg)), PRIMARY_NUM, cid); return; }
    if (s.step === 'b_upload') {
      if (msg === 'DONE') {
        const st = getState(phone);
        await sendSMS(phone, M.b_done(first(st.name), st.billCount || 0), PRIMARY_NUM, cid);
        if (st.contactId) { const parts = (st.name||'').split(' '); await updateContact(st.contactId, { firstName: parts[0], lastName: parts.slice(1).join(' '), intakeMethod: 'Bills' }, ['postcard-lead', 'sms-intake', 'bill-upload']); }
        await notifyTeam({ name: st.name, phone, method: `Branch B — Bill Photos (${st.billCount||0} received)` });
        clearState(phone);
      } else { setState(phone, { billCount: (s.billCount||0)+1 }); await sendSMS(phone, M.b_got, PRIMARY_NUM, cid); }
      return;
    }
  }

  if (s.branch === 'greenbutton' && msg === 'DONE') {
    const st = getState(phone);
    await sendSMS(phone, M.c_done(first(st.name)), PRIMARY_NUM, cid);
    if (st.contactId) await updateContact(st.contactId, { intakeMethod: 'GreenButton' }, ['postcard-lead', 'sms-intake', 'greenbutton-sent']);
    await notifyTeam({ name: st.name||'Unknown', phone, method: 'Branch C — Green Button Auth' });
    clearState(phone);
  }
}

// ── RUN AUTOMATED OR INTERACTIVE ─────────────────────────────
const PHONE = '+15550001234';

const SCRIPTS = {
  A: ['CORE', 'A', 'Harpreet Singh', 'Fresno', 'Almonds', 'PG&E', '$68,000', '24 hrs on, 48 hrs off'],
  B: ['CORE', 'B', 'Gurpreet Sandhu', 'photo1', 'photo2', 'DONE'],
  C: ['CORE', 'C', 'DONE'],
};

async function runScript(name) {
  const steps = SCRIPTS[name];
  if (!steps) { console.error('Unknown script. Use A, B, or C'); process.exit(1); }
  console.log(`\n${'='.repeat(60)}\nRunning Branch ${name} script\n${'='.repeat(60)}\n`);
  for (const step of steps) {
    console.log(`→ [YOU] ${step}`);
    await handle(PHONE, step);
    await new Promise(r => setTimeout(r, 100));
  }
  console.log('\n✅ Script complete\n');
}

async function interactive() {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(r => rl.question(q, r));
  console.log('\n' + '='.repeat(60));
  console.log('CORE SMS — Local Interactive Test (mocked GHL)');
  console.log('Type messages as a farmer would. Ctrl+C to quit.');
  console.log('='.repeat(60) + '\n');
  while (true) {
    const input = await ask('YOU: ');
    if (!input.trim()) continue;
    await handle(PHONE, input.trim());
  }
}

const branch = process.argv[2]?.toUpperCase();
if (branch && SCRIPTS[branch]) {
  runScript(branch).catch(console.error);
} else {
  interactive().catch(console.error);
}
