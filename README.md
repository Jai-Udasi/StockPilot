# StockPilot

StockPilot is a small-business inventory and order management app. It uses React and Vite for the responsive dashboard, an Express REST API, and SQLite for durable local storage. Product and order data is stored in a real SQLite database; the app does not rely on seeded or mocked records.

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

## Features

- Create, edit, search, filter, sort, paginate, activate/deactivate, and delete products; duplicate SKUs are rejected.
- Products support descriptions, category/supplier links, unit costs, maximum stock, units of measure, and active status. Legacy category text remains supported.
- Categories, suppliers, and customers have validated REST APIs. Categories with linked products cannot be deleted; suppliers and customers are deactivated rather than deleted.
- Stock changes are recorded in a movement ledger. Product creation, product stock edits, legacy stock updates, and sales all write their stock movements in the same SQLite transaction as the stock update.
- Create sales orders with multiple products and either a walk-in customer or a linked customer. The compatibility `POST /orders` endpoint creates a confirmed order and deducts stock immediately, atomically. Draft orders are available through `POST /orders/drafts`; stock is deducted once on confirmation.
- Manage draft purchase orders, submit them to suppliers, and receive partial or complete deliveries in multiple immutable receipt records. Stock increases only when goods are received; each receipt and stock-ledger update commits as one transaction.
- Create immutable sales invoice snapshots, record partial/full business payments, accept quantity-bounded sales returns, and track requested/completed/failed refunds. Eligible restockable returns update inventory through the stock ledger transactionally.
- Product names, SKUs, and prices are snapshotted on order items. Products with order or stock-movement history cannot be deleted, preserving the history.
- Dashboard summaries include on-hand inventory value, units, current-month orders and sales, recent orders, and low-stock alerts.
- Request bodies are validated and invalid input, duplicate SKUs, missing records, insufficient stock, and database errors receive explicit API error responses.
- Responsive, API-connected workspace with dashboard, product inventory, categories, suppliers, customers, sales orders, purchase orders, goods receipts, stock movements, invoices, payments, returns, and refunds.
- Connected dialogs submit real API mutations, show validation/network errors, and refresh affected lists. Order and receipt quantities, invoice balances, return eligibility, and refund eligibility are sourced from persisted backend records.
- Paginated transaction lists, search and filters where supported by the APIs, status-aware actions, confirmation dialogs for consequential transitions, and responsive mobile navigation.

## REST API

All endpoints are prefixed with `/api`. Successful responses use JSON except `DELETE /products/:id`, which returns `204 No Content`.

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/health` | API health check |
| `GET` | `/dashboard` | Inventory, sales, alerts, and recent-order summaries |
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

## Tests

Run the API tests with:

```bash
npm test
```

The tests use isolated SQLite databases and verify product CRUD and validation, business-data APIs, migrations and seeding, purchase drafting/submission/receiving, sales lifecycle transitions, stock-ledger updates and reconciliation, transaction rollback, low-stock/dashboard summaries, and protected historical records.

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
