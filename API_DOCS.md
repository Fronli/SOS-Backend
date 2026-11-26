# 📚 API Documentation — SOS (Student On Study)

**Base URL (port bawaan):** `http://localhost:3000/api/v1`
**Format:** Request dengan body dan response API menggunakan JSON (`Content-Type: application/json`). Endpoint `DELETE` yang berhasil mengembalikan `204` tanpa body.

Port dapat diubah melalui variabel lingkungan `PORT`. Gunakan header `Authorization: Bearer <accessToken>` untuk endpoint yang membutuhkan autentikasi. Access token diperoleh dari `/auth/login` (default berlaku 1 jam) dan dapat diperbarui dengan refresh token lewat `/auth/refresh`.

**Kode status yang dipakai konsisten:** `400` validasi, `401` token tidak ada/invalid, `403` bukan peserta resource atau akun ditangguhkan, `404` resource tidak ditemukan, `409` konflik status, `402` saldo tidak mencukupi, `429` rate limit, `501` fitur payment gateway belum dikonfigurasi.

---

## Daftar Endpoint

### Auth & akun

| Method | Endpoint | Keterangan | Auth |
|--------|----------|------------|------|
| `POST` | `/api/v1/auth/register` | Registrasi akun baru | ❌ |
| `POST` | `/api/v1/auth/verify-email` | Verifikasi OTP email (alias: `/auth/verify-otp`) | ❌ |
| `POST` | `/api/v1/auth/resend-otp` | Kirim ulang OTP | ❌ (rate limit) |
| `POST` | `/api/v1/auth/login` | Login → access + refresh token | ❌ (rate limit) |
| `POST` | `/api/v1/auth/refresh` | Rotasi refresh token | ❌ |
| `POST` | `/api/v1/auth/logout` | Cabut refresh token | 🔑 Bearer |
| `POST` | `/api/v1/auth/forgot-password` | Kirim OTP reset password | ❌ (rate limit) |
| `POST` | `/api/v1/auth/reset-password` | Set password baru via OTP | ❌ |
| `GET` | `/health` | Health check server | ❌ |

### Profil, unggahan, meta

| Method | Endpoint | Keterangan | Auth |
|--------|----------|------------|------|
| `GET` | `/api/v1/me` | Profil saya (lengkap dengan minat/skills/portfolio) | 🔑 |
| `PATCH` | `/api/v1/me` | Ubah nama, kampus, jurusan, LinkedIn, website | 🔑 Verified |
| `PUT` | `/api/v1/me/interests` | Simpan bidang minat | 🔑 Verified |
| `PUT` | `/api/v1/me/skills` | Simpan skills | 🔑 Verified |
| `POST` | `/api/v1/me/avatar` | Set foto profil dari file yang sudah diunggah | 🔑 Verified |
| `POST` | `/api/v1/me/portfolio` | Tambah portfolio | 🔑 Verified |
| `DELETE` | `/api/v1/me/portfolio/:id` | Hapus portfolio | 🔑 Verified |
| `POST` | `/api/v1/me/student-verification` | Ajukan KTM | 🔑 Verified |
| `GET` | `/api/v1/me/student-verification` | Status pengajuan KTM | 🔑 |
| `GET` | `/api/v1/meta/subjects` | Daftar subject (publik, alias `/tags`) | ❌ |
| `POST` | `/api/v1/uploads/presign` | Daftarkan file & dapatkan URL unggah | 🔑 Verified |
| `PUT` | `/api/v1/uploads/:key` | Unggah data biner file | 🔑 Verified |
| `DELETE` | `/api/v1/uploads/:key` | Hapus file yang belum dipakai | 🔑 Verified |
| `GET` | `/api/v1/files/:key` | Ambil file (publik untuk avatar/portfolio) | ❌ / 🔑 |

### Request, reply, helper

| Method | Endpoint | Keterangan | Auth |
|--------|----------|------------|------|
| `GET` | `/api/v1/requests` | Explore: `q, subject, sort=newest\|deadline\|budget` | 🔑 Verified |
| `POST` | `/api/v1/requests` | Buat request | 🔑 Verified |
| `GET` | `/api/v1/requests/:id` | Detail request | 🔑 Verified |
| `PATCH` | `/api/v1/requests/:id` | Edit request milik sendiri | 🔑 Verified |
| `DELETE` | `/api/v1/requests/:id` | Soft delete request sendiri | 🔑 Verified |
| `POST` | `/api/v1/requests/:id/cancel` | Batalkan request tanpa assignment aktif | 🔑 Verified |
| `GET` | `/api/v1/me/requests` | Request saya (`status=floating\|on_progress\|completed\|cancelled`) | 🔑 Verified |
| `GET` | `/api/v1/requests/:id/replies` | Daftar reply | 🔑 Verified |
| `POST` | `/api/v1/requests/:id/replies` | Kirim reply (bukan pemilik) | 🔑 Verified |
| `DELETE` | `/api/v1/replies/:id` | Tarik reply sendiri | 🔑 Verified |
| `POST` | `/api/v1/helpers/:id/direct-requests` | Direct request + conversation | 🔑 Verified |
| `GET` | `/api/v1/helpers` | Explore helper: `q, skill, sort=rating\|helps` | ❌ |
| `GET` | `/api/v1/users/:id` | Profil publik helper | ❌ |
| `GET` | `/api/v1/users/:id/reviews` | Review helper | ❌ |
| `GET` | `/api/v1/me/home` | Ringkasan Home | 🔑 Verified |
| `GET` | `/api/v1/me/pending-counts` | Badge jumlah antrean | 🔑 Verified |

### Chat

| Method | Endpoint | Keterangan | Auth |
|--------|----------|------------|------|
| `GET` | `/api/v1/conversations` | Daftar chat + pesan terakhir | 🔑 Verified |
| `POST` | `/api/v1/conversations` | Ambil/buat chat `{request_id, helper_id}` | 🔑 Verified |
| `GET` | `/api/v1/conversations/:id` | Detail chat + status assignment | 🔑 Verified |
| `GET` | `/api/v1/conversations/:id/messages?before=` | Riwayat pesan (cursor) | 🔑 Verified |
| `POST` | `/api/v1/conversations/:id/messages` | Kirim teks / lampiran | 🔑 Verified |
| `POST` | `/api/v1/conversations/:id/read` | Tandai sudah dibaca | 🔑 Verified |
| `POST` | `/api/v1/conversations/:id/decline` | Requester menolak helper | 🔑 Verified |

### Assignment & agreement

