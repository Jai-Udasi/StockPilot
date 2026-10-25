# StockPilot

StockPilot is a small-business inventory and operations application that connects product stock, purchasing, sales, invoicing, payments, returns, and analytics in one workflow. It is built with React, Vite, Express, SQLite, and Zod.

**Portfolio summary:** StockPilot demonstrates a full-stack business workflow with a stock movement ledger, transactional inventory changes, versioned SQLite migrations, API validation, and persisted analytics.

## Project guide

- [Architecture](docs/ARCHITECTURE.md) — browser-to-database request flow and runtime responsibilities.
- [Database](docs/DATABASE.md) — schema, migration history, verified foreign keys, and stock/financial relationships.
- [API reference](docs/API.md) — endpoints, request fields, validation, and business rules.
- [Testing](docs/TESTING.md) — test setup, covered areas, and latest recorded verification.
- [5–7 minute demo walkthrough](docs/DEMO_SCRIPT.md) — safe, repeatable local demo using a disposable database.
- [Interview notes](docs/INTERVIEW_NOTES.md) — concise technical discussion points and example answers.

## Screenshots

Screenshots are not included yet. Capture real application screens using safe demo data and follow [the screenshot checklist](docs/screenshots/README.md).

![StockPilot dashboard and analytics screenshot](docs/screenshots/dashboard-analytics.png)

![StockPilot inventory and products screenshot](docs/screenshots/inventory-products.png)

![StockPilot purchasing receipt and updated stock screenshot](docs/screenshots/purchase-receipt-stock.png)

![StockPilot sales order and stock movement screenshot](docs/screenshots/sales-order-stock-movement.png)

![StockPilot invoice screenshot](docs/screenshots/invoice.png)

![StockPilot payment and outstanding balance screenshot](docs/screenshots/payment-balance.png)

![StockPilot analytics charts and CSV export screenshot](docs/screenshots/analytics-csv-export.png)

The images above are planned capture paths, not existing or fabricated screenshots.

## Verified technology stack

- **React 19** builds the single-page business workspace.
- **Vite 6** serves the frontend in development and creates the static production bundle.
- **Express 5** provides the JSON REST API.
- **SQLite via better-sqlite3** stores business records and applies versioned schema migrations.
- **Zod 4** validates API request bodies.
- **Node.js `node:test` and Supertest** run isolated API/database tests.
- **ESLint 9** checks source code.

## Verification snapshot

The repository was verified during this documentation update, before the documentation-only edits:

- `npm test` — 38 tests passed, 0 failed, across 6 suites.
- `npm run lint` — passed.
- `npm run build` — passed; Vite 6.4.5 built the frontend bundle.
- `git diff --check` — passed after the documentation edits.

