const BASE = 'http://localhost:5055/api/v1';
let pass = 0;
let fail = 0;

function check(name, condition, detail) {
  if (condition) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${detail ?? ''}`); }
}

async function req(method, path, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (raw !== undefined) {
    headers['Content-Type'] = raw.type;
    payload = raw.data;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, body: json, text };
}

function adminTokenSetup() {
  return req('POST', '/auth/login', { body: { email: 'admin@sos.ac.id', password: 'AdminPass123' } });
}

const run = async () => {
  console.log('=== health ===');
  const health = await fetch('http://localhost:5055/health').then(r => r.json());
  check('health', health.status === 'OK', JSON.stringify(health));

  console.log('=== auth ===');
  const email = `user${Date.now()}@example.com`;
  const reg = await req('POST', '/auth/register', { body: { full_name: 'Smoke User', email, password: 'Passw0rd!' } });
  check('register 201', reg.status === 201, `${reg.status} ${reg.text}`);
  check('register hides password', reg.body?.data && reg.body.data.password === undefined, JSON.stringify(reg.body?.data));

  const loginUnverified = await req('POST', '/auth/login', { body: { email, password: 'Passw0rd!' } });
  check('login blocked until verified', loginUnverified.status === 403, loginUnverified.status);

  // Fetch OTP directly from DB for testing.
  const { Client } = await import('pg');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const otpRow = await client.query(
    `SELECT r.otp_hash FROM registration_otp_table r JOIN user_table u ON u.id = r.user_id WHERE u.email = $1`, [email]);
  check('otp row exists', otpRow.rowCount === 1);
  // The hash cannot be reversed, so reset it to a known bcrypt hash of 123456.
  const bcrypt = (await import('bcrypt')).default;
  const knownHash = await bcrypt.hash('123456', 10);
  await client.query(
    `UPDATE registration_otp_table SET otp_hash = $1 WHERE user_id = (SELECT id FROM user_table WHERE email = $2)`,
    [knownHash, email]);

  const badOtp = await req('POST', '/auth/verify-email', { body: { email, otp: '000000' } });
  check('wrong otp rejected', badOtp.status === 400, badOtp.status);

  const verify = await req('POST', '/auth/verify-email', { body: { email, otp: '123456' } });
  check('verify-email 200', verify.status === 200, `${verify.status} ${verify.text}`);

  const verifyAgain = await req('POST', '/auth/verify-email', { body: { email, otp: '123456' } });
  check('double verify 409', verifyAgain.status === 409, verifyAgain.status);

  const login = await req('POST', '/auth/login', { body: { email, password: 'Passw0rd!' } });
  check('login 200', login.status === 200, `${login.status} ${login.text}`);
  check('login returns access+refresh', Boolean(login.body?.data?.access_token && login.body?.data?.refresh_token), JSON.stringify(Object.keys(login.body?.data ?? {})));
  check('login returns role', login.body?.data?.role === 'USER');

  const userToken = login.body.data.access_token;
  const refreshToken = login.body.data.refresh_token;

  const rot = await req('POST', '/auth/refresh', { body: { refresh_token: refreshToken } });
  check('refresh 200', rot.status === 200, `${rot.status} ${rot.text}`);
  const newRefresh = rot.body?.data?.refresh_token;
  check('refresh rotated token', newRefresh && newRefresh !== refreshToken);

  const reuse = await req('POST', '/auth/refresh', { body: { refresh_token: refreshToken } });
  check('refresh reuse rejected', reuse.status === 401, reuse.status);

  const familyReuse = await req('POST', '/auth/refresh', { body: { refresh_token: newRefresh } });
  check('rotated token revoked after reuse', familyReuse.status === 401, familyReuse.status);

  // Fresh login for the rest of the flow.
  const login2 = await req('POST', '/auth/login', { body: { email, password: 'Passw0rd!' } });
  const userAccess = login2.body.data.access_token;
  const userRefresh = login2.body.data.refresh_token;

  console.log('=== me / profile ===');
  const me = await req('GET', '/me', { token: userAccess });
  check('GET /me', me.status === 200 && me.body?.data?.email === email, `${me.status} ${me.text}`);

  const patchMe = await req('PATCH', '/me', { token: userAccess, body: { full_name: 'Smoke Updated', website: 'https://example.com' } });
  check('PATCH /me', patchMe.status === 200 && patchMe.body?.data?.full_name === 'Smoke Updated', `${patchMe.status} ${patchMe.text}`);

  const subjects = await req('GET', '/meta/subjects');
  check('GET /meta/subjects public', subjects.status === 200 && subjects.body.data.length > 0, subjects.status);
  const tagIds = subjects.body.data.slice(0, 2).map(t => t.id);

  const interests = await req('PUT', '/me/interests', { token: userAccess, body: { tag_ids: tagIds } });
  check('PUT /me/interests', interests.status === 200, `${interests.status} ${interests.text}`);

  const skills = await req('PUT', '/me/skills', { token: userAccess, body: { tag_ids: tagIds } });
  check('PUT /me/skills', skills.status === 200, `${skills.status} ${skills.text}`);

  const badInterests = await req('PUT', '/me/interests', { token: userAccess, body: { tag_ids: [999999] } });
  check('invalid tag rejected', badInterests.status === 400, badInterests.status);

  console.log('=== uploads ===');
  const presign = await req('POST', '/uploads/presign', { token: userAccess, body: { purpose: 'AVATAR', mime: 'image/png', byte_size: 100, original_name: 'a.png' } });
  check('presign 201', presign.status === 201, `${presign.status} ${presign.text}`);
  const key = presign.body?.data?.file_key;

  const badMime = await req('POST', '/uploads/presign', { token: userAccess, body: { purpose: 'AVATAR', mime: 'application/zip', byte_size: 100 } });
  check('presign rejects mime', badMime.status === 400, badMime.status);

  const tooBig = await req('POST', '/uploads/presign', { token: userAccess, body: { purpose: 'AVATAR', mime: 'image/png', byte_size: 10 * 1024 * 1024 } });
  check('presign rejects size', tooBig.status === 400, tooBig.status);

  const upload = await req('PUT', `/uploads/${key}`, { token: userAccess, raw: { type: 'image/png', data: Buffer.from('89504e470d0a1a0a', 'hex') } });
  check('upload PUT', upload.status === 200, `${upload.status} ${upload.text}`);

  const avatar = await req('POST', '/me/avatar', { token: userAccess, body: { file_key: key } });
  check('set avatar', avatar.status === 200, `${avatar.status} ${avatar.text}`);

  const serve = await fetch(`http://localhost:5055/api/v1/files/${key}`);
  check('public avatar served', serve.status === 200, serve.status);

  const portfolio = await req('POST', '/me/portfolio', { token: userAccess, body: { title: 'Portfolio A', url: 'https://example.com' } });
  check('create portfolio', portfolio.status === 201, `${portfolio.status} ${portfolio.text}`);

  const delPortfolio = await req('DELETE', `/me/portfolio/${portfolio.body.data.id}`, { token: userAccess });
  check('delete portfolio 204', delPortfolio.status === 204, delPortfolio.status);

  // KTM submission needs an uploaded STUDENT_ID file.
  const ktmPresign = await req('POST', '/uploads/presign', { token: userAccess, body: { purpose: 'STUDENT_ID', mime: 'image/png', byte_size: 50 } });
  const ktmKey = ktmPresign.body.data.file_key;
  await req('PUT', `/uploads/${ktmKey}`, { token: userAccess, raw: { type: 'image/png', data: Buffer.from('89504e47', 'hex') } });

  const submitKtm = await req('POST', '/me/student-verification', { token: userAccess, body: { file_key: ktmKey } });
  check('submit KTM', submitKtm.status === 201, `${submitKtm.status} ${submitKtm.text}`);

  const ktmAgain = await req('POST', '/me/student-verification', { token: userAccess, body: { file_key: ktmKey } });
  check('duplicate KTM rejected', ktmAgain.status === 409, ktmAgain.status);

  console.log('=== requests / replies ===');
  const createReq = await req('POST', '/requests', { token: userAccess, body: {
    title: 'Bantu desain poster kegiatan',
    description: 'Butuh desain poster untuk kegiatan kampus minggu depan dengan tema teknologi.',
    estimated_time: 'fast',
    deadline_at: new Date(Date.now() + 86400000).toISOString(),
    budget_amount: 50000,
    tag_ids: tagIds,
  }});
  check('create request 201', createReq.status === 201, `${createReq.status} ${createReq.text}`);
  const requestId = createReq.body?.data?.id;

  const badReq = await req('POST', '/requests', { token: userAccess, body: {
    title: 'x', description: 'short', estimated_time: 'fast',
    deadline_at: '2000-01-01T00:00:00.000Z', budget_amount: -5, tag_ids: [],
  }});
  check('invalid request 400', badReq.status === 400, `${badReq.status} ${badReq.text}`);

  const feed = await req('GET', '/requests?sort=budget', { token: userAccess });
  check('feed 200', feed.status === 200, `${feed.status} ${feed.text}`);
  check('feed sorted by budget', (feed.body.data?.[0]?.budget_amount ?? 0) >= (feed.body.data?.[1]?.budget_amount ?? 0));

  const myReqs = await req('GET', '/me/requests?status=floating', { token: userAccess });
  check('my floating requests', myReqs.status === 200 && myReqs.body.data.some(r => r.id === requestId), `${myReqs.status} ${myReqs.text}`);

  // Second user acts as helper.
  const helperEmail = `helper${Date.now()}@example.com`;
  await req('POST', '/auth/register', { body: { full_name: 'Smoke Helper', email: helperEmail, password: 'Passw0rd!' } });
  const helperOtpHash = await bcrypt.hash('123456', 10);
  await client.query(
    `UPDATE registration_otp_table SET otp_hash = $1 WHERE user_id = (SELECT id FROM user_table WHERE email = $2)`,
    [helperOtpHash, helperEmail]);
  await req('POST', '/auth/verify-email', { body: { email: helperEmail, otp: '123456' } });
  const helperLogin = await req('POST', '/auth/login', { body: { email: helperEmail, password: 'Passw0rd!' } });
  const helperToken = helperLogin.body.data.access_token;
  const helperId = helperLogin.body.data.user.id;

  const reply = await req('POST', `/requests/${requestId}/replies`, { token: helperToken, body: { message: 'Saya bisa bantu desain ini.' } });
  check('create reply', reply.status === 201, `${reply.status} ${reply.text}`);

  const ownReply = await req('POST', `/requests/${requestId}/replies`, { token: userAccess, body: { message: 'reply sendiri' } });
  check('owner cannot reply', ownReply.status === 400, ownReply.status);

  const replies = await req('GET', `/requests/${requestId}/replies`, { token: userAccess });
  check('list replies', replies.status === 200 && replies.body.data.length === 1, `${replies.status} ${replies.text}`);

  const pub = await req('GET', `/users/${helperId}`);
  check('public profile', pub.status === 200 && pub.body.data.email === undefined, `${pub.status} ${pub.text}`);

  const helpers = await req('GET', `/helpers?skill=${subjects.body.data[0].slug}`);
  check('helpers list', helpers.status === 200, `${helpers.status} ${helpers.text}`);

  console.log('=== chat ===');
  const conv = await req('POST', '/conversations', { token: userAccess, body: { request_id: requestId, helper_id: helperId } });
  check('create conversation', conv.status === 201, `${conv.status} ${conv.text}`);
  const convId = conv.body?.data?.id;

  const convDup = await req('POST', '/conversations', { token: userAccess, body: { request_id: requestId, helper_id: helperId } });
  check('conversation idempotent', convDup.status === 200 && convDup.body.data.id === convId, `${convDup.status} ${convDup.text}`);

  const msg = await req('POST', `/conversations/${convId}/messages`, { token: userAccess, body: { body: 'Halo, kapan bisa mulai?' } });
  check('send message', msg.status === 201, `${msg.status} ${msg.text}`);

  const outsider = await req('GET', `/conversations/${convId}`, { token: userAccess });
  check('participant sees conversation', outsider.status === 200, outsider.status);

  const read = await req('POST', `/conversations/${convId}/read`, { token: helperToken, body: {} });
  check('mark read', read.status === 200, `${read.status} ${read.text}`);

  const msgs = await req('GET', `/conversations/${convId}/messages?limit=10`, { token: helperToken });
  check('list messages', msgs.status === 200 && msgs.body.data.messages.length === 1, `${msgs.status} ${msgs.text}`);

  const convList = await req('GET', '/conversations', { token: userAccess });
  check('conversation list', convList.status === 200 && convList.body.data.length === 1, `${convList.status} ${convList.text}`);

  console.log('=== assignment flow ===');
  const accept = await req('POST', `/requests/${requestId}/assignments`, { token: userAccess, body: { helper_id: helperId } });
  check('accept helper', accept.status === 201, `${accept.status} ${accept.text}`);
  const assignmentId = accept.body?.data?.id;

  const approve1 = await req('POST', `/assignments/${assignmentId}/agreement/approve`, { token: userAccess });
  check('requester approves', approve1.status === 200, `${approve1.status} ${approve1.text}`);

  const fundTooEarly = await req('POST', `/assignments/${assignmentId}/fund`, { token: userAccess });
  check('fund needs both approvals', fundTooEarly.status === 409, fundTooEarly.status);

  const approve2 = await req('POST', `/assignments/${assignmentId}/agreement/approve`, { token: helperToken });
  check('helper approves', approve2.status === 200, `${approve2.status} ${approve2.text}`);

  const fundNoBalance = await req('POST', `/assignments/${assignmentId}/fund`, { token: userAccess });
  check('fund without balance 402', fundNoBalance.status === 402, `${fundNoBalance.status} ${fundNoBalance.text}`);

  const walletBefore = await req('GET', '/me/wallet', { token: userAccess });
  check('wallet zero', walletBefore.status === 200 && walletBefore.body.data.balance === 0, JSON.stringify(walletBefore.body));

  // Credit the requester's wallet directly to exercise hold/release.
  await client.query(`INSERT INTO wallet_table (user_id, balance, held) VALUES ($1, 200000, 0)
    ON CONFLICT (user_id) DO UPDATE SET balance = 200000`, [login2.body.data.user.id]);

  const fund = await req('POST', `/assignments/${assignmentId}/fund`, { token: userAccess });
  check('fund succeeds', fund.status === 200, `${fund.status} ${fund.text}`);

  const walletAfterFund = await req('GET', '/me/wallet', { token: userAccess });
  check('balance held', walletAfterFund.body.data.balance === 150000 && walletAfterFund.body.data.held === 50000, JSON.stringify(walletAfterFund.body.data));

  const complete = await req('POST', `/assignments/${assignmentId}/completion`, { token: helperToken, body: { reason: 'Sudah selesai' } });
  check('helper requests completion', complete.status === 201, `${complete.status} ${complete.text}`);

  const selfConfirm = await req('POST', `/assignments/${assignmentId}/completion/confirm`, { token: helperToken });
  check('requester-only confirm', selfConfirm.status === 403, selfConfirm.status);

  const confirm = await req('POST', `/assignments/${assignmentId}/completion/confirm`, { token: userAccess });
  check('confirm completion', confirm.status === 200, `${confirm.status} ${confirm.text}`);

  const walletHelper = await req('GET', '/me/wallet', { token: helperToken });
  check('helper received funds', walletHelper.body.data.balance === 50000, JSON.stringify(walletHelper.body.data));

  const review = await req('POST', `/assignments/${assignmentId}/review`, { token: userAccess, body: { rating: 5, comment: 'Mantap' } });
  check('review created', review.status === 201, `${review.status} ${review.text}`);

  const reviewDup = await req('POST', `/assignments/${assignmentId}/review`, { token: userAccess, body: { rating: 4 } });
  check('duplicate review 409', reviewDup.status === 409, reviewDup.status);

  const publicReviews = await req('GET', `/users/${helperId}/reviews`);
  check('public reviews', publicReviews.status === 200 && publicReviews.body.data.length === 1, `${publicReviews.status} ${publicReviews.text}`);

  console.log('=== notifications / safety / home ===');
  const notifs = await req('GET', '/me/notifications', { token: userAccess });
  check('notifications listed', notifs.status === 200 && notifs.body.data.length > 0, `${notifs.status} ${notifs.body?.data?.length}`);

  const readAll = await req('POST', '/me/notifications/read-all', { token: userAccess });
  check('read all notifications', readAll.status === 200, readAll.status);

  const home = await req('GET', '/me/home', { token: userAccess });
  check('home summary', home.status === 200 && home.body.data.wallet, `${home.status} ${home.text}`);

  const pending = await req('GET', '/me/pending-counts', { token: userAccess });
  check('pending counts', pending.status === 200, pending.status);

  const report = await req('POST', '/reports', { token: helperToken, body: { target_type: 'REQUEST', target_id: requestId, reason: 'Spam percobaan laporan' } });
  check('create report', report.status === 201, `${report.status} ${report.text}`);

  const block = await req('POST', '/blocks', { token: helperToken, body: { user_id: login2.body.data.user.id } });
  check('block user', block.status === 201, `${block.status} ${block.text}`);

  const unblock = await req('DELETE', `/blocks/${login2.body.data.user.id}`, { token: helperToken });
  check('unblock user', unblock.status === 204, unblock.status);

  const topup = await req('POST', '/me/topups', { token: userAccess, body: { amount: 50000, method: 'bank_transfer' } });
  check('topup 501 placeholder', topup.status === 501 && topup.body.code === 'PAYMENT_PROVIDER_NOT_CONFIGURED', `${topup.status} ${topup.text}`);

  const webhook = await req('POST', '/webhooks/payments/midtrans', { body: {} });
  check('webhook 501 placeholder', webhook.status === 501, webhook.status);

  console.log('=== admin ===');
  const adminLogin = await adminTokenSetup();
  check('admin login', adminLogin.status === 200 && adminLogin.body.data.role === 'ADMIN', `${adminLogin.status} ${adminLogin.text}`);
  const adminToken = adminLogin.body.data.access_token;

  const userHitsAdmin = await req('GET', '/admin/dashboard/summary', { token: userAccess });
  check('non-admin blocked', userHitsAdmin.status === 403, userHitsAdmin.status);

  const summary = await req('GET', '/admin/dashboard/summary', { token: adminToken });
  check('admin summary', summary.status === 200 && typeof summary.body.data.total_users === 'number', `${summary.status} ${summary.text}`);

  const csv = await fetch(`${BASE}/admin/dashboard/summary/export`, { headers: { Authorization: `Bearer ${adminToken}` } });
  check('summary csv export', csv.status === 200 && (csv.headers.get('content-type') ?? '').includes('text/csv'), csv.status);

  const counts = await req('GET', '/admin/pending-counts', { token: adminToken });
  check('admin pending counts', counts.status === 200, counts.status);

  const verifications = await req('GET', '/admin/verifications?status=PENDING', { token: adminToken });
  check('verification queue', verifications.status === 200 && verifications.body.data.length >= 1, `${verifications.status} ${verifications.text}`);
  const verificationId = verifications.body.data[0].id;

  const vdetail = await req('GET', `/admin/verifications/${verificationId}`, { token: adminToken });
  check('verification detail has signed url', vdetail.status === 200 && String(vdetail.body.data.document_url).includes('token='), `${vdetail.status}`);

  const claim = await req('POST', `/admin/verifications/${verificationId}/claim`, { token: adminToken });
  check('claim verification', claim.status === 200, `${claim.status} ${claim.text}`);

  const approveV = await req('POST', `/admin/verifications/${verificationId}/approve`, { token: adminToken, body: { note: 'KTM valid' } });
  check('approve verification', approveV.status === 200, `${approveV.status} ${approveV.text}`);

  const meAfter = await req('GET', '/me', { token: userAccess });
  check('student verified flag', meAfter.body.data.is_student_verified === true, JSON.stringify(meAfter.body.data.is_student_verified));

  const usersList = await req('GET', '/admin/users?q=Smoke', { token: adminToken });
  check('admin user list', usersList.status === 200 && usersList.body.data.length >= 1, `${usersList.status} ${usersList.text}`);

  const warn = await req('POST', `/admin/users/${helperId}/warn`, { token: adminToken, body: { note: 'Peringatan percobaan' } });
  check('warn user', warn.status === 200, `${warn.status} ${warn.text}`);

  const suspend = await req('POST', `/admin/users/${helperId}/suspend`, { token: adminToken, body: { days: 1, reason: 'Percobaan suspend' } });
  check('suspend user', suspend.status === 200, `${suspend.status} ${suspend.text}`);

  const suspendedLogin = await req('POST', '/auth/login', { body: { email: helperEmail, password: 'Passw0rd!' } });
  check('suspended login blocked', suspendedLogin.status === 403, suspendedLogin.status);

  const reactivate = await req('POST', `/admin/users/${helperId}/reactivate`, { token: adminToken, body: { reason: 'Sudah selesai' } });
  check('reactivate user', reactivate.status === 200, `${reactivate.status} ${reactivate.text}`);

  const reports = await req('GET', '/admin/reports?status=OPEN', { token: adminToken });
  check('admin reports', reports.status === 200 && reports.body.data.length >= 1, `${reports.status}`);
  const reportId = reports.body.data[0].id;

  const claimReportRes = await req('POST', `/admin/reports/${reportId}/claim`, { token: adminToken });
  check('claim report', claimReportRes.status === 200, claimReportRes.status);

  const dismiss = await req('POST', `/admin/reports/${reportId}/dismiss`, { token: adminToken, body: { reason: 'Tidak ada pelanggaran' } });
  check('dismiss report', dismiss.status === 200, `${dismiss.status} ${dismiss.text}`);

  const tx = await req('GET', '/admin/transactions', { token: adminToken });
  check('admin transactions', tx.status === 200 && tx.body.data.length > 0, `${tx.status} ${tx.text}`);
  const txId = tx.body.data[0].id;

  const txSummary = await req('GET', '/admin/transactions/summary', { token: adminToken });
  check('transactions summary', txSummary.status === 200, txSummary.status);

  const txDetail = await req('GET', `/admin/transactions/${txId}`, { token: adminToken });
  check('transaction detail + history', txDetail.status === 200 && Array.isArray(txDetail.body.data.history), `${txDetail.status}`);

  const retry = await req('POST', `/admin/transactions/${txId}/retry`, { token: adminToken });
  check('retry payout 501', retry.status === 501, retry.status);

  const audit = await req('GET', '/admin/audit-logs?entityType=assignment', { token: adminToken });
  check('audit logs', audit.status === 200 && audit.body.data.length > 0, `${audit.status} ${audit.text}`);

  console.log('=== cancellation + dispute ===');
  const req2 = await req('POST', '/requests', { token: userAccess, body: {
    title: 'Bantu review dokumen tugas',
    description: 'Mohon bantu review dokumen tugas akhir saya bagian metodologi.',
    estimated_time: 'moderate',
    deadline_at: new Date(Date.now() + 2 * 86400000).toISOString(),
    budget_amount: 30000,
    tag_ids: tagIds,
  }});
  const requestId2 = req2.body.data.id;

  const accept2 = await req('POST', `/requests/${requestId2}/assignments`, { token: userAccess, body: { helper_id: helperId } });
  check('second assignment', accept2.status === 201, `${accept2.status} ${accept2.text}`);
  const assignmentId2 = accept2.body.data.id;

  const cancelUnfunded = await req('POST', `/assignments/${assignmentId2}/cancellation`, { token: userAccess, body: { reason: 'Batal sebelum mulai' } });
  check('cancel unfunded immediately', cancelUnfunded.status === 200, `${cancelUnfunded.status} ${cancelUnfunded.text}`);

  const req2Detail = await req('GET', `/requests/${requestId2}`, { token: userAccess });
  check('request reopened after cancel', req2Detail.body.data.status === 'OPEN', req2Detail.body?.data?.status);

  const disputeCandidate = await req('POST', `/requests/${requestId2}/assignments`, { token: userAccess, body: { helper_id: helperId } });
  const assignmentId3 = disputeCandidate.body?.data?.id;
  check('third assignment', disputeCandidate.status === 201, `${disputeCandidate.status}`);

  // Fund and dispute this one to exercise the admin resolution path.
  await req('POST', `/assignments/${assignmentId3}/agreement/approve`, { token: userAccess });
  await req('POST', `/assignments/${assignmentId3}/agreement/approve`, { token: helperToken });
  const fund3 = await req('POST', `/assignments/${assignmentId3}/fund`, { token: userAccess });
  check('fund third assignment', fund3.status === 200, `${fund3.status} ${fund3.text}`);

  const dispute = await req('POST', `/assignments/${assignmentId3}/disputes`, { token: userAccess, body: { reason: 'Pekerjaan tidak sesuai kesepakatan awal.' } });
  check('create dispute', dispute.status === 201, `${dispute.status} ${dispute.text}`);
  const disputeId = dispute.body.data.id;

  const disputes = await req('GET', '/admin/disputes?status=OPEN', { token: adminToken });
  check('admin dispute queue', disputes.status === 200 && disputes.body.data.length >= 1, `${disputes.status} ${disputes.text}`);

  const disputeDetail = await req('GET', `/admin/disputes/${disputeId}`, { token: adminToken });
  check('dispute detail with chat excerpt', disputeDetail.status === 200 && Array.isArray(disputeDetail.body.data.chat_excerpt), `${disputeDetail.status}`);

  const evidenceReq = await req('POST', `/admin/disputes/${disputeId}/request-evidence`, { token: adminToken, body: { note: 'Mohon lampirkan bukti chat' } });
  check('request evidence', evidenceReq.status === 200, `${evidenceReq.status} ${evidenceReq.text}`);

  const resolveDispute = await req('POST', `/admin/disputes/${disputeId}/resolve`, { token: adminToken, body: { decision: 'PARTIAL_REFUND', refund_amount: 15000, basis: 'Pekerjaan selesai sebagian' } });
  check('resolve dispute partial refund', resolveDispute.status === 200, `${resolveDispute.status} ${resolveDispute.text}`);

  const walletFinal = await req('GET', '/me/wallet', { token: userAccess });
  check('refund returned to balance', walletFinal.body.data.held === 0, JSON.stringify(walletFinal.body.data));

  console.log('=== request moderation ===');
  const moderate = await req('POST', `/admin/requests/${requestId2}/moderate`, { token: adminToken, body: { action: 'HIDE', reason: 'Uji moderasi' } });
  check('moderate hide', moderate.status === 200, `${moderate.status} ${moderate.text}`);

  const hiddenDetailForOther = await req('GET', `/requests/${requestId2}`, { token: helperToken });
  check('hidden request 404 for others', hiddenDetailForOther.status === 404, hiddenDetailForOther.status);

  const hiddenAsOwner = await req('GET', `/requests/${requestId2}`, { token: userAccess });
  check('owner can still see own hidden request', hiddenAsOwner.status === 200, hiddenAsOwner.status);

  const restore = await req('POST', `/admin/requests/${requestId2}/restore`, { token: adminToken });
  check('restore request', restore.status === 200, `${restore.status} ${restore.text}`);

  console.log('=== logout ===');
  const logoutLogin = await req('POST', '/auth/login', { body: { email, password: 'Passw0rd!' } });
  const logoutRefresh = logoutLogin.body.data.refresh_token;
  const logout = await req('POST', '/auth/logout', { token: logoutLogin.body.data.access_token, body: { refresh_token: logoutRefresh } });
  check('logout', logout.status === 200, `${logout.status} ${logout.text}`);
  const afterLogout = await req('POST', '/auth/refresh', { body: { refresh_token: logoutRefresh } });
  check('refresh after logout rejected', afterLogout.status === 401, afterLogout.status);

  await client.end();
  console.log(`\nRESULT pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error('SMOKE CRASH', error);
  process.exit(2);
});