| Method | Endpoint | Keterangan | Auth |
|--------|----------|------------|------|
| `POST` | `/api/v1/requests/:id/assignments` | Terima helper `{helper_id}` | 🔑 Verified |
| `GET` | `/api/v1/assignments/:id` | Detail assignment | 🔑 Peserta/Admin |
| `GET` | `/api/v1/assignments/:id/agreement` | Isi agreement | 🔑 Peserta |
| `POST` | `/api/v1/assignments/:id/agreement/approve` | Setujui agreement | 🔑 Peserta |
| `POST` | `/api/v1/assignments/:id/fund` | Kunci dana → `ON_PROGRESS` | 🔑 Requester |
| `POST` | `/api/v1/assignments/:id/completion` | Ajukan selesai | 🔑 Peserta |
| `POST` | `/api/v1/assignments/:id/completion/confirm` | Konfirmasi → lepas dana | 🔑 Pihak lain |
| `POST` | `/api/v1/assignments/:id/completion/reject` | Tolak penyelesaian | 🔑 Pihak lain |
| `POST` | `/api/v1/assignments/:id/cancellation` | Ajukan batal `{reason}` | 🔑 Peserta |
| `POST` | `/api/v1/assignments/:id/cancellation/confirm` | Konfirmasi batal → refund | 🔑 Pihak lain |
| `POST` | `/api/v1/assignments/:id/cancellation/reject` | Tolak pembatalan | 🔑 Pihak lain |
| `POST` | `/api/v1/assignments/:id/review` | Rating helper (sekali) | 🔑 Requester |
| `POST` | `/api/v1/assignments/:id/disputes` | Ajukan dispute | 🔑 Peserta |
| `GET` | `/api/v1/me/assignments` | `role=requester\|helper&status=` | 🔑 Verified |

### Wallet, notifikasi, keamanan

| Method | Endpoint | Keterangan | Auth |
|--------|----------|------------|------|
| `GET` | `/api/v1/me/wallet` | Saldo & dana ditahan | 🔑 |
| `GET` | `/api/v1/me/transactions` | Mutasi saldo | 🔑 |
| `POST` | `/api/v1/me/topups` | **501** sampai provider dipilih | 🔑 Verified |
| `POST` | `/api/v1/me/withdrawals` | **501** sampai provider dipilih | 🔑 Verified |
| `GET`/`POST` | `/api/v1/me/bank-accounts` | Rekening tujuan (nomor disamarkan) | 🔑 |
| `DELETE` | `/api/v1/me/bank-accounts/:id` | Hapus rekening | 🔑 Verified |
| `GET` | `/api/v1/me/notifications` | Daftar notifikasi | 🔑 |
| `POST` | `/api/v1/me/notifications/:id/read` | Tandai satu dibaca | 🔑 |
| `POST` | `/api/v1/me/notifications/read-all` | Tandai semua dibaca | 🔑 |
| `POST` | `/api/v1/me/devices` | Simpan token FCM/Expo | 🔑 Verified |
| `POST` | `/api/v1/reports` | Lapor request/user | 🔑 Verified |
| `POST`/`GET` | `/api/v1/blocks` | Blokir / daftar blokir | 🔑 Verified |
| `DELETE` | `/api/v1/blocks/:userId` | Buka blokir | 🔑 Verified |
| `POST` | `/api/v1/webhooks/payments/:provider` | **501** placeholder provider | ❌ |

### Admin 🛡️

| Method | Endpoint | Keterangan |
|--------|----------|-----------|
| `GET` | `/api/v1/admin/dashboard/summary` | Total user, verified, helper aktif, request berjalan, antrean |
| `GET` | `/api/v1/admin/dashboard/summary/export` | Export ringkasan (CSV) |
| `GET` | `/api/v1/admin/pending-counts` | Badge lonceng per antrean |
| `GET` | `/api/v1/admin/verifications` | Antrean KTM (`status`, `q`) |
| `GET` | `/api/v1/admin/verifications/export` | Export antrean (CSV) |
| `GET` | `/api/v1/admin/verifications/:id` | Detail + signed URL KTM |
| `POST` | `/api/v1/admin/verifications/:id/claim` | Tandai sedang ditinjau |
| `POST` | `/api/v1/admin/verifications/:id/approve` | Terima `{note?}` |
| `POST` | `/api/v1/admin/verifications/:id/reject` | Tolak `{note}` (wajib) |
| `GET` | `/api/v1/admin/users` | Daftar pengguna (`status`, `q`, `role`) |
| `GET` | `/api/v1/admin/users/export` | Export pengguna (CSV) |
| `GET` | `/api/v1/admin/users/:id` | Profil lengkap + statistik + jumlah laporan |
| `POST` | `/api/v1/admin/users/:id/suspend` | `{days\|null, reason}` |
| `POST` | `/api/v1/admin/users/:id/reactivate` | `{reason}` |
| `POST` | `/api/v1/admin/users/:id/warn` | `{note}` |
| `GET` | `/api/v1/admin/reports` | Laporan (`targetType`, `status`) |
| `GET` | `/api/v1/admin/reports/export` | Export laporan (CSV) |
| `GET` | `/api/v1/admin/reports/:id` | Detail laporan + target |
| `POST` | `/api/v1/admin/reports/:id/claim` | Tandai ditinjau |
| `POST` | `/api/v1/admin/reports/:id/resolve` | `{action, reason}` |
| `POST` | `/api/v1/admin/reports/:id/dismiss` | `{reason}` |
| `GET` | `/api/v1/admin/requests` | Request termoderasi |
| `POST` | `/api/v1/admin/requests/:id/moderate` | `{action: HIDE\|REMOVE\|KEEP, reason}` |
| `POST` | `/api/v1/admin/requests/:id/restore` | Pulihkan request |
| `GET` | `/api/v1/admin/disputes` | Antrean dispute (`status`) |
| `GET` | `/api/v1/admin/disputes/export` | Export dispute (CSV) |
| `GET` | `/api/v1/admin/disputes/:id` | Detail + bukti + cuplikan chat |
| `POST` | `/api/v1/admin/disputes/:id/claim` | Tandai ditinjau |
| `POST` | `/api/v1/admin/disputes/:id/request-evidence` | `{note}` |
| `POST` | `/api/v1/admin/disputes/:id/resolve` | `{decision, refund_amount, basis}` |
| `GET` | `/api/v1/admin/transactions` | Aktivitas transaksi platform |
| `GET` | `/api/v1/admin/transactions/export` | Export semua transaksi (CSV) |
| `GET` | `/api/v1/admin/transactions/summary` | Ringkasan hari ini |
| `GET` | `/api/v1/admin/transactions/:id` | Detail + riwayat pemrosesan |
| `POST` | `/api/v1/admin/transactions/:id/request-fix` | `{note}` |
| `POST` | `/api/v1/admin/transactions/:id/retry` | **501** sampai provider dipilih |
| `GET` | `/api/v1/admin/transactions/:id/export` | Export detail (CSV) |
| `GET` | `/api/v1/admin/audit-logs` | Jejak audit (`entityType`, `entityId`, `actorId`, `action`) |

