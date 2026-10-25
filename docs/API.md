# StockPilot API reference

All route paths below are prefixed with `/api`. This reference is based on route definitions and Zod schemas in `server/app.js`. The API uses JSON for regular responses; CSV export routes return `text/csv`.

## Common behavior

- The API accepts JSON request bodies up to 100 KB. Request objects validated by Zod are strict: unknown fields are rejected.
- Standard error response: `{ "error": "message" }`. Invalid JSON/schema/query values generally return `400`; missing records return `404`; conflicts or disallowed transitions generally return `409`; unauthorized manual stock adjustments return `403`; unexpected server failures return a generic `500`.
- Resource-create routes generally return `201`; reads and updates return `200`; successful product/category deletes return `204`.
- Monetary request fields are numeric dollar values; values are persisted as integer cents. Quantities are integers.
- Paginated resources generally accept positive `page` and `pageSize` up to 100. Analytics endpoints validate date ranges/periods/limits; CSV exports cap rows at 10,000.
- Query filter availability is endpoint-specific. Unsupported or malformed filter values are rejected where the handler validates them.

## Health and legacy dashboard

| Method | Path | Query/body | Success |
| --- | --- | --- | --- |
| GET | `/health` | None | `200 { status: "ok" }` |
| GET | `/dashboard` | None | `200` with product count, inventory value/units, low-stock count/details, current-month qualifying order count/revenue, and recent orders. |

## Analytics and CSV

Shared analytics query parameters where supported:

- `from`, `to`: ISO dates or datetimes; date-only bounds represent inclusive UTC calendar days. Defaults to the last 30 UTC calendar days. Reversed/invalid or over-366-day ranges are rejected.
- `period`: `daily`, `weekly`, or `monthly` where time grouping applies.
- `categoryId`, `supplierId`, `productId`: positive integer filters where supported.
- `windowDays`: inventory movement window, 1–365; default 90.
- `limit`: positive integer, capped by endpoint; export limit is at most 10,000.

| Method | Path | Additional query | Success shape / behavior |
| --- | --- | --- | --- |
| GET | `/analytics/overview` | `recentLimit` | `200` with `dateRange`, inventory KPI object, sales/status/category summaries, purchasing summaries, financials, returns/refunds, and recent stock movements. |
| GET | `/analytics/inventory` | `windowDays` | `200` with inventory totals, valuation, grouped products, stock alerts, reconciliation warnings, and slow/non-moving data. |
| GET | `/analytics/sales-trend` | `period` | `200` with date range, inclusion/date-basis metadata, gross/net sales, accepted-return credits, trends and breakdowns. |
| GET | `/analytics/top-products` | `limit` | `200 { dateRange, filters, includedStatuses, products }`. |
| GET | `/analytics/purchasing` | `period` | `200` with order and receipt totals, trends, supplier summaries, and date-basis metadata. |
| GET | `/analytics/recent-sales` | `limit` | `200 { dateRange, limit, includedStatuses, dateBasis, orders }`. |
| GET | `/analytics/out-of-stock` | None | `200 { dateBasis, total, products }`; active, non-archived products with zero stock. |
| GET | `/analytics/returns-refunds` | None | `200` with return/refund status counts and separate accepted-credit/refund amounts. |
| GET | `/analytics/status-distribution` | `period` | `200` with order, invoice/payment, return and refund distributions. |
| GET | `/analytics/financials` | None | `200` with invoice, payment, accepted credit, refund, net-cash, unsettled-credit, and receivable totals plus date-basis metadata. |
| GET | `/analytics/stock-movements` | `limit` | `200` with period/type totals and recent movements. |
| GET | `/analytics/exports/:dataset.csv` | Shared filters plus export `limit` | `200 text/csv`, with `Content-Disposition` attachment. Supported dataset names: `inventory`, `low-stock`, `out-of-stock`, `top-products`, `sales-trend`, `sales-by-category`, `sales-summary`, `supplier-purchases`, `purchases-by-supplier`, `purchasing-trend`, `order-status`, `invoice-payment-status`, `returns-refunds`, `stock-movements`. CSV cells are quoted/escaped; formula-like strings are prefixed to mitigate spreadsheet formula execution. |

Analytics and exports are read-only. Sales, return, purchase and receipt dates have separate documented date bases; financial balances are current-state values where stated by the response.

## Catalog

### Products

