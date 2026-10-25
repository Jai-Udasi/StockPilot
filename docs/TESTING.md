# Testing and verification

## Test architecture

The project uses Node.js's built-in `node:test` runner and `node:assert/strict`. API integration tests use Supertest against the Express app. Database tests use `better-sqlite3`; most tests construct an in-memory database with `createDatabase(':memory:')`, and migration tests use temporary database paths. Tests do not require the development database at `data/stockpilot.db`.

Test source: `server/app.test.js`.

## Commands

Run from the repository root in PowerShell:

```powershell
npm test
npm run lint
npm run build
git diff --check
```

`npm test` runs `node --test`. `npm run lint` runs `eslint .`. `npm run build` runs `vite build` and writes the static frontend to `dist/`. `git diff --check` checks patch whitespace; it is not an application test.

## Latest recorded baseline results

These commands were run against the repository before the portfolio documentation edits in this task:

| Command | Result |
| --- | --- |
| `npm test` | Passed: 38 tests, 6 suites, 0 failures, 0 skipped, 0 cancelled. Duration reported by Node: 27,713.9007 ms. |
| `npm run lint` | Passed: ESLint exited with code 0. |
| `npm run build` | Passed: Vite 6.4.5 transformed 1,581 modules and built `dist/` successfully. |
| `git diff --check` | Passed after the documentation edits: exit code 0. |

The test run printed deliberate SQLite trigger-error stack traces in rollback tests. Those tests inject ledger failures and assert that the containing operations roll back; the output concluded with 38 passing tests and no failures. These traces are expected from the failure-injection scenarios, not an overall failing run.

These are results from the recorded run, not a guarantee for later code changes. The test, lint, and build commands ran before the documentation-only edits; the final diff check ran after those edits. No application source or database content was changed as part of this documentation task.

## Coverage areas observed in the suite

- Product CRUD, metadata, relationship validation, filtering/sorting/pagination, stock changes, and deletion protection.
- Category, supplier, and customer validation, duplicate handling, CRUD/deactivation, and history preservation.
- Purchase order creation/edit/submission/cancellation, partial/full receipts, over-receipt and duplicate constraints, history, and rollback after injected ledger failure.
- Sales order creation, draft lifecycle, one-time stock deduction, insufficient stock, cancellation compensation, and disallowed transitions.
- Invoice snapshots and lifecycle; partial/full/failed payments, overpayment, duplicate references, reversal rules, return eligibility, restocking, refunds, and rollback.
- Migration initialization, deterministic seeding, preservation of legacy records, foreign-key enforcement, and stock reconciliation.
- Analytics date/filter behavior, empty data, financial/purchasing/stock calculations, read-only behavior, CSV escaping, and spreadsheet formula mitigation.
- CORS allowlisting, security headers, malformed request bodies, and request-size limits.

## Gaps and manual verification

Automated tests are API/database-focused. They do not establish visual correctness across every browser size, accessibility conformance, production hosting behavior, payment processor integration, or application-wide user authorization. The manual workflow script in [DEMO_SCRIPT.md](DEMO_SCRIPT.md) is a repeatable human walkthrough; do not report it as performed unless it has actually been run.
