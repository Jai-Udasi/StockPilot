import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = [
  {
    version: 1,
    name: 'baseline_schema',
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          price INTEGER NOT NULL CHECK (price >= 0),
          quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
          low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE TABLE IF NOT EXISTS orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_number TEXT NOT NULL UNIQUE,
          customer_name TEXT NOT NULL DEFAULT 'Walk-in customer',
          total INTEGER NOT NULL CHECK (total >= 0),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE TABLE IF NOT EXISTS order_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          product_name TEXT NOT NULL,
          sku TEXT NOT NULL,
          quantity INTEGER NOT NULL CHECK (quantity > 0),
          unit_price INTEGER NOT NULL CHECK (unit_price >= 0)
        );
        CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
        CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
        CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
      `);
    },
  },
  {
    version: 2,
    name: 'business_foundation',
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE TABLE IF NOT EXISTS suppliers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          supplier_code TEXT NOT NULL,
          business_name TEXT NOT NULL,
          contact_person TEXT,
          email TEXT,
          phone TEXT,
          address TEXT,
          notes TEXT,
          is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE TABLE IF NOT EXISTS customers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_code TEXT NOT NULL,
          name TEXT NOT NULL,
          email TEXT,
          phone TEXT,
          address TEXT,
          notes TEXT,
          is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
      `);

      ensureColumn(db, 'products', 'description', 'TEXT');
      ensureColumn(db, 'products', 'category_id', 'INTEGER REFERENCES categories(id) ON DELETE SET NULL');
      ensureColumn(db, 'products', 'unit_cost', 'INTEGER CHECK (unit_cost >= 0)');
      ensureColumn(db, 'products', 'supplier_id', 'INTEGER REFERENCES suppliers(id) ON DELETE SET NULL');
      ensureColumn(db, 'products', 'max_stock', 'INTEGER CHECK (max_stock >= 0)');
      ensureColumn(db, 'products', 'unit_of_measure', 'TEXT');
      ensureColumn(db, 'products', 'is_active', 'INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))');
      ensureColumn(db, 'products', 'archived_at', 'TEXT');

      ensureColumn(db, 'orders', 'customer_id', 'INTEGER REFERENCES customers(id) ON DELETE SET NULL');
      ensureColumn(db, 'orders', 'status', 'TEXT NOT NULL DEFAULT "confirmed"');
      ensureColumn(db, 'orders', 'payment_status', 'TEXT NOT NULL DEFAULT "unpaid"');
      ensureColumn(db, 'orders', 'notes', 'TEXT');

      ensureIndexIfSafe(db, 'idx_categories_name', 'categories', 'name COLLATE NOCASE');
      ensureIndexIfSafe(db, 'idx_suppliers_code', 'suppliers', 'supplier_code COLLATE NOCASE');
      ensureIndexIfSafe(db, 'idx_customers_code', 'customers', 'customer_code COLLATE NOCASE');
      ensureIndexIfSafe(db, 'idx_products_category', 'products', 'category_id');
      ensureIndexIfSafe(db, 'idx_products_supplier', 'products', 'supplier_id');
    },
  },
  {
    version: 3,
    name: 'stock_ledger',
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS stock_movements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          movement_type TEXT NOT NULL CHECK (movement_type IN (
            'initial_stock', 'sale', 'purchase', 'adjustment', 'return_in', 'return_out', 'write_off'
          )),
          quantity_delta INTEGER NOT NULL CHECK (quantity_delta != 0),
          previous_quantity INTEGER NOT NULL CHECK (previous_quantity >= 0),
          new_quantity INTEGER NOT NULL CHECK (new_quantity >= 0),
          reference_type TEXT,
          reference_id INTEGER,
          reason TEXT,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
      `);
      ensureIndexIfSafe(db, 'idx_stock_movements_product_created', 'stock_movements', 'product_id, created_at');
      ensureIndexIfSafe(db, 'idx_stock_movements_reference', 'stock_movements', 'reference_type, reference_id');
    },
  },
  {
    version: 4,
    name: 'business_data_integrity',
    apply(db) {
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS categories_name_unique_insert
        BEFORE INSERT ON categories
        WHEN EXISTS (SELECT 1 FROM categories WHERE trim(name) = trim(NEW.name) COLLATE NOCASE)
        BEGIN
          SELECT RAISE(ABORT, 'Category name already exists.');
        END;
        CREATE TRIGGER IF NOT EXISTS categories_name_unique_update
        BEFORE UPDATE OF name ON categories
        WHEN EXISTS (SELECT 1 FROM categories WHERE id != OLD.id AND trim(name) = trim(NEW.name) COLLATE NOCASE)
        BEGIN
          SELECT RAISE(ABORT, 'Category name already exists.');
        END;
        CREATE TRIGGER IF NOT EXISTS suppliers_code_unique_insert
        BEFORE INSERT ON suppliers
        WHEN EXISTS (SELECT 1 FROM suppliers WHERE trim(supplier_code) = trim(NEW.supplier_code) COLLATE NOCASE)
        BEGIN
          SELECT RAISE(ABORT, 'Supplier code already exists.');
        END;
        CREATE TRIGGER IF NOT EXISTS suppliers_code_unique_update
        BEFORE UPDATE OF supplier_code ON suppliers
        WHEN EXISTS (SELECT 1 FROM suppliers WHERE id != OLD.id AND trim(supplier_code) = trim(NEW.supplier_code) COLLATE NOCASE)
        BEGIN
          SELECT RAISE(ABORT, 'Supplier code already exists.');
        END;
        CREATE TRIGGER IF NOT EXISTS customers_code_unique_insert
        BEFORE INSERT ON customers
        WHEN EXISTS (SELECT 1 FROM customers WHERE trim(customer_code) = trim(NEW.customer_code) COLLATE NOCASE)
        BEGIN
          SELECT RAISE(ABORT, 'Customer code already exists.');
        END;
        CREATE TRIGGER IF NOT EXISTS customers_code_unique_update
        BEFORE UPDATE OF customer_code ON customers
        WHEN EXISTS (SELECT 1 FROM customers WHERE id != OLD.id AND trim(customer_code) = trim(NEW.customer_code) COLLATE NOCASE)
        BEGIN
          SELECT RAISE(ABORT, 'Customer code already exists.');
        END;
      `);

      db.exec(`
        INSERT INTO stock_movements (
          product_id, movement_type, quantity_delta, previous_quantity, new_quantity,
          reference_type, reference_id, reason, notes
        )
        SELECT p.id, 'initial_stock', p.quantity, 0, p.quantity,
          'migration', p.id, 'Opening stock baseline', 'Backfilled during stock-ledger migration'
        FROM products p
        WHERE p.quantity > 0
          AND NOT EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.product_id = p.id);
      `);
    },
  },
  {
    version: 5,
    name: 'purchasing_and_sales_lifecycle',
    apply(db) {
      ensureColumn(db, 'orders', 'updated_at', 'TEXT');
      ensureColumn(db, 'orders', 'stock_deducted_at', 'TEXT');
      db.exec(`
        UPDATE orders
        SET updated_at = COALESCE(updated_at, created_at),
            stock_deducted_at = COALESCE(stock_deducted_at, created_at),
            status = CASE WHEN status = 'draft' THEN 'confirmed' ELSE status END;

        CREATE TABLE IF NOT EXISTS purchase_orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          order_number TEXT NOT NULL UNIQUE,
          supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
          status TEXT NOT NULL CHECK (status IN ('draft', 'ordered', 'partially_received', 'received', 'cancelled')),
          subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
          tax_total INTEGER NOT NULL CHECK (tax_total >= 0),
          total INTEGER NOT NULL CHECK (total >= 0),
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          submitted_at TEXT,
          cancelled_at TEXT
        );
        CREATE TABLE IF NOT EXISTS purchase_order_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          product_name TEXT NOT NULL,
          sku TEXT NOT NULL,
          ordered_quantity INTEGER NOT NULL CHECK (ordered_quantity > 0),
          received_quantity INTEGER NOT NULL DEFAULT 0 CHECK (received_quantity >= 0 AND received_quantity <= ordered_quantity),
          unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0),
          discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
          tax_rate_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_basis_points >= 0 AND tax_rate_basis_points <= 10000),
          line_subtotal INTEGER NOT NULL CHECK (line_subtotal >= 0),
          line_tax INTEGER NOT NULL CHECK (line_tax >= 0),
          line_total INTEGER NOT NULL CHECK (line_total >= 0)
        );
        CREATE TABLE IF NOT EXISTS goods_receipts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          receipt_number TEXT NOT NULL UNIQUE,
          purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
          supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
          received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE TABLE IF NOT EXISTS goods_receipt_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          goods_receipt_id INTEGER NOT NULL REFERENCES goods_receipts(id) ON DELETE RESTRICT,
          purchase_order_item_id INTEGER NOT NULL REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          quantity INTEGER NOT NULL CHECK (quantity > 0),
          unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0)
        );
        CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_created ON purchase_orders(supplier_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_purchase_orders_status_created ON purchase_orders(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order ON purchase_order_items(purchase_order_id);
        CREATE INDEX IF NOT EXISTS idx_goods_receipts_order ON goods_receipts(purchase_order_id, id);
        CREATE INDEX IF NOT EXISTS idx_goods_receipt_items_receipt ON goods_receipt_items(goods_receipt_id);
        CREATE INDEX IF NOT EXISTS idx_goods_receipt_items_order_item ON goods_receipt_items(purchase_order_item_id);
        CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(customer_id, created_at);
        CREATE TRIGGER IF NOT EXISTS purchase_order_items_insert_draft_only
        BEFORE INSERT ON purchase_order_items
        WHEN (SELECT status FROM purchase_orders WHERE id = NEW.purchase_order_id) != 'draft'
        BEGIN
          SELECT RAISE(ABORT, 'Purchase order lines can only be added while the order is a draft.');
        END;
        CREATE TRIGGER IF NOT EXISTS purchase_order_items_delete_draft_only
        BEFORE DELETE ON purchase_order_items
        WHEN (SELECT status FROM purchase_orders WHERE id = OLD.purchase_order_id) != 'draft'
        BEGIN
          SELECT RAISE(ABORT, 'Submitted purchase order lines are immutable.');
        END;
        CREATE TRIGGER IF NOT EXISTS purchase_order_items_commercial_fields_immutable
        BEFORE UPDATE OF purchase_order_id, product_id, product_name, sku, ordered_quantity,
          unit_cost, discount_amount, tax_rate_basis_points, line_subtotal, line_tax, line_total
        ON purchase_order_items
        WHEN (SELECT status FROM purchase_orders WHERE id = OLD.purchase_order_id) != 'draft'
        BEGIN
          SELECT RAISE(ABORT, 'Submitted purchase order commercial details are immutable.');
        END;
        CREATE TRIGGER IF NOT EXISTS goods_receipts_immutable_update
        BEFORE UPDATE ON goods_receipts
        BEGIN
          SELECT RAISE(ABORT, 'Goods receipts are immutable.');
        END;
        CREATE TRIGGER IF NOT EXISTS goods_receipts_immutable_delete
        BEFORE DELETE ON goods_receipts
        BEGIN
          SELECT RAISE(ABORT, 'Goods receipts are immutable.');
        END;
        CREATE TRIGGER IF NOT EXISTS goods_receipt_items_immutable_update
        BEFORE UPDATE ON goods_receipt_items
        BEGIN
          SELECT RAISE(ABORT, 'Goods receipt items are immutable.');
        END;
        CREATE TRIGGER IF NOT EXISTS goods_receipt_items_immutable_delete
        BEFORE DELETE ON goods_receipt_items
        BEGIN
          SELECT RAISE(ABORT, 'Goods receipt items are immutable.');
        END;
      `);
    },
  },
  {
    version: 6,
    name: 'invoices_payments_returns_and_refunds',
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS invoices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          invoice_number TEXT NOT NULL UNIQUE COLLATE NOCASE,
          order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
          customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
          order_number TEXT NOT NULL,
          customer_name TEXT NOT NULL,
          customer_email TEXT,
          billing_address TEXT,
          invoice_date TEXT NOT NULL,
          due_date TEXT,
          status TEXT NOT NULL CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'credited', 'void')),
          subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
          discount_total INTEGER NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
          tax_total INTEGER NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
          total INTEGER NOT NULL CHECK (total >= 0),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_active_order
          ON invoices(order_id) WHERE status != 'void';
        CREATE INDEX IF NOT EXISTS idx_invoices_status_date ON invoices(status, invoice_date);
        CREATE INDEX IF NOT EXISTS idx_invoices_customer_date ON invoices(customer_id, invoice_date);

        CREATE TABLE IF NOT EXISTS invoice_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
          order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          product_name TEXT NOT NULL,
          sku TEXT NOT NULL,
          quantity INTEGER NOT NULL CHECK (quantity > 0),
          unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
          subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
          discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
          tax_amount INTEGER NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
          total INTEGER NOT NULL CHECK (total >= 0),
          UNIQUE (invoice_id, order_item_id)
        );
        CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id, id);
        CREATE INDEX IF NOT EXISTS idx_invoice_items_product ON invoice_items(product_id, invoice_id);

        CREATE TABLE IF NOT EXISTS payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
          payment_reference TEXT NOT NULL UNIQUE COLLATE NOCASE,
          external_reference TEXT UNIQUE COLLATE NOCASE,
          amount INTEGER NOT NULL CHECK (amount > 0),
          currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
          method TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'reversed')),
          payment_date TEXT NOT NULL,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX IF NOT EXISTS idx_payments_invoice_status ON payments(invoice_id, status, payment_date);

        CREATE TABLE IF NOT EXISTS sales_returns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          return_number TEXT NOT NULL UNIQUE COLLATE NOCASE,
          order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
          invoice_id INTEGER REFERENCES invoices(id) ON DELETE RESTRICT,
          customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
          customer_name TEXT NOT NULL,
          return_date TEXT NOT NULL,
          reason TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('draft', 'accepted', 'rejected')),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          completed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sales_returns_order_status ON sales_returns(order_id, status, id);
        CREATE INDEX IF NOT EXISTS idx_sales_returns_invoice_status ON sales_returns(invoice_id, status, id);

        CREATE TABLE IF NOT EXISTS sales_return_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          return_id INTEGER NOT NULL REFERENCES sales_returns(id) ON DELETE RESTRICT,
          order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
          product_name TEXT NOT NULL,
          sku TEXT NOT NULL,
          quantity INTEGER NOT NULL CHECK (quantity > 0),
          restockable INTEGER NOT NULL CHECK (restockable IN (0, 1)),
          restock_reason TEXT NOT NULL,
          unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
          refund_eligible_amount INTEGER NOT NULL CHECK (refund_eligible_amount >= 0),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          UNIQUE (return_id, order_item_id)
        );
        CREATE INDEX IF NOT EXISTS idx_sales_return_items_order_item ON sales_return_items(order_item_id, return_id);

        CREATE TABLE IF NOT EXISTS refunds (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          refund_reference TEXT NOT NULL UNIQUE COLLATE NOCASE,
          return_id INTEGER NOT NULL REFERENCES sales_returns(id) ON DELETE RESTRICT,
          invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
          payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
          amount INTEGER NOT NULL CHECK (amount > 0),
          currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
          method TEXT NOT NULL,
          external_reference TEXT UNIQUE COLLATE NOCASE,
          status TEXT NOT NULL CHECK (status IN ('requested', 'completed', 'failed')),
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          completed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_refunds_invoice_status ON refunds(invoice_id, status, id);
        CREATE INDEX IF NOT EXISTS idx_refunds_return_status ON refunds(return_id, status, id);

        CREATE TRIGGER IF NOT EXISTS invoice_items_insert_draft_only
        BEFORE INSERT ON invoice_items
        WHEN (SELECT status FROM invoices WHERE id = NEW.invoice_id) != 'draft'
        BEGIN
          SELECT RAISE(ABORT, 'Issued invoice lines are immutable.');
        END;
        CREATE TRIGGER IF NOT EXISTS invoice_items_update_draft_only
        BEFORE UPDATE ON invoice_items
        WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) != 'draft'
        BEGIN
          SELECT RAISE(ABORT, 'Issued invoice lines are immutable.');
        END;
        CREATE TRIGGER IF NOT EXISTS invoice_items_delete_draft_only
        BEFORE DELETE ON invoice_items
        WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) != 'draft'
        BEGIN
          SELECT RAISE(ABORT, 'Issued invoice lines are immutable.');
        END;
        CREATE TRIGGER IF NOT EXISTS invoice_snapshot_immutable
        BEFORE UPDATE OF invoice_number, order_id, customer_id, order_number, customer_name,
          customer_email, billing_address, invoice_date, due_date, subtotal, discount_total, tax_total, total
        ON invoices
        WHEN OLD.status != 'draft'
        BEGIN
          SELECT RAISE(ABORT, 'Issued invoice details are immutable.');
        END;
        CREATE TRIGGER IF NOT EXISTS invoice_status_transition
        BEFORE UPDATE OF status ON invoices
        WHEN NOT (
          (OLD.status = 'draft' AND NEW.status IN ('issued', 'void'))
          OR (OLD.status = 'issued' AND NEW.status IN ('partially_paid', 'paid', 'credited', 'void'))
          OR (OLD.status = 'partially_paid' AND NEW.status IN ('issued', 'paid', 'credited'))
          OR (OLD.status = 'paid' AND NEW.status IN ('partially_paid', 'issued', 'credited'))
        )
        BEGIN
          SELECT RAISE(ABORT, 'Invalid invoice status transition.');
        END;
        CREATE TRIGGER IF NOT EXISTS sales_return_items_draft_only
        BEFORE INSERT ON sales_return_items
        WHEN (SELECT status FROM sales_returns WHERE id = NEW.return_id) != 'draft'
        BEGIN
          SELECT RAISE(ABORT, 'Submitted return lines are immutable.');
        END;
        CREATE TRIGGER IF NOT EXISTS sales_return_items_update_draft_only
        BEFORE UPDATE ON sales_return_items
        WHEN (SELECT status FROM sales_returns WHERE id = OLD.return_id) != 'draft'
        BEGIN
          SELECT RAISE(ABORT, 'Submitted return lines are immutable.');
        END;
        CREATE TRIGGER IF NOT EXISTS sales_return_items_delete_draft_only
        BEFORE DELETE ON sales_return_items
        WHEN (SELECT status FROM sales_returns WHERE id = OLD.return_id) != 'draft'
        BEGIN
          SELECT RAISE(ABORT, 'Submitted return lines are immutable.');
        END;
        CREATE TRIGGER IF NOT EXISTS sales_return_snapshot_immutable
        BEFORE UPDATE OF return_number, order_id, invoice_id, customer_id, customer_name, return_date, reason
        ON sales_returns
        WHEN OLD.status != 'draft'
        BEGIN
          SELECT RAISE(ABORT, 'Completed return details are immutable.');
        END;
        CREATE TRIGGER IF NOT EXISTS sales_return_status_transition
        BEFORE UPDATE OF status ON sales_returns
        WHEN NOT (OLD.status = 'draft' AND NEW.status IN ('accepted', 'rejected'))
        BEGIN
          SELECT RAISE(ABORT, 'Invalid sales return status transition.');
        END;
        CREATE TRIGGER IF NOT EXISTS payment_transaction_immutable
        BEFORE UPDATE OF invoice_id, payment_reference, external_reference, amount, currency, method, payment_date, notes
        ON payments
        BEGIN
          SELECT RAISE(ABORT, 'Payment transaction details are immutable.');
        END;
        CREATE TRIGGER IF NOT EXISTS payment_status_transition
        BEFORE UPDATE OF status ON payments
        WHEN NOT (OLD.status = 'completed' AND NEW.status = 'reversed')
        BEGIN
          SELECT RAISE(ABORT, 'Invalid payment status transition.');
        END;
        CREATE TRIGGER IF NOT EXISTS payment_cannot_reverse_refunded
        BEFORE UPDATE OF status ON payments
        WHEN NEW.status = 'reversed' AND EXISTS (
          SELECT 1 FROM refunds WHERE payment_id = OLD.id AND status IN ('requested', 'completed')
        )
        BEGIN
          SELECT RAISE(ABORT, 'A payment with a refund cannot be reversed.');
        END;
        CREATE TRIGGER IF NOT EXISTS refund_transaction_immutable
        BEFORE UPDATE OF refund_reference, return_id, invoice_id, payment_id, amount, currency, method, external_reference, notes
        ON refunds
        BEGIN
          SELECT RAISE(ABORT, 'Refund transaction details are immutable.');
        END;
        CREATE TRIGGER IF NOT EXISTS refund_status_transition
        BEFORE UPDATE OF status ON refunds
        WHEN NOT (OLD.status = 'requested' AND NEW.status IN ('completed', 'failed'))
        BEGIN
          SELECT RAISE(ABORT, 'Invalid refund status transition.');
        END;
      `);
    },
  },
];

function ensureTableMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${columnName} ${definition};`);
  }
}