| Method | Path | Query/body | Success / rules |
| --- | --- | --- | --- |
| GET | `/products` | Query: `q`, `category`, `categoryId`, `supplierId`, `stock` (`low`/`in_stock`), `active` (`true`/`false`), `page`, `pageSize` (max 100), `sort` (`name`, `sku`, `price`, `quantity`, `createdAt`, `updatedAt`), `direction` (`asc`/`desc`). | `200 { products, categories, total, page, pageSize, totalPages }`. |
| POST | `/products` | Required: `sku` (1–40 chars), `name` (1–120), `category` (1–60), finite `price` (0–1,000,000,000), integer `quantity` (0–2,147,483,647). Optional: `lowStockThreshold` (integer, default 5), `description` (nullable, max 2000), positive integer/null `categoryId`/`supplierId`, nullable finite `unitCost` (0–1,000,000,000), nullable integer `maxStock` (nonnegative), nullable `unitOfMeasure` (max 40), boolean `isActive`. | `201 { product }`; duplicate SKU conflicts. Product starts with zero then opening quantity is recorded through the stock ledger in the same transaction. |
| GET | `/products/:id` | Positive integer path ID. | `200 { product }`; `404` if absent. |
| PUT | `/products/:id` | Any nonempty subset of product fields; same field constraints as create. | `200 { product }`; quantity changes are represented through ledger movements. |
| PATCH | `/products/:id/stock` | `{ quantity: integer, operation?: "set" \| "adjust" }`; defaults to `set`. `set` quantity must be nonnegative; adjusted result must remain within supported stock range. | `200 { product }`; stock change is ledger-recorded. |
| POST | `/products/:id/stock-adjustments` | Requires configured manual-adjustment authorization. Body: `{ quantityDelta: nonzero integer, reason: string (3–500), notes?: string (max 2000) }`. | `201 { product, movement }`; negative stock rejected. |
| GET | `/products/:id/stock-movements` | `page`, `pageSize` (max 100). | `200 { movements, total, page, pageSize }`. |
| GET | `/products/:id/history` | Positive integer path ID. | `200` product purchase/sales history from persisted records. |
| DELETE | `/products/:id` | Positive integer path ID. | `204`; `409` if referenced by transactions or stock history. |
| GET | `/stock-movements` | `productId`, `type` (`initial_stock`, `sale`, `purchase`, `adjustment`, `return_in`, `return_out`, `write_off`), `page`, `pageSize` (max 100). | `200 { movements, total, page, pageSize }`. |

### Categories, suppliers, and customers

| Method | Path | Query/body | Success / rules |
| --- | --- | --- | --- |
| GET | `/categories` | None. | `200 { categories }`; category records include product count, units in stock, and inventory value. |
| POST | `/categories` | `{ name: string (1–80), description?: string|null (max 1000) }`. | `201 { category }`; case-insensitive duplicate names conflict. |
| GET | `/categories/:id` | Positive integer path ID. | `200 { category }` with inventory summary. |
| PUT | `/categories/:id` | Nonempty partial category object. | `200 { category }`; rename also updates linked products' legacy category text. |
| DELETE | `/categories/:id` | Positive integer path ID. | `204` only if no products are associated; otherwise `409`. |
| GET | `/suppliers` | `q`, `active` (`true`/`false`). | `200 { suppliers, total }`; search covers business name, code, contact person, and email. |
| POST | `/suppliers` | Required `supplierCode` (1–40), `businessName` (1–160); optional nullable contact/email/phone/address/notes; optional `isActive` boolean. Email must be valid when provided. | `201 { supplier }`; case-insensitive duplicate code conflicts. |
| GET | `/suppliers/:id` | Positive integer path ID. | `200 { supplier }`, including `purchaseHistory`. |
| PUT | `/suppliers/:id` | Nonempty partial supplier object with create-field validation. | `200 { supplier }`; duplicate code conflicts. |
| PATCH | `/suppliers/:id/deactivate` | Positive integer path ID; no body. | `200 { supplier }`; retains purchase history. |
| GET | `/suppliers/:id/purchase-orders` | Positive integer supplier ID; no query parameters. | `200 { purchaseOrders }` with that supplier's full purchase-order history. |
| GET | `/customers` | `q`, `active` (`true`/`false`). | `200 { customers, total }`; search covers name, code, email, and phone. |
| POST | `/customers` | Required `customerCode` (1–40), `name` (1–160); optional nullable email/phone/address/notes; optional `isActive` boolean. Email must be valid when provided. | `201 { customer }`; case-insensitive duplicate code conflicts. |
| GET | `/customers/:id` | Positive integer path ID. | `200 { customer }`, including linked order history. |
| PUT | `/customers/:id` | Nonempty partial customer object with create-field validation. | `200 { customer }`; duplicate code conflicts. |
| PATCH | `/customers/:id/deactivate` | Positive integer path ID; no body. | `200 { customer }`; preserves historical relationships. |

