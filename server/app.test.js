import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from './app.js';
import { createDatabase, getStockReconciliationReport, ledgerStockMovement } from './database.js';

describe('StockPilot REST API', () => {
  let db;
  let client;
  beforeEach(() => {
    db = createDatabase(':memory:');
    client = request(createApp({ db }));
  });
  afterEach(() => db.close());

  describe('Purchasing and sales lifecycle APIs', () => {
  let db;
  let client;
  beforeEach(() => {
    db = createDatabase(':memory:');
    client = request(createApp({ db }));
  });
  afterEach(() => db.close());

  async function createSupplier(overrides = {}) {
    const response = await client.post('/api/suppliers').send({
      supplierCode: 'PHASE3-SUP',
      businessName: 'Phase Three Supplier',
      ...overrides,
    });
    assert.equal(response.status, 201);
    return response.body.supplier;
  }

  async function createProduct(overrides = {}) {
    const response = await client.post('/api/products').send({
      sku: 'PHASE3-PROD',
      name: 'Phase Three Item',
      category: 'Purchasing',
      price: 30,
      quantity: 4,
      unitCost: 12,
      ...overrides,
    });
    assert.equal(response.status, 201);
    return response.body.product;
  }

  async function createPurchaseOrder(supplierId, productId, overrides = {}) {
    const response = await client.post('/api/purchase-orders').send({
      supplierId,
      notes: 'Test order',
      items: [{ productId, quantity: 5, unitCost: 10, discountAmount: 2, taxRate: 10 }],
      ...overrides,
    });
    assert.equal(response.status, 201);
    return response.body.purchaseOrder;
  }

  async function submitPurchaseOrder(purchaseOrderId) {
    const response = await client.post(`/api/purchase-orders/${purchaseOrderId}/submit`);
    assert.equal(response.status, 200);
    return response.body.purchaseOrder;
  }

  async function receivePurchaseOrder(purchaseOrderId, receiptNumber, items) {
    return client.post(`/api/purchase-orders/${purchaseOrderId}/receipts`).send({
      receiptNumber,
      items,
    });
  }

  it('creates, edits, submits, filters, and cancels purchase orders with preserved commercial values', async () => {
    const supplier = await createSupplier();
    const product = await createProduct();
    let purchaseOrder = await createPurchaseOrder(supplier.id, product.id);
    assert.equal(purchaseOrder.status, 'draft');
    assert.equal(purchaseOrder.orderNumber, 'PO-00001');
    assert.equal(purchaseOrder.subtotal, 48);
    assert.equal(purchaseOrder.taxTotal, 4.8);
    assert.equal(purchaseOrder.total, 52.8);
    assert.equal(purchaseOrder.items[0].outstandingQuantity, 5);

    const updated = await client.put(`/api/purchase-orders/${purchaseOrder.id}`).send({
      notes: 'Updated draft',
      items: [{ productId: product.id, quantity: 6, unitCost: 10, discountAmount: 0, taxRate: 0 }],
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.purchaseOrder.items[0].orderedQuantity, 6);
    assert.equal(updated.body.purchaseOrder.total, 60);

    purchaseOrder = await submitPurchaseOrder(purchaseOrder.id);
    assert.equal(purchaseOrder.status, 'ordered');
    assert.equal((await client.put(`/api/purchase-orders/${purchaseOrder.id}`).send({ notes: 'Too late' })).status, 409);
    assert.throws(() => {
      db.prepare('UPDATE purchase_order_items SET unit_cost = 999 WHERE id = ?').run(purchaseOrder.items[0].id);
    }, /immutable/i);
    const filtered = await client.get('/api/purchase-orders').query({ status: 'ordered', supplierId: supplier.id, page: 1, pageSize: 1 });
    assert.equal(filtered.body.total, 1);
    assert.equal(filtered.body.purchaseOrders[0].status, 'ordered');
    const cancelled = await client.post(`/api/purchase-orders/${purchaseOrder.id}/cancel`);
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.purchaseOrder.status, 'cancelled');
  });

  it('rejects invalid supplier and product references and invalid purchase commercial values', async () => {
    const supplier = await createSupplier();
    const product = await createProduct();
    assert.equal((await client.post('/api/purchase-orders').send({
      supplierId: 99999,
      items: [{ productId: product.id, quantity: 1, unitCost: 1 }],
    })).status, 400);
    assert.equal((await client.post('/api/purchase-orders').send({
      supplierId: supplier.id,
      items: [{ productId: 99999, quantity: 1, unitCost: 1 }],
    })).status, 400);
    assert.equal((await client.post('/api/purchase-orders').send({
      supplierId: supplier.id,
      items: [{ productId: product.id, quantity: 1, unitCost: 1, discountAmount: 2 }],
    })).status, 400);
    assert.equal((await client.post('/api/purchase-orders').send({
      supplierId: supplier.id,
      items: [{ productId: product.id, quantity: 0, unitCost: -1 }],
    })).status, 400);
  });

  it('receives purchase orders partially and fully with ledger updates, history, and over-receipt prevention', async () => {
    const supplier = await createSupplier();
    const product = await createProduct({ quantity: 3 });
    const purchaseOrder = await createPurchaseOrder(supplier.id, product.id);
    await submitPurchaseOrder(purchaseOrder.id);
    const itemId = purchaseOrder.items[0].id;

    const first = await receivePurchaseOrder(purchaseOrder.id, 'GRN-001', [
      { purchaseOrderItemId: itemId, quantity: 2 },
    ]);
    assert.equal(first.status, 201);
    assert.equal(first.body.purchaseOrder.status, 'partially_received');
    assert.equal(first.body.purchaseOrder.items[0].receivedQuantity, 2);
    assert.equal((await client.get(`/api/products/${product.id}`)).body.product.quantity, 5);

    const duplicate = await receivePurchaseOrder(purchaseOrder.id, 'GRN-001', [
      { purchaseOrderItemId: itemId, quantity: 1 },
    ]);
    assert.equal(duplicate.status, 409);
    const overReceipt = await receivePurchaseOrder(purchaseOrder.id, 'GRN-OVER', [
      { purchaseOrderItemId: itemId, quantity: 4 },
    ]);
    assert.equal(overReceipt.status, 409);
    assert.equal((await client.get(`/api/products/${product.id}`)).body.product.quantity, 5);

    const second = await receivePurchaseOrder(purchaseOrder.id, 'GRN-002', [
      { purchaseOrderItemId: itemId, quantity: 3 },
    ]);
    assert.equal(second.status, 201);
    assert.equal(second.body.purchaseOrder.status, 'received');
    assert.equal(second.body.purchaseOrder.items[0].outstandingQuantity, 0);
    assert.equal((await client.get(`/api/products/${product.id}`)).body.product.quantity, 8);

    const movement = db.prepare(`
      SELECT * FROM stock_movements WHERE product_id = ? AND reference_type = 'goods_receipt'
      ORDER BY id DESC LIMIT 1
    `).get(product.id);
    assert.equal(movement.reference_id, second.body.receipt.id);
    assert.equal(movement.quantity_delta, 3);
    assert.equal(movement.movement_type, 'purchase');

    const receiptList = await client.get('/api/goods-receipts').query({ supplierId: supplier.id, purchaseOrderId: purchaseOrder.id });
    assert.equal(receiptList.body.total, 2);
    assert.equal((await client.get(`/api/goods-receipts/${first.body.receipt.id}`)).body.receipt.items[0].quantity, 2);
    assert.equal((await client.get(`/api/purchase-orders/${purchaseOrder.id}`)).body.purchaseOrder.receipts.length, 2);
    assert.throws(() => {
      db.prepare('UPDATE goods_receipts SET notes = ? WHERE id = ?').run('tampered', first.body.receipt.id);
    }, /immutable/i);
    assert.equal((await client.delete(`/api/products/${product.id}`)).status, 409);
  });

  it('rejects receipts for drafts and cancellations after any goods were received', async () => {
    const supplier = await createSupplier();
    const product = await createProduct();
    const purchaseOrder = await createPurchaseOrder(supplier.id, product.id);
    assert.equal((await receivePurchaseOrder(purchaseOrder.id, 'GRN-DRAFT', [
      { purchaseOrderItemId: purchaseOrder.items[0].id, quantity: 1 },
    ])).status, 409);
    await submitPurchaseOrder(purchaseOrder.id);
    const partial = await receivePurchaseOrder(purchaseOrder.id, 'GRN-PART', [
      { purchaseOrderItemId: purchaseOrder.items[0].id, quantity: 1 },
    ]);
    assert.equal(partial.status, 201);
    assert.equal((await client.post(`/api/purchase-orders/${purchaseOrder.id}/cancel`)).status, 409);
    assert.equal((await client.get(`/api/products/${product.id}`)).body.product.quantity, 5);
  });

  it('rolls back receipt, quantities, and stock when ledger insertion fails', async () => {
    const supplier = await createSupplier();
    const product = await createProduct();
    const purchaseOrder = await createPurchaseOrder(supplier.id, product.id);
    await submitPurchaseOrder(purchaseOrder.id);
    db.exec(`
      CREATE TRIGGER reject_purchase_movement
      BEFORE INSERT ON stock_movements WHEN NEW.reference_type = 'goods_receipt'
      BEGIN SELECT RAISE(ABORT, 'receipt ledger failure'); END;
    `);
    const receipt = await receivePurchaseOrder(purchaseOrder.id, 'GRN-ROLLBACK', [
      { purchaseOrderItemId: purchaseOrder.items[0].id, quantity: 2 },
    ]);
    assert.equal(receipt.status, 500);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM goods_receipts').get().count, 0);
    assert.equal(db.prepare('SELECT received_quantity FROM purchase_order_items WHERE id = ?').get(purchaseOrder.items[0].id).received_quantity, 0);
    assert.equal((await client.get(`/api/products/${product.id}`)).body.product.quantity, 4);
    assert.equal((await client.get(`/api/purchase-orders/${purchaseOrder.id}`)).body.purchaseOrder.status, 'ordered');
  });

  it('preserves immediate confirmed sales compatibility and supports a single-deduction draft lifecycle', async () => {
    const product = await createProduct({ sku: 'SALE-LIFE', quantity: 8 });
    const legacyOrder = await client.post('/api/orders').send({
      items: [{ productId: product.id, quantity: 2 }],
    });
    assert.equal(legacyOrder.status, 201);
    assert.equal(legacyOrder.body.order.status, 'confirmed');
    assert.ok(legacyOrder.body.order.stockDeductedAt);
    assert.equal((await client.get(`/api/products/${product.id}`)).body.product.quantity, 6);

    const legacyMovements = db.prepare(`
      SELECT COUNT(*) AS count FROM stock_movements WHERE reference_type = 'order' AND reference_id = ?
    `).get(legacyOrder.body.order.id).count;
    assert.equal(legacyMovements, 1);
    assert.equal((await client.patch(`/api/orders/${legacyOrder.body.order.id}/status`).send({ status: 'confirmed' })).status, 409);

    const draft = await client.post('/api/orders/drafts').send({
      items: [{ productId: product.id, quantity: 3 }],
    });
    assert.equal(draft.status, 201);
    assert.equal(draft.body.order.status, 'draft');
    assert.equal(draft.body.order.stockDeductedAt, null);
    assert.equal((await client.get(`/api/products/${product.id}`)).body.product.quantity, 6);
    assert.equal((await client.patch(`/api/orders/${draft.body.order.id}/status`).send({ status: 'shipped' })).status, 409);
    const edited = await client.put(`/api/orders/${draft.body.order.id}`).send({
      customerName: 'Updated walk-in',
      items: [{ productId: product.id, quantity: 4 }],
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.order.customerName, 'Updated walk-in');

    const confirmed = await client.patch(`/api/orders/${draft.body.order.id}/status`).send({ status: 'confirmed' });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.order.status, 'confirmed');
    assert.equal((await client.get(`/api/products/${product.id}`)).body.product.quantity, 2);
    const confirmationMovements = db.prepare(`
      SELECT COUNT(*) AS count FROM stock_movements WHERE reference_type = 'order' AND reference_id = ?
    `).get(draft.body.order.id).count;
    assert.equal(confirmationMovements, 1);
  });

  it('prevents insufficient-stock confirmation, restores eligible cancellations, and forbids restoration after fulfillment', async () => {
    const product = await createProduct({ sku: 'CANCEL-LIFE', quantity: 3 });
    const draft = await client.post('/api/orders/drafts').send({
      items: [{ productId: product.id, quantity: 4 }],
    });
    assert.equal(draft.status, 201);
    const insufficient = await client.patch(`/api/orders/${draft.body.order.id}/status`).send({ status: 'confirmed' });
    assert.equal(insufficient.status, 409);
    assert.equal((await client.get(`/api/products/${product.id}`)).body.product.quantity, 3);
    assert.equal((await client.get(`/api/orders/${draft.body.order.id}`)).body.order.status, 'draft');

    const cancellable = await client.post('/api/orders').send({
      items: [{ productId: product.id, quantity: 2 }],
    });
    assert.equal(cancellable.status, 201);
    assert.equal((await client.patch(`/api/orders/${cancellable.body.order.id}/status`).send({ status: 'cancelled' })).status, 200);
    assert.equal((await client.get(`/api/products/${product.id}`)).body.product.quantity, 3);
    const compensation = db.prepare(`
      SELECT * FROM stock_movements WHERE reference_type = 'order_cancellation' AND reference_id = ?
    `).get(cancellable.body.order.id);
    assert.equal(compensation.movement_type, 'return_in');
    assert.equal(compensation.quantity_delta, 2);

    const fulfilled = await client.post('/api/orders').send({
      items: [{ productId: product.id, quantity: 1 }],
    });
    assert.equal(fulfilled.status, 201);
    assert.equal((await client.patch(`/api/orders/${fulfilled.body.order.id}/status`).send({ status: 'processing' })).status, 200);
    assert.equal((await client.patch(`/api/orders/${fulfilled.body.order.id}/status`).send({ status: 'cancelled' })).status, 409);
    assert.equal((await client.get(`/api/products/${product.id}`)).body.product.quantity, 2);
    assert.equal((await client.patch(`/api/orders/${fulfilled.body.order.id}/status`).send({ status: 'shipped' })).status, 200);
    assert.equal((await client.patch(`/api/orders/${fulfilled.body.order.id}/status`).send({ status: 'delivered' })).status, 200);
    assert.equal((await client.patch(`/api/orders/${fulfilled.body.order.id}/status`).send({ status: 'cancelled' })).status, 409);
  });

  it('returns supplier, product and filtered order histories from persisted records', async () => {
    const supplier = await createSupplier();
    const product = await createProduct();
    const purchaseOrder = await createPurchaseOrder(supplier.id, product.id);
    await submitPurchaseOrder(purchaseOrder.id);
    const received = await receivePurchaseOrder(purchaseOrder.id, 'GRN-HISTORY', [
      { purchaseOrderItemId: purchaseOrder.items[0].id, quantity: 2 },
    ]);
    assert.equal(received.status, 201);
    const sale = await client.post('/api/orders').send({ items: [{ productId: product.id, quantity: 1 }] });
    assert.equal(sale.status, 201);

    const supplierDetail = await client.get(`/api/suppliers/${supplier.id}`);
    assert.equal(supplierDetail.body.supplier.purchaseHistory[0].orderNumber, purchaseOrder.orderNumber);
    const productHistory = await client.get(`/api/products/${product.id}/history`);
    assert.equal(productHistory.body.purchases.length, 1);
    assert.equal(productHistory.body.purchases[0].receivedQuantity, 2);
    assert.equal(productHistory.body.sales.length, 1);
    assert.equal(productHistory.body.sales[0].orderNumber, sale.body.order.orderNumber);

    const orders = await client.get('/api/orders').query({ status: 'confirmed', page: 1, pageSize: 1 });
    assert.equal(orders.body.total, 1);
    assert.equal(orders.body.orders[0].id, sale.body.order.id);
  });
  });

  async function createProduct(overrides = {}) {
    const response = await client.post('/api/products').send({
      sku: 'MUG-01',
      name: 'Stoneware Mug',
      category: 'Drinkware',
      price: 18.5,
      quantity: 10,
      lowStockThreshold: 3,
      ...overrides,
    });
    assert.equal(response.status, 201);
    return response.body.product;
  }

  it('creates, lists, searches, updates, and deletes products with validated inputs', async () => {
    const product = await createProduct();
    assert.equal(product.quantity, 10);
    assert.equal(product.lowStockThreshold, 3);

    const duplicate = await client.post('/api/products').send({
      sku: 'mug-01', name: 'Duplicate mug', category: 'Drinkware', price: 1, quantity: 1,
    });
    assert.equal(duplicate.status, 409);

    const invalid = await client.post('/api/products').send({
      sku: 'BAD', name: 'Broken item', category: 'Other', price: -1, quantity: 1,
    });
    assert.equal(invalid.status, 400);

    const search = await client.get('/api/products').query({ q: 'stoneware', category: 'drinkware' });
    assert.equal(search.body.total, 1);
    assert.equal(search.body.products[0].id, product.id);

    const updated = await client.put(`/api/products/${product.id}`).send({ price: 20 });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.product.price, 20);

    const historyProtected = await client.delete(`/api/products/${product.id}`);
    assert.equal(historyProtected.status, 409);

    const emptyProduct = await createProduct({ sku: 'EMPTY-01', quantity: 0 });
    const deleted = await client.delete(`/api/products/${emptyProduct.id}`);
    assert.equal(deleted.status, 204);
  });

  it('updates stock and prevents negative inventory', async () => {
    const product = await createProduct({ sku: 'STOCK-01', quantity: 4 });
    const adjusted = await client.patch(`/api/products/${product.id}/stock`).send({ operation: 'adjust', quantity: -2 });
    assert.equal(adjusted.status, 200);
    assert.equal(adjusted.body.product.quantity, 2);

    const invalid = await client.patch(`/api/products/${product.id}/stock`).send({ operation: 'adjust', quantity: -3 });
    assert.equal(invalid.status, 400);
    assert.equal((await client.get(`/api/products/${product.id}`)).body.product.quantity, 2);
  });

  it('places an order transactionally, snapshots item details, and deducts stock', async () => {
    const mug = await createProduct({ sku: 'ORDER-MUG', quantity: 5, price: 12.5 });
    const bowl = await createProduct({ sku: 'ORDER-BOWL', name: 'Clay Bowl', quantity: 4, price: 24 });
    const placed = await client.post('/api/orders').send({
      customerName: 'Alex Rivera',
      items: [{ productId: mug.id, quantity: 2 }, { productId: bowl.id, quantity: 1 }],
    });

    assert.equal(placed.status, 201);
    assert.equal(placed.body.order.orderNumber, 'SP-00001');
    assert.equal(placed.body.order.total, 49);
    assert.equal(placed.body.order.items.length, 2);
    assert.equal((await client.get(`/api/products/${mug.id}`)).body.product.quantity, 3);

    const conflict = await client.post('/api/orders').send({
      items: [{ productId: mug.id, quantity: 99 }, { productId: bowl.id, quantity: 1 }],
    });
    assert.equal(conflict.status, 409);
    assert.equal((await client.get(`/api/products/${mug.id}`)).body.product.quantity, 3);
    assert.equal((await client.get(`/api/products/${bowl.id}`)).body.product.quantity, 3);

    const blockedDelete = await client.delete(`/api/products/${mug.id}`);
    assert.equal(blockedDelete.status, 409);
  });

  it('reports accurate dashboard summaries and low-stock alerts', async () => {
    const product = await createProduct({ sku: 'LOW-01', quantity: 2, price: 10, lowStockThreshold: 2 });
    const order = await client.post('/api/orders').send({ items: [{ productId: product.id, quantity: 1 }] });
    assert.equal(order.status, 201);
    const dashboard = await client.get('/api/dashboard');
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.productCount, 1);
    assert.equal(dashboard.body.lowStockCount, 1);
    assert.equal(dashboard.body.monthlyOrderCount, 1);
    assert.equal(dashboard.body.monthlyRevenue, 10);
    assert.ok(dashboard.body.lowStockProducts.some((item) => item.id === product.id));
  });

  it('returns zero-valued dashboard summaries for a new workspace', async () => {
    const dashboard = await client.get('/api/dashboard');
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.productCount, 0);
    assert.equal(dashboard.body.inventoryValue, 0);
    assert.equal(dashboard.body.unitsInStock, 0);
    assert.equal(dashboard.body.lowStockCount, 0);
    assert.equal(dashboard.body.monthlyOrderCount, 0);
    assert.equal(dashboard.body.monthlyRevenue, 0);
  });

  it('rejects invalid order bodies and exposes a health endpoint', async () => {
    const invalidOrder = await client.post('/api/orders').send({ items: [] });
    assert.equal(invalidOrder.status, 400);
    assert.equal((await client.get('/api/health')).body.status, 'ok');
  });

  it('limits cross-origin API access, applies security headers, and rejects oversized JSON', async () => {
    const restrictedClient = request(createApp({ db, corsOrigins: 'https://stockpilot.example' }));
    const trusted = await restrictedClient.get('/api/health').set('Origin', 'https://stockpilot.example');
    assert.equal(trusted.status, 200);
    assert.equal(trusted.headers['access-control-allow-origin'], 'https://stockpilot.example');
    assert.equal(trusted.headers['x-content-type-options'], 'nosniff');
    assert.equal(trusted.headers['x-frame-options'], 'DENY');
    assert.equal(trusted.headers['referrer-policy'], 'no-referrer');
    assert.equal(trusted.headers['permissions-policy'], 'camera=(), microphone=(), geolocation=()');
    assert.equal(trusted.headers['x-powered-by'], undefined);

    const untrusted = await restrictedClient.get('/api/health').set('Origin', 'https://untrusted.example');
    assert.equal(untrusted.status, 200);
    assert.equal(untrusted.headers['access-control-allow-origin'], undefined);

    const oversized = await restrictedClient.post('/api/categories')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ name: 'x'.repeat(110_000) }));
    assert.equal(oversized.status, 413);
    assert.match(oversized.body.error, /too large/i);
  });
});

