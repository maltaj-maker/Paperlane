# Paperlane production readiness

## Required before launch

- Use a managed PostgreSQL database and run Prisma migrations; SQLite `dev.db` is for local development only.
- Set a strong `AUTH_SECRET` and a canonical HTTPS `APP_URL`.
- Configure a live payment provider. Stripe is the global adapter; the provider registry allows additional gateways without rewriting checkout.
- Configure `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` if Stripe is selected. Never commit them.
- Configure an FX source and refresh `CURRENCY_RATES_JSON` (or replace it with a live persisted FX service) before enabling non-INR checkout. Rates are major target-currency units per ₹1.
- Configure Resend or SMTP for real transactional email. Console email is development-only.
- Configure a real analytics/monitoring provider only after reviewing consent and privacy requirements.
- Replace the starter catalogue covers with images the store has the right to distribute.
- Review international tax/VAT/GST, customs, duties, returns, prohibited destinations, and shipping carrier contracts for each market served.
- Set explicit shipping zones/rates and serviceable countries. The app refuses to invent a shipping service when no zone matches.
- COD is intentionally limited to Kolkata, West Bengal, PINs beginning with 700.

## Verification

Run on a network-enabled Node 20+ environment:

```bash
npm ci
npm run db:generate
npm run typecheck
npm run lint
npm test
npm run build
```

The current development workspace could not complete `npm ci` because the npm registry was not reachable, so a successful production build must still be verified in a network-enabled environment.