function ensureIndexIfSafe(db, indexName, tableName, columns) {
  const indexList = db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').all('index', indexName);
  if (indexList.length > 0) {
    return;
  }

  const duplicateRows = db.prepare(`SELECT 1 FROM ${quoteIdentifier(tableName)} GROUP BY ${columns} HAVING COUNT(*) > 1 LIMIT 1`).get();
  if (duplicateRows) {
    return;
  }

  db.exec(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier(indexName)} ON ${quoteIdentifier(tableName)}(${columns});`);
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function maybeBackupDatabase(filename) {
  if (filename === ':memory:' || !fs.existsSync(filename) || fs.statSync(filename).size === 0) {
    return null;
  }

  const backupPath = `${filename}.bak-${Date.now()}`;
  fs.copyFileSync(filename, backupPath);
  return backupPath;
}

export function createDatabase(filename = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'stockpilot.db')) {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }

  const fileAlreadyExisted = filename !== ':memory:' && fs.existsSync(filename) && fs.statSync(filename).size > 0;
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const hasMigrationTable = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get());
  const currentVersion = hasMigrationTable
    ? db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version
    : 0;
  if (fileAlreadyExisted && currentVersion < MIGRATIONS[MIGRATIONS.length - 1].version) {
    db.pragma('wal_checkpoint(FULL)');
    maybeBackupDatabase(filename);
  }

  ensureTableMigrations(db);
  for (const migration of MIGRATIONS) {
    const record = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(migration.version);
    if (!record) {
      const applyMigration = db.transaction(() => {
        migration.apply(db);
        db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
      });
      applyMigration();
    }
  }

  if (filename !== ':memory:') {
    const seed = db.transaction(() => seedDeterministicData(db));
    seed();
  }
  return db;
}

export function seedDeterministicData(db) {
  const categories = [
    { name: 'Drinkware', description: 'Coffee, tea, and hydration goods' },
    { name: 'Home Goods', description: 'Everyday home and decor essentials' },
    { name: 'Office', description: 'Desk, study, and work essentials' },
  ];

  for (const category of categories) {
    db.prepare(`
      INSERT INTO categories (name, description)
      SELECT @name, @description
      WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = @name COLLATE NOCASE)
    `).run(category);
  }

  const suppliers = [
    {
      supplier_code: 'SUP-001',
      business_name: 'Northwind Supply',
      contact_person: 'Ava Green',
      email: 'ava@northwind.example',
      phone: '+1-555-0101',
      address: '89 River Street, Portland OR',
      notes: 'Primary ceramic supplier',
      is_active: 1,
    },
  ];

  for (const supplier of suppliers) {
    db.prepare(`
      INSERT INTO suppliers (supplier_code, business_name, contact_person, email, phone, address, notes, is_active)
      SELECT @supplier_code, @business_name, @contact_person, @email, @phone, @address, @notes, @is_active
      WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE supplier_code = @supplier_code COLLATE NOCASE)
    `).run(supplier);
  }

  const customers = [
    {
      customer_code: 'CUST-001',
      name: 'Harbor Cafe',
      email: 'orders@harborcafe.example',
      phone: '+1-555-0202',
      address: '14 Dock Lane, Seattle WA',
      notes: 'Preferred wholesale customer',
      is_active: 1,
    },
  ];

  for (const customer of customers) {
    db.prepare(`
      INSERT INTO customers (customer_code, name, email, phone, address, notes, is_active)
      SELECT @customer_code, @name, @email, @phone, @address, @notes, @is_active
      WHERE NOT EXISTS (SELECT 1 FROM customers WHERE customer_code = @customer_code COLLATE NOCASE)
    `).run(customer);
  }

  const seedProducts = [
    {
      sku: 'MUG-001',
      name: 'Stoneware Mug',
      category: 'Drinkware',
      description: 'Hand-finished ceramic mug for daily coffee service',
      price: 1850,
      quantity: 12,
      lowStockThreshold: 3,
      unit_cost: 780,
      max_stock: 30,
      unit_of_measure: 'each',
      is_active: 1,
      category_name: 'Drinkware',
      supplier_code: 'SUP-001',
    },
    {
      sku: 'BOWL-001',
      name: 'Clay Bowl',
      category: 'Home Goods',
      description: 'Glazed serving bowl for everyday use',
      price: 2400,
      quantity: 8,
      lowStockThreshold: 2,
      unit_cost: 990,
      max_stock: 20,
      unit_of_measure: 'each',
      is_active: 1,
      category_name: 'Home Goods',
      supplier_code: 'SUP-001',
    },
  ];

  for (const product of seedProducts) {
    const categoryRow = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE').get(product.category_name);
    const supplierRow = db.prepare('SELECT id FROM suppliers WHERE supplier_code = ? COLLATE NOCASE').get(product.supplier_code);

    db.prepare(`
      INSERT INTO products (
        sku, name, category, description, price, quantity, low_stock_threshold,
        unit_cost, category_id, supplier_id, max_stock, unit_of_measure, is_active
      )
      SELECT
        @sku, @name, @category, @description, @price, @quantity, @lowStockThreshold,
        @unit_cost, @categoryId, @supplierId, @max_stock, @unit_of_measure, @is_active
      WHERE NOT EXISTS (SELECT 1 FROM products WHERE sku = @sku COLLATE NOCASE)
    `).run({
      sku: product.sku,
      name: product.name,
      category: product.category,
      description: product.description,
      price: product.price,
      quantity: product.quantity,
      lowStockThreshold: product.lowStockThreshold,
      unit_cost: product.unit_cost,
      categoryId: categoryRow ? categoryRow.id : null,
      supplierId: supplierRow ? supplierRow.id : null,
      max_stock: product.max_stock,
      unit_of_measure: product.unit_of_measure,
      is_active: product.is_active,
    });

    const freshProduct = db.prepare('SELECT id, quantity FROM products WHERE sku = ? COLLATE NOCASE').get(product.sku);
    if (freshProduct) {
      const movementExists = db.prepare(`
        SELECT 1 FROM stock_movements
        WHERE product_id = ? AND movement_type = 'initial_stock' AND reference_type = 'seed'
        LIMIT 1
      `).get(freshProduct.id);

      if (!movementExists) {
        db.prepare(`
          INSERT INTO stock_movements (product_id, movement_type, quantity_delta, previous_quantity, new_quantity, reference_type, reference_id, reason, notes)
          VALUES (?, 'initial_stock', ?, 0, ?, 'seed', ?, 'Initial stocking', 'Deterministic seed data')
        `).run(freshProduct.id, freshProduct.quantity, freshProduct.quantity, freshProduct.id);
      }
    }
  }
}

export function ledgerStockMovement(db, {
  productId,
  movementType,
  quantityDelta,
  referenceType = null,
  referenceId = null,
  reason = '',
  notes = '',
}) {
  if (!Number.isInteger(quantityDelta) || quantityDelta === 0) {
    const error = new Error('quantityDelta must be a non-zero integer.');
    error.status = 400;
    throw error;
  }

  if (!['initial_stock', 'sale', 'purchase', 'adjustment', 'return_in', 'return_out', 'write_off'].includes(movementType)) {
    const error = new Error('Unsupported stock movement type.');
    error.status = 400;
    throw error;
  }

  const applyMovement = () => {
    const product = db.prepare('SELECT id, quantity FROM products WHERE id = ?').get(productId);
    if (!product) {
      const error = new Error('Product not found.');
      error.status = 404;
      throw error;
    }

    const previousQuantity = product.quantity;
    const newQuantity = previousQuantity + quantityDelta;
    if (!Number.isSafeInteger(newQuantity) || newQuantity < 0 || newQuantity > 2_147_483_647) {
      const error = new Error('Stock movement would result in an invalid quantity.');
      error.status = 409;
      throw error;
    }

    const update = db.prepare(`
      UPDATE products SET quantity = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND quantity = ?
    `).run(newQuantity, productId, previousQuantity);
    if (update.changes !== 1) {
      const error = new Error('Stock changed during the adjustment. Retry the request.');
      error.status = 409;
      throw error;
    }

    db.prepare(`
      INSERT INTO stock_movements (product_id, movement_type, quantity_delta, previous_quantity, new_quantity, reference_type, reference_id, reason, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      productId,
      movementType,
      quantityDelta,
      previousQuantity,
      newQuantity,
      referenceType,
      referenceId,
      reason,
      notes,
    );
    return db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  };

  if (db.inTransaction) {
    return applyMovement();
  }

  const transaction = db.transaction(applyMovement);
  return transaction.immediate();
}

export function getStockReconciliationReport(db) {
  return db.prepare(`
    SELECT
      p.id,
      p.sku,
      p.quantity AS current_quantity,
      COALESCE((
        SELECT new_quantity
        FROM stock_movements sm
        WHERE sm.product_id = p.id
        ORDER BY sm.id DESC
        LIMIT 1
      ), 0) AS ledger_quantity,
      CASE
        WHEN p.quantity = COALESCE((
          SELECT new_quantity
          FROM stock_movements sm
          WHERE sm.product_id = p.id
          ORDER BY sm.id DESC
          LIMIT 1
        ), 0)
          THEN 1 ELSE 0
      END AS reconciled
    FROM products p
    ORDER BY p.id
  `).all();
}
