# SOS (Student On Study) API

Backend REST API untuk platform mahasiswa yang ingin membuat dan mencari permintaan bantuan pekerjaan atau proyek. Saat ini API mendukung registrasi dengan verifikasi OTP email, login JWT, profil pengguna, katalog tag, serta pembuatan, pencarian, perubahan, dan penghapusan lunak request. Penugasan helper dan pembayaran belum tersedia sebagai endpoint.

Dibangun dengan **Node.js, TypeScript, Express, PostgreSQL, Drizzle ORM**, dan **Resend** untuk email OTP.

## Menjalankan secara lokal

1. Siapkan PostgreSQL dan buat file `.env` di root proyek. Isi paling tidak `DATABASE_URL`, `JWT_SECRET`, dan `RESEND_API_KEY`. `PORT` bersifat opsional (bawaan `3000`); `RESEND_FROM_EMAIL` opsional bila pengirim bawaan Resend sesuai untuk akun Anda.
2. Jalankan `npm install`, `npm run db:migrate`, `npm run db:seed`, lalu `npm run dev`.
3. Cek `http://localhost:3000/health`. Endpoint API berada di `/api/v1`.

PostgreSQL, migrasi, dan API juga dapat dijalankan dengan `docker compose up -d --build` setelah `.env` disiapkan. Untuk mengisi katalog tag, jalankan `npm run db:seed` dengan koneksi database yang sesuai.

Daftar endpoint, body, autentikasi, dan contoh respons tersedia di [API_DOCS.md](API_DOCS.md).
