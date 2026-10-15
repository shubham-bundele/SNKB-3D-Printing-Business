# SNKB 3D Studio — Custom 3D Printing & Instant STL Quoting (India)

High-precision custom 3D printing and instant quoting platform engineered for rapid prototyping and production parts across India.

Upload any STL model for real-time 3D inspection in Three.js, volume & weight calculation, and instant material pricing in Indian Rupees (**₹ INR**).

## Specifications & Standards

| Parameter | Specification |
| --- | --- |
| **Market Focus** | Pan-India Fast Courier Dispatch |
| **Currency** | Indian Rupee (**₹ INR**) |
| **Material** | Tough PLA+ & Technical PETG |
| **Density** | 1.24 g/cm³ (0.00124 g/mm³) |
| **Filament Rate** | Starting from **₹2.00 / gram** |
| **Layer Precision** | 0.08 mm – 0.28 mm (±0.1 mm tolerance) |
| **Capacity** | Scalable Multi-Printer Production Farm |

## Getting Started

```bash
npm install
npm start        # Runs backend & storefront at http://localhost:3000
```

Environment variables:
- `PORT` — HTTP port (default `3000`).
- `SUPABASE_URL` — Supabase PostgreSQL project URL.
- `SUPABASE_ANON_KEY` — Supabase anonymous API key.
- `RESEND_API_KEY` — Resend API key for transactional emails.
- `PUBLIC_SITE_URL` — Base site URL for links (default `http://localhost:3000`).

## API Reference

### `GET /api/health`
Health check endpoint reporting service availability.

```json
{
  "status": "ok",
  "service": "snkb-3d-printing-backend",
  "timestamp": "2026-10-13T08:30:00.000Z"
}
```

### `POST /api/quote`
Accepts `multipart/form-data` with an `.stl` file (Binary or ASCII). Automatic format detection and geometry calculation via the divergence theorem.

```bash
curl -X POST http://localhost:3000/api/quote \
  -F "file=@public/samples/cube_20mm_binary.stl"
```

**200 OK** — successful quote & pending order creation:
```json
{
  "success": true,
  "orderId": 1,
  "file": { "name": "cube_20mm_binary.stl", "sizeBytes": 684, "format": "binary", "triangleCount": 12 },
  "dimensions": { "x": 20, "y": 20, "z": 20 },
  "volumeMm3": 8000,
  "weightGrams": 9.92,
  "materialCost": 0.2,
  "currency": "INR",
  "material": { "name": "PLA+", "densityGPerCm3": 1.24 }
}
```

### `POST /api/orders/confirm`
Customer checkout submission attaching contact details, color choice, and production notes.

### `GET /api/orders/:id`
Public sanitized order tracking endpoint.

### `GET /api/admin/orders`
Private administrator order queue with status update endpoints (`PATCH /api/admin/orders/:id`).

## Testing Suite

```bash
npm test         # Unit & integration suites (77 tests)
npm run test:api # Cucumber BDD API acceptance suite (2 scenarios)
npm run test:e2e # Playwright End-to-End browser tests (Chromium)
```