describe('Core business data APIs', () => {
  let db;
  let client;

  beforeEach(() => {
    db = createDatabase(':memory:');
    client = request(createApp({ db, authorizeStockAdjustment: () => true }));
  });

  afterEach(() => db.close());

  async function createProduct(overrides = {}) {
    const response = await client.post('/api/products').send({
      sku: 'PHASE2-01',
      name: 'Phase Two Product',
      category: 'Unassigned',
      price: 25,
      quantity: 10,
      lowStockThreshold: 2,
      ...overrides,
    });
    assert.equal(response.status, 201);
    return response.body.product;
  }

  async function createSupplier(overrides = {}) {
    const response = await client.post('/api/suppliers').send({
      supplierCode: 'SUP-TEST',
      businessName: 'Test Supply Co.',
      email: 'supply@example.test',
      ...overrides,
    });
    assert.equal(response.status, 201);
    return response.body.supplier;
  }

  async function createCustomer(overrides = {}) {
    const response = await client.post('/api/customers').send({
      customerCode: 'CUST-TEST',
      name: 'Test Customer',
      email: 'customer@example.test',
      ...overrides,
    });
    assert.equal(response.status, 201);
    return response.body.customer;
  }

  it('supports category CRUD, case-insensitive duplicate rejection, summaries, and safe deletion', async () => {
    const created = await client.post('/api/categories').send({ name: 'Kitchen', description: 'Kitchen stock' });
    assert.equal(created.status, 201);
    const duplicate = await client.post('/api/categories').send({ name: ' kitchen ' });
    assert.equal(duplicate.status, 409);

    const product = await createProduct({ categoryId: created.body.category.id });
    const legacyProduct = await createProduct({ sku: 'LEGACY-CATEGORY', category: 'Kitchen' });
    const listed = await client.get('/api/categories');
    const category = listed.body.categories.find((entry) => entry.id === created.body.category.id);
    assert.equal(category.productCount, 2);
    assert.equal(category.unitsInStock, 20);
    assert.equal(category.inventoryValue, 500);

    const renamed = await client.put(`/api/categories/${category.id}`).send({ name: 'Kitchenware' });
    assert.equal(renamed.status, 200);
    assert.equal((await client.get(`/api/products/${product.id}`)).body.product.category, 'Kitchenware');
    const linkedLegacyProduct = (await client.get(`/api/products/${legacyProduct.id}`)).body.product;
    assert.equal(linkedLegacyProduct.category, 'Kitchenware');
    assert.equal(linkedLegacyProduct.categoryId, category.id);
    assert.equal((await client.delete(`/api/categories/${category.id}`)).status, 409);

    const unassigned = await client.post('/api/categories').send({ name: 'Unused' });
    assert.equal((await client.delete(`/api/categories/${unassigned.body.category.id}`)).status, 204);
  });

  it('supports supplier CRUD, duplicate-code rejection, validation, and deactivation', async () => {
    const supplier = await createSupplier();
    const duplicate = await client.post('/api/suppliers').send({
      supplierCode: 'sup-test',
      businessName: 'Duplicate Supply',
    });
    assert.equal(duplicate.status, 409);

    const invalid = await client.post('/api/suppliers').send({
      supplierCode: 'SUP-BAD',
      businessName: 'Invalid Supply',
      email: 'not-an-email',
    });
    assert.equal(invalid.status, 400);

    const updated = await client.put(`/api/suppliers/${supplier.id}`).send({ phone: '+1-555-1010' });
    assert.equal(updated.body.supplier.phone, '+1-555-1010');
    assert.equal(updated.body.supplier.purchaseHistory, undefined);
    const deactivated = await client.patch(`/api/suppliers/${supplier.id}/deactivate`);
    assert.equal(deactivated.body.supplier.isActive, false);
    assert.equal((await client.get('/api/suppliers').query({ active: 'false' })).body.total, 1);
    assert.equal((await client.get(`/api/suppliers/${supplier.id}`)).status, 200);
  });

  it('supports customer CRUD, duplicate-code rejection, and preserves customer order history', async () => {
    const customer = await createCustomer();
    const duplicate = await client.post('/api/customers').send({
      customerCode: 'cust-test',
      name: 'Duplicate Customer',
    });
    assert.equal(duplicate.status, 409);

    const invalid = await client.post('/api/customers').send({
      customerCode: 'CUST-BAD',
      name: 'Invalid Customer',
      email: 'invalid',
    });
    assert.equal(invalid.status, 400);

    const product = await createProduct();
    const order = await client.post('/api/orders').send({
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 1 }],
    });
    assert.equal(order.status, 201);
    assert.equal(order.body.order.customerId, customer.id);
    assert.equal(order.body.order.customerName, customer.name);

    const updated = await client.put(`/api/customers/${customer.id}`).send({ phone: '+1-555-2020' });
    assert.equal(updated.body.customer.phone, '+1-555-2020');
    const detail = await client.get(`/api/customers/${customer.id}`);
    assert.equal(detail.body.customer.orderHistory.length, 1);
    assert.equal(detail.body.customer.orderHistory[0].orderNumber, order.body.order.orderNumber);

    const deactivated = await client.patch(`/api/customers/${customer.id}/deactivate`);
    assert.equal(deactivated.body.customer.isActive, false);
    const blockedOrder = await client.post('/api/orders').send({
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 1 }],
    });
    assert.equal(blockedOrder.status, 409);
  });

  it('validates product relationships and supports metadata, search, sorting, filters, and pagination', async () => {
    const category = (await client.post('/api/categories').send({ name: 'Metadata Category' })).body.category;
    const supplier = await createSupplier({ supplierCode: 'SUP-META', businessName: 'Metadata Supply' });
    const first = await createProduct({
      sku: 'META-A',
      name: 'Alpha Product',
      categoryId: category.id,
      supplierId: supplier.id,
      description: 'Searchable sample',
      unitCost: 4.25,
      maxStock: 50,
      unitOfMeasure: 'box',
      isActive: false,
    });
    await createProduct({ sku: 'META-B', name: 'Beta Product', categoryId: category.id, supplierId: supplier.id });

    assert.equal(first.description, 'Searchable sample');
    assert.equal(first.unitCost, 4.25);
    assert.equal(first.maxStock, 50);
    assert.equal(first.unitOfMeasure, 'box');
    assert.equal(first.isActive, false);

    const invalidCategory = await client.post('/api/products').send({
      sku: 'BAD-CAT', name: 'Bad Category', category: 'No category',
      price: 1, quantity: 1, categoryId: 99999,
    });
    const invalidSupplier = await client.post('/api/products').send({
      sku: 'BAD-SUP', name: 'Bad Supplier', category: 'No supplier',
      price: 1, quantity: 1, supplierId: 99999,
    });
    assert.equal(invalidCategory.status, 400);
    assert.equal(invalidSupplier.status, 400);

    const results = await client.get('/api/products').query({
      q: 'searchable',
      categoryId: category.id,
      supplierId: supplier.id,
      active: 'false',
      page: 1,
      pageSize: 1,
      sort: 'sku',
      direction: 'desc',
    });
    assert.equal(results.body.total, 1);
    assert.equal(results.body.products[0].id, first.id);
    assert.equal(results.body.page, 1);

    const firstPage = await client.get('/api/products').query({
      categoryId: category.id,
      supplierId: supplier.id,
      page: 1,
      pageSize: 1,
      sort: 'sku',
      direction: 'desc',
    });
    const secondPage = await client.get('/api/products').query({
      categoryId: category.id,
      supplierId: supplier.id,
      page: 2,
      pageSize: 1,
      sort: 'sku',
      direction: 'desc',
    });
    assert.equal(firstPage.body.total, 2);
    assert.equal(firstPage.body.products[0].sku, 'META-B');
    assert.equal(secondPage.body.products[0].sku, 'META-A');

    const updated = await client.put(`/api/products/${first.id}`).send({ unitCost: 5 });
    assert.equal(updated.body.product.unitCost, 5);
  });

  it('updates product metadata with nullable fields and keeps quantity changes reconciled', async () => {
    const category = (await client.post('/api/categories').send({ name: 'Update Category' })).body.category;
    const supplier = await createSupplier({ supplierCode: 'SUP-UPDATE' });
    const duplicate = await createProduct({ sku: 'OTHER-UPDATE' });
    const product = await createProduct({
      sku: 'UPDATE-ME',
      categoryId: category.id,
      supplierId: supplier.id,
      description: 'Original description',
      unitCost: 4.5,
      maxStock: 30,
      unitOfMeasure: 'box',
    });
    const updated = await client.put(`/api/products/${product.id}`).send({
      sku: 'UPDATED-SKU',
      name: 'Updated product',
      category: 'Updated category',
      price: 32.5,
      quantity: 13,
      lowStockThreshold: 4,
      description: null,
      categoryId: null,
      supplierId: null,
      unitCost: null,
      maxStock: null,
      unitOfMeasure: null,
      isActive: false,
    });
    assert.equal(updated.status, 200);
    assert.deepEqual({
      sku: updated.body.product.sku,
      name: updated.body.product.name,
      category: updated.body.product.category,
      price: updated.body.product.price,
      quantity: updated.body.product.quantity,
      lowStockThreshold: updated.body.product.lowStockThreshold,
      description: updated.body.product.description,
      categoryId: updated.body.product.categoryId,
      supplierId: updated.body.product.supplierId,
      unitCost: updated.body.product.unitCost,
      maxStock: updated.body.product.maxStock,
      unitOfMeasure: updated.body.product.unitOfMeasure,
      isActive: updated.body.product.isActive,
    }, {
      sku: 'UPDATED-SKU',
      name: 'Updated product',
      category: 'Updated category',
      price: 32.5,
      quantity: 13,
      lowStockThreshold: 4,
      description: null,
      categoryId: null,
      supplierId: null,
      unitCost: null,
      maxStock: null,
      unitOfMeasure: null,
      isActive: false,
    });

    const movement = db.prepare(`
      SELECT movement_type, quantity_delta, previous_quantity, new_quantity
      FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1
    `).get(product.id);
    assert.deepEqual(movement, {
      movement_type: 'adjustment',
      quantity_delta: 3,
      previous_quantity: 10,
      new_quantity: 13,
    });
    assert.equal(getStockReconciliationReport(db).find((row) => row.id === product.id).reconciled, 1);

    const invalidPrice = await client.put(`/api/products/${product.id}`).send({ price: -1 });
    assert.equal(invalidPrice.status, 400);
    const invalidQuantity = await client.put(`/api/products/${product.id}`).send({ quantity: -1 });
    assert.equal(invalidQuantity.status, 400);
    const invalidCategory = await client.put(`/api/products/${product.id}`).send({ categoryId: 99999 });
    assert.equal(invalidCategory.status, 400);
    const invalidSupplier = await client.put(`/api/products/${product.id}`).send({ supplierId: 99999 });
    assert.equal(invalidSupplier.status, 400);
    const duplicateSku = await client.put(`/api/products/${product.id}`).send({ sku: duplicate.sku });
    assert.equal(duplicateSku.status, 409);
    const responseOnlyFields = await client.put(`/api/products/${product.id}`).send({
      id: product.id,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      price: 35,
    });
    assert.equal(responseOnlyFields.status, 400);
    assert.equal((await client.get(`/api/products/${product.id}`)).body.product.price, 32.5);
    assert.equal((await client.get(`/api/products/${product.id}`)).body.product.quantity, 13);
  });

  it('records authorized stock adjustments, rejects negative stock, and exposes immutable history', async () => {
    const product = await createProduct({ sku: 'LEDGER-01', quantity: 5 });
    const denied = await request(createApp({ db, authorizeStockAdjustment: () => false })).post(`/api/products/${product.id}/stock-adjustments`).send({
      quantityDelta: 1,
      reason: 'Cycle count correction',
    });
    assert.equal(denied.status, 403);

    const adjusted = await client.post(`/api/products/${product.id}/stock-adjustments`).send({
      quantityDelta: -2,
      reason: 'Cycle count correction',
      notes: 'Two damaged units',
    });
    assert.equal(adjusted.status, 201);
    assert.equal(adjusted.body.product.quantity, 3);
    assert.equal(adjusted.body.movement.previousQuantity, 5);
    assert.equal(adjusted.body.movement.resultingQuantity, 3);
    assert.equal(adjusted.body.movement.reason, 'Cycle count correction');

    const rejected = await client.post(`/api/products/${product.id}/stock-adjustments`).send({
      quantityDelta: -4,
      reason: 'Invalid count',
    });
    assert.equal(rejected.status, 409);
    assert.equal((await client.get(`/api/products/${product.id}`)).body.product.quantity, 3);

    const history = await client.get(`/api/products/${product.id}/stock-movements`);
    assert.equal(history.body.total, 2);
    assert.equal(history.body.movements[0].movementType, 'adjustment');
    assert.equal((await client.delete(`/api/products/${product.id}`)).status, 409);
  });

  it('rolls back a product and stock ledger insert together when ledger insertion fails', async () => {
    const existingProduct = await createProduct({ sku: 'ROLLBACK-ORDER', quantity: 4 });
    db.exec(`
      CREATE TRIGGER reject_stock_movement
      BEFORE INSERT ON stock_movements
      BEGIN
        SELECT RAISE(ABORT, 'test ledger failure');
      END;
    `);
    const movementsBefore = db.prepare('SELECT COUNT(*) AS count FROM stock_movements').get().count;

    const response = await client.post('/api/products').send({
      sku: 'ROLLBACK-01',
      name: 'Rollback Product',
      category: 'Testing',
      price: 2,
      quantity: 4,
    });
    assert.equal(response.status, 500);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products WHERE sku = ?').get('ROLLBACK-01').count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM stock_movements').get().count, movementsBefore);

    const orderResponse = await client.post('/api/orders').send({
      items: [{ productId: existingProduct.id, quantity: 2 }],
    });
    assert.equal(orderResponse.status, 500);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM order_items').get().count, 0);
    assert.equal((await client.get(`/api/products/${existingProduct.id}`)).body.product.quantity, 4);
  });
});

