# Daftar API — SOS

Usulan endpoint REST untuk backend (Node.js + Express + TypeScript, lihat `CLAUDE.md`).
Diturunkan dari layar yang sudah ada di aplikasi Android dan aturan di `business-rules.md`.

- Base URL: `/api/v1`. Semua respons JSON. Pagination: `?page=&limit=` (atau cursor untuk chat).
- Auth: `Authorization: Bearer <accessToken>` kecuali yang ditandai **publik**.
- 🔒 = hanya pemilik resource / pihak dalam assignment. 🛡️ = role `ADMIN`.
- Setiap transisi status + aksi Admin wajib menulis **AuditLog** dan mengirim **Notification**.
- Fungsi di `SosRepository` / `AdminRepository` (aplikasi) adalah padanan sementara endpoint ini.

## 1. Auth & akun (modul 4.1)

| Method | Path | Fungsi | Layar |
|---|---|---|---|
| POST | `/auth/register` (publik) | Daftar: fullName, email, password | Create an Account |
| POST | `/auth/verify-email` (publik) | Verifikasi OTP 4 digit | Verification Code |
| POST | `/auth/resend-otp` (publik, rate limit) | Kirim ulang OTP | Verification Code |
| POST | `/auth/login` (publik, rate limit) | Login → access + refresh token, `role` | Login |
| POST | `/auth/refresh` (publik) | Rotasi refresh token | – |
| POST | `/auth/logout` | Revoke refresh token | Profile → Logout |
| POST | `/auth/forgot-password` (publik) | Kirim tautan/OTP reset | Forgot password |
| POST | `/auth/reset-password` (publik) | Set password baru | – |

## 2. Profil & verifikasi mahasiswa (4.2)

| Method | Path | Fungsi | Layar |
|---|---|---|---|
| GET | `/me` | Profil saya (termasuk email, status verifikasi, status akun) | Profile |
| PATCH | `/me` | Ubah nama, kampus, jurusan, LinkedIn, website | Edit Profile, Create an Account 1 |
| PUT | `/me/interests` | Simpan bidang minat | Create an Account 2 |
| PUT | `/me/skills` | Simpan skills | Edit Profile |
| POST | `/me/avatar` | Unggah foto profil | Edit Profile |
| POST / DELETE | `/me/portfolio`, `/me/portfolio/{id}` | Tambah / hapus portfolio | Edit Profile |
| POST | `/me/student-verification` | Ajukan KTM (file → private storage) | (perlu layar unggah KTM) |
| GET | `/me/student-verification` | Status pengajuan KTM | – |
| GET | `/meta/subjects` (publik) | Daftar bidang/subject | Interest, Create Request, Filter |
| POST | `/uploads/presign` | Signed URL untuk unggah file (tipe & ukuran dibatasi) | Semua lampiran |

## 3. Request & Explore (4.3, 4.4)

| Method | Path | Fungsi | Layar |
|---|---|---|---|
| GET | `/requests` | Explore request: `q, subject, sort=newest\|deadline\|budget` (hanya OPEN, tidak hidden) | Explore → Request |
| POST | `/requests` | Buat request | Create Request |
| GET | `/requests/{id}` | Detail request | Request Info |
| PATCH | `/requests/{id}` 🔒 | Edit deskripsi, lampiran, deadline (+jam), budget (budget terkunci jika sudah ada agreement) | Edit Request |
| POST | `/requests/{id}/cancel` 🔒 | Batalkan request tanpa assignment aktif | Request Info ⋮ |
| GET | `/me/requests` | Request saya per assignment: `status=floating\|on_progress\|completed` | Home, History → My Requests |
| GET | `/helpers` | Explore helper: `q, skill, sort=rating\|helps` | Explore → Helper |
| GET | `/users/{id}` | Profil publik helper (tanpa email/NIM) | Helper Info |
| GET | `/users/{id}/reviews` | Review helper | Helper Info |
| POST | `/helpers/{id}/direct-requests` | Direct Request → buat request + percakapan | Add Request Details |
| GET | `/me/home` | Ringkasan Home (ongoing tasks) | Home |

## 4. Reply (4.5)

| Method | Path | Fungsi | Layar |
|---|---|---|---|
| GET | `/requests/{id}/replies` | Daftar reply | Request Info |
| POST | `/requests/{id}/replies` | Kirim reply (bukan pemilik, akun aktif) | Request Info |
| DELETE | `/replies/{id}` 🔒 | Tarik reply | – |

