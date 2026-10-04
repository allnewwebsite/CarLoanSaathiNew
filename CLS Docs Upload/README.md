# CarLoanSaathi Finance Desk

Lightweight Phase 1 document-upload client for Finance Desk users. It uses the existing CarLoanSaathi backend as the only source of truth.

## Run

```bash
npm install
npm run start
```

Set `EXPO_PUBLIC_API_BASE_URL` to the backend API URL including `/api`, for example `http://192.168.1.10:8080/api` when testing on a physical device.

## Existing APIs used

- `POST /api/auth/login`
- `GET /api/auth/session`
- `POST /api/auth/session/refresh`
- `POST /api/auth/logout`
- `GET /api/dealer/leads`
- `GET /api/dealer/leads/:id`
- `GET /api/documents/lead/:leadId`
- `POST /api/documents/upload`
- `POST /api/realtime/ticket`
- `GET /api/realtime/events`

Uploads reuse the backend `Idempotency-Key` contract. The app does not create cases, documents, notifications, or business statuses locally.