**Status fitur:** Seluruh alur non-payment sudah aktif: chat (REST), assignment/agreement, escrow saldo internal, review, dispute, dan moderasi admin. Integrasi payment gateway (top up, withdraw, webhook, retry payout) sengaja mengembalikan `501` dengan `code: "PAYMENT_PROVIDER_NOT_CONFIGURED"` sampai provider seperti Midtrans ditentukan. WebSocket realtime belum aktif; chat memakai REST dan notifikasi tersimpan di DB untuk dikirim lewat FCM/WS nanti.

---

## 🔐 Auth Endpoints


---

### 1. Register

**`POST /api/v1/auth/register`**

Mendaftarkan akun baru. Setelah berhasil, sistem otomatis mengirimkan kode **OTP 6 digit** ke email pengguna. Akun belum bisa digunakan untuk login sampai OTP diverifikasi.

#### Request Body

```json
{
  "full_name": "John Doe",
  "email": "john@example.com",
  "password": "rahasia123",
  "university": "Universitas Indonesia",
  "major": "Teknik Informatika",
  "linkedin_url": "https://linkedin.com/in/johndoe",
  "website": "https://johndoe.dev"
}
```

| Field | Tipe | Wajib | Validasi |
|-------|------|--------|----------|
| `full_name` | `string` | ✅ | Tidak boleh kosong, maks. **255 karakter** |
| `email` | `string` | ✅ | Format email valid, maks. **254 karakter**, di-lowercase otomatis |
| `password` | `string` | ✅ | Tidak boleh kosong, maks. **72 byte** (UTF-8) |
| `university` | `string` | ❌ | Maks. **255 karakter**, default `""` jika tidak diisi |
| `major` | `string` | ❌ | Maks. **255 karakter**, default `""` jika tidak diisi |
| `linkedin_url` | `string` | ❌ | Maks. **255 karakter**, default `""` jika tidak diisi |
| `website` | `string` | ❌ | Maks. **255 karakter**, default `""` jika tidak diisi |

#### Response Sukses — `201 Created`

```json
{
  "success": true,
  "message": "Registrasi berhasil. Periksa email Anda untuk verifikasi OTP.",
  "data": {
    "id": 1,
    "full_name": "John Doe",
    "email": "john@example.com",
    "university": "Universitas Indonesia",
    "major": "Teknik Informatika",
    "linkedin_url": "https://linkedin.com/in/johndoe",
    "website": "https://johndoe.dev",
    "email_verified_at": null,
    "created_at": "2026-10-16T04:00:00.000Z",
    "updated_at": "2026-10-16T04:00:00.000Z",
    "requires_verification": true,
    "otp_expires_in": 600
  }
}
```

> `otp_expires_in` adalah waktu kedaluwarsa OTP dalam **detik** (`600` = 10 menit). OTP maksimal dicoba 5 kali; pengiriman ulang memiliki jeda 60 detik.

#### Response Error

| Status | `message` | Penyebab |
|--------|-----------|----------|
| `400 Bad Request` | `"full_name, email valid, dan password wajib diisi"` | Salah satu field wajib kosong atau tidak valid |
| `400 Bad Request` | `"full_name maksimal 255 karakter dan password maksimal 72 byte"` | Melebihi batas karakter |
| `400 Bad Request` | `"{field} harus berupa teks maksimal 255 karakter"` | Field opsional melebihi 255 karakter |
| `409 Conflict` | `"Email sudah terdaftar. Gunakan kirim ulang OTP jika belum terverifikasi."` | Email sudah ada di database |
| `503 Service Unavailable` | `"Email OTP gagal dikirim. Silakan coba lagi nanti."` | Layanan email gagal |
| `500 Internal Server Error` | `"Terjadi kesalahan pada server"` | Error tidak terduga |

---

### 2. Verify OTP

**`POST /api/v1/auth/verify-otp`**

Memverifikasi kode OTP 6 digit yang diterima lewat email. Jika berhasil, akun langsung aktif dan dapat digunakan untuk login. OTP yang sudah diverifikasi akan **dihapus** dari database.

#### Request Body

```json
{
  "email": "john@example.com",
  "otp": "123456"
}
```

| Field | Tipe | Wajib | Validasi |
|-------|------|--------|----------|
| `email` | `string` | ✅ | Format email valid |
| `otp` | `string` | ✅ | Tepat **6 digit angka** (pola: `^\d{6}$`) |

#### Response Sukses — `200 OK`

```json
{
  "success": true,
  "message": "Email berhasil diverifikasi. Silakan login.",
  "data": {
    "id": 1,
    "full_name": "John Doe",
    "email": "john@example.com",
    "university": "Universitas Indonesia",
    "major": "Teknik Informatika",
    "linkedin_url": "https://linkedin.com/in/johndoe",
    "website": "https://johndoe.dev",
    "email_verified_at": "2026-10-16T04:05:00.000Z",
    "created_at": "2026-10-16T04:00:00.000Z",
    "updated_at": "2026-10-16T04:05:00.000Z"
  }
}
```

#### Response Error

| Status | `message` | Penyebab |
|--------|-----------|----------|
| `400 Bad Request` | `"Email valid dan OTP berupa 6 digit angka wajib diisi"` | Format input salah |
| `400 Bad Request` | `"Email atau OTP tidak valid"` | Email tidak ditemukan di database |
| `400 Bad Request` | `"OTP tidak ditemukan. Silakan kirim ulang OTP."` | Record OTP tidak ada |
| `400 Bad Request` | `"OTP sudah kedaluwarsa. Silakan kirim ulang OTP."` | OTP melewati waktu kedaluwarsa |
| `400 Bad Request` | `"OTP tidak valid"` | OTP salah (masih ada sisa percobaan) |
| `409 Conflict` | `"Email sudah terverifikasi. Silakan login."` | Akun sudah aktif sebelumnya |
| `429 Too Many Requests` | `"Batas percobaan OTP tercapai. Silakan kirim ulang OTP."` | Counter percobaan habis |
| `500 Internal Server Error` | `"Terjadi kesalahan pada server"` | Error tidak terduga |

> ⚠️ **Penting soal percobaan gagal:**
> - Setiap OTP yang salah akan menambah `attempts` counter.
> - Jika `attempts >= REGISTER_OTP_MAX_ATTEMPTS`, endpoint ini **selalu** mengembalikan `429` hingga OTP baru dikirim via `/resend-otp`.
> - Kode OTP dibandingkan dengan hash bcrypt. Server memeriksa batas percobaan dan masa berlaku sebelum perbandingan, lalu memeriksa masa berlaku sekali lagi setelahnya.

---

### 3. Resend OTP

**`POST /api/v1/auth/resend-otp`**

Mengirim ulang kode OTP baru ke email. OTP lama digantikan seluruhnya dengan OTP baru, dan counter percobaan (`attempts`) direset ke `0`.

Terdapat **cooldown** (jeda wajib) antar pengiriman OTP — jika terlalu cepat mengirim ulang, server akan menolak dengan `429`.