## Purchasing and receiving

Purchase-line bodies use unique `productId` values and require `quantity` as a positive integer, nonnegative finite `unitCost`, optional nonnegative `discountAmount`, and optional `taxRate` from 0 through 100. Monetary fields are dollar amounts. Discounts apply to the full line and cannot exceed its pre-discount amount; tax is calculated on the discounted amount.

| Method | Path | Query/body | Success / rules |
| --- | --- | --- | --- |
| POST | `/purchase-orders` | `{ supplierId: positive integer, notes?: string|null (max 2000), items: nonempty array (max 100) of purchase lines }`. | `201 { purchaseOrder }`; supplier must be active; server calculates totals and snapshots line details. |
| GET | `/purchase-orders` | `status` (`draft`, `ordered`, `partially_received`, `received`, `cancelled`), `supplierId`, `from`, `to`, `page`, `pageSize` (max 100). | `200 { purchaseOrders, total, page, pageSize, totalPages }`. |
| GET | `/purchase-orders/:id` | Positive integer path ID. | `200 { purchaseOrder }`, including lines and receipt history. |
| PUT | `/purchase-orders/:id` | Nonempty partial purchase-order input; item arrays use create constraints. | `200 { purchaseOrder }`; draft only. Submitted commercial lines are immutable. |
| POST | `/purchase-orders/:id/submit` | Positive integer path ID; no body. | `200 { purchaseOrder }`; draft transitions to ordered. |
| POST | `/purchase-orders/:id/cancel` | Positive integer path ID; no body. | `200 { purchaseOrder }`; only eligible unreceived orders can be cancelled. |
| POST | `/purchase-orders/:id/receipts` | `{ receiptNumber: string (1–80), notes?: string|null (max 2000), receivedAt?: ISO datetime, items: nonempty array (max 100) of { purchaseOrderItemId: positive integer, quantity: positive integer } }`. No duplicate line IDs. | `201 { receipt, purchaseOrder }`; ordered/partially received only; unique receipt number; cannot exceed outstanding quantity. Receipt, inventory, and ledger writes are transactional. |
| GET | `/goods-receipts` | `supplierId`, `purchaseOrderId`, `page`, `pageSize` (max 100). | `200 { receipts, total, page, pageSize }`. |
| GET | `/goods-receipts/:id` | Positive integer path ID. | `200 { receipt }`; receipt history is immutable. |

Purchase statuses: `draft`, `ordered`, `partially_received`, `received`, `cancelled`. Received stock is added only as goods receipts are recorded.

## Sales orders

Order body: optional `customerName` (1–120 chars), optional positive integer/null `customerId`, and `items` with 1–100 entries. Each item has positive integer `productId` and `quantity`; duplicate product IDs in a single request are rejected. Inactive customers/products cannot be selected where the handler enforces active eligibility.

| Method | Path | Query/body | Success / rules |
| --- | --- | --- | --- |
| GET | `/orders` | `status`, `customerId`, `from`, `to`, `page`, `pageSize` (max 100). | `200 { orders, total, page, pageSize, totalPages }`. |
| GET | `/orders/:id` | Positive integer path ID. | `200 { order }` with lines. |
| POST | `/orders/drafts` | Order body. | `201 { order }` with `draft` status; no stock deduction yet. |
| PUT | `/orders/:id` | Order body. | `200 { order }`; draft only. |
| PATCH | `/orders/:id/status` | `{ status: "confirmed" \| "processing" \| "shipped" \| "delivered" \| "cancelled" }`. | `200 { order }`; status transitions are constrained. Confirmation deducts stock exactly once; eligible confirmed cancellation writes compensating movements. |
| POST | `/orders` | Order body. | `201 { order }`; compatibility route creates a confirmed sale and deducts stock transactionally. |

Allowed transitions are draft → confirmed/cancelled, confirmed → processing/cancelled, processing → shipped, shipped → delivered. Processing and later states cannot be cancelled. An order with an active invoice or non-rejected return cannot be cancelled.

