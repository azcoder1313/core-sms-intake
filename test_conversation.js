'use strict';
/**
 * Local conversation simulator — no real SMS needed
 * Usage: node test_conversation.js
 * Simulates GHL posting to /sms endpoint, shows full flow
 */

const BASE_URL = process.env.TEST_URL || 'https://core-sms-intake-production.up.railway.app';
const TEST_PHONE = process.env.TEST_PHONE || '+15550001234'; // fake number, clean state every run

const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

async function sendToServer(phone, message) {
  const payload = {
    from: phone,
    body: message,
    locationId: 'NcJddt6h22VLqrHhSygt',
    contactPhone: phone,
  };
  console.log(`\n→ [YOU] ${message}`);
  try {
    const r = await fetch(`${BASE_URL}/sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log(`  (server responded ${r.status})`);
  } catch (e) {
    console.error('  ERROR hitting server:', e.message);
  }
}

async function getLastOutbound(phone) {
  // Poll GHL conversations to see what was sent back
  const TOKEN = process.env.GHL_TOKEN;
  const LOC = 'NcJddt6h22VLqrHhSygt';

  // Find contact
  const sr = await fetch(`https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${LOC}&number=${encodeURIComponent(phone)}`, {
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Version': '2021-07-28' }
  }).then(r => r.json()).catch(() => ({}));

  const contactId = sr.contact?.id;
  if (!contactId) return '(no contact found yet)';

  // Get conversation
  const cr = await fetch(`https://services.leadconnectorhq.com/conversations/search?locationId=${LOC}&contactId=${contactId}&limit=1`, {
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Version': '2021-07-28' }
  }).then(r => r.json()).catch(() => ({}));

  const convoId = cr.conversations?.[0]?.id;
  if (!convoId) return '(no conversation yet)';

  // Get messages
  const mr = await fetch(`https://services.leadconnectorhq.com/conversations/${convoId}/messages?limit=10`, {
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Version': '2021-07-28' }
  }).then(r => r.json()).catch(() => ({}));

  const msgs = mr.messages?.messages || mr.messages || [];
  const outbound = msgs.filter(m => m.direction === 'outbound').sort((a, b) => b.dateAdded - a.dateAdded);
  return outbound[0]?.body || '(no outbound message found)';
}

async function main() {
  console.log('='.repeat(60));
  console.log('CORE SMS Intake — Conversation Simulator');
  console.log(`Server: ${BASE_URL}`);
  console.log(`Test phone: ${TEST_PHONE}`);
  console.log('Type your message, press Enter. Ctrl+C to quit.');
  console.log('='.repeat(60));
  console.log('\nTip: Start with CORE to begin the flow\n');

  while (true) {
    const input = await ask('YOU: ');
    if (!input.trim()) continue;

    await sendToServer(TEST_PHONE, input.trim());

    // Wait a moment for Railway to process + GHL to update
    process.stdout.write('  Waiting for response');
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 800));
      process.stdout.write('.');
    }
    console.log();

    const reply = await getLastOutbound(TEST_PHONE);
    console.log(`\n← [AG EQUITY] ${reply}\n`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