#### Request Body

```json
{
  "email": "john@example.com"
}
```

| Field | Tipe | Wajib | Validasi |
|-------|------|--------|----------|
| `email` | `string` | ✅ | Format email valid |

#### Response Sukses — `200 OK`

```json
{
  "success": true,
  "message": "OTP baru telah dikirim ke email Anda.",
  "data": {
    "otp_expires_in": 600
  }
}
```

#### Response Error

| Status | Header | `message` | Penyebab |
|--------|--------|-----------|----------|
| `400 Bad Request` | — | `"Email valid wajib diisi"` | Format email tidak valid |
| `400 Bad Request` | — | `"Email belum terdaftar"` | Email tidak ada di database |
| `409 Conflict` | — | `"Email sudah terverifikasi. Silakan login."` | Akun sudah aktif |
| `429 Too Many Requests` | `Retry-After: <detik>` | `"Tunggu sebelum mengirim ulang OTP."` | Masih dalam periode cooldown |
| `503 Service Unavailable` | — | `"Email OTP gagal dikirim. Silakan coba lagi nanti."` | Layanan email gagal |
| `500 Internal Server Error` | — | `"Terjadi kesalahan pada server"` | Error tidak terduga |

> **Header `Retry-After`** pada response `429` berisi sisa waktu cooldown dalam **detik**. Client sebaiknya menampilkan countdown timer berdasarkan nilai ini.

**Contoh response `429`:**
```json
{
  "success": false,
  "message": "Tunggu sebelum mengirim ulang OTP.",
  "retry_after_seconds": 47
}
```
```
Retry-After: 47
```

---

### 4. Login

**`POST /api/v1/auth/login`**

Mengautentikasi pengguna yang sudah terverifikasi dan mengembalikan **JWT Bearer Token**. Token ini digunakan untuk mengakses endpoint yang membutuhkan autentikasi.

#### Request Body

```json
{
  "email": "john@example.com",
  "password": "rahasia123"
}
```

| Field | Tipe | Wajib | Validasi |
|-------|------|--------|----------|
| `email` | `string` | ✅ | Format email valid |
| `password` | `string` | ✅ | Tidak boleh kosong |

#### Response Sukses — `200 OK`

```json
{
  "success": true,
  "message": "Login berhasil",
  "data": {
    "user": {
      "id": 1,
      "full_name": "John Doe",
      "email": "john@example.com",
      "university": "Universitas Indonesia",
      "major": "Teknik Informatika",
      "linkedin_url": "https://linkedin.com/in/johndoe",
      "website": "https://johndoe.dev",
      "email_verified_at": "2026-10-16T04:05:00.000Z",
      "role": "USER",
      "status": "ACTIVE",
      "last_login_at": "2026-10-16T04:05:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...SIGNATURE",
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...SIGNATURE",
    "refresh_token": "3Vf8h...opaque",
    "token_type": "Bearer",
    "expires_in": 3600,
    "role": "USER"
  }
}
```

> **Informasi token:**
> - `token` dipertahankan sebagai alias `access_token` agar build mobile lama tetap jalan.
> - **Access token:** JWT HS256, default 1 jam (`ACCESS_TOKEN_TTL`), payload `{ id, email, role, iat, exp }`.
> - **Refresh token:** string opaque 32 byte; server hanya menyimpan hash SHA-256-nya. Rotasi dilakukan setiap `/auth/refresh`; pemakaian ulang token lama mencabut seluruh sesi dalam family tersebut.
> - **Cara pakai:** `Authorization: Bearer <access_token>`.
> - Role & status akun **selalu** dibaca ulang dari database pada setiap request, jadi perubahan role/suspend langsung berlaku walau token belum kedaluwarsa.

#### Response Error

| Status | `message` | Penyebab |
|--------|-----------|----------|
| `400 Bad Request` | `"Validasi gagal"` | Format input salah (lihat `errors[]`) |
| `401 Unauthorized` | `"Email atau password salah"` | Kombinasi email/password tidak cocok |
| `403 Forbidden` | `"Email belum terverifikasi. Silakan verifikasi email terlebih dahulu."` | Akun belum melewati `/verify-email` |
| `403 Forbidden` | `"Akun Anda sedang ditangguhkan."` | `status=SUSPENDED`; body menyertakan `suspended_until` dan `suspended_reason` |
| `429 Too Many Requests` | `"Terlalu banyak percobaan login. Coba lagi nanti."` | Melebihi 10 percobaan / 15 menit per email+IP |
| `500 Internal Server Error` | `"Terjadi kesalahan pada server"` | Error tidak terduga |

> ⚠️ **Keamanan:** Field `password` **tidak pernah** dikembalikan dalam response manapun. Login menggunakan bcrypt compare, bukan perbandingan plain text.

---

### 5. Refresh Token

**`POST /api/v1/auth/refresh`**

Menukar refresh token dengan pasangan token baru (rotasi). Refresh token lama langsung dicabut.

```json
{ "refresh_token": "3Vf8h...opaque" }
```

Response `200 OK` berisi `token`, `access_token`, `refresh_token` baru, `token_type`, `expires_in`, dan `role`.

| Status | Penyebab |
|--------|----------|
| `401` | Token tidak valid, sudah dicabut, kedaluwarsa, atau dipakai ulang (family dicabut) |
| `403` | Akun ditangguhkan |

---

### 6. Logout

**`POST /api/v1/auth/logout`** — perlu `Authorization: Bearer`.

Body opsional `{ "refresh_token": "..." }`. Tanpa body, **semua** refresh token milik user dicabut (logout semua perangkat).

---

### 7. Forgot & Reset Password

**`POST /api/v1/auth/forgot-password`**

```json
{ "email": "john@example.com" }
```

Selalu membalas `200` dengan pesan generik agar keberadaan akun tidak bocor. OTP 6 digit dikirim bila email terdaftar dan terverifikasi; berlaku 10 menit, maksimal 5 percobaan, cooldown 60 detik (`429` + `retry_after_seconds`).

**`POST /api/v1/auth/reset-password`**

```json
{ "email": "john@example.com", "otp": "123456", "new_password": "baru12345" }
```

Sukses `200`. Setelah reset, **semua refresh token dicabut** sehingga semua perangkat harus login ulang. OTP salah/kedaluwarsa `400`, batas percobaan `429`.

---

## 🩺 Health Check

### GET /health

Mengecek apakah server berjalan normal. Digunakan oleh Docker healthcheck dan load balancer.

#### Response — `200 OK`

```json
{
  "status": "OK",
  "message": "AMAN BOS!"
}
```

---

## 🔄 Alur Lengkap Registrasi & Login