## Invoices, payments, returns, and refunds

| Method | Path | Query/body | Success / rules |
| --- | --- | --- | --- |
| POST | `/invoices` | `{ orderId: positive integer, invoiceNumber?: string (1–80), invoiceDate?: ISO datetime, dueDate?: ISO datetime|null }`. | `201 { invoice }`; requires stock-deducted eligible sale; only one non-void invoice per order; snapshots order/customer details. |
| GET | `/invoices` | `status`, `customerId`, `from`, `to`, `page`, `pageSize` (max 100). | `200 { invoices, total, page, pageSize, totalPages }`. |
| GET | `/invoices/:id` | Positive integer path ID. | `200 { invoice, payments, returns }`. |
| POST | `/invoices/:id/issue` | Positive integer path ID; no body. | `200 { invoice }`; draft only; commercial snapshot becomes immutable. |
| POST | `/invoices/:id/void` | Positive integer path ID; no body. | `200 { invoice }`; restricted to eligible unpaid invoice without active return/refund activity. |
| POST | `/invoices/:id/payments` | `{ paymentReference?: string (1–80), externalReference?: string|null (1–160), amount: positive finite number (max 1,000,000,000), method: string (1–80), status?: "completed" \| "failed", paymentDate?: ISO datetime, notes?: string|null (max 2000) }`. | `201 { payment }`; duplicate references and overpayments are rejected. |
| GET | `/payments` | `status`, `invoiceId`, `from`, `to`, `page`, `pageSize` (max 100). | `200 { payments, total, page, pageSize, totalPages }`. |
| GET | `/payments/:id` | Positive integer path ID. | `200 { payment }`. |
| POST | `/payments/:id/reverse` | Positive integer path ID; no body. | `200 { payment }`; completed payment only, and not if a refund is requested/completed. |
| POST | `/returns` | `{ returnNumber?: string (1–80), orderId: positive integer, invoiceId?: positive integer|null, returnDate?: ISO datetime, reason: string (3–500), items: 1–100 unique { orderItemId: positive integer, quantity: positive integer, restockable: boolean, restockReason: string (3–500) } }`. | `201 { salesReturn }`; requires a stock-deducted eligible sale; returned quantities/credit cannot exceed remaining sold/invoice quantities. |
| GET | `/returns` | `orderId`, `invoiceId`, `status` (`draft`, `accepted`, `rejected`), `from`, `to`, `page`, `pageSize` (max 100). | `200 { returns, total, page, pageSize, totalPages }`. |
| GET | `/returns/:id` | Positive integer path ID. | `200 { salesReturn }` with lines/refund history. |
| POST | `/returns/:id/complete` | `{ status: "accepted" \| "rejected" }`. | `200 { salesReturn }`; draft only. Acceptance restocks only restockable items and does so transactionally with ledger records. |
| POST | `/returns/:id/refunds` | `{ refundReference?: string (1–80), paymentId: positive integer, amount: positive finite number (max 1,000,000,000), method: string (1–80), externalReference?: string|null (1–160), notes?: string|null (max 2000) }`. | `201 { refund }`, initially `requested`; requires an accepted invoice-linked return and completed payment; capped by return credit and selected payment's refundable balance. |
| GET | `/refunds` | `invoiceId`, `returnId`, `status` (`requested`, `completed`, `failed`), `page`, `pageSize` (max 100). | `200 { refunds, total, page, pageSize, totalPages }`. |
| GET | `/refunds/:id` | Positive integer path ID. | `200 { refund }`. |
| POST | `/refunds/:id/complete` | Positive integer path ID; no body. | `200 { refund }`; requested only, rechecks eligibility. |
| POST | `/refunds/:id/fail` | Positive integer path ID; no body. | `200 { refund }`; requested only. |

### Representative sanitized requests

Create a draft sale:

```http
POST /api/orders/drafts
Content-Type: application/json
```

```json
{
  "customerId": 1,
  "items": [{ "productId": 1, "quantity": 2 }]
}
```

Create a purchase order:

```json
{
  "supplierId": 1,
  "notes": "Portfolio demo restock",
  "items": [{ "productId": 1, "quantity": 5, "unitCost": 8.25 }]
}
```

Record a payment:

```json
{
  "amount": 10,
  "method": "cash",
  "status": "completed"
}
```

The payment body is sent to `POST /api/invoices/:id/payments`. References and names in these examples are illustrative input values, not claims about current database records.
