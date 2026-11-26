# SOS (Student On Study) API

Backend REST API untuk platform mahasiswa yang saling membantu mengerjakan request pekerjaan. Mendukung autentikasi email OTP + refresh token, profil & verifikasi KTM, unggahan file, explore request/helper, reply, chat, alur assignment dengan escrow saldo internal, review, dispute, notifikasi, moderasi, dan panel admin.

Dibangun dengan **Node.js, TypeScript, Express 5, PostgreSQL, Drizzle ORM, Zod**, dan **Resend** untuk email OTP.

**Integrasi payment gateway belum dikonfigurasi.** Top up, penarikan, webhook payment, dan retry payout sengaja mengembalikan `501` dengan `code: "PAYMENT_PROVIDER_NOT_CONFIGURED"` agar mudah disambungkan ke provider seperti Midtrans. Alur dana internal (hold/release/refund) sudah berjalan penuh.

## Menjalankan secara lokal

1. Siapkan PostgreSQL dan salin `.env.example` menjadi `.env`. Isi minimal `DATABASE_URL` dan `JWT_SECRET`. Untuk pengembangan tanpa Resend, set `EMAIL_DRIVER=console` agar OTP tercetak di log server.
2. Jalankan:
   ```bash
   npm install
   npm run db:migrate
   npm run db:seed        # katalog tag + akun admin dari ADMIN_EMAIL/ADMIN_PASSWORD
   npm run dev
   ```
3. Cek `http://localhost:3000/health`. Endpoint API berada di `/api/v1`.

PostgreSQL, migrasi, dan API juga dapat dijalankan dengan `docker compose up -d --build` setelah `.env` disiapkan. Compose menjalankan migrasi otomatis sebelum API start. Untuk mengisi katalog tag dan akun admin di dalam container:

```bash
docker compose --profile tools run --rm seed
```

Bila port `5432` di host sudah dipakai PostgreSQL lain, set `POSTGRES_PORT=55432` (atau port bebas lain) sebelum `docker compose up`. File unggahan disimpan di named volume `uploads` sehingga tetap ada setelah container dibuat ulang.

## Variabel lingkungan penting

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | Port HTTP |
| `DATABASE_URL` | — | Koneksi PostgreSQL (wajib) |
| `JWT_SECRET` | — | Kunci JWT (wajib) |
| `ACCESS_TOKEN_TTL` | `1h` | Masa berlaku access token |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Masa berlaku refresh token |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | — | Pengiriman OTP |
| `EMAIL_DRIVER` | — | Set `console` untuk mencetak OTP ke log (lokal) |
| `UPLOAD_DIR` | `uploads` | Direktori penyimpanan file lokal |
| `PUBLIC_BASE_URL` | `http://localhost:PORT` | Basis URL file publik |
| `FILE_URL_SECRET` | `JWT_SECRET` | Kunci token URL file privat |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Akun admin saat `npm run db:seed` |
| `PLATFORM_FEE_PERCENT` | `0` | Fee platform saat pelepasan dana |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `fronli` / `fronli` / `mobile_api` | Kredensial service `postgres` di Compose |
| `POSTGRES_PORT` | `5432` | Port host untuk PostgreSQL di Compose |

## Arsitektur

```
src/
  controllers/        handler per modul (auth, me, request, chat, assignment, wallet, ...)
  controllers/admin/  handler khusus admin
  routes/             definisi endpoint + middleware
  middlewares/        auth, validasi zod, rate limit, error handler
  validators/         skema zod per modul
  services/           audit, notification, wallet, assignment, storage, otp, mail
  db/                 schema drizzle, koneksi, seed
  utils/              response, pagination, csv, id, token
```

- **Auth:** JWT HS256 + refresh token opaque (hash SHA-256, rotasi dengan deteksi reuse). Role/status akun selalu dibaca ulang dari database pada setiap request.
- **Otorisasi:** `authenticateToken → loadCurrentUser → requireVerified / requireAdmin`. Endpoint publik hanya auth dasar, katalog subject, profil helper, review, dan file publik.
- **Konsistensi transaksi:** setiap transisi status menulis baris `audit_log_table` dan `notification_table` dalam transaksi yang sama. Resolusi dispute menulis wallet + status assignment + audit + notifikasi sekaligus.
- **Uang:** nilai rupiah integer; `wallet_table.balance` (tersedia) dan `held` (terkunci) selalu disertai `wallet_transaction_table` dengan `balance_after`/`held_after`.
- **Storage:** adapter lokal (`storage.service.ts`) dengan presign + PUT + URL bertanda tangan. Ganti implementasi service ini untuk S3/R2 tanpa mengubah controller.
- **Rate limit:** in-memory per proses (login, register, resend OTP, forgot password). Deployment multi-instance perlu Redis.
- **Realtime:** chat masih REST. Notifikasi tersimpan di database dan `device_token_table` sudah siap untuk FCM/WebSocket pada iterasi berikutnya.

## Pengujian

```bash
npm test          # unit test helper murni (CSV, pagination, fee, storage, token)
npm run typecheck # tsc --noEmit
npm run build     # kompilasi ke dist/
```

Untuk smoke test end-to-end (membutuhkan server berjalan + database), gunakan `scripts/smoke-test.mjs`. Script ini membuat pengguna baru, menjalankan alur OTP → request → chat → assignment → completion → review → dispute → admin, dan memeriksa 112 assertion.

Daftar endpoint, body, autentikasi, dan contoh respons tersedia di [API_DOCS.md](API_DOCS.md).