describe('Invoices, payments, returns, and refunds', () => {
  let db;
  let client;

  beforeEach(() => {
    db = createDatabase(':memory:');
    client = request(createApp({ db }));
  });

  afterEach(() => db.close());

  async function createProduct(overrides = {}) {
    const response = await client.post('/api/products').send({
      sku: 'FINANCIAL-01',
      name: 'Financial Test Item',
      category: 'Testing',
      price: 10,
      quantity: 20,
      ...overrides,
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body.product;
  }

  async function createCustomer(overrides = {}) {
    const response = await client.post('/api/customers').send({
      customerCode: 'FIN-CUSTOMER',
      name: 'Financial Customer',
      email: 'financial@example.test',
      address: '10 Ledger Lane',
      ...overrides,
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body.customer;
  }

  async function createSale(product, quantity, customerId) {
    const response = await client.post('/api/orders').send({
      ...(customerId ? { customerId } : {}),
      items: [{ productId: product.id, quantity }],
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body.order;
  }

  async function issueInvoice(order, invoiceOverrides = {}) {
    const created = await client.post('/api/invoices').send({ orderId: order.id, ...invoiceOverrides });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const issued = await client.post(`/api/invoices/${created.body.invoice.id}/issue`);
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    return issued.body.invoice;
  }

  function returnPayload(order, orderItemId, overrides = {}) {
    return {
      orderId: order.id,
      reason: 'Customer returned the item',
      items: [{
        orderItemId,
        quantity: 1,
        restockable: true,
        restockReason: 'Inspected and suitable for resale',
      }],
      ...overrides,
    };
  }

  it('creates and issues immutable invoice snapshots and enforces invoice eligibility/idempotency', async () => {
    const product = await createProduct({ price: 12.34 });
    const customer = await createCustomer();
    const order = await createSale(product, 2, customer.id);
    const created = await client.post('/api/invoices').send({
      orderId: order.id,
      dueDate: '2026-11-01T00:00:00.000Z',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const invoiceId = created.body.invoice.id;
    assert.equal(created.body.invoice.status, 'draft');
    assert.equal(created.body.invoice.invoiceNumber, 'INV-00001');
    assert.equal(created.body.invoice.subtotal, 24.68);
    assert.equal(created.body.invoice.discountTotal, 0);
    assert.equal(created.body.invoice.taxTotal, 0);
    assert.equal(created.body.invoice.total, 24.68);
    assert.equal(created.body.invoice.items[0].quantity, 2);
    assert.equal(created.body.invoice.customerName, customer.name);
    assert.equal(created.body.invoice.billingAddress, customer.address);

    assert.equal((await client.post('/api/invoices').send({ orderId: order.id })).status, 409);
    assert.equal((await client.post(`/api/invoices/${invoiceId}/issue`)).status, 200);
    assert.equal((await client.post(`/api/invoices/${invoiceId}/issue`)).status, 409);
    await client.put(`/api/products/${product.id}`).send({ name: 'Renamed Item', price: 99 });
    await client.put(`/api/customers/${customer.id}`).send({
      name: 'Updated Customer',
      email: 'updated@example.test',
      address: 'Updated address',
    });
    assert.throws(() => db.prepare('UPDATE invoices SET total = 1 WHERE id = ?').run(invoiceId), /immutable/i);
    assert.throws(() => db.prepare('UPDATE invoice_items SET unit_price = 1 WHERE invoice_id = ?').run(invoiceId), /immutable/i);
    const detail = await client.get(`/api/invoices/${invoiceId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.invoice.customerName, 'Financial Customer');
    assert.equal(detail.body.invoice.customerEmail, 'financial@example.test');
    assert.equal(detail.body.invoice.billingAddress, '10 Ledger Lane');
    assert.equal(detail.body.invoice.items[0].productName, 'Financial Test Item');
    assert.equal(detail.body.invoice.items[0].unitPrice, 12.34);
    const filtered = await client.get('/api/invoices').query({ status: 'issued', customerId: customer.id, page: 1, pageSize: 1 });
    assert.equal(filtered.body.total, 1);
    assert.equal(filtered.body.invoices[0].invoiceNumber, 'INV-00001');
    assert.equal((await client.post(`/api/invoices/${invoiceId}/void`)).body.invoice.status, 'void');
    const replacement = await client.post('/api/invoices').send({ orderId: order.id, invoiceNumber: 'INV-REISSUED' });
    assert.equal(replacement.status, 201);

    const draft = await client.post('/api/orders/drafts').send({ items: [{ productId: product.id, quantity: 1 }] });
    assert.equal(draft.status, 201);
    assert.equal((await client.post('/api/invoices').send({ orderId: draft.body.order.id })).status, 409);
    await client.patch(`/api/orders/${draft.body.order.id}/status`).send({ status: 'cancelled' });
    assert.equal((await client.post('/api/invoices').send({ orderId: draft.body.order.id })).status, 409);
    assert.equal(db.pragma('foreign_key_check').length, 0);
  });

  it('records partial/full/failed payments, prevents overpayment and duplicate references, and reverses safely', async () => {
    const product = await createProduct();
    const order = await createSale(product, 4);
    const invoice = await issueInvoice(order);
    assert.equal(invoice.total, 40);
    const orderDetail = await client.get(`/api/orders/${order.id}`);
    assert.equal(orderDetail.body.order.items[0].orderItemId, db.prepare('SELECT id FROM order_items WHERE order_id = ?').get(order.id).id);

    assert.equal((await client.post(`/api/invoices/${invoice.id}/payments`).send({
      amount: 0,
      method: 'cash',
    })).status, 400);
    assert.equal((await client.post(`/api/invoices/${invoice.id}/payments`).send({
      amount: -1,
      method: 'cash',
    })).status, 400);
    const failed = await client.post(`/api/invoices/${invoice.id}/payments`).send({
      amount: 5,
      method: 'card',
      status: 'failed',
      externalReference: 'PAY-FAILED-01',
    });
    assert.equal(failed.status, 201);
    assert.equal((await client.get(`/api/invoices/${invoice.id}`)).body.invoice.completedPayments, 0);
    assert.equal((await client.get(`/api/invoices/${invoice.id}`)).body.invoice.outstandingBalance, 40);

    const first = await client.post(`/api/invoices/${invoice.id}/payments`).send({
      amount: 15,
      method: 'card',
      externalReference: 'PAY-EXT-01',
    });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    let details = (await client.get(`/api/invoices/${invoice.id}`)).body;
    assert.equal(details.invoice.status, 'partially_paid');
    assert.equal(details.invoice.completedPayments, 15);
    assert.equal(details.invoice.outstandingBalance, 25);
    assert.equal((await client.post(`/api/invoices/${invoice.id}/payments`).send({
      amount: 1,
      method: 'card',
      externalReference: 'PAY-EXT-01',
    })).status, 409);
    assert.equal((await client.post(`/api/invoices/${invoice.id}/payments`).send({
      amount: 26,
      method: 'cash',
    })).status, 409);

    const second = await client.post(`/api/invoices/${invoice.id}/payments`).send({
      amount: 25,
      method: 'cash',
      paymentReference: 'PAY-FINAL-01',
    });
    assert.equal(second.status, 201);
    details = (await client.get(`/api/invoices/${invoice.id}`)).body;
    assert.equal(details.invoice.status, 'paid');
    assert.equal(details.invoice.outstandingBalance, 0);
    assert.equal(details.payments.length, 3);
    assert.equal((await client.get('/api/payments').query({ invoiceId: invoice.id, status: 'failed' })).body.total, 1);

    const reversed = await client.post(`/api/payments/${first.body.payment.id}/reverse`);
    assert.equal(reversed.status, 200);
    assert.equal(reversed.body.payment.status, 'reversed');
    details = (await client.get(`/api/invoices/${invoice.id}`)).body;
    assert.equal(details.invoice.status, 'partially_paid');
    assert.equal(details.invoice.completedPayments, 25);
    assert.equal(details.invoice.outstandingBalance, 15);
    assert.equal((await client.post(`/api/payments/${first.body.payment.id}/reverse`)).status, 409);

    const concurrentInvoice = await issueInvoice(await createSale(product, 2));
    const attempts = await Promise.all([1, 2].map(() => client.post(`/api/invoices/${concurrentInvoice.id}/payments`).send({
      amount: 15,
      method: 'cash',
    })));
    assert.deepEqual(attempts.map((response) => response.status).sort(), [201, 409]);
    assert.equal((await client.get(`/api/invoices/${concurrentInvoice.id}`)).body.invoice.completedPayments, 15);
  });

  it('accepts bounded returns, restocks only eligible lines once, and records partial/full refunds', async () => {
    const product = await createProduct({ quantity: 10 });
    const order = await createSale(product, 4);
    const orderItemId = db.prepare('SELECT id FROM order_items WHERE order_id = ?').get(order.id).id;
    const invoice = await issueInvoice(order);
    const payment = await client.post(`/api/invoices/${invoice.id}/payments`).send({
      amount: 40,
      method: 'card',
    });
    assert.equal(payment.status, 201);
    const stockAfterSale = (await client.get(`/api/products/${product.id}`)).body.product.quantity;

    const first = await client.post('/api/returns').send(returnPayload(order, orderItemId, { invoiceId: invoice.id }));
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.salesReturn.status, 'draft');
    const firstId = first.body.salesReturn.id;
    const accepted = await client.post(`/api/returns/${firstId}/complete`).send({ status: 'accepted' });
    assert.equal(accepted.status, 200);
    assert.equal((await client.get(`/api/products/${product.id}`)).body.product.quantity, stockAfterSale + 1);
    const movementCount = db.prepare(`
      SELECT COUNT(*) AS count FROM stock_movements
      WHERE reference_type = 'sales_return' AND reference_id = ?
    `).get(firstId).count;
    assert.equal(movementCount, 1);
    assert.equal((await client.post(`/api/returns/${firstId}/complete`).send({ status: 'accepted' })).status, 409);
    assert.equal(db.prepare(`
      SELECT COUNT(*) AS count FROM stock_movements
      WHERE reference_type = 'sales_return' AND reference_id = ?
    `).get(firstId).count, 1);
    assert.ok(getStockReconciliationReport(db).every((row) => row.reconciled === 1));

    const second = await client.post('/api/returns').send(returnPayload(order, orderItemId, {
      invoiceId: invoice.id,
      items: [{
        orderItemId,
        quantity: 2,
        restockable: false,
        restockReason: 'Packaging was opened',
      }],
    }));
    assert.equal(second.status, 201);
    assert.equal((await client.post(`/api/returns/${second.body.salesReturn.id}/complete`).send({ status: 'accepted' })).status, 200);
    assert.equal((await client.get(`/api/products/${product.id}`)).body.product.quantity, stockAfterSale + 1);

    const overReturn = await client.post('/api/returns').send(returnPayload(order, orderItemId, {
      invoiceId: invoice.id,
      items: [{
        orderItemId,
        quantity: 2,
        restockable: false,
        restockReason: 'Excess quantity attempt',
      }],
    }));
    assert.equal(overReturn.status, 409);

    const failedRefund = await client.post(`/api/returns/${firstId}/refunds`).send({
      paymentId: payment.body.payment.id,
      amount: 3,
      method: 'card',
    });
    assert.equal(failedRefund.status, 201);
    assert.equal((await client.post(`/api/refunds/${failedRefund.body.refund.id}/fail`)).status, 200);
    let invoiceDetails = (await client.get(`/api/invoices/${invoice.id}`)).body.invoice;
    assert.equal(invoiceDetails.completedRefunds, 0);

    const partialRefund = await client.post(`/api/returns/${firstId}/refunds`).send({
      paymentId: payment.body.payment.id,
      amount: 6,
      method: 'card',
      externalReference: 'REFUND-EXT-01',
    });
    assert.equal(partialRefund.status, 201);
    assert.equal((await client.post(`/api/refunds/${partialRefund.body.refund.id}/complete`)).status, 200);
    assert.equal((await client.post(`/api/refunds/${partialRefund.body.refund.id}/complete`)).status, 409);
    assert.equal((await client.post(`/api/returns/${firstId}/refunds`).send({
      paymentId: payment.body.payment.id,
      amount: 5,
      method: 'card',
    })).status, 409);
    const finalRefund = await client.post(`/api/returns/${firstId}/refunds`).send({
      paymentId: payment.body.payment.id,
      amount: 4,
      method: 'card',
    });
    assert.equal(finalRefund.status, 201);
    assert.equal((await client.post(`/api/refunds/${finalRefund.body.refund.id}/complete`)).status, 200);
    const secondReturnRefund = await client.post(`/api/returns/${second.body.salesReturn.id}/refunds`).send({
      paymentId: payment.body.payment.id,
      amount: 20,
      method: 'card',
    });
    assert.equal(secondReturnRefund.status, 201);
    assert.equal((await client.post(`/api/refunds/${secondReturnRefund.body.refund.id}/complete`)).status, 200);

    invoiceDetails = (await client.get(`/api/invoices/${invoice.id}`)).body.invoice;
    assert.equal(invoiceDetails.acceptedReturnCredits, 30);
    assert.equal(invoiceDetails.completedPayments, 40);
    assert.equal(invoiceDetails.completedRefunds, 30);
    assert.equal(invoiceDetails.outstandingBalance, 0);
    assert.equal(invoiceDetails.netCashRetained, 10);
    assert.equal((await client.get('/api/returns').query({ invoiceId: invoice.id, status: 'accepted' })).body.total, 2);
    assert.equal((await client.get('/api/refunds').query({ invoiceId: invoice.id, status: 'completed' })).body.total, 3);
    assert.equal((await client.get(`/api/returns/${firstId}`)).body.salesReturn.refundableBalance, 0);
  });

  it('caps refunds at both the accepted credit and money collected from the selected payment', async () => {
    const product = await createProduct();
    const order = await createSale(product, 2);
    const orderItemId = db.prepare('SELECT id FROM order_items WHERE order_id = ?').get(order.id).id;
    const invoice = await issueInvoice(order);
    const payment = await client.post(`/api/invoices/${invoice.id}/payments`).send({
      amount: 5,
      method: 'cash',
    });
    assert.equal(payment.status, 201);
    const salesReturn = await client.post('/api/returns').send(returnPayload(order, orderItemId, {
      invoiceId: invoice.id,
      items: [{
        orderItemId,
        quantity: 1,
        restockable: false,
        restockReason: 'Customer retained damaged packaging',
      }],
    }));
    assert.equal(salesReturn.status, 201);
    assert.equal((await client.post(`/api/returns/${salesReturn.body.salesReturn.id}/complete`).send({ status: 'accepted' })).status, 200);
    assert.equal((await client.post(`/api/returns/${salesReturn.body.salesReturn.id}/refunds`).send({
      paymentId: payment.body.payment.id,
      amount: 6,
      method: 'cash',
    })).status, 409);
    const refund = await client.post(`/api/returns/${salesReturn.body.salesReturn.id}/refunds`).send({
      paymentId: payment.body.payment.id,
      amount: 5,
      method: 'cash',
      externalReference: 'REFUND-ONCE',
    });
    assert.equal(refund.status, 201);
    assert.equal((await client.post(`/api/returns/${salesReturn.body.salesReturn.id}/refunds`).send({
      paymentId: payment.body.payment.id,
      amount: 1,
      method: 'cash',
      externalReference: 'REFUND-ONCE',
    })).status, 409);
    assert.equal((await client.post(`/api/refunds/${refund.body.refund.id}/complete`)).status, 200);
    const invoiceDetails = (await client.get(`/api/invoices/${invoice.id}`)).body.invoice;
    assert.equal(invoiceDetails.completedRefunds, 5);
    assert.equal(invoiceDetails.unsettledReturnCredit, 5);
    assert.equal(invoiceDetails.outstandingBalance, 5);
    assert.equal(invoiceDetails.paymentStatus, 'partial');
  });

  it('prevents cancellation/returns from restoring the same units and rolls back return acceptance on ledger failure', async () => {
    const product = await createProduct({ quantity: 10 });
    const order = await createSale(product, 2);
    const orderItemId = db.prepare('SELECT id FROM order_items WHERE order_id = ?').get(order.id).id;
    const invoice = await issueInvoice(order);
    assert.equal((await client.patch(`/api/orders/${order.id}/status`).send({ status: 'cancelled' })).status, 409);
    const salesReturn = await client.post('/api/returns').send(returnPayload(order, orderItemId, { invoiceId: invoice.id }));
    assert.equal(salesReturn.status, 201);
    const returnId = salesReturn.body.salesReturn.id;
    const stockBefore = (await client.get(`/api/products/${product.id}`)).body.product.quantity;
    db.exec(`
      CREATE TRIGGER test_return_ledger_failure
      BEFORE INSERT ON stock_movements
      WHEN NEW.reference_type = 'sales_return'
      BEGIN SELECT RAISE(ABORT, 'return ledger failure'); END;
    `);
    const failedCompletion = await client.post(`/api/returns/${returnId}/complete`).send({ status: 'accepted' });
    assert.equal(failedCompletion.status, 500);
    assert.equal((await client.get(`/api/products/${product.id}`)).body.product.quantity, stockBefore);
    assert.equal((await client.get(`/api/returns/${returnId}`)).body.salesReturn.status, 'draft');
    assert.equal(db.prepare(`
      SELECT COUNT(*) AS count FROM stock_movements
      WHERE reference_type = 'sales_return' AND reference_id = ?
    `).get(returnId).count, 0);
    db.exec('DROP TRIGGER test_return_ledger_failure');
    assert.equal((await client.post(`/api/returns/${returnId}/complete`).send({ status: 'accepted' })).status, 200);
    assert.equal((await client.patch(`/api/orders/${order.id}/status`).send({ status: 'cancelled' })).status, 409);
    assert.equal(db.pragma('foreign_key_check').length, 0);

    const uncapturedOrder = await createSale(product, 1);
    assert.equal((await client.patch(`/api/orders/${uncapturedOrder.id}/status`).send({ status: 'cancelled' })).status, 200);
    const canceledItemId = db.prepare('SELECT id FROM order_items WHERE order_id = ?').get(uncapturedOrder.id).id;
    assert.equal((await client.post('/api/returns').send(returnPayload(uncapturedOrder, canceledItemId))).status, 409);
  });

  it('rejects invalid financial foreign keys and returns consistent filtered histories', async () => {
    const product = await createProduct();
    const order = await createSale(product, 1);
    const invoice = await issueInvoice(order);
    const payment = await client.post(`/api/invoices/${invoice.id}/payments`).send({
      amount: 10,
      method: 'cash',
    });
    assert.equal(payment.status, 201);
    const orderItemId = db.prepare('SELECT id FROM order_items WHERE order_id = ?').get(order.id).id;
    const salesReturn = await client.post('/api/returns').send(returnPayload(order, orderItemId, { invoiceId: invoice.id }));
    assert.equal(salesReturn.status, 201);
    assert.equal((await client.post(`/api/returns/${salesReturn.body.salesReturn.id}/complete`).send({ status: 'accepted' })).status, 200);

    assert.throws(() => db.prepare(`
      INSERT INTO invoice_items (
        invoice_id, order_item_id, product_id, product_name, sku, quantity,
        unit_price, subtotal, discount_amount, tax_amount, total
      ) VALUES (999, 999, 999, 'invalid', 'invalid', 1, 1, 1, 0, 0, 1)
    `).run(), /FOREIGN KEY|SQLITE_CONSTRAINT_FOREIGNKEY/);
    assert.throws(() => db.prepare(`
      INSERT INTO payments (invoice_id, payment_reference, amount, method, status, payment_date)
      VALUES (999, 'BAD-PAYMENT', 1, 'cash', 'completed', '2026-10-24T00:00:00.000Z')
    `).run(), /FOREIGN KEY|SQLITE_CONSTRAINT_FOREIGNKEY/);
    assert.throws(() => db.prepare(`
      INSERT INTO sales_returns (return_number, order_id, customer_name, return_date, reason, status)
      VALUES ('BAD-RETURN', 999, 'Invalid', '2026-10-24T00:00:00.000Z', 'Foreign key check', 'draft')
    `).run(), /FOREIGN KEY|SQLITE_CONSTRAINT_FOREIGNKEY/);
    assert.throws(() => db.prepare(`
      INSERT INTO refunds (
        refund_reference, return_id, invoice_id, payment_id, amount, method, status
      ) VALUES ('BAD-REFUND', 999, ?, ?, 1, 'cash', 'requested')
    `).run(invoice.id, payment.body.payment.id), /FOREIGN KEY|SQLITE_CONSTRAINT_FOREIGNKEY/);
    assert.equal((await client.post('/api/invoices/999/payments').send({ amount: 1, method: 'cash' })).status, 404);
    assert.equal((await client.get('/api/refunds/999')).status, 404);
    assert.equal((await client.get('/api/invoices').query({ page: 1, pageSize: 1 })).body.total, 1);
    assert.equal((await client.get('/api/payments').query({ invoiceId: invoice.id, status: 'completed' })).body.total, 1);
    assert.equal((await client.get('/api/returns').query({ orderId: order.id, status: 'accepted' })).body.total, 1);
    assert.equal((await client.get(`/api/invoices/${invoice.id}`)).body.returns[0].returnNumber, salesReturn.body.salesReturn.returnNumber);
    assert.equal(db.pragma('foreign_key_check').length, 0);
  });
});

describe('Database foundation', () => {
  it('requires production databases to be explicitly provisioned and avoids production seeding', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockpilot-production-db-'));
    const dbPath = path.join(dir, 'production.db');
    const previousNodeEnv = process.env.NODE_ENV;
    const previousDatabasePath = process.env.DATABASE_PATH;

    process.env.NODE_ENV = 'production';
    try {
      delete process.env.DATABASE_PATH;
      assert.throws(() => createDatabase(), /requires an explicit DATABASE_PATH/);

      process.env.DATABASE_PATH = dbPath;
      assert.throws(() => createDatabase(), /does not exist or is empty/);
      assert.throws(() => createDatabase(':memory:'), /cannot use an in-memory/);

      const db = createDatabase(dbPath, { allowCreate: true, seed: false });
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products').get().count, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM categories').get().count, 0);
      db.close();
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previousDatabasePath;
    }
  });

  it('initializes the schema, migration metadata, and deterministic seed data', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockpilot-seed-'));
    const dbPath = path.join(dir, 'stockpilot.db');
    const db = createDatabase(dbPath);

    assert.equal(db.pragma('foreign_keys')[0].foreign_keys, 1);
    assert.ok(db.prepare('SELECT 1 FROM schema_migrations LIMIT 1').get());

    const migrationCount = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count;
    assert.equal(migrationCount, 7);
    for (const table of ['invoices', 'invoice_items', 'payments', 'sales_returns', 'sales_return_items', 'refunds']) {
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
    }

    const productCount = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
    const categoryCount = db.prepare('SELECT COUNT(*) AS count FROM categories').get().count;
    const supplierCount = db.prepare('SELECT COUNT(*) AS count FROM suppliers').get().count;
    const customerCount = db.prepare('SELECT COUNT(*) AS count FROM customers').get().count;
    const stockMovementCount = db.prepare('SELECT COUNT(*) AS count FROM stock_movements').get().count;

    assert.ok(productCount >= 2);
    assert.ok(categoryCount >= 1);
    assert.ok(supplierCount >= 1);
    assert.ok(customerCount >= 1);
    assert.ok(stockMovementCount >= 2);

    const seededSku = db.prepare('SELECT sku FROM products WHERE sku = ? COLLATE NOCASE').get('MUG-001');
    assert.ok(seededSku);
    const counts = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM categories) AS categories,
        (SELECT COUNT(*) FROM suppliers) AS suppliers,
        (SELECT COUNT(*) FROM customers) AS customers,
        (SELECT COUNT(*) FROM products) AS products,
        (SELECT COUNT(*) FROM stock_movements) AS movements
    `).get();
    db.close();

    const reopenedDb = createDatabase(dbPath);
    const reopenedCounts = reopenedDb.prepare(`
      SELECT
        (SELECT COUNT(*) FROM categories) AS categories,
        (SELECT COUNT(*) FROM suppliers) AS suppliers,
        (SELECT COUNT(*) FROM customers) AS customers,
        (SELECT COUNT(*) FROM products) AS products,
        (SELECT COUNT(*) FROM stock_movements) AS movements
    `).get();
    assert.deepEqual(reopenedCounts, counts);
    reopenedDb.close();
  });

  it('adds analytics date indexes from the prior schema version without changing records', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockpilot-v7-'));
    const dbPath = path.join(dir, 'stockpilot.db');
    const initialDb = createDatabase(dbPath);
    const before = initialDb.prepare(`
      SELECT
        (SELECT COUNT(*) FROM products) AS products,
        (SELECT COUNT(*) FROM stock_movements) AS movements,
        (SELECT sku FROM products WHERE sku = 'MUG-001') AS seededSku
    `).get();
    initialDb.exec(`
      DROP INDEX idx_stock_movements_created_at;
      DROP INDEX idx_goods_receipts_received_at;
      DROP INDEX idx_invoices_date_status;
      DROP INDEX idx_payments_date_status;
      DROP INDEX idx_sales_returns_date_status;
      DROP INDEX idx_refunds_created_status;
      DROP INDEX idx_refunds_completed_status;
      DELETE FROM schema_migrations WHERE version = 7;
    `);
    initialDb.close();

    const migratedDb = createDatabase(dbPath);
    const after = migratedDb.prepare(`
      SELECT
        (SELECT COUNT(*) FROM products) AS products,
        (SELECT COUNT(*) FROM stock_movements) AS movements,
        (SELECT sku FROM products WHERE sku = 'MUG-001') AS seededSku
    `).get();
    assert.deepEqual(after, before);
    assert.equal(migratedDb.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 7);
    for (const indexName of [
      'idx_stock_movements_created_at',
      'idx_goods_receipts_received_at',
      'idx_invoices_date_status',
      'idx_payments_date_status',
      'idx_sales_returns_date_status',
      'idx_refunds_created_status',
      'idx_refunds_completed_status',
    ]) {
      assert.ok(migratedDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(indexName));
    }
    assert.ok(fs.readdirSync(dir).some((name) => name.startsWith('stockpilot.db.bak-')));
    migratedDb.close();
  });

  it('migrates legacy databases without resetting preserved records', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stockpilot-db-'));
    const dbPath = path.join(workDir, 'stockpilot.db');

    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price INTEGER NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0,
        low_stock_threshold INTEGER NOT NULL DEFAULT 5,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      INSERT INTO products (sku, name, category, price, quantity, low_stock_threshold)
      VALUES ('LEG-100', 'Legacy Product', 'Legacy', 2500, 7, 2);
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT NOT NULL UNIQUE,
        customer_name TEXT NOT NULL DEFAULT 'Walk-in customer',
        total INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        product_name TEXT NOT NULL,
        sku TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price INTEGER NOT NULL
      );
      INSERT INTO orders (order_number, customer_name, total) VALUES ('LEG-ORDER', 'Legacy Customer', 5000);
      INSERT INTO order_items (order_id, product_id, product_name, sku, quantity, unit_price)
      VALUES (1, 1, 'Legacy Product', 'LEG-100', 2, 2500);
    `);
    legacyDb.close();

    const migratedDb = createDatabase(dbPath);
    const legacyProduct = migratedDb.prepare('SELECT sku, quantity FROM products WHERE sku = ?').get('LEG-100');
    assert.ok(legacyProduct);
    assert.equal(legacyProduct.quantity, 7);
    const historicalOrder = migratedDb.prepare('SELECT * FROM orders WHERE order_number = ?').get('LEG-ORDER');
    assert.equal(historicalOrder.status, 'confirmed');
    assert.ok(historicalOrder.stock_deducted_at);
    assert.ok(historicalOrder.updated_at);

    const legacyCancel = await request(createApp({ db: migratedDb }))
      .patch(`/api/orders/${historicalOrder.id}/status`)
      .send({ status: 'cancelled' });
    assert.equal(legacyCancel.status, 409);
    assert.equal(migratedDb.prepare('SELECT quantity FROM products WHERE id = 1').get().quantity, 7);

    const files = fs.readdirSync(workDir);
    assert.ok(files.some((name) => name.startsWith('stockpilot.db.bak-')));

    const migrationVersion = migratedDb.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get().version;
    assert.equal(migrationVersion, 7);
    assert.equal(migratedDb.pragma('foreign_key_check').length, 0);
    migratedDb.close();
  });

  it('enforces foreign keys and keeps stock movements reconciled with product stock', () => {
    const db = createDatabase(':memory:');
    assert.throws(() => {
      db.prepare(`
        INSERT INTO stock_movements (product_id, movement_type, quantity_delta, previous_quantity, new_quantity, reason)
        VALUES (9999, 'adjustment', -1, 5, 4, 'bad foreign key')
      `).run();
    }, /FOREIGN KEY|SQLITE_CONSTRAINT_FOREIGNKEY/);
    assert.throws(() => {
      db.prepare(`
        INSERT INTO products (sku, name, category, price, quantity, category_id)
        VALUES ('BAD-CATEGORY-FK', 'Bad Category FK', 'Invalid', 100, 0, 9999)
      `).run();
    }, /FOREIGN KEY|SQLITE_CONSTRAINT_FOREIGNKEY/);
    assert.throws(() => {
      db.prepare(`
        INSERT INTO products (sku, name, category, price, quantity, supplier_id)
        VALUES ('BAD-SUPPLIER-FK', 'Bad Supplier FK', 'Invalid', 100, 0, 9999)
      `).run();
    }, /FOREIGN KEY|SQLITE_CONSTRAINT_FOREIGNKEY/);
    assert.throws(() => {
      db.prepare(`
        INSERT INTO orders (order_number, customer_name, total, customer_id)
        VALUES ('BAD-CUSTOMER-FK', 'Invalid Customer', 0, 9999)
      `).run();
    }, /FOREIGN KEY|SQLITE_CONSTRAINT_FOREIGNKEY/);

    db.prepare(`
      INSERT INTO products (sku, name, category, price, quantity, low_stock_threshold)
      VALUES ('TEST-001', 'Test Product', 'Testing', 1000, 0, 2)
    `).run();
    const product = db.prepare('SELECT * FROM products WHERE sku = ? COLLATE NOCASE').get('TEST-001');
    ledgerStockMovement(db, {
      productId: product.id,
      movementType: 'initial_stock',
      quantityDelta: 12,
      referenceType: 'seed',
      reason: 'Initial stock setup',
      notes: 'Seeded new product stock',
    });

    const beforeQuantity = 12;
    const updatedProduct = ledgerStockMovement(db, {
      productId: product.id,
      movementType: 'adjustment',
      quantityDelta: -2,
      referenceType: 'manual',
      reason: 'Stock count correction',
      notes: 'Removed two units during audit',
    });

    assert.equal(updatedProduct.quantity, beforeQuantity - 2);

    const lastMovement = db.prepare('SELECT * FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(product.id);
    assert.equal(lastMovement.quantity_delta, -2);
    assert.equal(lastMovement.previous_quantity, beforeQuantity);
    assert.equal(lastMovement.new_quantity, updatedProduct.quantity);

    const report = getStockReconciliationReport(db);
    assert.ok(report.every((row) => row.reconciled === 1));
    db.prepare('UPDATE products SET quantity = quantity + 1 WHERE id = ?').run(product.id);
    assert.equal(getStockReconciliationReport(db).find((row) => row.id === product.id).reconciled, 0);
    db.close();
  });
});

describe('Analytics APIs', () => {
  let db;
  let client;

  beforeEach(() => {
    db = createDatabase(':memory:');
    client = request(createApp({ db }));
  });

  afterEach(() => db.close());

  const utcToday = () => new Date().toISOString().slice(0, 10);

  async function createAnalyticsProduct(overrides = {}) {
    const response = await client.post('/api/products').send({
      sku: 'ANALYTICS-1',
      name: 'Analytics Product',
      category: 'Analytics',
      price: 10,
      quantity: 10,
      lowStockThreshold: 3,
      unitCost: 2.5,
      ...overrides,
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body.product;
  }

  it('returns correctly shaped zero-valued analytics for an empty database', async () => {
    const range = { from: utcToday(), to: utcToday() };
    const overview = await client.get('/api/analytics/overview').query(range);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.inventory.activeProductCount, 0);
    assert.equal(overview.body.inventory.totalProductCount, 0);
    assert.equal(overview.body.inventory.totalUnitsInStock, 0);
    assert.equal(overview.body.inventory.inventoryValuation, 0);
    assert.equal(overview.body.sales.orderCount, 0);
    assert.equal(overview.body.sales.averageOrderValue, 0);
    assert.equal(overview.body.financials.outstandingReceivables, 0);
    assert.deepEqual(overview.body.sales.recentSales, []);
    assert.deepEqual(overview.body.recentStockMovements, []);
    assert.deepEqual(overview.body.returnsAndRefunds.returns.byStatus, []);
    assert.deepEqual(overview.body.returnsAndRefunds.refunds.byStatus, []);

    const inventory = await client.get('/api/analytics/inventory');
    assert.equal(inventory.body.products.length, 0);
    assert.equal(inventory.body.byCategory.length, 0);
    assert.equal(inventory.body.bySupplier.length, 0);
    const trend = await client.get('/api/analytics/sales-trend').query({ ...range, period: 'daily' });
    assert.equal(trend.body.salesTrend.length, 1);
    assert.equal(trend.body.salesTrend[0].salesValue, 0);
    const top = await client.get('/api/analytics/top-products').query(range);
    assert.deepEqual(top.body.products, []);
    const movements = await client.get('/api/analytics/stock-movements').query(range);
    assert.deepEqual(movements.body.recentMovements, []);
    assert.deepEqual(movements.body.movementsByPeriodAndType, []);
  });

  it('calculates inventory, sales, purchasing, financial and ledger analytics from stored records', async () => {
    const category = (await client.post('/api/categories').send({ name: 'Analytics Category' })).body.category;
    const supplierResponse = await client.post('/api/suppliers').send({
      supplierCode: 'ANALYTICS-SUP',
      businessName: 'Analytics Supplier',
    });
    const supplier = supplierResponse.body.supplier;
    const product = await createAnalyticsProduct({
      category: category.name,
      categoryId: category.id,
      supplierId: supplier.id,
    });
    const outOfStock = await createAnalyticsProduct({
      sku: 'ANALYTICS-2', name: 'Out of Stock', quantity: 0, unitCost: 5, lowStockThreshold: 1,
      category: category.name, categoryId: category.id, supplierId: supplier.id,
    });
    await createAnalyticsProduct({
      sku: 'ANALYTICS-3', name: 'Inactive Item', quantity: 2, unitCost: 4,
      isActive: false, lowStockThreshold: 1, category: 'Legacy Category',
    });

    const initialInventory = await client.get('/api/analytics/inventory');
    assert.equal(initialInventory.body.totalUnitsInStock, 12);
    assert.equal(initialInventory.body.inventoryValuation, 33);
    assert.equal(initialInventory.body.activeProductCount, 2);
    assert.equal(initialInventory.body.lowStockCount, 1);
    assert.equal(initialInventory.body.outOfStockCount, 1);
    assert.equal(initialInventory.body.outOfStockProducts[0].id, outOfStock.id);
    assert.equal(initialInventory.body.negativeStockCount, 0);
    assert.equal(initialInventory.body.lowStockProducts[0].id, outOfStock.id);
    assert.equal(initialInventory.body.products.find((row) => row.id === product.id).stockValue, 25);
    assert.equal(initialInventory.body.byCategory.find((row) => row.categoryId === category.id).inventoryValue, 25);
    assert.equal(initialInventory.body.bySupplier.find((row) => row.supplierId === supplier.id).productCount, 2);

    const orderResponse = await client.post('/api/orders').send({
      items: [{ productId: product.id, quantity: 2 }],
    });
    assert.equal(orderResponse.status, 201);
    const order = orderResponse.body.order;
    const invoiceDraft = await client.post('/api/invoices').send({ orderId: order.id });
    assert.equal(invoiceDraft.status, 201);
    const invoice = (await client.post(`/api/invoices/${invoiceDraft.body.invoice.id}/issue`)).body.invoice;
    const paymentResponse = await client.post(`/api/invoices/${invoice.id}/payments`).send({ amount: 5, method: 'cash' });
    assert.equal(paymentResponse.status, 201);
    const orderItemId = db.prepare('SELECT id FROM order_items WHERE order_id = ?').get(order.id).id;
    const returnResponse = await client.post('/api/returns').send({
      orderId: order.id,
      invoiceId: invoice.id,
      reason: 'Analytics return',
      items: [{ orderItemId, quantity: 1, restockable: true, restockReason: 'Inspected for resale' }],
    });
    assert.equal(returnResponse.status, 201);
    const salesReturn = returnResponse.body.salesReturn;
    assert.equal((await client.post(`/api/returns/${salesReturn.id}/complete`).send({ status: 'accepted' })).status, 200);
    const refundResponse = await client.post(`/api/returns/${salesReturn.id}/refunds`).send({
      paymentId: paymentResponse.body.payment.id,
      amount: 4,
      method: 'cash',
    });
    assert.equal(refundResponse.status, 201);
    assert.equal((await client.post(`/api/refunds/${refundResponse.body.refund.id}/complete`)).status, 200);

    const purchaseOrder = await client.post('/api/purchase-orders').send({
      supplierId: supplier.id,
      items: [{ productId: product.id, quantity: 3, unitCost: 2.5 }],
    });
    assert.equal(purchaseOrder.status, 201);
    assert.equal((await client.post(`/api/purchase-orders/${purchaseOrder.body.purchaseOrder.id}/submit`)).status, 200);

    const range = { from: utcToday(), to: utcToday() };
    const overview = await client.get('/api/analytics/overview').query(range);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.inventory.totalUnitsInStock, 11);
    assert.equal(overview.body.inventory.inventoryValuation, 30.5);
    assert.equal(overview.body.inventory.totalProductCount, 3);
    assert.equal(overview.body.sales.orderCount, 1);
    assert.equal(overview.body.sales.salesValue, 20);
    assert.equal(overview.body.sales.averageOrderValue, 20);
    assert.equal(overview.body.sales.recentSales[0].id, order.id);
    assert.ok(overview.body.recentStockMovements.some((row) => row.movementType === 'sale'));
    assert.equal(overview.body.purchasing.purchaseOrderCount, 1);
    assert.equal(overview.body.purchasing.purchaseTrend[0].orderCount, 1);
    assert.equal(overview.body.purchasing.purchaseTrend[0].purchaseValue, 7.5);
    assert.equal(overview.body.financials.invoicesIssued, 20);
    assert.equal(overview.body.financials.paymentsReceived, 5);
    assert.equal(overview.body.financials.acceptedReturnCredits, 10);
    assert.equal(overview.body.financials.completedRefunds, 4);
    assert.equal(overview.body.financials.outstandingReceivables, 5);
    assert.ok(overview.body.financials.paymentStatusDistribution.some((row) => row.status === 'completed' && row.count === 1));
    assert.equal(overview.body.returnsAndRefunds.returns.acceptedReturnCredits, 10);
    assert.equal(overview.body.returnsAndRefunds.refunds.completedAmount, 4);

    const trend = await client.get('/api/analytics/sales-trend').query({ ...range, period: 'daily' });
    assert.equal(trend.body.salesTrend[0].orderCount, 1);
    assert.equal(trend.body.salesTrend[0].averageOrderValue, 20);
    const weeklyTrend = await client.get('/api/analytics/sales-trend').query({ ...range, period: 'weekly' });
    assert.equal(weeklyTrend.body.salesTrend[0].orderCount, 1);
    const monthlyTrend = await client.get('/api/analytics/sales-trend').query({ ...range, period: 'monthly' });
    assert.equal(monthlyTrend.body.salesTrend[0].orderCount, 1);
    const top = await client.get('/api/analytics/top-products').query({ ...range, limit: 5 });
    assert.equal(top.body.products[0].sku, product.sku);
    assert.equal(top.body.products[0].unitsSold, 2);
    assert.equal(top.body.products[0].salesValue, 20);
    assert.equal(top.body.products[0].orderCount, 1);

    const movements = await client.get('/api/analytics/stock-movements').query(range);
    assert.ok(movements.body.movementsByPeriodAndType.some((row) => row.movement_type === 'sale' && row.outbound_quantity === 2));
    assert.ok(movements.body.movementsByPeriodAndType.some((row) => row.movement_type === 'return_in' && row.inbound_quantity === 1));
    assert.ok(movements.body.recentMovements.some((row) => row.movementType === 'return_in' && row.productId === product.id));

    const cancelledOrder = await client.post('/api/orders').send({ items: [{ productId: product.id, quantity: 1 }] });
    assert.equal(cancelledOrder.status, 201);
    assert.equal((await client.patch(`/api/orders/${cancelledOrder.body.order.id}/status`).send({ status: 'cancelled' })).status, 200);
    const afterCancellation = await client.get('/api/analytics/top-products').query(range);
    assert.equal(afterCancellation.body.products[0].unitsSold, 2);
  });

  it('validates dates, periods and limits and returns date-boundary results', async () => {
    const product = await createAnalyticsProduct({ quantity: 3 });
    assert.equal((await client.post('/api/orders').send({ items: [{ productId: product.id, quantity: 1 }] })).status, 201);
    const today = utcToday();
    const boundary = await client.get('/api/analytics/overview').query({ from: today, to: today });
    assert.equal(boundary.body.sales.orderCount, 1);

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    assert.equal((await client.get('/api/analytics/overview').query({ from: '2026-02-30', to: today })).status, 400);
    assert.equal((await client.get('/api/analytics/overview').query({ from: '2026-02-30T00:00:00.000Z', to: today })).status, 400);
    assert.equal((await client.get('/api/analytics/overview').query({ from: '2026-10-01T00:00:00', to: today })).status, 400);
    assert.equal((await client.get('/api/analytics/overview').query({ from: tomorrow, to: today })).status, 400);
    assert.equal((await client.get('/api/analytics/overview').query({ from: '2024-01-01', to: today })).status, 400);
    assert.equal((await client.get('/api/analytics/sales-trend').query({ period: 'yearly' })).status, 400);
    assert.equal((await client.get('/api/analytics/top-products').query({ limit: 0 })).status, 400);
    assert.equal((await client.get('/api/analytics/top-products').query({ limit: 101 })).status, 400);
    assert.equal((await client.get('/api/analytics/exports/sales-trend.csv').query({ period: 'invalid' })).status, 400);
    assert.equal((await client.get('/api/analytics/exports/not-real.csv')).status, 404);
  });

  it('exports quoted CSV values safely and blocks spreadsheet formulas', async () => {
    const name = ' =HYPERLINK("https://example.invalid","bad"),\nsecond line';
    const product = await createAnalyticsProduct({ sku: 'CSV-01', name });
    await createAnalyticsProduct({ sku: 'CSV-02', name: 'Out of stock CSV', quantity: 0 });
    const secondSoldProduct = await createAnalyticsProduct({ sku: 'CSV-03', name: 'Second sold product' });
    const response = await client.get('/api/analytics/exports/inventory.csv');
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /text\/csv/);
    assert.match(response.headers['content-disposition'], /inventory-valuation-/);
    assert.ok(response.text.startsWith('"SKU","Product","Category"'));
    assert.ok(response.text.includes(`"'=HYPERLINK(""https://example.invalid"",""bad""),\nsecond line"`));

    const lowStock = await client.get('/api/analytics/exports/low-stock.csv');
    assert.equal(lowStock.status, 200);
    assert.ok(lowStock.text.startsWith('"SKU","Product","Category"'));
    const outOfStock = await client.get('/api/analytics/exports/out-of-stock.csv');
    assert.equal(outOfStock.status, 200);
    assert.ok(outOfStock.text.startsWith('"SKU","Product","Category"'));
    const order = await client.post('/api/orders').send({ items: [{ productId: product.id, quantity: 1 }] });
    assert.equal(order.status, 201);
    assert.equal((await client.post('/api/orders').send({ items: [{ productId: secondSoldProduct.id, quantity: 1 }] })).status, 201);
    const top = await client.get('/api/analytics/exports/top-products.csv').query({ from: utcToday(), to: utcToday() });
    assert.equal(top.status, 200);
    assert.ok(top.text.startsWith('"SKU","Product","Units sold"'));
    assert.equal((await client.get('/api/analytics/exports/top-products.csv').query({ from: utcToday(), to: utcToday(), limit: 1 })).status, 400);
    const trend = await client.get('/api/analytics/exports/sales-trend.csv').query({ from: utcToday(), to: utcToday() });
    assert.equal(trend.status, 200);
    assert.ok(trend.text.startsWith('"Period","Qualifying orders"'));
    const movements = await client.get('/api/analytics/exports/stock-movements.csv').query({ from: utcToday(), to: utcToday() });
    assert.equal(movements.status, 200);
    assert.ok(movements.text.startsWith('"Timestamp","Movement type"'));
    const tooMany = await client.get('/api/analytics/exports/inventory.csv').query({ limit: 1 });
    assert.equal(tooMany.status, 400);
  });

  it('reports filtered returns, receipt values, supplier performance, inventory warnings, and stays read-only', async () => {
    const categoryResponse = await client.post('/api/categories').send({ name: 'Analytics Readonly Category' });
    const supplierResponse = await client.post('/api/suppliers').send({
      supplierCode: 'ANALYTICS-READONLY-SUP',
      businessName: 'Analytics Readonly Supplier',
    });
    assert.equal(categoryResponse.status, 201);
    assert.equal(supplierResponse.status, 201);
    const category = categoryResponse.body.category;
    const supplier = supplierResponse.body.supplier;
    const product = await createAnalyticsProduct({
      sku: 'ANALYTICS-READONLY-1',
      name: 'Analytics Readonly Product',
      categoryId: category.id,
      category: category.name,
      supplierId: supplier.id,
      quantity: 8,
      price: 10,
      unitCost: 4,
    });
    const missingCost = await createAnalyticsProduct({
      sku: 'ANALYTICS-READONLY-2',
      name: 'Missing Cost Product',
      categoryId: category.id,
      category: category.name,
      supplierId: supplier.id,
      quantity: 2,
      unitCost: null,
      price: 12,
    });
    const orderResponse = await client.post('/api/orders').send({ items: [{ productId: product.id, quantity: 2 }] });
    assert.equal(orderResponse.status, 201);
    const orderItemId = db.prepare('SELECT id FROM order_items WHERE order_id = ?').get(orderResponse.body.order.id).id;
    const returnResponse = await client.post('/api/returns').send({
      orderId: orderResponse.body.order.id,
      reason: 'Analytics return',
      items: [{ orderItemId, quantity: 1, restockable: true, restockReason: 'Passed inspection' }],
    });
    assert.equal(returnResponse.status, 201);
    assert.equal((await client.post(`/api/returns/${returnResponse.body.salesReturn.id}/complete`).send({ status: 'accepted' })).status, 200);
    const purchaseOrderResponse = await client.post('/api/purchase-orders').send({
      supplierId: supplier.id,
      items: [{ productId: product.id, quantity: 3, unitCost: 4 }],
    });
    assert.equal(purchaseOrderResponse.status, 201);
    const purchaseOrder = purchaseOrderResponse.body.purchaseOrder;
    assert.equal((await client.post(`/api/purchase-orders/${purchaseOrder.id}/submit`)).status, 200);
    const receiptResponse = await client.post(`/api/purchase-orders/${purchaseOrder.id}/receipts`).send({
      receiptNumber: 'ANALYTICS-READONLY-GR-1',
      items: [{ purchaseOrderItemId: purchaseOrder.items[0].id, quantity: 1 }],
    });
    assert.equal(receiptResponse.status, 201, JSON.stringify(receiptResponse.body));
    const invoiceResponse = await client.post('/api/invoices').send({ orderId: orderResponse.body.order.id });
    assert.equal(invoiceResponse.status, 201);
    assert.equal((await client.post(`/api/invoices/${invoiceResponse.body.invoice.id}/issue`)).status, 200);
    const paymentResponse = await client.post(`/api/invoices/${invoiceResponse.body.invoice.id}/payments`).send({
      amount: 5,
      method: 'cash',
    });
    assert.equal(paymentResponse.status, 201);

    const businessTables = [
      'categories', 'suppliers', 'products', 'orders', 'order_items', 'stock_movements',
      'purchase_orders', 'purchase_order_items', 'goods_receipts', 'goods_receipt_items',
      'invoices', 'invoice_items', 'payments', 'sales_returns', 'sales_return_items', 'refunds',
    ];
    const snapshot = () => JSON.stringify(Object.fromEntries(businessTables.map((table) => [
      table,
      db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ])));
    const before = snapshot();
    const range = { from: utcToday(), to: utcToday(), categoryId: String(category.id), supplierId: String(supplier.id) };
    const inventory = await client.get('/api/analytics/inventory').query({ ...range, windowDays: 60 });
    assert.equal(inventory.status, 200, JSON.stringify(inventory.body));
    assert.equal(inventory.body.retailValue, 104);
    assert.equal(inventory.body.missingCostCount, 1);
    assert.equal(inventory.body.slowMovement.windowDays, 60);
    assert.deepEqual(inventory.body.reconciliationWarnings, []);
    assert.equal(inventory.body.products.some((row) => row.id === missingCost.id), true);

    const sales = await client.get('/api/analytics/sales-trend').query({ ...range, period: 'daily' });
    assert.equal(sales.status, 200, JSON.stringify(sales.body));
    assert.equal(sales.body.grossSalesValue, 20);
    assert.equal(sales.body.acceptedReturnCredits, 10);
    assert.equal(sales.body.netSalesValue, 10);
    assert.equal(sales.body.byCategory[0].netUnitsSold, 1);
    assert.ok(sales.body.statusBreakdown.some((row) => row.status === 'confirmed' && row.orderCount === 1));
    const financials = await client.get('/api/analytics/financials').query({ from: utcToday(), to: utcToday() });
    assert.equal(financials.status, 200, JSON.stringify(financials.body));
    assert.equal(financials.body.unsettledReturnCredits, 10);
    assert.equal(financials.body.netCashRetained, 5);
    const top = await client.get('/api/analytics/top-products').query({ ...range, limit: 5 });
    assert.equal(top.status, 200, JSON.stringify(top.body));
    assert.equal(top.body.products[0].netUnitsSold, 1);

    const purchasing = await client.get('/api/analytics/purchasing').query({ ...range, period: 'daily' });
    assert.equal(purchasing.status, 200, JSON.stringify(purchasing.body));
    assert.equal(purchasing.body.purchaseOrderCount, 1);
    assert.equal(purchasing.body.orderedQuantity, 3);
    assert.equal(purchasing.body.receivedQuantity, 1);
    assert.equal(purchasing.body.receivedValue, 4);
    assert.equal(purchasing.body.outstandingQuantity, 2);
    assert.equal(purchasing.body.receivingTrend[0].receivedQuantity, 1);
    assert.equal(purchasing.body.receivingTrend[0].receivedValue, 4);
    assert.equal(purchasing.body.suppliers[0].supplierId, supplier.id);
    assert.equal(purchasing.body.suppliers[0].receivedQuantity, 1);
    assert.ok(purchasing.body.suppliers[0].averageDaysToFirstReceipt >= 0);

    for (const path of [
      `/api/analytics/overview?from=${utcToday()}&to=${utcToday()}&categoryId=${category.id}&supplierId=${supplier.id}`,
      `/api/analytics/financials?from=${utcToday()}&to=${utcToday()}`,
      `/api/analytics/recent-sales?from=${utcToday()}&to=${utcToday()}&limit=1`,
      `/api/analytics/out-of-stock?categoryId=${category.id}`,
      `/api/analytics/returns-refunds?from=${utcToday()}&to=${utcToday()}`,
      `/api/analytics/status-distribution?from=${utcToday()}&to=${utcToday()}`,
      `/api/analytics/stock-movements?from=${utcToday()}&to=${utcToday()}&productId=${product.id}`,
      `/api/analytics/exports/inventory.csv?categoryId=${category.id}`,
      `/api/analytics/exports/low-stock.csv?supplierId=${supplier.id}`,
      `/api/analytics/exports/out-of-stock.csv?supplierId=${supplier.id}`,
      `/api/analytics/exports/top-products.csv?from=${utcToday()}&to=${utcToday()}&productId=${product.id}`,
      `/api/analytics/exports/sales-trend.csv?from=${utcToday()}&to=${utcToday()}&supplierId=${supplier.id}`,
      `/api/analytics/exports/sales-by-category.csv?from=${utcToday()}&to=${utcToday()}&categoryId=${category.id}`,
      `/api/analytics/exports/sales-summary.csv?from=${utcToday()}&to=${utcToday()}&categoryId=${category.id}`,
      `/api/analytics/exports/supplier-purchases.csv?from=${utcToday()}&to=${utcToday()}&supplierId=${supplier.id}`,
      `/api/analytics/exports/purchases-by-supplier.csv?from=${utcToday()}&to=${utcToday()}&supplierId=${supplier.id}`,
      `/api/analytics/exports/purchasing-trend.csv?from=${utcToday()}&to=${utcToday()}&supplierId=${supplier.id}`,
      `/api/analytics/exports/order-status.csv?from=${utcToday()}&to=${utcToday()}`,
      `/api/analytics/exports/invoice-payment-status.csv?from=${utcToday()}&to=${utcToday()}`,
      `/api/analytics/exports/returns-refunds.csv?from=${utcToday()}&to=${utcToday()}`,
      `/api/analytics/exports/stock-movements.csv?from=${utcToday()}&to=${utcToday()}&productId=${product.id}`,
    ]) {
      const response = await client.get(path);
      assert.equal(response.status, 200, `${path}: ${JSON.stringify(response.body)}`);
    }
    const recentSales = await client.get('/api/analytics/recent-sales').query({ from: utcToday(), to: utcToday(), limit: 1 });
    assert.equal(recentSales.body.orders.length, 1);
    assert.equal(recentSales.body.orders[0].id, orderResponse.body.order.id);
    const outOfStockReport = await client.get('/api/analytics/out-of-stock').query({ categoryId: category.id });
    assert.equal(outOfStockReport.body.total, 0);
    const statusDistribution = await client.get('/api/analytics/status-distribution').query({ from: utcToday(), to: utcToday() });
    assert.ok(statusDistribution.body.returnStatusDistribution.some((row) => row.status === 'accepted'));
    assert.ok(statusDistribution.body.paymentStatusDistribution.some((row) => row.status === 'completed'));
    assert.equal((await client.get('/api/analytics/inventory').query({ categoryId: '2bad' })).status, 400);
    assert.equal((await client.get('/api/analytics/inventory').query({ supplierId: '1.5' })).status, 400);
    assert.equal((await client.get('/api/analytics/inventory').query({ productId: '1 OR 1=1' })).status, 400);
    assert.equal((await client.get('/api/analytics/recent-sales').query({ limit: '1;DROP TABLE products' })).status, 400);
    assert.equal((await client.get('/api/analytics/inventory').query({ windowDays: 366 })).status, 400);
    assert.equal(snapshot(), before, 'Analytics reads must not mutate business records.');
  });
});
