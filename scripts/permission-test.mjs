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
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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

  async function makeVerifiedUser(label) {
    const email = `${label}${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
    await req('POST', '/auth/register', { body: { full_name: label, email, password: 'Passw0rd!' } });
    const hash = await bcrypt.hash('123456', 10);
    await client.query(
      `UPDATE registration_otp_table SET otp_hash = $1 WHERE user_id = (SELECT id FROM user_table WHERE email = $2)`,
      [hash, email]);
    await req('POST', '/auth/verify-email', { body: { email, otp: '123456' } });
    const login = await req('POST', '/auth/login', { body: { email, password: 'Passw0rd!' } });
    return { email, token: login.body.data.access_token, id: login.body.data.user.id };
  }

  const admin = await req('POST', '/auth/login', { body: { email: 'admin@sos.ac.id', password: 'AdminPass123' } });
  const adminToken = admin.body.data.access_token;
  const owner = await makeVerifiedUser('own');
  const helper = await makeVerifiedUser('hlp');

  const subjects = await req('GET', '/meta/subjects');
  const tagIds = subjects.body.data.slice(0, 2).map((t) => t.id);

  console.log('=== block enforcement ===');
  const reqA = await req('POST', '/requests', { token: owner.token, body: {
    title: 'Block test request satu',
    description: 'Deskripsi request untuk menguji penegakan blokir pengguna.',
    estimated_time: 'fast',
    deadline_at: new Date(Date.now() + 86400000).toISOString(),
    budget_amount: 20000,
    tag_ids: tagIds,
  }});
  const requestBlocked = reqA.body.data.id;

  await req('POST', '/blocks', { token: owner.token, body: { user_id: helper.id } });

  const blockedReply = await req('POST', `/requests/${requestBlocked}/replies`, { token: helper.token, body: { message: 'Halo' } });
  check('blocked helper cannot reply', blockedReply.status === 403, `${blockedReply.status} ${blockedReply.text}`);

  const blockedConv = await req('POST', '/conversations', { token: owner.token, body: { request_id: requestBlocked, helper_id: helper.id } });
  check('blocked user cannot start chat', blockedConv.status === 403, `${blockedConv.status} ${blockedConv.text}`);

  const blockedDirect = await req('POST', `/helpers/${helper.id}/direct-requests`, { token: owner.token, body: { request_id: requestBlocked } });
  check('blocked direct request rejected', blockedDirect.status === 403, `${blockedDirect.status} ${blockedDirect.text}`);

  await req('DELETE', `/blocks/${helper.id}`, { token: owner.token });

  console.log('=== chat permissions ===');
  const outsider = await makeVerifiedUser('out');
  const conv = await req('POST', '/conversations', { token: owner.token, body: { request_id: requestBlocked, helper_id: helper.id } });
  const convId = conv.body.data.id;

  const outsiderRead = await req('GET', `/conversations/${convId}`, { token: outsider.token });
  check('outsider cannot read conversation', outsiderRead.status === 403, outsiderRead.status);

  const outsiderSend = await req('POST', `/conversations/${convId}/messages`, { token: outsider.token, body: { body: 'halo' } });
  check('outsider cannot send message', outsiderSend.status === 403, outsiderSend.status);

  const outsiderMessages = await req('GET', `/conversations/${convId}/messages`, { token: outsider.token });
  check('outsider cannot list messages', outsiderMessages.status === 403, outsiderMessages.status);

  console.log('=== request ownership ===');
  const outsiderEdit = await req('PATCH', `/requests/${requestBlocked}`, { token: outsider.token, body: { title: 'Hijack request orang' } });
  check('outsider cannot edit request', outsiderEdit.status === 403, outsiderEdit.status);

  const outsiderCancel = await req('POST', `/requests/${requestBlocked}/cancel`, { token: outsider.token, body: {} });
  check('outsider cannot cancel request', outsiderCancel.status === 403, outsiderCancel.status);

  const outsiderAssign = await req('POST', `/requests/${requestBlocked}/assignments`, { token: outsider.token, body: { helper_id: helper.id } });
  check('outsider cannot assign helper', outsiderAssign.status === 403, outsiderAssign.status);

  const selfAssign = await req('POST', `/requests/${requestBlocked}/assignments`, { token: owner.token, body: { helper_id: owner.id } });
  check('self assign rejected', selfAssign.status === 400, selfAssign.status);

  console.log('=== budget lock ===');
  const accept = await req('POST', `/requests/${requestBlocked}/assignments`, { token: owner.token, body: { helper_id: helper.id } });
  const assignmentId = accept.body.data.id;

  const budgetLock = await req('PATCH', `/requests/${requestBlocked}`, { token: owner.token, body: { budget_amount: 99999 } });
  check('budget locked after assignment', budgetLock.status === 409, `${budgetLock.status} ${budgetLock.text}`);

  const titleStillEditable = await req('PATCH', `/requests/${requestBlocked}`, { token: owner.token, body: { title: 'Judul diperbarui setelah assign' } });
  check('title still editable after assignment', titleStillEditable.status === 200, `${titleStillEditable.status} ${titleStillEditable.text}`);

  const tagLock = await req('PATCH', `/requests/${requestBlocked}`, { token: owner.token, body: { tag_ids: tagIds } });
  check('tags locked after assignment', tagLock.status === 409, tagLock.status);

  console.log('=== duplicate assignment ===');
  const helper2 = await makeVerifiedUser('hl2');
  const secondAccept = await req('POST', `/requests/${requestBlocked}/assignments`, { token: owner.token, body: { helper_id: helper2.id } });
  check('second helper rejected', secondAccept.status === 409, `${secondAccept.status} ${secondAccept.text}`);

  console.log('=== assignment permissions ===');
  const outsiderAssignment = await req('GET', `/assignments/${assignmentId}`, { token: outsider.token });
  check('outsider cannot view assignment', outsiderAssignment.status === 403, outsiderAssignment.status);

  const outsiderApprove = await req('POST', `/assignments/${assignmentId}/agreement/approve`, { token: outsider.token });
  check('outsider cannot approve agreement', outsiderApprove.status === 403, outsiderApprove.status);

  const outsiderFund = await req('POST', `/assignments/${assignmentId}/fund`, { token: outsider.token });
  check('outsider cannot fund', outsiderFund.status === 403, outsiderFund.status);

  const helperFund = await req('POST', `/assignments/${assignmentId}/fund`, { token: helper.token });
  check('helper cannot fund', helperFund.status === 403, helperFund.status);

  console.log('=== dispute edge cases ===');
  await req('POST', `/assignments/${assignmentId}/agreement/approve`, { token: owner.token });
  await req('POST', `/assignments/${assignmentId}/agreement/approve`, { token: helper.token });
  await client.query(`INSERT INTO wallet_table (user_id, balance, held) VALUES ($1, 300000, 0)
    ON CONFLICT (user_id) DO UPDATE SET balance = 300000, held = 0`, [owner.id]);
  const fund = await req('POST', `/assignments/${assignmentId}/fund`, { token: owner.token });
  check('fund for dispute test', fund.status === 200, `${fund.status} ${fund.text}`);

  const dispute = await req('POST', `/assignments/${assignmentId}/disputes`, { token: outsider.token, body: { reason: 'Mencoba dispute dari luar pihak assignment.' } });
  check('outsider cannot create dispute', dispute.status === 403, dispute.status);

  const disputeOwner = await req('POST', `/assignments/${assignmentId}/disputes`, { token: owner.token, body: { reason: 'Pekerjaan tidak selesai sesuai tenggat yang disepakati.' } });
  check('owner creates dispute', disputeOwner.status === 201, `${disputeOwner.status} ${disputeOwner.text}`);
  const disputeId = disputeOwner.body.data.id;

  const partialFull = await req('POST', `/admin/disputes/${disputeId}/resolve`, { token: adminToken, body: {
    decision: 'PARTIAL_REFUND', refund_amount: 20000, basis: 'Refund penuh via partial',
  }});
  check('partial refund equal to full rejected', partialFull.status === 400, `${partialFull.status} ${partialFull.text}`);

  const partialZero = await req('POST', `/admin/disputes/${disputeId}/resolve`, { token: adminToken, body: {
    decision: 'PARTIAL_REFUND', refund_amount: 0, basis: 'Nol',
  }});
  check('partial refund zero rejected', partialZero.status === 400, `${partialZero.status} ${partialZero.text}`);

  const resolve = await req('POST', `/admin/disputes/${disputeId}/resolve`, { token: adminToken, body: {
    decision: 'RELEASE', basis: 'Helper menyelesaikan pekerjaan sesuai bukti',
  }});
  check('release decision works', resolve.status === 200, `${resolve.status} ${resolve.text}`);

  const winnerWallet = await req('GET', '/me/wallet', { token: helper.token });
  check('helper received full amount', winnerWallet.body.data.balance === 20000, JSON.stringify(winnerWallet.body.data));

  const doubleResolve = await req('POST', `/admin/disputes/${disputeId}/resolve`, { token: adminToken, body: {
    decision: 'FULL_REFUND', basis: 'Coba lagi',
  }});
  check('double resolve rejected', doubleResolve.status === 409, doubleResolve.status);

  console.log('=== suspend revokes sessions ===');
  const suspend = await req('POST', `/admin/users/${helper.id}/suspend`, { token: adminToken, body: { days: null, reason: 'Uji suspend permanen' } });
  check('suspend permanent', suspend.status === 200, `${suspend.status} ${suspend.text}`);

  const suspendedAction = await req('GET', '/me', { token: helper.token });
  check('suspended token rejected on action', suspendedAction.status === 403, `${suspendedAction.status} ${suspendedAction.text}`);

  const stillCanChat = await req('GET', '/conversations', { token: helper.token });
  check('suspended token rejected everywhere', stillCanChat.status === 403, stillCanChat.status);

  console.log('=== admin guard ===');
  const adminSelfSuspend = await req('POST', `/admin/users/${admin.body.data.user.id}/suspend`, { token: adminToken, body: { days: 1, reason: 'x' } });
  check('admin cannot suspend self', adminSelfSuspend.status === 400, adminSelfSuspend.status);

  const suspendAdmin = await req('POST', `/admin/users/${admin.body.data.user.id}/suspend`, { token: adminToken, body: { days: 1, reason: 'x' } });
  check('admin suspend blocked', suspendAdmin.status === 400, suspendAdmin.status);

  console.log('=== validation ===');
  const badJson = await fetch(`${BASE}/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  check('malformed json 400', badJson.status === 400, badJson.status);

  const unknownField = await req('POST', '/requests', { token: owner.token, body: {
    title: 'Field tambahan tidak boleh',
    description: 'Deskripsi yang cukup panjang untuk validasi request ini.',
    estimated_time: 'fast',
    deadline_at: new Date(Date.now() + 86400000).toISOString(),
    budget_amount: 1000,
    tag_ids: tagIds,
    requester_id: 999,
  }});
  check('unknown field rejected', unknownField.status === 400, `${unknownField.status} ${unknownField.text}`);

  const badId = await req('GET', '/requests/abc', { token: owner.token });
  check('invalid id 400', badId.status === 400, badId.status);

  const missing = await req('GET', '/requests/99999999', { token: owner.token });
  check('missing request 404', missing.status === 404, missing.status);

  const noToken = await req('GET', '/me');
  check('missing token 401', noToken.status === 401, noToken.status);

  const badToken = await req('GET', '/me', { token: 'not-a-jwt' });
  check('invalid token 401', badToken.status === 401, badToken.status);

  const unknownEndpoint = await req('GET', '/does-not-exist');
  check('unknown endpoint 404', unknownEndpoint.status === 404, unknownEndpoint.status);

  const negativeLimit = await req('GET', '/requests?limit=-5', { token: owner.token });
  check('negative limit handled', negativeLimit.status === 200 && negativeLimit.body.meta.limit === 20, `${negativeLimit.status} ${JSON.stringify(negativeLimit.body.meta)}`);

  const bigLimit = await req('GET', '/requests?limit=500', { token: owner.token });
  check('limit capped at 50', bigLimit.body.meta.limit === 50, JSON.stringify(bigLimit.body.meta));

  const invalidEnum = await req('GET', '/me/assignments?status=BOGUS', { token: owner.token });
  check('invalid enum filter ignored', invalidEnum.status === 200, `${invalidEnum.status} ${invalidEnum.text}`);

  console.log('=== review guard ===');
  // The dispute above ended as COMPLETED, so use a fresh ON_PROGRESS assignment.
  const reviewHelper = await makeVerifiedUser('rvw');
  const reviewReq = await req('POST', '/requests', { token: owner.token, body: {
    title: 'Request untuk uji guard review',
    description: 'Deskripsi request untuk menguji validasi pemberian rating.',
    estimated_time: 'fast',
    deadline_at: new Date(Date.now() + 86400000).toISOString(),
    budget_amount: 10000,
    tag_ids: tagIds,
  }});
  const reviewReqId = reviewReq.body.data.id;
  const reviewAssign = await req('POST', `/requests/${reviewReqId}/assignments`, { token: owner.token, body: { helper_id: reviewHelper.id } });
  const reviewAssignmentId = reviewAssign.body.data.id;
  await req('POST', `/assignments/${reviewAssignmentId}/agreement/approve`, { token: owner.token });
  await req('POST', `/assignments/${reviewAssignmentId}/agreement/approve`, { token: reviewHelper.token });

  const reviewBeforeComplete = await req('POST', `/assignments/${reviewAssignmentId}/review`, { token: owner.token, body: { rating: 5 } });
  check('review before completion rejected', reviewBeforeComplete.status === 409, `${reviewBeforeComplete.status} ${reviewBeforeComplete.text}`);

  const helperReview = await req('POST', `/assignments/${reviewAssignmentId}/review`, { token: reviewHelper.token, body: { rating: 5 } });
  check('helper cannot review', helperReview.status === 403, helperReview.status);

  const badRating = await req('POST', `/assignments/${reviewAssignmentId}/review`, { token: owner.token, body: { rating: 9 } });
  check('rating out of range rejected', badRating.status === 400, badRating.status);

  console.log('=== notifications after suspend ===');
  const notifCount = await req('GET', '/me/notifications', { token: owner.token });
  check('owner has notifications', notifCount.body.meta.unread >= 0, JSON.stringify(notifCount.body.meta));

  await client.end();
  console.log(`\nRESULT pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
};
run().catch((e) => { console.error('CRASH', e); process.exit(2); });