Exact commands and context are recorded in [TESTING.md](docs/TESTING.md). These results describe that run and do not guarantee later changes.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Get started

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal (usually [http://localhost:5173](http://localhost:5173)). The API runs at [http://localhost:3001](http://localhost:3001), and Vite proxies `/api` requests to it.

The API creates `data/stockpilot.db` automatically the first time it starts. To store the database elsewhere, set `DATABASE_PATH` before starting the API:

```powershell
$env:DATABASE_PATH = "C:\path\to\stockpilot.db"
npm run dev:api
```

For a production frontend build, run `npm run build`. Start the API with `npm start`. The built frontend is in `dist/`; serve it with a static web server configured to forward `/api` requests to the API, or deploy the frontend and API separately.

## Security and deployment

The API has no application-wide authentication or role-based authorization. Treat network deployment as blocked until an authentication/authorization layer is designed and tested. Do not expose StockPilot to an untrusted network or use it to store sensitive customer or financial data as a shared service. The API binds to `127.0.0.1` by default. `HOST` and `PORT` can be set for an intentional deployment, but changing the bind address does not add authentication.

Cross-origin browser access is restricted to `http://localhost:5173` and `http://127.0.0.1:5173` by default. Set `CORS_ORIGINS` to a comma-separated allowlist when a separate trusted frontend origin is needed. CORS is not an access-control substitute. API JSON bodies are limited to 100 KB, and the API sets basic anti-sniffing, frame, referrer, and permissions headers.

The database automatically creates a timestamped backup before applying migrations to an existing older database. For manual testing, still use an isolated `DATABASE_PATH`; never use a real business database for test or browser smoke checks.

Schema migration 7 adds indexes for the date columns used by analytics and history reports (stock movements, goods receipts, invoices, payments, returns, and refunds). It does not rewrite or delete business records. Existing database files are backed up by the migration runner before it applies the migration.

## Release preparation and deployment

### Environment variables

The application reads configuration from the process environment. It does **not** load `.env` files itself; `.env.example` is a reference for local values. Use your shell, service manager, or hosting secret/environment configuration to set the variables. Never put real secrets in `.env.example` or source control.

| Variable | Default / requirement | Purpose |
| --- | --- | --- |
| `NODE_ENV` | Unset for local development; set to `production` for deployment | Production mode requires an explicitly configured, pre-provisioned persistent database and disables sample seeding. |
| `DATABASE_PATH` | `./data/stockpilot.db` under the current working directory | SQLite file path. Production requires an explicit absolute path on persistent storage. |
| `HOST` | `127.0.0.1` | API bind address. Keep loopback behind a local reverse proxy; changing this does not add authentication. |
| `PORT` | `3001` | API listening port; must be an integer from 1 to 65535. |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated exact origin allowlist. |
| `STOCK_ADJUSTMENT_TOKEN` | Unset | Optional token for the manual stock-adjustment endpoint only. It is not application-wide authentication. Store as a secret and do not reuse it as a user password. |
| `BACKUP_PATH` | Required by `npm run db:backup` | New destination file for a SQLite online backup; existing destinations are refused. |

`.gitignore` excludes environment files, SQLite databases and sidecars, backups, logs, dependencies, and build output. The checked-in `.env.example` contains only safe local defaults.

### Local startup and production preparation

Local development retains the deterministic sample catalog:

```powershell
npm install
npm run dev
```

For reproducible production dependency installation, use `npm ci` from a clean checkout with the committed lockfile. Build the frontend with `npm run build`; output is in `dist/`. The API can be started with `npm start`. `.env.example` documents the local values but Node does not automatically load it or a copied `.env`; set values in the shell/service environment.

Provision a new production database explicitly, using a persistent path. The migration command creates the schema but **does not seed sample records**:

```powershell
$env:NODE_ENV = "production"
$env:DATABASE_PATH = "D:\StockPilotData\stockpilot.db"
npm run db:migrate
npm run db:verify
```

Set the same `NODE_ENV` and `DATABASE_PATH` in the production service environment before starting the API. Production startup refuses a missing `DATABASE_PATH`, an in-memory database, or a missing/empty database file. On later starts the API applies any pending versioned migrations; migration errors stop startup rather than serving with a partial schema. Existing database files are backed up before a pending migration. The backup is a same-volume migration safety copy, not a substitute for scheduled off-host backups.

Do not use a fresh uninitialized production database with `npm start` as a provisioning shortcut. Use `npm run db:migrate`, then verify it. Do not set production `DATABASE_PATH` to an ephemeral container filesystem, a shared network filesystem, or a path mounted by multiple app replicas. SQLite WAL mode is enabled; run one API instance against a local persistent disk. If the hosting platform cannot provide durable local storage and single-writer semantics, use a persistent-volume-capable host or plan and test an explicit migration to a supported server database. StockPilot does not silently switch database engines.

Recommended topology is a single API service and its SQLite file on the same persistent host/volume, with the frontend `dist/` served by a static host or same-origin reverse proxy. Proxy `/api` to the API over a private network, terminate HTTPS at a trusted proxy, and configure exact frontend origins in `CORS_ORIGINS`. Do not expose the API directly to the public internet. A separate static frontend is acceptable only when its origin is allowlisted and API connectivity is private and protected.

**Vercel assessment:** the current app is not safe to deploy to Vercel as-is for durable business data. Its backend opens a local SQLite file through `better-sqlite3`, while serverless instances do not provide the persistent, single-writer local-volume model this configuration requires. A persistent database/storage architecture and deployment integration would need to be selected and tested before using Vercel; this project does not silently switch databases.

### Backup, verification, and restore

The backup command uses SQLite's online backup API, so it produces a consistent standalone database snapshot while the WAL is active. Give every backup a new destination:

```powershell
$env:DATABASE_PATH = "D:\StockPilotData\stockpilot.db"
$env:BACKUP_PATH = "D:\StockPilotBackups\stockpilot-$(Get-Date -Format yyyyMMdd-HHmmss).db"
npm run db:backup
$env:DATABASE_PATH = $env:BACKUP_PATH
npm run db:verify
```

`db:verify` opens the selected file read-only and checks SQLite integrity, foreign keys, and migration metadata. Schedule encrypted backups outside the application host, retain (for example) daily copies for 14 days and weekly copies for 12 weeks, and monitor backup failures and available disk space. Perform a restore drill at least quarterly: restore a backup to a **new temporary path**, run `db:verify`, start StockPilot against that path, and confirm health, sample record counts, and stock reconciliation before treating the backup plan as proven.

To restore a verified snapshot, stop the API first. Preserve the current database and any `-wal`/`-shm` sidecars under a timestamped recovery name; do not copy over a live SQLite database or delete the only recoverable copy. Copy the verified standalone backup to the configured database path, run `npm run db:verify` against it, then start the API and check `/api/health` plus product/order/stock reconciliation. Keep the pre-restore files until business owners approve the recovery. Never restore by copying only a live `.db` file while its WAL may contain uncheckpointed transactions.

If startup fails during migration, keep the process stopped, preserve the original database and generated `.bak-*` file, inspect the startup error, and verify the backup on a separate path before restoring. For corruption, stop all writers, preserve the database and sidecars, verify a recent backup on a scratch path, and restore only after confirming the backup. Do not delete a failed database or automatically reset/reseed it.

### Security gates and operational readiness

**Public deployment is blocked.** The API has no application-wide authentication or authorization. CORS is not authentication. Before public or shared-network deployment, implement and test authenticated users and role/ownership authorization for every sensitive read and mutation. Also require HTTPS, a trusted reverse proxy, rate limiting, secure session/token lifecycle and storage, secret rotation, audit logging for business/administrative actions, and monitoring/alerting. Restrict network access and filesystem permissions as defense in depth.

The API validates request bodies and query parameters, uses parameterized SQL, limits JSON bodies to 100 KB, disables Express's identifying header, and sets basic security response headers. The application does not currently provide rate limiting, application-wide auth, durable audit logs, or HTTPS termination. Do not describe it as production-secure or store sensitive business data on an untrusted network. Keep secrets in the host's secret manager/environment configuration; do not log tokens, credentials, full customer/payment payloads, or database contents.

`GET /api/health` is a basic process/API liveness check, not a full dependency or database-integrity check. A hosting health probe should also detect process exit; use the read-only `npm run db:verify` as a separate operational check, not on every request. Startup and migration errors are written by Node to stderr and cause process failure. Restrict logs and configure retention with the hosting platform.

### Release procedure and checklist

1. Review the complete Git diff and status; confirm no database, backup, `.env`, credential, log, or unrelated file is included.
2. Pin the supported Node.js runtime, install dependencies with `npm ci`, and build with `npm run build`.
3. Run `npm test`, `npm run lint`, `npm run build`, and `git diff --check`; retain their output with the release record.
4. Provision durable storage and restricted filesystem permissions; set the production environment variables and trusted CORS origins.
5. Take and verify a pre-release backup. Run `npm run db:migrate` against the configured database, then `npm run db:verify`. Do not use a production database for acceptance mutations.
6. Deploy the reviewed build and API only to a controlled, private environment. Check startup logs, `/api/health`, basic read-only API behavior, backup scheduling, and recovery monitoring.
7. Keep a rollback build and verified database backup. Roll back the application and database together when a schema change is not backward-compatible.
8. Do not proceed to public/shared use until application-wide authentication and authorization are implemented and independently tested.

## Features

- Create, edit, search, filter, sort, paginate, activate/deactivate, and delete products; duplicate SKUs are rejected.
- Products support descriptions, category/supplier links, unit costs, maximum stock, units of measure, and active status. Legacy category text remains supported.
- Categories, suppliers, and customers have validated REST APIs. Categories with linked products cannot be deleted; suppliers and customers are deactivated rather than deleted.
- Stock changes are recorded in a movement ledger. Product creation, product stock edits, legacy stock updates, and sales all write their stock movements in the same SQLite transaction as the stock update.
- Create sales orders with multiple products and either a walk-in customer or a linked customer. The compatibility `POST /orders` endpoint creates a confirmed order and deducts stock immediately, atomically. Draft orders are available through `POST /orders/drafts`; stock is deducted once on confirmation.
- Manage draft purchase orders, submit them to suppliers, and receive partial or complete deliveries in multiple immutable receipt records. Stock increases only when goods are received; each receipt and stock-ledger update commits as one transaction.
- Create immutable sales invoice snapshots, record partial/full business payments, accept quantity-bounded sales returns, and track requested/completed/failed refunds. Eligible restockable returns update inventory through the stock ledger transactionally.
- Product names, SKUs, and prices are snapshotted on order items. Products with order or stock-movement history cannot be deleted, preserving the history.
- Dashboard analytics include current inventory valuation, restock alerts, date-filtered sales and purchasing, financial summaries, product rankings, and stock-ledger trends.
- Request bodies are validated and invalid input, duplicate SKUs, missing records, insufficient stock, and database errors receive explicit API error responses.
- Responsive, API-connected workspace with an analytics dashboard, report center, product inventory, categories, suppliers, customers, sales orders, purchase orders, goods receipts, stock movements, invoices, payments, returns, and refunds.
- Connected dialogs submit real API mutations, show validation/network errors, and refresh affected lists. Order and receipt quantities, invoice balances, return eligibility, and refund eligibility are sourced from persisted backend records.
- Paginated transaction lists, search and filters where supported by the APIs, status-aware actions, confirmation dialogs for consequential transitions, and responsive mobile navigation.

## REST API

All endpoints are prefixed with `/api`. Successful responses use JSON except `DELETE /products/:id`, which returns `204 No Content`.

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/health` | API health check |
| `GET` | `/dashboard` | Inventory, sales, alerts, and recent-order summaries |
| `GET` | `/analytics/overview?from=&to=&period=&categoryId=&supplierId=&windowDays=` | Inventory, return-aware sales/status/category summaries, purchasing/receipts/suppliers, and financial summaries |
| `GET` | `/analytics/inventory?categoryId=&supplierId=&productId=&windowDays=` | Cost/retail inventory values, missing-cost and reconciliation warnings, slow/non-moving products, and grouped inventory |
| `GET` | `/analytics/sales-trend?from=&to=&period=&categoryId=&supplierId=&productId=` | Daily, weekly, or monthly gross sales and accepted return credits, plus status/category breakdowns |
| `GET` | `/analytics/top-products?from=&to=&limit=&categoryId=&supplierId=&productId=` | Gross and net product sales based on order-line snapshots and accepted return lines |
| `GET` | `/analytics/purchasing?from=&to=&period=&supplierId=&categoryId=&productId=` | Ordered purchase value/quantities, receipt-date received value/quantities, outstanding stock, and supplier delivery summaries |
| `GET` | `/analytics/recent-sales?from=&to=&limit=&categoryId=&supplierId=&productId=` | Most recent qualifying sales with persisted order and line-item details |
| `GET` | `/analytics/out-of-stock?categoryId=&supplierId=&productId=` | Active, non-archived products with zero stock |
| `GET` | `/analytics/returns-refunds?from=&to=` | Return/refund status counts and separate accepted-credit/refund amounts |
| `GET` | `/analytics/status-distribution?from=&to=&period=&categoryId=&supplierId=&productId=` | Order, invoice, payment, return and refund status distributions |
| `GET` | `/analytics/financials?from=&to=` | Period financial flows and current outstanding receivables |
| `GET` | `/analytics/stock-movements?from=&to=&limit=` | Ledger movement totals by date/type and recent movement details |
| `GET` | `/analytics/exports/{inventory|low-stock|out-of-stock|top-products|sales-trend|sales-by-category|sales-summary|supplier-purchases|purchases-by-supplier|purchasing-trend|order-status|invoice-payment-status|returns-refunds|stock-movements}.csv` | Safely escaped CSV exports; accepts date, dimension, `period`, `windowDays`, and `limit` filters where relevant |
| `GET` | `/products?q=&category=&stock=` | List/search/filter products; `stock` is `low` or `in_stock` |
| `GET` | `/products/:id` | Get a product |
| `POST` | `/products` | Create a product |
| `PUT` | `/products/:id` | Update one or more product fields |
| `PATCH` | `/products/:id/stock` | Set stock with `{ "quantity": 8 }`, or adjust with `{ "operation": "adjust", "quantity": -2 }` |
| `DELETE` | `/products/:id` | Delete a product without order or stock-movement history |
| `GET` | `/products/:id/stock-movements` | Paginated stock movement history for one product |
| `POST` | `/products/:id/stock-adjustments` | Authorized stock adjustment requiring `quantityDelta` and `reason` |
| `GET` | `/stock-movements` | Paginated movement history; optional `productId` and `type` filters |
| `GET` | `/categories` | List categories and linked inventory summaries |
| `POST` | `/categories` | Create a category |
| `GET` | `/categories/:id` | Get category and linked inventory summary |
| `PUT` | `/categories/:id` | Update a category; renames also update linked products' legacy category text |
| `DELETE` | `/categories/:id` | Delete only when no products are linked |
| `GET` | `/suppliers?q=&active=` | Search/list suppliers |
| `POST` | `/suppliers` | Create a supplier |
| `GET` | `/suppliers/:id` | Get supplier details |
| `PUT` | `/suppliers/:id` | Update a supplier |
| `PATCH` | `/suppliers/:id/deactivate` | Safely deactivate a supplier |
| `GET` | `/customers?q=&active=` | Search/list customers |
| `POST` | `/customers` | Create a customer |
| `GET` | `/customers/:id` | Get customer details and linked order history |
| `PUT` | `/customers/:id` | Update a customer |
| `PATCH` | `/customers/:id/deactivate` | Safely deactivate a customer |
| `GET` | `/orders` | List the latest 100 orders |
| `GET` | `/orders/:id` | Get a sales order and line items |
| `POST` | `/orders` | Compatibility: create a confirmed order and deduct stock immediately |
| `POST` | `/orders/drafts` | Create a draft sales order without deducting stock |
| `PUT` | `/orders/:id` | Edit a draft sales order |
| `PATCH` | `/orders/:id/status` | Transition a sales order through its lifecycle |
| `POST` | `/invoices` | Create a draft invoice snapshot from an eligible sales order |
| `GET` | `/invoices` | Paginate/filter invoices by status, customer, and invoice date |
| `GET` | `/invoices/:id` | Retrieve invoice lines, financial balance, payments, and returns |
| `POST` | `/invoices/:id/issue` | Issue a draft invoice; its commercial snapshot becomes immutable |
| `POST` | `/invoices/:id/void` | Void an unpaid invoice without active returns/refunds |
| `POST` | `/invoices/:id/payments` | Record a completed or failed partial/full payment |
| `GET` | `/payments` | Paginate/filter payments by invoice, status, and date |
| `GET` | `/payments/:id` | Retrieve a payment record |
| `POST` | `/payments/:id/reverse` | Reverse a completed payment that has no requested/completed refund |
| `POST` | `/returns` | Create a draft return against a sale, optionally linked to its invoice |
| `GET` | `/returns` | Paginate/filter returns by order, invoice, status, and date |
| `GET` | `/returns/:id` | Retrieve return lines and refund history |
| `POST` | `/returns/:id/complete` | Accept or reject a draft return; acceptance may restock through the ledger |
| `POST` | `/returns/:id/refunds` | Request a refund against an accepted invoiced return and completed payment |
| `GET` | `/refunds` | Paginate/filter refunds by invoice, return, and status |
| `GET` | `/refunds/:id` | Retrieve a refund record |
| `POST` | `/refunds/:id/complete` | Mark a requested refund completed |
| `POST` | `/refunds/:id/fail` | Mark a requested refund failed |
| `POST` | `/purchase-orders` | Create a draft purchase order |
| `GET` | `/purchase-orders` | Filter/paginate by status, supplier, and date |
| `GET` | `/purchase-orders/:id` | Get purchase lines and receipt history |
| `PUT` | `/purchase-orders/:id` | Edit a draft purchase order |
| `POST` | `/purchase-orders/:id/submit` | Submit a draft to its supplier |
| `POST` | `/purchase-orders/:id/cancel` | Cancel an unreceived draft or ordered purchase |
| `POST` | `/purchase-orders/:id/receipts` | Record a partial or complete goods receipt |
| `GET` | `/goods-receipts` | List receipts, optionally filtered by supplier or purchase order |
| `GET` | `/goods-receipts/:id` | Get an immutable goods receipt |
| `GET` | `/suppliers/:id/purchase-orders` | List a supplier's purchase history |
| `GET` | `/products/:id/history` | Read persisted purchase and sales history for a product |

Product listing accepts `q`, `category`, `categoryId`, `supplierId`, `stock`, `active`, `page`, `pageSize`, `sort`, and `direction` query parameters. Page sizes are capped at 100.
Sales orders accept `status`, `customerId`, `from`, `to`, `page`, and `pageSize` filters. Purchase orders accept `status`, `supplierId`, `from`, `to`, `page`, and `pageSize`.

Example product:

```json
{
  "sku": "MUG-024",
  "name": "Ceramic pour-over",
  "category": "Drinkware",
  "price": 24.5,
  "quantity": 12,
  "lowStockThreshold": 4,
  "description": "Handmade ceramic pour-over",
  "categoryId": 1,
  "supplierId": 1,
  "unitCost": 8.25,
  "maxStock": 40,
  "unitOfMeasure": "each",
  "isActive": true
}
```

Example order:

```json
{
  "customerName": "Alex Rivera",
  "items": [
    { "productId": 1, "quantity": 2 }
  ]
}
```

Example draft purchase order (currency values are dollar amounts in the API):

```json
{
  "supplierId": 1,
  "notes": "Restock for the next month",
  "items": [
    {
      "productId": 1,
      "quantity": 20,
      "unitCost": 8.25,
      "discountAmount": 5,
      "taxRate": 8.25
    }
  ]
}
```

Submit a draft with `POST /api/purchase-orders/1/submit`. To receive a delivery, send a unique receipt number and one or more purchase-line quantities:

```json
{
  "receiptNumber": "GRN-2026-001",
  "notes": "First partial delivery",
  "items": [
    { "purchaseOrderItemId": 1, "quantity": 8 }
  ]
}
```

Purchase-order states are `draft`, `ordered`, `partially_received`, `received`, and `cancelled`. Commercial line details become immutable after submission. Cancellation is permitted only before any quantity has been received; it never deletes receipt history or reverses received stock.

Sales-order states are `draft`, `confirmed`, `processing`, `shipped`, `delivered`, and `cancelled`. The supported transitions are draft → confirmed or cancelled; confirmed → processing or cancelled; processing → shipped; shipped → delivered. The compatibility `POST /api/orders` route creates a confirmed order with stock deducted once in the same transaction. Draft orders do not affect stock until they transition to confirmed. Cancelling a confirmed but not processing order restores stock through a separate compensating `return_in` movement; orders already in processing or a later fulfilment state cannot be cancelled.

Migration v5 preserves existing sales records and marks them as previously confirmed/deducted. Cancellation of a legacy order is refused if the ledger does not contain its original sale movement, because restoring that stock cannot be proven safe.

Purchase unit cost, line discounts, tax, and totals are persisted as integer cents. `taxRate` is a percentage from 0 to 100; line discount is a currency amount for the entire line and cannot exceed its pre-discount amount. Tax is calculated on the discounted subtotal.

Prices are represented as numeric dollar amounts in the API and stored as integer cents in SQLite to avoid floating-point rounding in order totals.

### Invoices, payments, returns, and refunds

Migration v6 adds invoices and invoice-line snapshots, payments, sales returns and return lines, and refunds. It preserves prior rows and uses foreign keys, uniqueness constraints, indexes, status checks, and immutability/transition triggers. Existing orders are not retroactively invoiced or assigned fictitious payment data.

Create an invoice from a confirmed or later non-cancelled sale. Draft sales orders and cancelled orders are not eligible. Only one non-void invoice can exist for an order at a time; an invoice number is unique. Voiding an invoice is terminal and allows a replacement invoice for the same order. The invoice snapshots customer billing details and order-line product names, SKUs, quantities, and prices. Issuing freezes the financial snapshot. Legacy sales order lines contain no discount or tax breakdown, so invoice discounts and taxes are zero; this API is not a tax-compliance calculation.

Example invoice creation and issue:

```http
POST /api/invoices
Content-Type: application/json
```

```json
{ "orderId": 1, "invoiceNumber": "INV-2026-001", "dueDate": "2026-11-01T00:00:00.000Z" }
```

The response contains a `draft` invoice and snapshotted lines. Issue it with `POST /api/invoices/{id}/issue`. Invoice statuses are `draft`, `issued`, `partially_paid`, `paid`, `credited`, and `void`; the API only permits issuing a draft, voiding an unpaid invoice without active return/refund activity, and financial status changes derived from persisted payments and accepted return credits.

Record full, partial, or failed payments:

```http
POST /api/invoices/1/payments
Content-Type: application/json
```

```json
{ "amount": 25.50, "method": "card", "externalReference": "processor-ref-123", "status": "completed" }
```

Payment `amount` is a positive dollar amount converted to integer cents. A server-generated payment reference is returned when none is supplied. Duplicate payment or external transaction references and payments above the remaining balance are rejected. Failed payments do not count as collected money. Completed payments can be reversed only if no refund is requested or completed against them; reversal removes that amount from collected payments and recalculates the invoice balance. `POST /api/payments/{id}/reverse` performs that transition.

The API reports these persisted invoice values:

- `completedPayments`: sum of payments currently in `completed` status.
- `acceptedReturnCredits`: value of accepted return lines linked to the invoice.
- `outstandingBalance`: `max(0, invoice total - completed payments - accepted return credits)`.
- `completedRefunds`: sum of refunds in `completed` status.
- `unsettledReturnCredit`: `max(0, accepted return credits - completed refunds)`.
- `netCashRetained`: `completed payments - completed refunds`.
- `paymentStatus`: `unpaid`, `partial`, `paid`, `credited`, or `void`, derived from persisted invoice activity.

Failed and reversed payments and requested/failed refunds are excluded from completed cash totals. Refunds settle accepted return credits and reduce `netCashRetained`; they do not create a new customer receivable after the return credit has already reduced the outstanding collectible balance. Returned-item credit is based on the snapshotted sold unit price and quantity; the legacy order model has no sale-tax or discount details to prorate.

Create and accept a return:

```http
POST /api/returns
Content-Type: application/json
```

```json
{
  "orderId": 1,
  "invoiceId": 1,
  "reason": "Customer returned damaged item",
  "items": [
    {
      "orderItemId": 1,
      "quantity": 1,
      "restockable": false,
      "restockReason": "Item is damaged and cannot be resold"
    }
  ]
}
```

Returns start as `draft`; complete them with `POST /api/returns/{id}/complete` and `{ "status": "accepted" }` or `{ "status": "rejected" }`. Draft and accepted returns reserve sold quantities so concurrent/repeated requests cannot return more than was sold. Rejected returns release that reservation. Acceptance is atomic: each restockable line adds stock through one `return_in` ledger movement, while non-restockable lines do not affect stock. A failed movement rolls back the whole acceptance. Returns against cancelled sales are rejected, and an order cannot be cancelled while a non-void invoice or non-rejected return exists, preventing cancellation and returns from restoring the same units.

Request a refund only for an accepted, invoice-linked return and a completed payment on that invoice:

```http
POST /api/returns/1/refunds
Content-Type: application/json
```

```json
{ "paymentId": 1, "amount": 10, "method": "card", "externalReference": "refund-ref-456" }
```

Refunds start as `requested`; use `POST /api/refunds/{id}/complete` or `/fail` to finalize the record. Multiple refunds are allowed only up to both the accepted return's remaining credit and the selected payment's unrefunded amount. Only completed refunds count as returned cash. A payment with a requested/completed refund cannot be reversed.

These payment and refund records are business records only: there is no payment gateway, bank verification, accounting ledger, multi-currency support, tax compliance, or application-wide authentication in this phase.

Manual adjustment requires the `Authorization: Bearer <token>` header. Configure `STOCK_ADJUSTMENT_TOKEN` before starting the API; if it is unset, the authorized adjustment endpoint denies requests. Example request:

```json
{
  "quantityDelta": -2,
  "reason": "Cycle count correction",
  "notes": "Two damaged units"
}
```

## Analytics dashboard and metric definitions

The dashboard loads its figures from the read-only `/analytics/*` APIs. It provides date presets for the last 7, 30, or 90 days, this month, this year, and a custom range; the sales chart can be grouped daily, weekly, or monthly. `from` and `to` accept ISO date (`YYYY-MM-DD`) or ISO datetime values. Date-only boundaries are inclusive UTC calendar days. When omitted, the range defaults to the last 30 UTC calendar days. Ranges longer than 366 days, invalid dates, reversed ranges, unsupported periods, or out-of-bound limits return HTTP 400 using the normal JSON error response. Product/category/supplier filters are positive integer IDs; `limit` is a positive integer capped by each endpoint (10,000 for CSV exports).

Metric rules:

- Cost valuation is `products.quantity * unit_cost`; retail value is separately computed as `quantity * current price`. Both are converted from stored cents. Missing unit costs are counted and listed explicitly, and contribute zero only to cost valuation. Current stock totals and valuations include inactive, non-archived stock; active product counts and restock alerts only include active products.
- Reconciliation compares each product quantity with the latest `stock_movements.new_quantity`, matching the existing database reconciliation helper. The warning list surfaces mismatches without correcting or mutating stock.
- The slow/non-moving report considers active products with positive on-hand stock. A product with no qualifying sale history is non-moving; one whose last qualifying sale is older than `windowDays` (default 90, valid range 1–365) is slow-moving. Qualifying sales require a stock deduction and a status of `confirmed`, `processing`, `shipped`, or `delivered`.
- Sales gross value is stored order total for unfiltered summaries, and matching order-line snapshot value (`quantity * unit_price`) when product/category/supplier filters are applied. Status breakdown includes all order statuses; draft and cancelled orders do not contribute to qualifying sales. Product/category sales use current product category assignment because the order-line schema snapshots product name, SKU, quantity and price, but not category.
- The overview's total product count includes inactive, non-archived products; active product count excludes inactive products. Sales order count and average order value use only stock-deducted orders in `confirmed`, `processing`, `shipped`, or `delivered` status. Average order value is gross qualifying sales divided by that qualifying order count; it is zero when there are no qualifying orders. Recent sales use the same inclusion rule and return persisted order/line details.
- Accepted return credits and quantities come from accepted return lines and use `return_date`. They are shown separately from gross order sales. `netSalesValue`/`netUnitsSold` subtract accepted return credits/quantities in the selected range from qualifying sales; sales dates use order creation dates, so these are separately dated activity measures, not a matched-cohort accounting report.
- Purchase order value and ordered quantities use submitted purchase orders in `ordered`, `partially_received`, or `received` states and the order creation date. Filtered PO values sum matching line totals. Received value/quantity use immutable goods receipt lines and receipt `received_at`; outstanding quantity is the current outstanding quantity for the selected purchase orders. Supplier delivery time is elapsed days from `submitted_at` to first receipt; the schema has no promised delivery date, so no on-time rate is fabricated.
- Purchase trends group submitted purchase orders by creation date; receiving trends independently group receipts by `received_at` and include receipt count, received quantity, and receipt-line value. Weekly buckets start Monday in UTC. Out-of-stock alerts are limited to active, non-archived products and reflect current stock, not a date-filtered historical snapshot.
- Invoice issuance uses `invoice_date`; completed payments use `payment_date`; accepted return credits use `return_date`; completed refunds use `completed_at`. Outstanding receivables are current-state values across non-draft/non-void invoices using the existing formula: `max(0, invoice total - completed payments - accepted return credits)`. Refunds are not subtracted a second time from receivables. Net cash retained is date-filtered completed payments less date-filtered completed refunds; unsettled return credits are a current-state total of accepted credits less completed refunds grouped by return.
- Analytics accept positive integer product/category/supplier IDs and reject malformed IDs with HTTP 400. Endpoints and CSV exports are read-only; filtering never changes stock, order, purchase, receipt, invoice, payment, return, refund, or movement records.
- Stock movement reports read `stock_movements`; positive and negative deltas are inbound and outbound quantities respectively, with adjustment and return movement types preserved.
- CSV exports use stable headers: inventory and stock alert exports include product/category/supplier and stock/cost columns; sales exports include period/category/product and gross/return/net columns; purchasing exports include supplier/order/receipt totals; status exports contain record type, status, count, and amount where applicable; stock-movement exports include timestamp, movement type, product, deltas, before/after quantities, reference, and reason. Values are quoted/escaped, and formula-like text starting with `=`, `+`, `-`, or `@` is prefixed to prevent spreadsheet formula execution. Export row limits default to 10,000 and cannot exceed that ceiling; oversized datasets are rejected instead of silently truncated.

The visualizations use accessible HTML and CSS rather than adding a chart dependency. Analytics endpoints use parameterized SQL and do not mutate business records. No forecasts or fabricated analytics are included.

The Reports workspace reuses the same selected date range, interval, category, and supplier filters for the reports whose APIs support those dimensions. It displays sales by period/product/category, purchases by supplier, current inventory valuation and stock alerts, order/invoice/payment statuses, return/refund summaries, financial balances, and stock movement history. CSV links call the corresponding persisted `/analytics/exports/*.csv` endpoint; they do not construct export rows in the browser. Financial flows and current-state balances are labeled separately because they have different date/filter bases.

## Tests

Run the API tests with:

```bash
npm test
npm run lint
npm run build
git diff --check
```

The tests use isolated SQLite databases and verify product CRUD and validation, business-data APIs, migrations and seeding, v7 migration backup/data preservation, purchase drafting/submission/receiving, sales lifecycle transitions, stock-ledger updates and reconciliation, transaction rollback, low-stock/dashboard summaries, protected historical records, analytics filters and financial/return/purchasing metrics, recent-sales and out-of-stock reports, status distributions, CSV export coverage and escaping, malformed/injection-like IDs and limits, CORS/security headers/request-size handling, and that analytics reads do not mutate business records.

### Manual verification checklist

Use a separate temporary database so smoke checks cannot alter development records:

```powershell
$env:DATABASE_PATH = Join-Path $env:TEMP "stockpilot-manual-smoke.db"
$env:HOST = "127.0.0.1"
npm run dev
```

Open the Vite URL and verify that Dashboard, Reports, Products, Categories, Suppliers, Customers, Sales orders, Purchase orders, Goods receipts, Stock movements, Invoices, Payments, and Returns & refunds load. Check dashboard/report date presets and a custom range, category/supplier filters, empty states, and a CSV download. Use a disposable database for mutations; exercise a product edit, a purchase receipt, a sales confirmation, payment, return and refund, then compare the visible records to their API details and stock movement history. Check desktop, tablet and mobile widths, including the mobile navigation and any horizontally scrollable tables. Do not test these mutations against important business data without first taking and verifying a backup.

Before any deployment, verify that authentication and authorization have been added, database backups/restores are tested, only intended origins are allowed, the server is reachable only through the intended network boundary, and dependency advisories have been reviewed.

## Manual financial API smoke check

To avoid using the normal development database, start the API with a dedicated temporary database path in one PowerShell terminal:

```powershell
$env:DATABASE_PATH = Join-Path $env:TEMP "stockpilot-phase4a-manual.db"
npm run dev:api
```

In a second PowerShell terminal, use a seeded in-stock product to create a sale and invoice, record a payment, accept a restockable return, and request a refund:

```powershell
$base = "http://localhost:3001/api"
$product = (Invoke-RestMethod "$base/products").products | Where-Object { $_.quantity -gt 0 } | Select-Object -First 1
$order = Invoke-RestMethod -Method Post -Uri "$base/orders" -ContentType "application/json" -Body (@{
  items = @(@{ productId = $product.id; quantity = 1 })
} | ConvertTo-Json -Depth 5)
$invoiceDraft = Invoke-RestMethod -Method Post -Uri "$base/invoices" -ContentType "application/json" -Body (@{
  orderId = $order.order.id
} | ConvertTo-Json)
$invoice = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($invoiceDraft.invoice.id)/issue" -ContentType "application/json" -Body "{}"
$payment = Invoke-RestMethod -Method Post -Uri "$base/invoices/$($invoice.invoice.id)/payments" -ContentType "application/json" -Body (@{
  amount = $invoice.invoice.total; method = "manual-test"
} | ConvertTo-Json)
$salesOrder = Invoke-RestMethod "$base/orders/$($order.order.id)"
$return = Invoke-RestMethod -Method Post -Uri "$base/returns" -ContentType "application/json" -Body (@{
  orderId = $order.order.id
  invoiceId = $invoice.invoice.id
  reason = "Manual API verification"
  items = @(@{
    orderItemId = $salesOrder.order.items[0].orderItemId
    quantity = 1
    restockable = $true
    restockReason = "Inspected and suitable for resale"
  })
} | ConvertTo-Json -Depth 5)
$acceptedReturn = Invoke-RestMethod -Method Post -Uri "$base/returns/$($return.salesReturn.id)/complete" -ContentType "application/json" -Body '{"status":"accepted"}'
$refund = Invoke-RestMethod -Method Post -Uri "$base/returns/$($return.salesReturn.id)/refunds" -ContentType "application/json" -Body (@{
  paymentId = $payment.payment.id; amount = $invoice.invoice.total; method = "manual-test"
} | ConvertTo-Json)
Invoke-RestMethod -Method Post -Uri "$base/refunds/$($refund.refund.id)/complete" -ContentType "application/json" -Body "{}"
Invoke-RestMethod "$base/invoices/$($invoice.invoice.id)"
```

The invoice detail response provides persisted payment, refund, return-credit, outstanding-balance, and net-cash figures. The temporary database remains at the selected path; no existing database is reset or removed.

## Project structure

```text
server/
  app.js          Express API routes, validation, and transaction logic
  app.test.js     REST API tests
  database.js     SQLite schema and connection setup
  index.js        API server entry point
src/
  App.jsx         Dashboard, catalog, orders, and forms
  main.jsx        React entry point
  styles.css      Responsive visual design
index.html        Vite HTML entry point
vite.config.js    Development server and API proxy
```
