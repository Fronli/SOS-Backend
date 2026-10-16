# 📚 API Documentation — SOS (Student On Study)

**Base URL:** `http://localhost:5000/api/v1`  
**Format:** Semua request dan response menggunakan `Content-Type: application/json`

---

## Daftar Endpoint

| Method | Endpoint | Keterangan | Auth |
|--------|----------|------------|------|
| `POST` | `/api/v1/auth/register` | Registrasi akun baru | ❌ |
| `POST` | `/api/v1/auth/verify-otp` | Verifikasi OTP email | ❌ |
| `POST` | `/api/v1/auth/resend-otp` | Kirim ulang OTP | ❌ |
| `POST` | `/api/v1/auth/login` | Login & dapatkan token | ❌ |
| `GET` | `/health` | Health check server | ❌ |

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
    "otp_expires_in": 300
  }
}
```

> `otp_expires_in` adalah waktu kedaluwarsa OTP dalam **detik** (contoh: `300` = 5 menit).

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
> - Pengecekan OTP dilakukan **setelah** bcrypt hash compare, bukan sebelumnya — ini mencegah timing attack.

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
    "otp_expires_in": 300
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
      "created_at": "2026-10-16T04:00:00.000Z",
      "updated_at": "2026-10-16T04:05:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwiZW1haWwiOiJqb2huQGV4YW1wbGUuY29tIiwiaWF0IjoxNjAwMDAwMDAwLCJleHAiOjE2MDAwODY0MDB9.SIGNATURE"
  }
}
```

> **Informasi JWT Token:**
> - **Algoritma:** HS256
> - **Masa berlaku:** `1 hari` (`expiresIn: "1d"`)
> - **Payload:** `{ id: number, email: string, iat: number, exp: number }`
> - **Cara pakai:** Sertakan di header request sebagai `Authorization: Bearer <token>`

#### Response Error

| Status | `message` | Penyebab |
|--------|-----------|----------|
| `400 Bad Request` | `"Email valid dan password wajib diisi"` | Field kosong atau format email salah |
| `401 Unauthorized` | `"Email atau password salah"` | Kombinasi email/password tidak cocok |
| `403 Forbidden` | `"Email belum terverifikasi. Silakan verifikasi OTP terlebih dahulu."` | Akun belum melewati `/verify-otp` |
| `500 Internal Server Error` | `"Terjadi kesalahan pada server"` | Error tidak terduga |

> ⚠️ **Keamanan:** Field `password` **tidak pernah** dikembalikan dalam response manapun. Login menggunakan bcrypt compare, bukan perbandingan plain text.

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
