const BASE = 'http://localhost:5055/api/v1';
let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${detail ?? ''}`); }
}
async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: res.status, body: json, text };
}

const run = async () => {
  const { Client } = await import('pg');
  const bcrypt = (await import('bcrypt')).default;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  async function makeUser(label) {
    const email = `${label}${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
    await req('POST', '/auth/register', { body: { full_name: label, email, password: 'Passw0rd!' } });
    const hash = await bcrypt.hash('123456', 10);
    await client.query(`UPDATE registration_otp_table SET otp_hash = $1 WHERE user_id = (SELECT id FROM user_table WHERE email = $2)`, [hash, email]);
    await req('POST', '/auth/verify-email', { body: { email, otp: '123456' } });
    const login = await req('POST', '/auth/login', { body: { email, password: 'Passw0rd!' } });
    return { email, token: login.body.data.access_token, id: login.body.data.user.id };
  }

  const owner = await makeUser('ow2');
  const helper = await makeUser('hl2');
  const tags = (await req('GET', '/meta/subjects')).body.data.slice(0, 1).map((t) => t.id);

  const request = await req('POST', '/requests', { token: owner.token, body: {
    title: 'Request uji reject completion',
    description: 'Deskripsi request untuk menguji penolakan penyelesaian pekerjaan.',
    estimated_time: 'fast',
    deadline_at: new Date(Date.now() + 86400000).toISOString(),
    budget_amount: 10000,
    tag_ids: tags,
  }});
  const requestId = request.body.data.id;
  const assign = await req('POST', `/requests/${requestId}/assignments`, { token: owner.token, body: { helper_id: helper.id } });
  const assignmentId = assign.body.data.id;

  await req('POST', `/assignments/${assignmentId}/agreement/approve`, { token: owner.token });
  await req('POST', `/assignments/${assignmentId}/agreement/approve`, { token: helper.token });
  await client.query(`INSERT INTO wallet_table (user_id, balance, held) VALUES ($1, 50000, 0)
    ON CONFLICT (user_id) DO UPDATE SET balance = 50000, held = 0`, [owner.id]);
  const fund = await req('POST', `/assignments/${assignmentId}/fund`, { token: owner.token });
  check('fund ok', fund.status === 200, `${fund.status} ${fund.text}`);

  console.log('=== reject completion ===');
  const complete = await req('POST', `/assignments/${assignmentId}/completion`, { token: helper.token, body: { reason: 'Selesai' } });
  check('completion requested', complete.status === 201, complete.status);

  const reject = await req('POST', `/assignments/${assignmentId}/completion/reject`, { token: owner.token, body: { reason: 'Belum sesuai' } });
  check('completion rejected', reject.status === 200, `${reject.status} ${reject.text}`);
  check('assignment still ON_PROGRESS', reject.body.data.status === 'ON_PROGRESS', reject.body?.data?.status);
  check('no double release', (await req('GET', '/me/wallet', { token: helper.token })).body.data.balance === 0);

  const secondComplete = await req('POST', `/assignments/${assignmentId}/completion`, { token: helper.token, body: {} });
  check('can re-request completion', secondComplete.status === 201, `${secondComplete.status} ${secondComplete.text}`);

  console.log('=== cancellation after funding ===');
  const cancel = await req('POST', `/assignments/${assignmentId}/cancellation`, { token: owner.token, body: { reason: 'Batal setelah dana' } });
  check('cancellation requested', cancel.status === 200, `${cancel.status} ${cancel.text}`);
  check('assignment still ON_PROGRESS pending', cancel.body.data.status === 'ON_PROGRESS', cancel.body?.data?.status);

  const selfConfirm = await req('POST', `/assignments/${assignmentId}/cancellation/confirm`, { token: owner.token });
  check('self confirm cancel rejected', selfConfirm.status === 403, selfConfirm.status);

  const confirm = await req('POST', `/assignments/${assignmentId}/cancellation/confirm`, { token: helper.token });
  check('cancellation confirmed', confirm.status === 200, `${confirm.status} ${confirm.text}`);
  check('assignment CANCELLED', confirm.body.data.status === 'CANCELLED', confirm.body?.data?.status);

  const walletAfter = await req('GET', '/me/wallet', { token: owner.token });
  check('refund restored balance', walletAfter.body.data.balance === 50000 && walletAfter.body.data.held === 0, JSON.stringify(walletAfter.body.data));

  const requestAfter = await req('GET', `/requests/${requestId}`, { token: owner.token });
  check('request reopened', requestAfter.body.data.status === 'OPEN', requestAfter.body?.data?.status);

  console.log('=== pending request collisions ===');
  const req2 = await req('POST', '/requests', { token: owner.token, body: {
    title: 'Request uji konflik pending',
    description: 'Deskripsi request untuk menguji konflik permintaan yang menunggu.',
    estimated_time: 'fast',
    deadline_at: new Date(Date.now() + 86400000).toISOString(),
    budget_amount: 10000,
    tag_ids: tags,
  }});
  const request2 = req2.body.data.id;
  const assign2 = await req('POST', `/requests/${request2}/assignments`, { token: owner.token, body: { helper_id: helper.id } });
  check('assign again after cancel allowed', assign2.status === 201, `${assign2.status} ${assign2.text}`);
  const assignment2 = assign2.body.data.id;
  await req('POST', `/assignments/${assignment2}/agreement/approve`, { token: owner.token });
  await req('POST', `/assignments/${assignment2}/agreement/approve`, { token: helper.token });
  await client.query(`UPDATE wallet_table SET balance = 50000, held = 0 WHERE user_id = $1`, [owner.id]);
  await req('POST', `/assignments/${assignment2}/fund`, { token: owner.token });

  const c1 = await req('POST', `/assignments/${assignment2}/completion`, { token: helper.token, body: {} });
  check('first completion pending', c1.status === 201, c1.status);
  const c2 = await req('POST', `/assignments/${assignment2}/completion`, { token: owner.token, body: {} });
  check('second completion blocked while pending', c2.status === 409, `${c2.status} ${c2.text}`);

  const cc1 = await req('POST', `/assignments/${assignment2}/cancellation`, { token: owner.token, body: { reason: 'x' } });
  check('cancellation during pending completion', cc1.status === 200, `${cc1.status} ${cc1.text}`);

  console.log('=== duplicate reply and withdraw guard ===');
  const dupReply1 = await req('POST', `/requests/${request2}/replies`, { token: helper.token, body: { message: 'pertama' } });
  check('helper reply after assignment?', dupReply1.status === 409 || dupReply1.status === 201, dupReply1.status);

  const withdrawNoAccount = await req('POST', '/me/withdrawals', { token: owner.token, body: { amount: 50000, bank_account_id: 999999 } });
  check('withdrawal 501 regardless of account', withdrawNoAccount.status === 501, withdrawNoAccount.status);

  const belowMin = await req('POST', '/me/withdrawals', { token: owner.token, body: { amount: 5000, bank_account_id: 1 } });
  check('withdrawal min validated first', belowMin.status === 400, `${belowMin.status} ${belowMin.text}`);

  const bank = await req('POST', '/me/bank-accounts', { token: owner.token, body: {
    bank_code: 'BCA', account_number: '1234567890', account_name: 'Owner', is_primary: true,
  }});
  check('bank account created', bank.status === 201, `${bank.status} ${bank.text}`);
  check('account number masked', bank.body.data.account_number_masked.endsWith('7890'), bank.body?.data?.account_number_masked);
  check('no full number stored', bank.body.data.account_number === undefined);

  const banks = await req('GET', '/me/bank-accounts', { token: owner.token });
  check('bank list', banks.status === 200 && banks.body.data.length === 1, banks.status);

  await client.end();
  console.log(`\nRESULT pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
};
run().catch((e) => { console.error('CRASH', e); process.exit(2); });
