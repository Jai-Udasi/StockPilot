# StockPilot portfolio demo script

**Target duration:** 5–7 minutes

**Use:** local demonstration only, with a disposable database.

**Do not use:** the normal development database for demo transactions if it contains user data.

## Prepare safe demo data

In PowerShell:

```powershell
Set-Location E:\StockPilot
$env:NODE_ENV = "development"
$env:DATABASE_PATH = Join-Path $env:TEMP ("stockpilot-demo-" + [guid]::NewGuid().ToString() + ".db")
npm run dev
```

Leave this terminal open and note the generated database path for the session. Open the Vite URL printed by the terminal, normally `http://localhost:5173`. A new development database receives deterministic sample records, including sample categories, one supplier, one customer, and two products. Confirm the sample workspace is present before beginning. Do not assume IDs; use names from the UI.

If demo data is missing, stop and start with a **new disposable path** using the commands above. Do not delete/reset/reseed `data/stockpilot.db`. If you need more product stock for a larger receipt and sale, create a disposable demo product from **Products → Create product** with opening quantity and a valid price; do not manually edit the SQLite file.

## Walkthrough

### 1. Opening and problem statement — 30 seconds

**Say:** “StockPilot connects inventory movements to purchasing, sales, and finance so that stock and business reports can be checked against persisted records.”

Point out the main navigation groups: Overview, Catalog, Operations, and Finance. The demo focuses on connected records, not just static dashboard cards.

### 2. Dashboard and analytics — 45 seconds

1. Open **Dashboard**.
2. Show the date range, sales interval, category and supplier filters, inventory KPIs, gross/net sales measures, and ledger warning indicator.
3. Open **Reports** briefly and show the detailed tables and download buttons.

- **Needs beforehand:** a fresh disposable seeded DB is enough; reports may be sparse before transactions.
- **Verify:** zero-state/report messaging is sensible and current figures load. Metrics are API-backed.
- **If missing:** use a new disposable database path; confirm API health at `http://127.0.0.1:3001/api/health`.

### 3. Receive purchased stock — 60–90 seconds

1. Open **Purchase orders** and choose the create action.
2. Select the seeded active supplier and one available product. Create a small quantity and unit-cost purchase order.
3. Open that draft and use the submit action.
4. Open **Goods receipts**, select the ordered purchase order, and receive part or all of the outstanding quantity with a unique receipt number.
5. Open **Products** or the purchase order details to verify the new quantity and receipt history. Open **Stock movements** to confirm the `purchase` movement.

- **Needs beforehand:** an active supplier and a product (the development seed includes these).
- **Expected:** the purchase order moves to ordered/partially received/received as quantities are received; stock changes only on receipt.
- **If missing:** create a supplier under **Suppliers** and a product under **Products** in this disposable database. Do not reuse receipt numbers; create a new PO if no outstanding quantity remains.

### 4. Confirm a sale and verify stock movement — 60–90 seconds

1. Open **Sales orders** and create a sales draft using an active customer or the walk-in option.
2. Add the product and a quantity within available stock.
3. Save the draft and inspect its details; draft creation should not deduct stock.
4. Confirm the draft from the order actions.
5. Open **Products** and **Stock movements** to verify the stock deduction and sale movement.

- **Needs beforehand:** available stock and optionally an active customer.
- **Expected:** confirmation deducts the order quantity once. A second confirmation is not allowed.
- **If missing:** receive stock first. If no customer is available, use the walk-in option or create a customer in this disposable database.

### 5. Issue an invoice — 45 seconds

1. Open **Invoices** and create an invoice for the confirmed order.
2. Open the invoice details and choose the issue action.

- **Needs beforehand:** a confirmed, stock-deducted order without an active invoice.
- **Expected:** invoice lines reflect the saved sale; issuance changes the draft invoice to issued and freezes its commercial snapshot.
- **If missing:** complete the sales step first. If the order already has an active invoice, use a new eligible sale rather than changing historical records.

### 6. Record a payment and show balance change — 45–60 seconds

1. From **Invoices** or **Payments**, start a payment for the issued invoice.
2. Enter a partial amount, choose a method, and save.
3. Reopen invoice details to show the payment and outstanding balance. If time permits, record the remaining balance.

- **Needs beforehand:** issued invoice with an outstanding balance.
- **Expected:** partial payment leaves a positive outstanding balance and updates payment status; paying the remaining amount brings the balance to zero. Amounts beyond the balance are rejected.
- **If missing:** issue an invoice first. Do not reuse an external payment reference.

### 7. Analytics and CSV export — 45 seconds

1. Return to **Dashboard** or **Reports**.
2. Set the date range to include the demo activity.
3. Show the order/purchase/inventory/financial values relevant to the records just created.
4. Use **Export CSV** on Dashboard or **Download reports** on Reports; open the downloaded CSV and check its header and a demo row.

- **Needs beforehand:** completed demo transactions for nonzero analytics; empty data is valid when no transactions exist.
- **Expected:** visible metrics match persisted records; CSV is returned by the API with headers and values for the selected dataset/filter.
- **If missing:** refresh the view, widen its date range, and verify `/api/analytics/overview` or `/api/analytics/exports/sales-summary.csv` through the local API.

### 8. Close with architecture and testing — 30 seconds

Summarize the browser → React/Vite → Express/Zod → SQLite flow, transactional stock ledger, and isolated API/database tests. Mention that SQLite requires persistent storage and the application currently lacks app-wide authentication/authorization; public deployment is not ready until that is addressed.

## Completion notes

This is a prepared walkthrough, not a claim that the demo was performed. Record any actual failures and corrections during a live run. After the demo, stop the server. Keep or remove only the specifically identified disposable DB after verifying its path; never target the project's existing `data/stockpilot.db`.