```
┌─────────────────────────────────────────────────────────────────┐
│  1. POST /auth/register                                         │
│     → Akun dibuat, OTP dikirim ke email                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │
           ┌───────────────▼───────────────┐
           │  Cek email untuk kode OTP     │
           └───────────────┬───────────────┘
                           │
          ┌────────────────▼────────────────┐
          │  2. POST /auth/verify-otp        │
          │     → Masukkan OTP 6 digit       │
          └──────┬──────────────────┬────────┘
                 │                  │
           OTP Benar           OTP Salah / Expired
                 │                  │
                 │      ┌───────────▼──────────────┐
                 │      │  3. POST /auth/resend-otp │
                 │      │     → OTP baru dikirim    │
                 │      │     → Kembali ke step 2   │
                 │      └──────────────────────────-┘
                 │
  ┌──────────────▼───────────────────────┐
  │  Email terverifikasi ✅               │
  └──────────────┬───────────────────────┘
                 │
  ┌──────────────▼───────────────────────┐
  │  4. POST /auth/login                 │
  │     → Dapatkan JWT Token             │
  └──────────────────────────────────────┘
```

---

## ⚠️ Format Error Umum

Semua response error mengikuti format berikut:

```json
{
  "success": false,
  "message": "Pesan error yang menjelaskan masalah"
}
```

Response `429` pada `/resend-otp` memiliki tambahan field:

```json
{
  "success": false,
  "message": "Tunggu sebelum mengirim ulang OTP.",
  "retry_after_seconds": 47
}
```

Endpoint terproteksi juga dapat mengembalikan `401` jika token tidak ada, tidak valid, atau akun tidak ditemukan; `403` jika email belum diverifikasi. Kesalahan validasi body dan ID umumnya menghasilkan `400`, request yang tidak ditemukan atau telah dihapus menghasilkan `404`, dan kegagalan server menghasilkan `500`.


---

## 👤 User Endpoints

---

### 1. Ambil Profil Sendiri (Get My Profile)

**`GET /api/v1/users/me`**
- **Auth:** `Bearer <token>` (Pengguna belum terverifikasi tetap dapat mengakses)

Middleware endpoint ini tidak memeriksa status verifikasi. Namun, proses login saat ini hanya menerbitkan token untuk email yang sudah terverifikasi.

#### Response Sukses — `200 OK`
```json
{
  "success": true,
  "message": "Profil berhasil diambil",
  "data": {
    "id": 1,
    "full_name": "John Doe",
    "email": "john@example.com",
    "university": "Universitas Indonesia",
    "major": "Teknik Informatika",
    "linkedin_url": "https://linkedin.com/in/johndoe",
    "website": "https://johndoe.dev",
    "email_verified_at": "2026-10-16T04:05:00.000Z",
    "created_at": "2026-10-16T04:00:00.000Z",
    "updated_at": "2026-10-16T04:05:00.000Z"
  }
}
```

---

### 2. Update Profil Sendiri (Update Profile)

**`PATCH /api/v1/users/me`**
- **Auth:** `Bearer <token>` (Wajib email terverifikasi)

#### Request Body
```json
{
  "full_name": "John Doe Updated",
  "university": "Universitas Gadjah Mada",
  "major": "Sistem Informasi",
  "linkedin_url": "https://linkedin.com/in/johndoe2",
  "website": null
}
```
Minimal kirim satu field. `full_name` harus 2–255 karakter setelah trim; `university` dan `major` harus 1–255 karakter setelah trim. `linkedin_url` dan `website` menerima URL HTTP/HTTPS maksimal 255 karakter, string kosong, atau `null` (dua nilai terakhir disimpan sebagai `null`). Field lain, termasuk `id`, `email`, `password`, dan timestamp, ditolak dengan `400`.

#### Response Sukses — `200 OK`
```json
{
  "success": true,
  "message": "Profil berhasil diperbarui",
  "data": {
    "id": 1,
    "full_name": "John Doe Updated",
    "email": "john@example.com",
    "university": "Universitas Gadjah Mada",
    "major": "Sistem Informasi",
    "linkedin_url": "https://linkedin.com/in/johndoe2",
    "website": null,
    "email_verified_at": "2026-10-16T04:05:00.000Z",
    "created_at": "2026-10-16T04:00:00.000Z",
    "updated_at": "2026-10-16T05:00:00.000Z"
  }
}
```

---

## 🏷️ Tags Endpoints

---

### 1. Ambil Katalog Tag

**`GET /api/v1/tags`**
- **Auth:** `Bearer <token>` (Wajib email terverifikasi)
- **Query Params (Opsional):**
  - `q`: Kata kunci pencarian nama tag, tanpa membedakan huruf besar/kecil (contoh: `/api/v1/tags?q=design`). Hasil diurutkan menurut nama.

#### Response Sukses — `200 OK`
```json
{
  "success": true,
  "message": "Daftar tag berhasil diambil",
  "data": [
    { "id": 1, "name": "Design", "slug": "design" },
    { "id": 6, "name": "Digital Product", "slug": "digital-product" },
    { "id": 3, "name": "Development", "slug": "development" },
    { "id": 5, "name": "Startup", "slug": "startup" },
    { "id": 4, "name": "Technology", "slug": "technology" },
    { "id": 2, "name": "UI/UX", "slug": "ui-ux" }
  ]
}
```

---

## 📋 Requests Endpoints

---

### 1. Buat Request Baru

**`POST /api/v1/requests`**
- **Auth:** `Bearer <token>` (Wajib email terverifikasi)

#### Request Body
```json
{
  "title": "Bantu Desain Wireframe Mobile App SOS",
  "description": "Dibutuhkan bantuan untuk membuat wireframe low-fidelity dan high-fidelity aplikasi SOS menggunakan Figma.",
  "estimated_time": "moderate",
  "deadline_at": "2026-12-31T23:59:59.000Z",
  "budget_amount": 150000,
  "tag_ids": [1, 2]
}
```

| Field | Tipe | Wajib | Keterangan |
|-------|------|--------|------------|
| `title` | `string` | ✅ | 5–150 karakter (setelah trim) |
| `description` | `string` | ✅ | 10–10.000 karakter (setelah trim) |
| `estimated_time` | `string` | ✅ | `'fast'`, `'moderate'`, atau `'extended'` |
| `deadline_at` | `string` | ✅ | Tanggal yang dapat diparse JavaScript dan harus di masa depan; gunakan ISO 8601 dengan timezone agar tidak ambigu |
| `budget_amount` | `integer` | ✅ | Rp 0 – 2.147.483.647 |
| `tag_ids` | `number[]` | ✅ | 1–5 ID tag valid, tidak boleh duplikat |

`title` dan `description` disimpan setelah trim. `budget_amount` adalah nominal rupiah bulat; `0` berarti bantuan gratis. `requester_id` diambil dari token. Field seperti `requester_id`, `helper_id`, `status`, `response`, `max_helpers`, `id`, dan timestamp tidak boleh dikirim.

