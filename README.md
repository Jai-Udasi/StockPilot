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
- Product names, SKUs, and prices are snapshotted on order items. Products with order or stock-movement history cannot be deleted, preserving the history.
- Dashboard summaries include on-hand inventory value, units, current-month orders and sales, recent orders, and low-stock alerts.
- Request bodies are validated and invalid input, duplicate SKUs, missing records, insufficient stock, and database errors receive explicit API error responses.
- Responsive dashboard, product catalog, stock-update dialog, order composer, and mobile navigation.

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