## 5. Chat (4.7)

| Method | Path | Fungsi | Layar |
|---|---|---|---|
| GET | `/conversations` | Daftar chat + pesan terakhir, `q` | Chat |
| POST | `/conversations` | Ambil/buat chat `{requestId, helperId}` | Tombol Chat |
| GET | `/conversations/{id}` 🔒 | Detail chat + status assignment | Chat room |
| GET | `/conversations/{id}/messages?before=` 🔒 | Riwayat pesan (cursor) | Chat room |
| POST | `/conversations/{id}/messages` 🔒 | Kirim teks / file (`fileKey`) | Chat room |
| POST | `/conversations/{id}/read` 🔒 | Tandai sudah dibaca | Chat room |
| POST | `/conversations/{id}/decline` 🔒 | Requester menolak helper (Decline help) | Chat room |
| WS | `/ws` | Event `message:new`, `message:read`, `assignment:updated`, `typing` | Chat |

## 6. Assignment, agreement, completion, cancellation (4.6, 4.8, 4.9)

| Method | Path | Fungsi | Layar |
|---|---|---|---|
| POST | `/requests/{id}/assignments` 🔒 | Accept help `{helperId}` → `PENDING_AGREEMENT` + draft agreement | Accept help |
| GET | `/assignments/{id}` 🔒 | Detail assignment | Request Details |
| GET | `/assignments/{id}/agreement` 🔒 | Isi Contract Agreement | Contract Agreement |
| POST | `/assignments/{id}/agreement/approve` 🔒 | Setujui agreement (per pihak) | Agree & Continue |
| POST | `/assignments/{id}/fund` 🔒 | Danai dari balance / buat pembayaran → `ON_PROGRESS` setelah SUCCESS | Agree & Continue |
| POST | `/assignments/{id}/completion` 🔒 | Ajukan selesai (helper) / selesaikan (requester) | Request complete |
| POST | `/assignments/{id}/completion/confirm` 🔒 | Konfirmasi selesai → RELEASE dana | Confirm complete |
| POST | `/assignments/{id}/completion/reject` 🔒 | Tolak → kembali `ON_PROGRESS` | – |
| POST | `/assignments/{id}/cancellation` 🔒 | Ajukan batal `{reason}` | Cancel request |
| POST | `/assignments/{id}/cancellation/confirm` 🔒 | Konfirmasi batal → REFUND | Confirm cancel |
| POST | `/assignments/{id}/cancellation/reject` 🔒 | Tolak batal | Decline |
| POST | `/assignments/{id}/review` 🔒 | Rating 1–5 + komentar (requester, sekali, setelah COMPLETED) | Review |
| POST | `/assignments/{id}/disputes` 🔒 | Ajukan dispute ke Admin `{reason, evidenceKeys[]}` | Chat ⋮ Raise a dispute |
| GET | `/me/assignments` | `role=requester\|helper`, `status=` | Home, History → My Answers |

## 7. Wallet & pembayaran (4.11)

| Method | Path | Fungsi | Layar |
|---|---|---|---|
| GET | `/me/wallet` | Saldo | Profile, Transaction History |
| GET | `/me/transactions` | Mutasi saldo | Transaction History |
| POST | `/me/topups` | Top up `{amount, method}` → instruksi bayar dari provider | Top Up |
| POST | `/me/withdrawals` | Tarik dana `{amount, bankAccountId}` (min. Rp10.000) | Withdraw |
| GET / POST | `/me/bank-accounts` | Rekening tujuan (token provider, tidak simpan nomor lengkap) | Withdraw |
| POST | `/webhooks/payments/{provider}` (publik, verifikasi signature, idempotent) | Update status PAYMENT/REFUND/PAYOUT | – |

## 8. Notifikasi & keamanan pengguna (4.10, 4.12)

| Method | Path | Fungsi | Layar |
|---|---|---|---|
| GET | `/me/notifications` | Daftar notifikasi | (perlu layar notifikasi) |
| POST | `/me/notifications/{id}/read`, `/me/notifications/read-all` | Tandai dibaca | – |
| POST | `/me/devices` | Simpan token FCM/Expo | – |
| POST | `/reports` | Lapor `{targetType: REQUEST\|USER, targetId, reason}` | Request Info ⋮, Chat ⋮ |
| POST / DELETE | `/blocks`, `/blocks/{userId}` | Blokir / buka blokir | – |

