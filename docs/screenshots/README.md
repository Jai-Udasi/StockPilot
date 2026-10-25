# Screenshot capture checklist

No screenshots are checked in yet. Capture the actual local UI with safe demo data; do not create mock screenshots or expose private customer information, credentials, database paths, or environment values.

Recommended preparation:

1. Start StockPilot with a fresh disposable `DATABASE_PATH` using the commands in [DEMO_SCRIPT.md](../DEMO_SCRIPT.md).
2. Use generic portfolio demo names and the development seed data.
3. Remove or obscure browser-profile details and unrelated windows, but do not alter the app content to fabricate results.
4. Save actual captures using the filenames below. Once present, README image links will resolve.

| Recommended filename | UI screen | Required safe demo state | What the screenshot demonstrates |
| --- | --- | --- | --- |
| `dashboard-analytics.png` | Dashboard | Seeded disposable DB; show date range and loaded analytics. | Persisted inventory/sales KPIs and analytics hierarchy. |
| `inventory-products.png` | Products | Seeded catalog, or generic demo product created in disposable DB. | Product fields, stock status, and catalog table. |
| `purchase-receipt-stock.png` | Purchase orders or Goods receipts plus Products | A submitted demo purchase order with at least one recorded receipt. | Receiving workflow and resulting product quantity. |
| `sales-order-stock-movement.png` | Sales orders and Stock movements | Confirmed demo order with a corresponding sale movement. | Order-to-stock deduction connection and ledger history. |
| `invoice.png` | Invoices | Issued invoice created from the demo confirmed sale. | Invoice snapshot and lifecycle state. |
| `payment-balance.png` | Invoice details or Payments | Partial payment recorded against the issued invoice. | Payment record and remaining outstanding balance. |
| `analytics-csv-export.png` | Reports or Dashboard | Date range includes demo sale/purchase; CSV export control visible. | Filtered analytics and available CSV export. |

Capture steps: open the relevant page, set a useful date range/filter, wait for loading to finish, confirm no error toast/dialog is obscuring the result, and use the operating system/browser screenshot tool. Verify each image before adding it to Git. Do not include SQLite files or sidecars; the repository `.gitignore` excludes them.
