# Paperlane Books

Paperlane is a mobile-first, worldwide online bookstore built with Next.js, React, TypeScript, Prisma and Tailwind CSS.

## Highlights

- Worldwide storefront and catalogue
- Multi-currency presentment architecture
- Provider-independent payments (Stripe + extensible regional providers)
- Kolkata-only Cash on Delivery
- India and international shipping zones
- Authentication, orders, wishlist and reviews
- Prisma-backed data model
- PWA/mobile-first UI

## Requirements

- Node.js 20+
- npm 10+
- A database configured through `DATABASE_URL`

## Local development

```bash
npm ci
cp .env.example .env
# Fill AUTH_SECRET and any services you want to enable.
npm run setup
npm run dev
```

Open http://localhost:3000.

## Verification

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

`npm run build` runs `prisma generate` before the Next.js production build.

## GitHub Codespaces

This repository includes a dev-container configuration. Open the repository in Codespaces and run:

```bash
npm ci
cp .env.example .env
npm run setup
npm run dev
```

Do not commit `.env`, production secrets, payment keys, database files, or generated build output.

## Environment variables

Copy `.env.example` to `.env` and configure only the services you actually use. `PAYMENTS_PROVIDER=mock` is intended for local development/testing. Real payment credentials must be supplied through the deployment platform's secret manager.

For production, use a managed PostgreSQL database and follow `PRODUCTION_READINESS.md` before accepting real orders.

## Payments

The application uses a payment-provider abstraction. Stripe is the recommended global provider, but checkout code is not intended to be permanently coupled to Stripe. Regional providers can be added behind the same interface.

Cash on Delivery is deliberately restricted to eligible Kolkata, West Bengal 700xxx addresses and is not a worldwide payment method.

## Deployment

The repository can be deployed to a Node-compatible host. Configure production environment variables, a managed PostgreSQL database, a real email provider, payment-provider credentials, an FX-rate source, shipping/carrier arrangements and legally licensed catalogue imagery before launch.

See `PRODUCTION_READINESS.md` for the launch checklist.
