# StockPilot interview notes

## Project summary

StockPilot is a full-stack inventory and business-management app. Its React/Vite frontend calls an Express REST API; API handlers validate requests with Zod and use better-sqlite3 to persist products, stock movement history, purchasing, sales, invoices, payments, returns, refunds, and analytics.

## Stack: role, not assumed history

- **React** provides the interactive single-page workspace and workflow forms.
- **Vite** serves the frontend during local development and builds the static production assets.
- **Express** hosts the REST API and shared request/error middleware.
- **Zod** validates strict request bodies and rejects unknown or invalid fields.
- **SQLite / better-sqlite3** provides local durable storage, foreign-key enforcement, constraints, transactions, and database migrations.
- **Node `node:test` and Supertest** run isolated integration tests.

These are descriptions of the current implementation, not claims about why the original author historically selected each tool.

## Architecture and request flow

The browser runs the React app. In development, Vite proxies `/api` to Express. Express validates requests, applies business rules, and queries SQLite through better-sqlite3. Multi-step stock and financial operations are transactional where implemented. The UI displays loading, API error, empty, confirmation, and mutation success states. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Data integrity discussion points

- Current stock quantity is stored on `products`; stock-affecting actions use a movement ledger that records the delta and before/after quantities.
- The database helper rejects a resulting negative quantity and wraps standalone movements in an immediate transaction. Larger workflows include stock movement writes in their own transaction.
- Sales line snapshots and invoice line snapshots preserve historical product/customer details when catalog records later change.
- Purchases add stock on receipt rather than order submission.
- Return acceptance restocks only restockable lines; refunds are separately tracked against an accepted return and completed payment.
- Schema migrations 1–7 are versioned. Foreign keys, CHECK constraints, unique identifiers, and selected triggers enforce integrity.
- Money is stored in integer cents and exposed as dollar values. It is USD-only and not a tax-compliance or general accounting system.

## Validation, errors, and tests

Request body schemas are strict Zod objects; query/path inputs are checked in route handlers. Expected validation/business errors return a JSON `{ "error": ... }` message. Unexpected server errors are logged and returned with a generic server message.

The current suite uses in-memory or temporary SQLite databases, Node's test runner, and Supertest. The latest recorded run in this documentation update passed 38 tests; lint and build passed too. Tests cover route/data/business behavior, not browser accessibility or production hosting. See [TESTING.md](TESTING.md).

## Honest limitations and areas to discuss

- There is no app-wide authentication, user identity, role-based authorization, or audit log. Do not expose the current application to the public internet as a shared business service.
- The manual stock-adjustment token is a narrow endpoint gate, not a substitute for authentication.
- Payments/refunds are tracked business records; there is no gateway, settlement reconciliation, or banking integration.
- SQLite is appropriate for a local/single-instance demo but needs persistent local storage and single-writer deployment semantics. Ephemeral/serverless local filesystems are unsuitable for durable business records.
- Concurrent behavior is guarded by SQLite transactions and stock compare/update logic, but high-write multi-instance scale would require an architecture review and likely a server database migration.
- Current tests do not demonstrate full browser cross-viewport, automated accessibility, real payment processor, or public deployment readiness.

## Likely interviewer questions and truthful sample answers

### 1. How do you prevent stock from drifting away from transaction history?

**Sample answer:** “The product stores current stock, and supported stock-changing operations call a shared ledger helper that updates the product and appends the movement in the same transaction. Movements retain previous and resulting quantities, and analytics compare current stock to the latest ledger result. That detects a mismatch; it does not silently rewrite stock.”

### 2. How do you protect a multi-step receiving or return operation from partial failure?

**Sample answer:** “The handler wraps the business transition and ledger writes in a SQLite transaction. The test suite injects a failure at the ledger insert and verifies that the receipt/return and stock changes roll back together.”

### 3. Why keep snapshots on order and invoice lines?

**Sample answer:** “Catalog data is mutable, but past transactions need to remain understandable. Lines store product names, SKUs, quantities, and prices as transaction-time snapshots. Invoice details become immutable after issue.”

### 4. What would need to change before a public production launch?

**Sample answer:** “First, application-wide authentication and authorization, then operational security controls and a review of deployment and audit requirements. SQLite would also need persistent local storage and a single writer. A platform without that guarantee requires a persistent volume or an explicit, tested database migration. The current repo does not claim public-production readiness.”

### 5. How would you scale analytics and data storage?

**Sample answer:** “I would measure workload and query plans first, keep indexes aligned to real filters, and add pagination/limits for large result sets. If write concurrency or hosting requirements outgrow SQLite, I would plan and test an explicit migration to a supported server database, preserving transaction and ledger invariants rather than silently swapping storage.”