#### Response Sukses — `201 Created`
```json
{
  "success": true,
  "message": "Request pekerjaan berhasil dibuat",
  "data": {
    "id": 1,
    "title": "Bantu Desain Wireframe Mobile App SOS",
    "description": "Dibutuhkan bantuan untuk membuat wireframe low-fidelity dan high-fidelity aplikasi SOS menggunakan Figma.",
    "estimated_time": "moderate",
    "deadline_at": "2026-12-31T23:59:59.000Z",
    "budget_amount": 150000,
    "created_at": "2026-11-08T14:00:00.000Z",
    "updated_at": "2026-11-08T14:00:00.000Z",
    "is_expired": false,
    "requester": {
      "id": 1,
      "full_name": "John Doe",
      "university": "Universitas Indonesia",
      "major": "Teknik Informatika"
    },
    "tags": [
      { "id": 1, "name": "Design", "slug": "design" },
      { "id": 2, "name": "UI/UX", "slug": "ui-ux" }
    ]
  }
}
```

---

### 2. Daftar Semua Request

**`GET /api/v1/requests`**
- **Auth:** `Bearer <token>` (Wajib email terverifikasi)
- **Query Params (Opsional):**
  - `q`: Cari judul atau deskripsi (case-insensitive)
  - `tag_id`: Filter berdasarkan ID tag
  - `estimated_time`: `fast`, `moderate`, atau `extended`
  - `page`: Nomor halaman (default: `1`)
  - `limit`: Jumlah per halaman (default: `20`, max: `50`)

`page` atau `limit` yang bukan bilangan positif akan memakai nilai bawaan; `limit` di atas `50` dibatasi menjadi `50`. Filter `tag_id` dan `estimated_time` yang tidak valid diabaikan. Hasil diurutkan dari `created_at` terbaru, kemudian `id` terbesar. Request yang dihapus secara lunak tidak ditampilkan; request dengan tenggat lewat tetap ditampilkan dengan `is_expired: true`. `meta.total_pages` bernilai minimal `1`, termasuk saat hasil kosong.

Contoh: `GET /api/v1/requests?q=desain&tag_id=1&page=1&limit=10`

#### Response Sukses — `200 OK`
```json
{
  "success": true,
  "message": "Daftar request berhasil diambil",
  "data": [
    {
      "id": 1,
      "title": "Bantu Desain Wireframe Mobile App SOS",
      "description": "Dibutuhkan bantuan untuk membuat wireframe low-fidelity dan high-fidelity aplikasi SOS menggunakan Figma.",
      "estimated_time": "moderate",
      "deadline_at": "2026-12-31T23:59:59.000Z",
      "budget_amount": 150000,
      "created_at": "2026-11-08T14:00:00.000Z",
      "updated_at": "2026-11-08T14:00:00.000Z",
      "is_expired": false,
      "requester": {
        "id": 1,
        "full_name": "John Doe",
        "university": "Universitas Indonesia",
        "major": "Teknik Informatika"
      },
      "tags": [
        { "id": 1, "name": "Design", "slug": "design" }
      ]
    }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "total_pages": 1
  }
}
```

---

### 3. Detail Request

**`GET /api/v1/requests/:id`**
- **Auth:** `Bearer <token>` (Wajib email terverifikasi)

#### Response Sukses — `200 OK`
```json
{
  "success": true,
  "message": "Detail request berhasil diambil",
  "data": {
    "id": 1,
    "title": "Bantu Desain Wireframe Mobile App SOS",
    "description": "Dibutuhkan bantuan untuk membuat wireframe low-fidelity dan high-fidelity aplikasi SOS menggunakan Figma.",
    "estimated_time": "moderate",
    "deadline_at": "2026-12-31T23:59:59.000Z",
    "budget_amount": 150000,
    "created_at": "2026-11-08T14:00:00.000Z",
    "updated_at": "2026-11-08T14:00:00.000Z",
    "is_expired": false,
    "requester": {
      "id": 1,
      "full_name": "John Doe",
      "university": "Universitas Indonesia",
      "major": "Teknik Informatika"
    },
    "tags": [
      { "id": 1, "name": "Design", "slug": "design" },
      { "id": 2, "name": "UI/UX", "slug": "ui-ux" }
    ]
  }
}
```

---

### 4. Daftar Request Milik Sendiri

**`GET /api/v1/users/me/requests`**
- **Auth:** `Bearer <token>` (Wajib email terverifikasi)
- Mendukung query parameter dan bentuk `data`/`meta` yang sama dengan `GET /api/v1/requests`, tetapi hanya menampilkan request milik pengguna. Pesan sukses: `Daftar request Anda berhasil diambil`.

---

### 5. Update Request Sendiri

**`PATCH /api/v1/requests/:id`**
- **Auth:** `Bearer <token>` (Wajib email terverifikasi & pembuat request)
- Jika request sudah memiliki helper ditugaskan, server mengembalikan `409 Conflict`.
- Body boleh berisi satu atau beberapa field dari tabel pada bagian "Buat Request Baru"; semua validasi field tersebut tetap berlaku. Jika `tag_ids` dikirim, seluruh tag lama diganti. Body kosong atau field di luar daftar menghasilkan `400`.

#### Request Body
```json
{
  "title": "Bantu Desain Wireframe & Prototype Figma SOS",
  "description": "Deskripsi baru minimal 10 karakter...",
  "estimated_time": "extended",
  "deadline_at": "2027-01-15T23:59:59.000Z",
  "budget_amount": 250000,
  "tag_ids": [1, 2, 6]
}
```

#### Response Sukses — `200 OK`
Response berisi `success: true`, `message: "Request berhasil diperbarui"`, dan objek `data` dengan bentuk yang sama seperti response `GET /api/v1/requests/:id`.

Jika ID tidak valid server mengembalikan `400`; request tidak ada atau telah dihapus `404`; pengguna bukan pemilik `403`; dan request sudah memiliki helper `409`.

---

### 6. Hapus Request Sendiri (Soft Delete)

**`DELETE /api/v1/requests/:id`**
- **Auth:** `Bearer <token>` (Wajib email terverifikasi & pembuat request)
- Jika request sudah memiliki helper ditugaskan, server mengembalikan `409 Conflict`.
- Penghapusan bersifat lunak: request tidak lagi muncul pada daftar atau detail, dan tidak dapat diubah lagi. ID tidak valid menghasilkan `400`, request tidak ada/sudah dihapus `404`, dan pengguna bukan pemilik `403`.

#### Response Sukses — `204 No Content`
(Tanpa body)

---

# 🧩 Modul Lanjutan

Bagian ini merangkum modul baru. Contoh body lengkap mengikuti skema validasi di `src/validators/`.

## Respons & pagination

Semua daftar memakai bentuk yang sama:

```json
{
  "success": true,
  "message": "...",
  "data": [],
  "meta": { "page": 1, "limit": 20, "total": 0, "total_pages": 1 }
}
```

