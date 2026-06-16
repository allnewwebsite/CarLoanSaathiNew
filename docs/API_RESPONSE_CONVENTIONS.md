# API Response Conventions

New backend endpoints should use the response helpers attached in `backend/utils/apiResponse.js`.

## Success

Use `res.success()` for new endpoints:

```js
return res.success({
  status: 201,
  message: "Lead created",
  data: lead,
  meta: { source: "finance-desk" },
});
```

Shape:

```json
{
  "success": true,
  "message": "Lead created",
  "data": {},
  "meta": {
    "requestId": "request-id",
    "durationMs": 12
  }
}
```

For paginated endpoints, put pagination metadata in `pagination`:

```js
return res.success({
  message: "Leads loaded",
  data: rows,
  pagination: { limit, nextCursor, hasMore },
});
```

## Errors

Use `res.fail()` when a controller handles an expected failure directly:

```js
return res.fail({
  status: 403,
  errorCode: "PORTAL_FORBIDDEN",
  message: "This session cannot access the requested portal.",
});
```

Shape:

```json
{
  "success": false,
  "errorCode": "PORTAL_FORBIDDEN",
  "message": "This session cannot access the requested portal.",
  "details": null,
  "requestId": "request-id"
}
```

Unexpected errors should still be passed to `next(error)` so centralized error handling and monitoring can capture them.

## Existing Endpoints

Many current endpoints return legacy raw records or `{ data, total, nextCursor }`. Do not break existing frontend consumers during normal feature work. Prefer this migration pattern:

1. Keep the existing route response stable.
2. Use `res.success()` for new endpoints.
3. When touching an old endpoint, update frontend consumers in the same change.
4. For public or partner-facing changes, document the response shape in the PR.

## Rules

- Always include request metadata through the helper for new endpoints.
- Do not return secrets, Firebase private details, Razorpay secrets, or internal stack traces.
- Prefer explicit `errorCode` values that frontend auth/session handling can recognize.
- Keep pagination metadata out of `data`.
