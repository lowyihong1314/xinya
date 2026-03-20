# Twilio

This package owns OTP send/verify APIs backed by Twilio Verify and Redis rate limiting.

## Files
- `routes.py`: Flask routes for `/twilio/*`.
- `services.py`: OTP send, verify, test-mode, and session helpers.
- `rate_limit.py`: Redis-based rate-limit helpers.

## Notes
- External URL prefix stays `/twilio` for compatibility.
- Requires Twilio credentials and Redis to be available at runtime.