Validasi gagal:

```json
{
  "success": false,
  "message": "Validasi gagal",
  "errors": [{ "path": "body.title", "message": "title minimal 5 karakter" }]
}
```

Chat memakai cursor: `GET /conversations/:id/messages?before=<message_id>&limit=30` → `{ messages: [...], next_before: 123 }`.

---

## 👤 Profil (`/me`)

- `GET /me` → profil privat + `interests`, `skills`, `portfolio`, `student_verification_pending`, `is_student_verified`, `avatar_url`.
- `PATCH /me` → field `full_name`, `university`, `major`, `linkedin_url`, `website`. Field lain ditolak `400`. `linkedin_url`/`website` menerima URL HTTP(S), string kosong, atau `null`.
- `PUT /me/interests` & `PUT /me/skills` → `{ "tag_ids": [1,2] }` (maks 10). Seluruh daftar lama diganti.
- `POST /me/avatar` → `{ "file_key": "..." }` dari file `purpose=AVATAR` yang sudah diunggah.
- `POST /me/portfolio` → `{ title, description?, url?, file_key?, sort_order? }` (minimal salah satu dari `url`/`file_key`).
- `DELETE /me/portfolio/:id` → `204`, soft delete.
- `POST /me/student-verification` → `{ file_key }` dengan `purpose=STUDENT_ID`. Hanya boleh satu pengajuan aktif (`409` bila sudah ada).

Profil publik `GET /users/:id` tidak pernah memuat `email`; menyertakan `avatar_url`, portfolio, skills, `rating_average`, `review_count`, dan `completed_helps`.

---

## 📎 Unggahan file (adapter lokal)

Alur dua langkah, siap diganti presigned S3/R2:

1. `POST /uploads/presign`
   ```json
   { "purpose": "AVATAR", "mime": "image/png", "byte_size": 120000, "original_name": "foto.png" }
   ```
   → `201 { file_key, upload_url, method: "PUT", headers: { "Content-Type": ... }, expires_at, max_bytes }`
2. `PUT /uploads/:key` dengan **body biner** dan header `Content-Type` sesuai MIME → `200`.

Batas per purpose:

| Purpose | MIME | Maks |
|---|---|---|
| `AVATAR` | jpeg, png, webp | 2 MB |
| `PORTFOLIO` | jpeg, png, webp, pdf | 5 MB |
| `STUDENT_ID` | jpeg, png, webp, pdf | 5 MB |
| `REQUEST_ATTACHMENT` | jpeg, png, webp, pdf | 5 MB |
| `CHAT_ATTACHMENT` | jpeg, png, webp, pdf, zip, doc, docx | 10 MB |
| `DISPUTE_EVIDENCE` | jpeg, png, webp, pdf | 10 MB |

`GET /files/:key` publik untuk `AVATAR`/`PORTFOLIO`. File privat hanya bisa dibaca pemilik, peserta percakapan/assignment terkait, atau lewat URL bertanda tangan (`?token=`, 10 menit) yang dipakai admin. File tersimpan di `UPLOAD_DIR` (default `uploads/`, tidak di-commit).

---

## 📋 Request, reply, home

- `GET /requests` — hanya `status=OPEN`, tidak dihapus/ dimoderasi, dan **tidak punya assignment aktif**. Filter: `q`, `subject` (slug tag), `tag_id`, `estimated_time`, `sort=newest|deadline|budget`, `page`, `limit`.
- `POST /requests` — body sama seperti sebelumnya + `attachment_file_keys?` (maks 5, harus `purpose=REQUEST_ATTACHMENT` milik sendiri).
- `PATCH /requests/:id` — `budget_amount` terkunci (`409`) bila sudah ada assignment; `deadline_at`/`tag_ids` juga terkunci bila ada assignment. Request `CANCELLED`/`COMPLETED`/`REMOVED` tidak dapat diubah.
- `POST /requests/:id/cancel` — `{ reason? }`; hanya `OPEN` tanpa assignment aktif. Sukses mengembalikan detail dengan `status: "CANCELLED"`.
- `GET /me/requests?status=` — `floating` (OPEN tanpa assignment aktif), `on_progress`, `completed`, `cancelled`. Setiap item menyertakan `assignment` terakhir.
- `GET/POST /requests/:id/replies` — reply hanya dari non-pemilik, satu kali per helper, request harus `OPEN`, dan pasangan tidak saling blokir. `DELETE /replies/:id` hanya penulis selama belum ada assignment.
- `POST /helpers/:id/direct-requests` — `{ request_id }` untuk request yang sudah ada, atau `{ title, description, estimated_time, deadline_at, budget_amount, tag_ids }` untuk membuat request baru. `message?` menjadi pesan pembuka chat. Response `{ request_id, conversation_id }`.
- `GET /me/home` → `{ ongoing_as_requester, ongoing_as_helper, unread_notifications, unread_messages, wallet }`.
- `GET /me/pending-counts` → `{ pending_agreements, on_progress, active_conversations, unread_notifications, unread_messages }`.

Status request: `OPEN`, `CANCELLED`, `COMPLETED`, `HIDDEN`, `REMOVED`.

---

## 💬 Chat (REST)

WebSocket belum aktif. Semua endpoint memerlukan salah satu peserta percakapan.

- `GET /conversations?q=` → `{ id, request, counterpart, status, last_message_preview, last_message_at, unread_count, assignment }`.
- `POST /conversations` → `{ request_id, helper_id }`. Hanya pemilik request. Idempoten: `200` bila sudah ada, `201` bila baru dibuat.
- `GET /conversations/:id` → detail + `requester`, `helper`, `assignment`.
- `GET /conversations/:id/messages?before=&limit=` → `{ messages: [{ id, body, created_at, sender, file, is_mine }], next_before }`.
- `POST /conversations/:id/messages` → `{ body? , file_key? }` (minimal satu). `file_key` harus `purpose=CHAT_ATTACHMENT`.
- `POST /conversations/:id/read` → `{ last_read_message_id? }`; tanpa body memakai pesan terakhir.
- `POST /conversations/:id/decline` → requester menolak helper; conversation menjadi `DECLINED` dan assignment `PENDING_AGREEMENT` (bila ada) otomatis `CANCELLED`, request kembali `OPEN`.

Blokir antar pengguna menolak pembuatan reply, chat, dan direct request (`403`).

---

## 🤝 Assignment, agreement, completion, cancellation

Status assignment: `PENDING_AGREEMENT` → `ON_PROGRESS` → `COMPLETED`, atau `CANCELLED`/`DISPUTED`.

1. **Terima helper** — `POST /requests/:id/assignments`
   ```json
   { "helper_id": 2, "amount": 50000, "terms": "opsional", "deadline_at": "2026-12-01T10:00:00.000Z" }
   ```
   `amount`/`terms`/`deadline_at` opsional; default dari request. Menolak self-assign (`400`), helper nonaktif (`404`), dan assignment aktif lain (`409`). Percakapan otomatis dibuat.