## 9. Admin 🛡️ (4.12)

| Method | Path | Fungsi | Layar |
|---|---|---|---|
| GET | `/admin/dashboard/summary` | Total user, verified, helper aktif, request berjalan, jumlah antrean | Admin dashboard |
| GET | `/admin/dashboard/summary/export?format=csv` | Export ringkasan | Export ringkasan |
| GET | `/admin/pending-counts` | Badge lonceng per antrean | Header admin |
| GET | `/admin/verifications?status=&q=` | Antrean KTM | Verifikasi Mahasiswa |
| GET | `/admin/verifications/{id}` | Detail + signed URL dokumen KTM | Verifikasi Mahasiswa |
| POST | `/admin/verifications/{id}/claim` | Tandai sedang ditinjau | – |
| POST | `/admin/verifications/{id}/approve` | Terima `{note}` | Terima verifikasi |
| POST | `/admin/verifications/{id}/reject` | Tolak `{note}` (wajib) | Tolak verifikasi |
| GET | `/admin/users?status=&q=` | Daftar pengguna | Kelola Pengguna |
| GET | `/admin/users/{id}` | Profil lengkap + statistik + jumlah laporan | Kelola Pengguna |
| POST | `/admin/users/{id}/suspend` | Tangguhkan `{days\|null, reason}` | Tangguhkan akun |
| POST | `/admin/users/{id}/reactivate` | Aktifkan kembali `{reason}` | Aktifkan kembali akun |
| POST | `/admin/users/{id}/warn` | Kirim peringatan `{note}` | Beri peringatan |
| GET | `/admin/reports?targetType=&status=` | Laporan request / pengguna | Moderasi Request, Laporan & Dispute |
| GET | `/admin/reports/{id}` | Detail laporan | – |
| POST | `/admin/reports/{id}/claim` | Tandai ditinjau | – |
| POST | `/admin/reports/{id}/resolve` | Tutup dengan tindakan `{action, reason}` | – |
| POST | `/admin/reports/{id}/dismiss` | Tutup tanpa tindakan | Tutup tanpa tindakan |
| POST | `/admin/requests/{id}/moderate` | `{action: HIDE\|REMOVE\|KEEP, reason}` | Simpan tindakan |
| POST | `/admin/requests/{id}/restore` | Pulihkan request | Pulihkan request |
| GET | `/admin/disputes?status=` | Antrean dispute | Laporan & Dispute |
| GET | `/admin/disputes/{id}` | Detail: pernyataan, bukti, cuplikan chat | Detail kasus |
| POST | `/admin/disputes/{id}/request-evidence` | Minta bukti tambahan | Minta bukti tambahan |
| POST | `/admin/disputes/{id}/resolve` | `{decision: FULL_REFUND\|PARTIAL_REFUND\|RELEASE, refundAmount, basis}` → REFUND/RELEASE dalam 1 transaksi DB | Tetapkan keputusan |
| GET | `/admin/transactions?type=&status=&q=&date=` | Aktivitas transaksi platform | Monitoring Transaksi |
| GET | `/admin/transactions/summary?date=` | Dana ditahan, bayar berhasil, refund menunggu, pencairan gagal | Ringkasan hari ini |
| GET | `/admin/transactions/{id}` | Detail + riwayat pemrosesan | Detail pencairan |
| POST | `/admin/transactions/{id}/request-fix` | Minta pengguna perbaiki data rekening `{note}` | Kirim permintaan perbaikan |
| POST | `/admin/transactions/{id}/retry` | Proses ulang payout | Proses ulang |
| GET | `/admin/transactions/{id}/export` | Ekspor detail | Ekspor detail transaksi |
| GET | `/admin/audit-logs?entityType=&entityId=` | Jejak audit | Log moderasi / riwayat akun |

## Catatan

- Aplikasi saat ini membedakan Admin lewat email demo `admin@sos.ac.id` (lihat `SosRepository.ADMIN_EMAIL`). Di backend, role diambil dari JWT dan **dicek ulang di setiap endpoint `/admin`**.
- Layar unggah KTM untuk user belum ada (Student ID dihapus dari registrasi atas permintaan). Endpoint `POST /me/student-verification` butuh layar baru, misalnya di Profile.
- Open questions yang memengaruhi API: #9 (balance vs payout langsung), #10 (fee), #11 (kebijakan refund), #17 (auto-complete).
