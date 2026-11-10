# 📚 API Documentation — SOS (Student On Study)

**Base URL (port bawaan):** `http://localhost:3000/api/v1`
**Format:** Request dengan body dan response API menggunakan JSON (`Content-Type: application/json`). Endpoint `DELETE` yang berhasil mengembalikan `204` tanpa body.

Port dapat diubah melalui variabel lingkungan `PORT`. Gunakan header `Authorization: Bearer <token>` untuk endpoint yang membutuhkan autentikasi. Token diperoleh dari `/auth/login` dan berlaku 1 hari.

---

## Daftar Endpoint

| Method | Endpoint | Keterangan | Auth |
|--------|----------|------------|------|
| `POST` | `/api/v1/auth/register` | Registrasi akun baru | ❌ |
| `POST` | `/api/v1/auth/verify-otp` | Verifikasi OTP email | ❌ |
| `POST` | `/api/v1/auth/resend-otp` | Kirim ulang OTP | ❌ |
| `POST` | `/api/v1/auth/login` | Login & dapatkan token | ❌ |
| `GET` | `/health` | Health check server | ❌ |
| `GET` | `/api/v1/users/me` | Ambil profil user login | 🔑 Bearer (Unverified OK) |
| `PATCH` | `/api/v1/users/me` | Update profil user | 🔑 Bearer + Verified |
| `GET` | `/api/v1/users/me/requests` | Daftar request milik sendiri | 🔑 Bearer + Verified |
| `GET` | `/api/v1/tags` | Katalog bidang pekerjaan / tags | 🔑 Bearer + Verified |
| `POST` | `/api/v1/requests` | Buat request pekerjaan | 🔑 Bearer + Verified |
| `GET` | `/api/v1/requests` | Daftar request pekerjaan yang belum dihapus | 🔑 Bearer + Verified |
| `GET` | `/api/v1/requests/:id` | Detail request pekerjaan | 🔑 Bearer + Verified |
| `PATCH` | `/api/v1/requests/:id` | Update request milik sendiri | 🔑 Bearer + Verified |
| `DELETE` | `/api/v1/requests/:id` | Hapus secara lunak request sendiri | 🔑 Bearer + Verified |

**Status fitur:** Penugasan helper sudah memiliki tabel database, tetapi endpoint untuk mendaftar atau menugaskan helper belum tersedia. `budget_amount` adalah nominal penawaran dalam rupiah, belum merupakan transaksi pembayaran.

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