2. **Setujui agreement** — `POST /assignments/:id/agreement/approve` dipanggil **masing-masing pihak**. Setiap pihak hanya sekali (`409`).
3. **Danai** — `POST /assignments/:id/fund` (requester). Wajib dua persetujuan (`409`) dan saldo cukup (`402`). Saldo berpindah `balance → held`, assignment menjadi `ON_PROGRESS`.
4. **Selesai** — `POST /assignments/:id/completion` (salah satu pihak) → status `PENDING`. Pihak **lain** memanggil `/completion/confirm` → dana dilepas ke helper (dipotong `PLATFORM_FEE_PERCENT`, default 0), request & assignment `COMPLETED`. `/completion/reject` mengembalikan ke `ON_PROGRESS`.
5. **Batal** — `POST /assignments/:id/cancellation`:
   - sebelum pendanaan (`PENDING_AGREEMENT`) → langsung `CANCELLED` dan request kembali `OPEN`;
   - setelah dana dikunci → menjadi permintaan `PENDING`. Pihak lain `/cancellation/confirm` → **refund** ke saldo requester; `/cancellation/reject` tetap `ON_PROGRESS`.
6. **Review** — `POST /assignments/:id/review` `{ rating: 1..5, comment? }`, hanya requester, hanya setelah `COMPLETED`, sekali per assignment.
7. **Dispute** — `POST /assignments/:id/disputes` `{ reason, evidence_keys? }` → assignment `DISPUTED`, menunggu admin.
8. `GET /me/assignments?role=requester|helper&status=` menyertakan `can_review` untuk requester setelah selesai.

Semua transisi menulis **AuditLog** dan **Notification** dalam transaksi database yang sama.

---

## 💰 Wallet (internal) & payment gateway (ditunda)

- `GET /me/wallet` → `{ balance, held, available, currency: "IDR", updated_at }`. `balance` = dana tersedia; `held` = dana terkunci untuk assignment berjalan.
- `GET /me/transactions` → mutasi dengan filter `type`, `status`, `date_from`, `date_to`. Tipe: `TOPUP`, `WITHDRAWAL`, `HOLD`, `RELEASE`, `REFUND`, `FEE`, `ADJUSTMENT`; setiap baris menyimpan `balance_after` dan `held_after`.
- `POST /me/topups` dan `POST /me/withdrawals` → **`501`**
  ```json
  { "success": false, "code": "PAYMENT_PROVIDER_NOT_CONFIGURED", "message": "Integrasi payment gateway belum dikonfigurasi. Hubungi admin." }
  ```
  Body divalidasi lebih dulu (`amount` integer, minimal Rp10.000) sehingga kontraknya sudah siap untuk Midtrans.
- `GET/POST /me/bank-accounts`, `DELETE /me/bank-accounts/:id` → hanya menyimpan nomor bertopeng (`account_number_masked`); `provider_token` dikosongkan sampai provider dipilih.
- `POST /webhooks/payments/:provider` → `501` placeholder (idempotensi & verifikasi signature ditambahkan saat integrasi).
- `POST /admin/transactions/:id/retry` → `501` untuk alasan yang sama.

Penyesuaian saldo manual oleh admin memakai `ADJUSTMENT` lewat service wallet; endpoint admin untuk itu belum dibuka.

---

## 🔔 Notifikasi & keamanan

- `GET /me/notifications?unread_only=true` → `data[]` + `meta.unread`.
- `POST /me/notifications/:id/read`, `POST /me/notifications/read-all`.
- `POST /me/devices` `{ token, platform: android|ios|web }` — token FCM/Expo disimpan untuk pengiriman push di iterasi berikutnya.
- `POST /reports` `{ target_type: REQUEST|USER, target_id, reason }` — mencegah laporan terbuka duplikat (`409`).
- `POST /blocks` `{ user_id }`, `GET /blocks`, `DELETE /blocks/:userId`.

---

## 🛡️ Admin

Semua route `/admin` memakai `authenticateToken → loadCurrentUser → requireAdmin`. Role dibaca ulang dari database, bukan dari klaim token.

- **Dashboard** — `/admin/dashboard/summary` (total user, verified, helper aktif, request berjalan, antrean, dana ditahan), `/summary/export` (CSV), `/pending-counts`.
- **Verifikasi KTM** — list (`status`, `q`), detail dengan `document_url` bertanda tangan 10 menit, `claim`, `approve {note?}`, `reject {note}` (note wajib). Approve mengisi `user.student_verified_at` dan mengirim notifikasi.
- **Pengguna** — list (`status`, `role`, `q`), detail (+statistik & jumlah laporan), `suspend {days|null, reason}` (mencabut semua refresh token), `reactivate {reason}`, `warn {note}`. Admin tidak dapat menangguhkan sesama admin.
- **Laporan** — list (`targetType`, `status`), detail (+target), `claim`, `resolve {action, reason}`, `dismiss {reason}`.
- **Moderasi request** — `moderate {action: HIDE|REMOVE|KEEP, reason}`, `restore`. Request `HIDDEN`/`REMOVED` hanya terlihat oleh pemilik dan admin; `404` untuk pengguna lain.
- **Dispute** — list, detail (pernyataan, bukti dengan signed URL, 30 pesan chat terakhir), `claim`, `request-evidence {note}`, `resolve {decision, refund_amount, basis}`:
  - `FULL_REFUND` → seluruh dana dikembalikan ke requester, assignment `CANCELLED`, request kembali `OPEN`.
  - `PARTIAL_REFUND` → `refund_amount` (integer, 0 < nilai < nominal) dikembalikan, sisanya dilepas ke helper; assignment `COMPLETED`.
  - `RELEASE` → seluruh dana dilepas ke helper; assignment `COMPLETED`.
  Semua langkah wallet + status + audit + notifikasi berada dalam **satu transaksi database**.
- **Transaksi** — list (`type`, `status`, `q`, `date`), `summary?date=`, detail + `history`, `request-fix {note}`, `retry` (`501`), export CSV.
- **Audit log** — `GET /admin/audit-logs?entityType=&entityId=&actorId=&action=&page=&limit=`.

---

## 🔄 Alur end-to-end (ringkas)

```
register → verify-email → login (access + refresh)
  → presign + PUT file → /me/avatar → /me/interests → /me/skills
  → /me/student-verification → admin approve
  → POST /requests → helper POST /requests/:id/replies
  → POST /conversations → POST messages
  → POST /requests/:id/assignments
  → POST .../agreement/approve (requester) → (helper)
  → POST .../fund (balance → held, ON_PROGRESS)
  → POST .../completion (helper) → POST .../completion/confirm (requester)
  → dana dilepas ke helper → POST .../review
  → (opsional) POST .../disputes → admin resolve (refund/release)
```
