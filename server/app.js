import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createDatabase, ledgerStockMovement } from './database.js';

const productFields = {
  sku: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(60),
  price: z.number().finite().min(0).max(1_000_000_000),
  quantity: z.number().int().min(0).max(2_147_483_647),
  lowStockThreshold: z.number().int().min(0).max(2_147_483_647).default(5),
  description: z.string().trim().max(2000).nullable().optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  supplierId: z.number().int().positive().nullable().optional(),
  unitCost: z.number().finite().min(0).max(1_000_000_000).nullable().optional(),
  maxStock: z.number().int().min(0).max(2_147_483_647).nullable().optional(),
  unitOfMeasure: z.string().trim().max(40).nullable().optional(),
  isActive: z.boolean().optional(),
};
const productSchema = z.object(productFields).strict();
const updateProductSchema = z.object(productFields).partial().strict().refine((value) => Object.keys(value).length > 0, {
  message: 'Provide at least one field to update.',
});
const stockSchema = z.object({
  quantity: z.number().int().min(-2_147_483_647).max(2_147_483_647),
  operation: z.enum(['set', 'adjust']).default('set'),
}).strict().refine((value) => value.operation === 'adjust' || value.quantity >= 0, {
  message: 'Set quantities cannot be negative.',
  path: ['quantity'],
});
const adjustmentSchema = z.object({
  quantityDelta: z.number().int().min(-2_147_483_647).max(2_147_483_647).refine((quantity) => quantity !== 0),
  reason: z.string().trim().min(3).max(500),
  notes: z.string().trim().max(2000).optional().default(''),
}).strict();
const optionalText = (max) => z.string().trim().max(max).nullable().optional().default(null);
const emailField = z.string().trim().email().max(254).nullable().optional().default(null);
const categorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: optionalText(1000),
}).strict();
const updateCategorySchema = categorySchema.partial().strict().refine((value) => Object.keys(value).length > 0, {
  message: 'Provide at least one field to update.',
});
const supplierSchema = z.object({
  supplierCode: z.string().trim().min(1).max(40),
  businessName: z.string().trim().min(1).max(160),
  contactPerson: optionalText(120),
  email: emailField,
  phone: optionalText(40),
  address: optionalText(500),
  notes: optionalText(2000),
  isActive: z.boolean().optional().default(true),
}).strict();
const updateSupplierSchema = supplierSchema.partial().strict().refine((value) => Object.keys(value).length > 0, {
  message: 'Provide at least one field to update.',
});
const customerSchema = z.object({
  customerCode: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  email: emailField,
  phone: optionalText(40),
  address: optionalText(500),
  notes: optionalText(2000),
  isActive: z.boolean().optional().default(true),
}).strict();
const updateCustomerSchema = customerSchema.partial().strict().refine((value) => Object.keys(value).length > 0, {
  message: 'Provide at least one field to update.',
});
const orderSchema = z.object({
  customerName: z.string().trim().min(1).max(120).optional(),
  customerId: z.number().int().positive().nullable().optional(),
  items: z.array(z.object({
    productId: z.number().int().positive(),
    quantity: z.number().int().positive().max(2_147_483_647),
  }).strict()).min(1).max(100),
}).strict().refine((value) => new Set(value.items.map((item) => item.productId)).size === value.items.length, {
  message: 'Each product can only appear once in an order.',
  path: ['items'],
});
const purchaseOrderItemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive().max(2_147_483_647),
  unitCost: z.number().finite().min(0).max(1_000_000_000),
  discountAmount: z.number().finite().min(0).max(1_000_000_000).optional().default(0),
  taxRate: z.number().finite().min(0).max(100).optional().default(0),
}).strict().array().min(1).max(100).refine(
  (items) => new Set(items.map((item) => item.productId)).size === items.length,
  { message: 'Each product can only appear once on a purchase order.' },
);
const purchaseOrderSchema = z.object({
  supplierId: z.number().int().positive(),
  notes: z.string().trim().max(2000).nullable().optional().default(null),
  items: purchaseOrderItemSchema,
}).strict();
const updatePurchaseOrderSchema = purchaseOrderSchema.partial().strict().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Provide at least one field to update.' },
);
const receiptSchema = z.object({
  receiptNumber: z.string().trim().min(1).max(80),
  notes: z.string().trim().max(2000).nullable().optional().default(null),
  receivedAt: z.string().datetime().optional(),
  items: z.array(z.object({
    purchaseOrderItemId: z.number().int().positive(),
    quantity: z.number().int().positive().max(2_147_483_647),
  }).strict()).min(1).max(100).refine(
    (items) => new Set(items.map((item) => item.purchaseOrderItemId)).size === items.length,
    { message: 'Each purchase order line can only appear once per receipt.' },
  ),
}).strict();
const salesDraftSchema = orderSchema;
const salesStatusSchema = z.object({
  status: z.enum(['confirmed', 'processing', 'shipped', 'delivered', 'cancelled']),
}).strict();
const invoiceCreateSchema = z.object({
  orderId: z.number().int().positive(),
  invoiceNumber: z.string().trim().min(1).max(80).optional(),
  invoiceDate: z.string().datetime().optional(),
  dueDate: z.string().datetime().nullable().optional(),
}).strict();
const paymentCreateSchema = z.object({
  paymentReference: z.string().trim().min(1).max(80).optional(),
  externalReference: z.string().trim().min(1).max(160).nullable().optional(),
  amount: z.number().finite().positive().max(1_000_000_000),
  method: z.string().trim().min(1).max(80),
  status: z.enum(['completed', 'failed']).default('completed'),
  paymentDate: z.string().datetime().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).strict();
const returnCreateSchema = z.object({
  returnNumber: z.string().trim().min(1).max(80).optional(),
  orderId: z.number().int().positive(),
  invoiceId: z.number().int().positive().nullable().optional(),
  returnDate: z.string().datetime().optional(),
  reason: z.string().trim().min(3).max(500),
  items: z.array(z.object({
    orderItemId: z.number().int().positive(),
    quantity: z.number().int().positive().max(2_147_483_647),
    restockable: z.boolean(),
    restockReason: z.string().trim().min(3).max(500),
  }).strict()).min(1).max(100).refine(
    (items) => new Set(items.map((item) => item.orderItemId)).size === items.length,
    { message: 'Each sold order line can only appear once per return.' },
  ),
}).strict();
const returnCompleteSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
}).strict();
const refundCreateSchema = z.object({
  refundReference: z.string().trim().min(1).max(80).optional(),
  paymentId: z.number().int().positive(),
  amount: z.number().finite().positive().max(1_000_000_000),
  method: z.string().trim().min(1).max(80),
  externalReference: z.string().trim().min(1).max(160).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).strict();

function validate(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const error = new Error(result.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '));
    error.status = 400;
    throw error;
  }
  return result.data;
}

function notFound(message = 'Resource not found.') {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function parseId(value, label = 'Product') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw notFound(`${label} not found.`);
  return id;
}

function conflictOnUnique(action, message) {
  try {
    return action();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const conflict = new Error(message);
      conflict.status = 409;
      throw conflict;
    }
    throw error;
  }
}

function moneyToMinorUnits(amount, label = 'Amount') {
  const minorUnits = Math.round((amount + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(minorUnits) || minorUnits <= 0) {
    const error = new Error(`${label} must be at least one cent.`);
    error.status = 400;
    throw error;
  }
  return minorUnits;
}

function mapProduct(row) {
  if (!row) return row;
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    description: row.description ?? null,
    categoryId: row.category_id ?? null,
    supplierId: row.supplier_id ?? null,
    price: row.price / 100,
    unitCost: row.unit_cost === null || row.unit_cost === undefined ? null : row.unit_cost / 100,
    quantity: row.quantity,
    lowStockThreshold: row.low_stock_threshold,
    maxStock: row.max_stock ?? null,
    unitOfMeasure: row.unit_of_measure ?? null,
    isActive: row.is_active === undefined ? true : Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCategory(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    productCount: row.product_count,
    unitsInStock: row.units_in_stock,
    inventoryValue: row.inventory_value / 100,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSupplier(row) {
  return {
    id: row.id,
    supplierCode: row.supplier_code,
    businessName: row.business_name,
    contactPerson: row.contact_person,
    email: row.email,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCustomer(row, orders) {
  return {
    id: row.id,
    customerCode: row.customer_code,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(orders === undefined ? {} : { orderHistory: orders.map((order) => ({
      id: order.id,
      orderNumber: order.order_number,
      total: order.total / 100,
      status: order.status,
      paymentStatus: order.payment_status,
      createdAt: order.created_at,
    })) }),
  };
}

function mapStockMovement(row) {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    sku: row.sku,
    movementType: row.movement_type,
    quantityDelta: row.quantity_delta,
    previousQuantity: row.previous_quantity,
    resultingQuantity: row.new_quantity,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    reason: row.reason,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function mapOrder(row, items) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    customerId: row.customer_id ?? null,
    customerName: row.customer_name,
    total: row.total / 100,
    status: row.status ?? 'confirmed',
    paymentStatus: row.payment_status ?? 'unpaid',
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    stockDeductedAt: row.stock_deducted_at ?? (row.status === 'draft' ? null : row.created_at),
    items: items.map((item) => ({
      orderItemId: item.id,
      productId: item.product_id,
      productName: item.product_name,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: item.unit_price / 100,
    })),
  };
}

function mapInvoiceItem(item) {
  return {
    id: item.id,
    orderItemId: item.order_item_id,
    productId: item.product_id,
    productName: item.product_name,
    sku: item.sku,
    quantity: item.quantity,
    unitPrice: item.unit_price / 100,
    subtotal: item.subtotal / 100,
    discountAmount: item.discount_amount / 100,
    taxAmount: item.tax_amount / 100,
    total: item.total / 100,
  };
}

function getInvoiceFinancials(db, invoice) {
  const completedPayments = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS amount FROM payments
    WHERE invoice_id = ? AND status = 'completed'
  `).get(invoice.id).amount;
  const completedRefunds = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS amount FROM refunds
    WHERE invoice_id = ? AND status = 'completed'
  `).get(invoice.id).amount;
  const acceptedReturnCredits = db.prepare(`
    SELECT COALESCE(SUM(sri.refund_eligible_amount), 0) AS amount
    FROM sales_return_items sri
    JOIN sales_returns sr ON sr.id = sri.return_id
    WHERE sr.invoice_id = ? AND sr.status = 'accepted'
  `).get(invoice.id).amount;
  const outstandingBalance = Math.max(0, invoice.total - acceptedReturnCredits - completedPayments);
  const netCashRetained = completedPayments - completedRefunds;
  return {
    completedPayments,
    completedRefunds,
    acceptedReturnCredits,
    outstandingBalance,
    netCashRetained,
  };
}

function updateInvoiceFinancialStatus(db, invoiceId) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice || invoice.status === 'draft' || invoice.status === 'void') return;
  const financials = getInvoiceFinancials(db, invoice);
  let status = 'issued';
  if (financials.acceptedReturnCredits >= invoice.total && financials.acceptedReturnCredits > 0) {
    status = 'credited';
  } else if (financials.outstandingBalance === 0) {
    status = 'paid';
  } else if (financials.completedPayments > 0) {
    status = 'partially_paid';
  }
  if (status !== invoice.status) {
    db.prepare(`
      UPDATE invoices SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(status, invoiceId);
  }
  const paymentStatus = status === 'credited'
    ? 'credited'
    : financials.outstandingBalance === 0 ? 'paid'
      : financials.completedPayments > 0 ? 'partial' : 'unpaid';
  db.prepare('UPDATE orders SET payment_status = ? WHERE id = ?').run(paymentStatus, invoice.order_id);
}

function mapInvoice(db, invoice, items = []) {
  const financials = getInvoiceFinancials(db, invoice);
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoice_number,
    orderId: invoice.order_id,
    orderNumber: invoice.order_number,
    customerId: invoice.customer_id ?? null,
    customerName: invoice.customer_name,
    customerEmail: invoice.customer_email,
    billingAddress: invoice.billing_address,
    invoiceDate: invoice.invoice_date,
    dueDate: invoice.due_date,
    status: invoice.status,
    subtotal: invoice.subtotal / 100,
    discountTotal: invoice.discount_total / 100,
    taxTotal: invoice.tax_total / 100,
    total: invoice.total / 100,
    completedPayments: financials.completedPayments / 100,
    completedRefunds: financials.completedRefunds / 100,
    acceptedReturnCredits: financials.acceptedReturnCredits / 100,
    outstandingBalance: financials.outstandingBalance / 100,
    unsettledReturnCredit: Math.max(0, financials.acceptedReturnCredits - financials.completedRefunds) / 100,
    netCashRetained: financials.netCashRetained / 100,
    paymentStatus: invoice.status === 'void'
      ? 'void'
      : invoice.status === 'draft'
        ? 'unpaid'
      : invoice.status === 'credited'
        ? 'credited'
        : financials.outstandingBalance === 0
          ? 'paid'
          : financials.completedPayments > 0 ? 'partial' : 'unpaid',
    items: items.map(mapInvoiceItem),
    createdAt: invoice.created_at,
    updatedAt: invoice.updated_at,
  };
}

function mapPayment(payment) {
  return {
    id: payment.id,
    invoiceId: payment.invoice_id,
    invoiceNumber: payment.invoice_number,
    paymentReference: payment.payment_reference,
    externalReference: payment.external_reference,
    amount: payment.amount / 100,
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    paymentDate: payment.payment_date,
    notes: payment.notes,
    createdAt: payment.created_at,
    updatedAt: payment.updated_at,
  };
}

function mapRefund(refund) {
  return {
    id: refund.id,
    refundReference: refund.refund_reference,
    returnId: refund.return_id,
    invoiceId: refund.invoice_id,
    paymentId: refund.payment_id,
    amount: refund.amount / 100,
    currency: refund.currency,
    method: refund.method,
    externalReference: refund.external_reference,
    status: refund.status,
    notes: refund.notes,
    createdAt: refund.created_at,
    updatedAt: refund.updated_at,
    completedAt: refund.completed_at,
  };
}

function getSalesReturn(db, returnId) {
  const salesReturn = db.prepare(`
    SELECT sr.*, o.order_number, i.invoice_number
    FROM sales_returns sr
    JOIN orders o ON o.id = sr.order_id
    LEFT JOIN invoices i ON i.id = sr.invoice_id
    WHERE sr.id = ?
  `).get(returnId);
  if (!salesReturn) return null;
  const items = db.prepare(`
    SELECT * FROM sales_return_items WHERE return_id = ? ORDER BY id
  `).all(returnId);
  const refunds = db.prepare(`
    SELECT * FROM refunds WHERE return_id = ? ORDER BY id
  `).all(returnId);
  const total = items.reduce((sum, item) => sum + item.refund_eligible_amount, 0);
  const completedRefunds = refunds
    .filter((refund) => refund.status === 'completed')
    .reduce((sum, refund) => sum + refund.amount, 0);
  return {
    id: salesReturn.id,
    returnNumber: salesReturn.return_number,
    orderId: salesReturn.order_id,
    orderNumber: salesReturn.order_number,
    invoiceId: salesReturn.invoice_id,
    invoiceNumber: salesReturn.invoice_number,
    customerId: salesReturn.customer_id,
    customerName: salesReturn.customer_name,
    returnDate: salesReturn.return_date,
    reason: salesReturn.reason,
    status: salesReturn.status,
    total: total / 100,
    completedRefunds: completedRefunds / 100,
    refundableBalance: Math.max(0, total - completedRefunds) / 100,
    items: items.map((item) => ({
      id: item.id,
      orderItemId: item.order_item_id,
      productId: item.product_id,
      productName: item.product_name,
      sku: item.sku,
      quantity: item.quantity,
      restockable: Boolean(item.restockable),
      restockReason: item.restock_reason,
      unitPrice: item.unit_price / 100,
      refundEligibleAmount: item.refund_eligible_amount / 100,
      createdAt: item.created_at,
    })),
    refunds: refunds.map((refund) => ({
      id: refund.id,
      refundReference: refund.refund_reference,
      paymentId: refund.payment_id,
      amount: refund.amount / 100,
      method: refund.method,
      externalReference: refund.external_reference,
      status: refund.status,
      notes: refund.notes,
      createdAt: refund.created_at,
      updatedAt: refund.updated_at,
      completedAt: refund.completed_at,
    })),
    createdAt: salesReturn.created_at,
    updatedAt: salesReturn.updated_at,
    completedAt: salesReturn.completed_at,
  };
}

function mapPurchaseOrderItem(item) {
  return {
    id: item.id,
    productId: item.product_id,
    productName: item.product_name,
    sku: item.sku,
    orderedQuantity: item.ordered_quantity,
    receivedQuantity: item.received_quantity,
    outstandingQuantity: item.ordered_quantity - item.received_quantity,
    unitCost: item.unit_cost / 100,
    discountAmount: item.discount_amount / 100,
    taxRate: item.tax_rate_basis_points / 100,
    subtotal: item.line_subtotal / 100,
    tax: item.line_tax / 100,
    total: item.line_total / 100,
  };
}

function mapGoodsReceipt(row, items = []) {
  return {
    id: row.id,
    receiptNumber: row.receipt_number,
    purchaseOrderId: row.purchase_order_id,
    purchaseOrderNumber: row.purchase_order_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    receivedAt: row.received_at,
    notes: row.notes,
    createdAt: row.created_at,
    items: items.map((item) => ({
      id: item.id,
      purchaseOrderItemId: item.purchase_order_item_id,
      productId: item.product_id,
      productName: item.product_name,
      sku: item.sku,
      quantity: item.quantity,
      unitCost: item.unit_cost / 100,
    })),
  };
}

function mapPurchaseOrder(row, items = [], receipts = []) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    supplierCode: row.supplier_code,
    status: row.status,
    subtotal: row.subtotal / 100,
    taxTotal: row.tax_total / 100,
    total: row.total / 100,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    cancelledAt: row.cancelled_at,
    items: items.map(mapPurchaseOrderItem),
    receipts,
  };
}

function computePurchaseLines(lines, products) {
  let subtotal = 0;
  let taxTotal = 0;
  const calculated = lines.map((line) => {
    const product = products.get(line.productId);
    if (!product) {
      const error = new Error(`Product ${line.productId} was not found.`);
      error.status = 400;
      throw error;
    }
    const unitCost = Math.round(line.unitCost * 100);
    const gross = unitCost * line.quantity;
    const discountAmount = Math.round(line.discountAmount * 100);
    if (!Number.isSafeInteger(gross) || discountAmount > gross) {
      const error = new Error('Purchase line discount cannot exceed its gross amount.');
      error.status = 400;
      throw error;
    }
    const lineSubtotal = gross - discountAmount;
    const taxRateBasisPoints = Math.round(line.taxRate * 100);
    const lineTax = Math.round(lineSubtotal * taxRateBasisPoints / 10000);
    const lineTotal = lineSubtotal + lineTax;
    if (![lineSubtotal, lineTax, lineTotal].every(Number.isSafeInteger)) {
      const error = new Error('Purchase line total exceeds the supported amount.');
      error.status = 400;
      throw error;
    }
    subtotal += lineSubtotal;
    taxTotal += lineTax;
    return {
      product,
      productId: line.productId,
      quantity: line.quantity,
      unitCost,
      discountAmount,
      taxRateBasisPoints,
      lineSubtotal,
      lineTax,
      lineTotal,
    };
  });
  if (![subtotal, taxTotal, subtotal + taxTotal].every(Number.isSafeInteger)) {
    const error = new Error('Purchase order total exceeds the supported amount.');
    error.status = 400;
    throw error;
  }
  return { lines: calculated, subtotal, taxTotal, total: subtotal + taxTotal };
}

function getPurchaseOrder(db, orderId) {
  const row = db.prepare(`
    SELECT po.*, s.business_name AS supplier_name, s.supplier_code
    FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.id = ?
  `).get(orderId);
  if (!row) return null;
  const items = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY id').all(orderId);
  const receiptRows = db.prepare(`
    SELECT gr.*, po.order_number AS purchase_order_number, s.business_name AS supplier_name
    FROM goods_receipts gr
    JOIN purchase_orders po ON po.id = gr.purchase_order_id
    JOIN suppliers s ON s.id = gr.supplier_id
    WHERE gr.purchase_order_id = ?
    ORDER BY gr.id
  `).all(orderId);
  const receipts = receiptRows.map((receipt) => {
    const receiptItems = db.prepare(`
      SELECT gri.*, p.name AS product_name, p.sku
      FROM goods_receipt_items gri JOIN products p ON p.id = gri.product_id
      WHERE gri.goods_receipt_id = ? ORDER BY gri.id
    `).all(receipt.id);
    return mapGoodsReceipt(receipt, receiptItems);
  });
  return mapPurchaseOrder(row, items, receipts);
}

function getOrderWithItems(db, orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;
  return mapOrder(order, db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId));
}

function createSalesOrder(db, input, status) {
  const create = db.transaction(() => {
    let customerName = input.customerName ?? 'Walk-in customer';
    if (input.customerId !== undefined && input.customerId !== null) {
      const customer = db.prepare('SELECT id, name, is_active FROM customers WHERE id = ?').get(input.customerId);
      if (!customer) {
        const error = new Error('Customer not found.');
        error.status = 404;
        throw error;
      }
      if (!customer.is_active) {
        const error = new Error('Inactive customers cannot be selected for a new order.');
        error.status = 409;
        throw error;
      }
      customerName = customer.name;
    }

    const items = input.items.map((item) => {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.productId);
      if (!product) {
        const error = new Error(`Product ${item.productId} was not found.`);
        error.status = 404;
        throw error;
      }
      if (status === 'confirmed' && product.quantity < item.quantity) {
        const error = new Error(`Not enough stock for ${product.name}. ${product.quantity} available.`);
        error.status = 409;
        throw error;
      }
      return { ...item, product };
    });
    const total = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    if (!Number.isSafeInteger(total)) {
      const error = new Error('Order total exceeds the supported amount.');
      error.status = 400;
      throw error;
    }

    const inserted = db.prepare(`
      INSERT INTO orders (order_number, customer_name, total, customer_id, status, stock_deducted_at)
      VALUES ('pending', ?, ?, ?, ?, ?)
    `).run(
      customerName,
      total,
      input.customerId ?? null,
      status,
      status === 'confirmed' ? new Date().toISOString() : null,
    );
    const orderId = Number(inserted.lastInsertRowid);
    const orderNumber = `SP-${String(orderId).padStart(5, '0')}`;
    db.prepare(`
      UPDATE orders SET order_number = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
    `).run(orderNumber, orderId);
    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, sku, quantity, unit_price)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      insertItem.run(orderId, item.product.id, item.product.name, item.product.sku, item.quantity, item.product.price);
      if (status === 'confirmed') {
        ledgerStockMovement(db, {
          productId: item.product.id,
          movementType: 'sale',
          quantityDelta: -item.quantity,
          referenceType: 'order',
          referenceId: orderId,
          reason: `Stock deducted for order ${orderNumber}`,
        });
      }
    }
    return getOrderWithItems(db, orderId);
  });
  return create.immediate();
}

function validateProductReferences(db, product) {
  if (product.categoryId !== undefined && product.categoryId !== null) {
    const category = db.prepare('SELECT name FROM categories WHERE id = ?').get(product.categoryId);
    if (!category) {
      const error = new Error('Category not found.');
      error.status = 400;
      throw error;
    }
    product.category = category.name;
  }
  if (product.supplierId !== undefined && product.supplierId !== null) {
    const supplier = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(product.supplierId);
    if (!supplier) {
      const error = new Error('Supplier not found.');
      error.status = 400;
      throw error;
    }
  }
}

function productWriteValues(input) {
  return {
    sku: input.sku,
    name: input.name,
    category: input.category,
    price: Math.round(input.price * 100),
    quantity: input.quantity,
    lowStockThreshold: input.lowStockThreshold,
    description: input.description ?? null,
    categoryId: input.categoryId ?? null,
    supplierId: input.supplierId ?? null,
    unitCost: input.unitCost === undefined || input.unitCost === null ? null : Math.round(input.unitCost * 100),
    maxStock: input.maxStock ?? null,
    unitOfMeasure: input.unitOfMeasure ?? null,
    isActive: input.isActive === undefined ? 1 : Number(input.isActive),
  };
}

function mapUniqueConflict(error, label) {
  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === 'SQLITE_CONSTRAINT_TRIGGER') {
    const conflict = new Error(`${label} already exists.`);
    conflict.status = 409;
    throw conflict;
  }
  throw error;
}

export function createApp({
  db = createDatabase(),
  authorizeStockAdjustment = (req) => {
    const token = process.env.STOCK_ADJUSTMENT_TOKEN;
    return Boolean(token) && req.get('authorization') === `Bearer ${token}`;
  },
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  app.get('/api/categories', (_req, res) => {
    const categories = db.prepare(`
      SELECT c.*,
        COUNT(p.id) AS product_count,
        COALESCE(SUM(p.quantity), 0) AS units_in_stock,
        COALESCE(SUM(p.quantity * p.price), 0) AS inventory_value
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
        OR (p.category_id IS NULL AND p.category = c.name COLLATE NOCASE)
      GROUP BY c.id
      ORDER BY c.name COLLATE NOCASE
    `).all().map(mapCategory);
    res.json({ categories });
  });

  app.post('/api/categories', (req, res) => {
    const input = validate(categorySchema, req.body);
    try {
      const result = db.prepare('INSERT INTO categories (name, description) VALUES (?, ?)').run(input.name, input.description ?? null);
      const category = db.prepare(`
        SELECT c.*, 0 AS product_count, 0 AS units_in_stock, 0 AS inventory_value
        FROM categories c WHERE c.id = ?
      `).get(result.lastInsertRowid);
      res.status(201).json({ category: mapCategory(category) });
    } catch (error) {
      mapUniqueConflict(error, 'Category name');
    }
  });

  app.get('/api/categories/:id', (req, res) => {
    const categoryId = parseId(req.params.id, 'Category');
    const category = db.prepare(`
      SELECT c.*,
        COUNT(p.id) AS product_count,
        COALESCE(SUM(p.quantity), 0) AS units_in_stock,
        COALESCE(SUM(p.quantity * p.price), 0) AS inventory_value
      FROM categories c LEFT JOIN products p ON p.category_id = c.id
        OR (p.category_id IS NULL AND p.category = c.name COLLATE NOCASE)
      WHERE c.id = ? GROUP BY c.id
    `).get(categoryId);
    if (!category) throw notFound('Category not found.');
    res.json({ category: mapCategory(category) });
  });

  app.put('/api/categories/:id', (req, res) => {
    const input = validate(updateCategorySchema, req.body);
    const categoryId = parseId(req.params.id, 'Category');
    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
    if (!existing) throw notFound('Category not found.');
    const name = input.name ?? existing.name;
    const description = input.description === undefined ? existing.description : input.description;
    try {
      const updateCategory = db.transaction(() => {
        db.prepare(`
          UPDATE categories SET name = ?, description = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ?
        `).run(name, description, categoryId);
        if (input.name !== undefined) {
          db.prepare(`
            UPDATE products SET category = ?, category_id = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE category_id = ? OR (category_id IS NULL AND category = ? COLLATE NOCASE)
          `).run(name, categoryId, categoryId, existing.name);
        }
      });
      updateCategory.immediate();
    } catch (error) {
      mapUniqueConflict(error, 'Category name');
    }
    const category = db.prepare(`
      SELECT c.*, COUNT(p.id) AS product_count,
        COALESCE(SUM(p.quantity), 0) AS units_in_stock,
        COALESCE(SUM(p.quantity * p.price), 0) AS inventory_value
      FROM categories c LEFT JOIN products p ON p.category_id = c.id
        OR (p.category_id IS NULL AND p.category = c.name COLLATE NOCASE)
      WHERE c.id = ? GROUP BY c.id
    `).get(categoryId);
    res.json({ category: mapCategory(category) });
  });

  app.delete('/api/categories/:id', (req, res) => {
    const categoryId = parseId(req.params.id, 'Category');
    const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
    if (!category) throw notFound('Category not found.');
    const products = db.prepare(`
      SELECT COUNT(*) AS count
      FROM products p JOIN categories c ON c.id = ?
      WHERE p.category_id = c.id
        OR (p.category_id IS NULL AND p.category = c.name COLLATE NOCASE)
    `).get(categoryId).count;
    if (products > 0) {
      const error = new Error('Categories associated with products cannot be deleted. Reassign the products first.');
      error.status = 409;
      throw error;
    }
    db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
    res.status(204).end();
  });

  app.get('/api/suppliers', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const active = req.query.active;
    if (active !== undefined && active !== 'true' && active !== 'false') {
      return res.status(400).json({ error: 'active must be true or false.' });
    }
    const conditions = [];
    const params = [];
    if (query) {
      conditions.push('(business_name LIKE ? OR supplier_code LIKE ? OR contact_person LIKE ? OR email LIKE ?)');
      params.push(...Array(4).fill(`%${query}%`));
    }
    if (active !== undefined) conditions.push('is_active = ?'), params.push(active === 'true' ? 1 : 0);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const suppliers = db.prepare(`SELECT * FROM suppliers ${where} ORDER BY business_name COLLATE NOCASE`).all(...params);
    res.json({ suppliers: suppliers.map(mapSupplier), total: suppliers.length });
  });

  app.post('/api/suppliers', (req, res) => {
    const input = validate(supplierSchema, req.body);
    try {
      const result = db.prepare(`
        INSERT INTO suppliers (supplier_code, business_name, contact_person, email, phone, address, notes, is_active)
        VALUES (@supplierCode, @businessName, @contactPerson, @email, @phone, @address, @notes, @isActive)
      `).run({ ...input, isActive: Number(input.isActive) });
      res.status(201).json({ supplier: mapSupplier(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(result.lastInsertRowid)) });
    } catch (error) {
      mapUniqueConflict(error, 'Supplier code');
    }
  });

  app.get('/api/suppliers/:id', (req, res) => {
    const supplierId = parseId(req.params.id, 'Supplier');
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplierId);
    if (!supplier) throw notFound('Supplier not found.');
    const purchaseHistory = db.prepare(`
      SELECT id, order_number, status, subtotal, tax_total, total, created_at, submitted_at
      FROM purchase_orders WHERE supplier_id = ? ORDER BY id DESC
    `).all(supplierId).map((order) => ({
      id: order.id,
      orderNumber: order.order_number,
      status: order.status,
      subtotal: order.subtotal / 100,
      taxTotal: order.tax_total / 100,
      total: order.total / 100,
      createdAt: order.created_at,
      submittedAt: order.submitted_at,
    }));
    res.json({ supplier: { ...mapSupplier(supplier), purchaseHistory } });
  });

  app.put('/api/suppliers/:id', (req, res) => {
    const input = validate(updateSupplierSchema, req.body);
    const supplierId = parseId(req.params.id, 'Supplier');
    const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplierId);
    if (!existing) throw notFound('Supplier not found.');
    const values = {
      supplierCode: input.supplierCode ?? existing.supplier_code,
      businessName: input.businessName ?? existing.business_name,
      contactPerson: input.contactPerson === undefined ? existing.contact_person : input.contactPerson,
      email: input.email === undefined ? existing.email : input.email,
      phone: input.phone === undefined ? existing.phone : input.phone,
      address: input.address === undefined ? existing.address : input.address,
      notes: input.notes === undefined ? existing.notes : input.notes,
      isActive: input.isActive === undefined ? existing.is_active : Number(input.isActive),
      id: supplierId,
    };
    try {
      db.prepare(`
        UPDATE suppliers SET supplier_code = @supplierCode, business_name = @businessName,
          contact_person = @contactPerson, email = @email, phone = @phone, address = @address,
          notes = @notes, is_active = @isActive, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = @id
      `).run(values);
    } catch (error) {
      mapUniqueConflict(error, 'Supplier code');
    }
    res.json({ supplier: mapSupplier(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplierId)) });
  });

  app.patch('/api/suppliers/:id/deactivate', (req, res) => {
    const supplierId = parseId(req.params.id, 'Supplier');
    const result = db.prepare(`
      UPDATE suppliers SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
    `).run(supplierId);
    if (!result.changes) throw notFound('Supplier not found.');
    res.json({ supplier: mapSupplier(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplierId)) });
  });

  app.get('/api/customers', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const active = req.query.active;
    if (active !== undefined && active !== 'true' && active !== 'false') {
      return res.status(400).json({ error: 'active must be true or false.' });
    }
    const conditions = [];
    const params = [];
    if (query) {
      conditions.push('(name LIKE ? OR customer_code LIKE ? OR email LIKE ? OR phone LIKE ?)');
      params.push(...Array(4).fill(`%${query}%`));
    }
    if (active !== undefined) conditions.push('is_active = ?'), params.push(active === 'true' ? 1 : 0);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const customers = db.prepare(`SELECT * FROM customers ${where} ORDER BY name COLLATE NOCASE`).all(...params);
    res.json({ customers: customers.map((customer) => mapCustomer(customer)), total: customers.length });
  });

  app.post('/api/customers', (req, res) => {
    const input = validate(customerSchema, req.body);
    try {
      const result = db.prepare(`
        INSERT INTO customers (customer_code, name, email, phone, address, notes, is_active)
        VALUES (@customerCode, @name, @email, @phone, @address, @notes, @isActive)
      `).run({ ...input, isActive: Number(input.isActive) });
      res.status(201).json({ customer: mapCustomer(db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid)) });
    } catch (error) {
      mapUniqueConflict(error, 'Customer code');
    }
  });

  app.get('/api/customers/:id', (req, res) => {
    const customerId = parseId(req.params.id, 'Customer');
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    if (!customer) throw notFound('Customer not found.');
    const orders = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY id DESC').all(customerId);
    res.json({ customer: mapCustomer(customer, orders) });
  });

  app.put('/api/customers/:id', (req, res) => {
    const input = validate(updateCustomerSchema, req.body);
    const customerId = parseId(req.params.id, 'Customer');
    const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    if (!existing) throw notFound('Customer not found.');
    const values = {
      customerCode: input.customerCode ?? existing.customer_code,
      name: input.name ?? existing.name,
      email: input.email === undefined ? existing.email : input.email,
      phone: input.phone === undefined ? existing.phone : input.phone,
      address: input.address === undefined ? existing.address : input.address,
      notes: input.notes === undefined ? existing.notes : input.notes,
      isActive: input.isActive === undefined ? existing.is_active : Number(input.isActive),
      id: customerId,
    };
    try {
      db.prepare(`
        UPDATE customers SET customer_code = @customerCode, name = @name, email = @email,
          phone = @phone, address = @address, notes = @notes, is_active = @isActive,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = @id
      `).run(values);
    } catch (error) {
      mapUniqueConflict(error, 'Customer code');
    }
    res.json({ customer: mapCustomer(db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId)) });
  });

  app.patch('/api/customers/:id/deactivate', (req, res) => {
    const customerId = parseId(req.params.id, 'Customer');
    const result = db.prepare(`
      UPDATE customers SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
    `).run(customerId);
    if (!result.changes) throw notFound('Customer not found.');
    res.json({ customer: mapCustomer(db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId)) });
  });

  app.get('/api/dashboard', (_req, res) => {
    const inventory = db.prepare(`
      SELECT COUNT(*) AS product_count,
        COALESCE(SUM(quantity * price), 0) / 100.0 AS inventory_value,
        COALESCE(SUM(quantity), 0) AS units_in_stock,
        COALESCE(SUM(CASE WHEN quantity <= low_stock_threshold THEN 1 ELSE 0 END), 0) AS low_stock_count
      FROM products
    `).get();
    const orderSummary = db.prepare(`
      SELECT COUNT(*) AS order_count, COALESCE(SUM(total), 0) / 100.0 AS revenue
      FROM orders
      WHERE status IN ('confirmed', 'processing', 'shipped', 'delivered')
        AND created_at >= strftime('%Y-%m-01T00:00:00.000Z', 'now')
    `).get();
    const lowStockProducts = db.prepare(`
      SELECT * FROM products WHERE quantity <= low_stock_threshold
      ORDER BY quantity ASC, name COLLATE NOCASE ASC LIMIT 6
    `).all().map(mapProduct);
    const recentOrders = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 6').all()
      .map((order) => mapOrder(order, db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id)));
    res.json({
      productCount: inventory.product_count,
      inventoryValue: inventory.inventory_value,
      unitsInStock: inventory.units_in_stock,
      lowStockCount: inventory.low_stock_count,
      monthlyOrderCount: orderSummary.order_count,
      monthlyRevenue: orderSummary.revenue,
      lowStockProducts,
      recentOrders,
    });
  });

  app.get('/api/products', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const stock = req.query.stock;
    const categoryId = req.query.categoryId;
    const supplierId = req.query.supplierId;
    const active = req.query.active;
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const pageSize = req.query.pageSize === undefined ? 50 : Number(req.query.pageSize);
    const sortFields = {
      name: 'name COLLATE NOCASE',
      sku: 'sku COLLATE NOCASE',
      price: 'price',
      quantity: 'quantity',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    };
    const sort = req.query.sort === undefined ? 'name' : String(req.query.sort);
    const direction = req.query.direction === undefined ? 'asc' : String(req.query.direction).toLowerCase();
    if (stock !== undefined && stock !== 'low' && stock !== 'in_stock') {
      return res.status(400).json({ error: 'stock must be low or in_stock.' });
    }
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return res.status(400).json({ error: 'page must be positive and pageSize must be between 1 and 100.' });
    }
    if (!sortFields[sort] || !['asc', 'desc'].includes(direction)) {
      return res.status(400).json({ error: 'Unsupported product sort or direction.' });
    }
    if (active !== undefined && active !== 'true' && active !== 'false') {
      return res.status(400).json({ error: 'active must be true or false.' });
    }
    for (const [label, value] of [['categoryId', categoryId], ['supplierId', supplierId]]) {
      if (value !== undefined && (!/^\d+$/.test(String(value)) || Number(value) < 1)) {
        return res.status(400).json({ error: `${label} must be a positive integer.` });
      }
    }
    const conditions = [];
    const params = [];
    if (query) {
      conditions.push("(name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
      const escaped = query.replace(/[\\%_]/g, '\\$&');
      params.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
    }
    if (category) {
      conditions.push('category = ? COLLATE NOCASE');
      params.push(category);
    }
    if (stock === 'low') conditions.push('quantity <= low_stock_threshold');
    if (stock === 'in_stock') conditions.push('quantity > 0');
    if (categoryId !== undefined) conditions.push('category_id = ?'), params.push(Number(categoryId));
    if (supplierId !== undefined) conditions.push('supplier_id = ?'), params.push(Number(supplierId));
    if (active !== undefined) conditions.push('is_active = ?'), params.push(active === 'true' ? 1 : 0);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS count FROM products ${where}`).get(...params).count;
    const products = db.prepare(`
      SELECT * FROM products ${where}
      ORDER BY ${sortFields[sort]} ${direction.toUpperCase()}, id ASC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize);
    const categories = db.prepare('SELECT DISTINCT category FROM products ORDER BY category COLLATE NOCASE').all()
      .map((row) => row.category);
    res.json({
      products: products.map(mapProduct),
      categories,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  });

  app.post('/api/products', (req, res) => {
    const input = validate(productSchema, req.body);
    validateProductReferences(db, input);
    const values = productWriteValues(input);
    try {
      const createProduct = db.transaction(() => {
        const result = db.prepare(`
          INSERT INTO products (
            sku, name, category, price, quantity, low_stock_threshold, description, category_id,
            supplier_id, unit_cost, max_stock, unit_of_measure, is_active
          ) VALUES (
            @sku, @name, @category, @price, 0, @lowStockThreshold, @description, @categoryId,
            @supplierId, @unitCost, @maxStock, @unitOfMeasure, @isActive
          )
        `).run(values);
        if (values.quantity > 0) {
          ledgerStockMovement(db, {
            productId: Number(result.lastInsertRowid),
            movementType: 'initial_stock',
            quantityDelta: values.quantity,
            referenceType: 'product_creation',
            referenceId: Number(result.lastInsertRowid),
            reason: 'Initial stock on product creation',
          });
        }
        return mapProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid));
      });
      const product = createProduct.immediate();
      res.status(201).json({ product });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        const conflict = new Error('A product with this SKU already exists.');
        conflict.status = 409;
        throw conflict;
      }
      throw error;
    }
  });

  app.get('/api/products/:id', (req, res) => {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(parseId(req.params.id));
    if (!product) throw notFound('Product not found.');
    res.json({ product: mapProduct(product) });
  });

  app.put('/api/products/:id', (req, res) => {
    const input = validate(updateProductSchema, req.body);
    const productId = parseId(req.params.id);
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!existing) throw notFound('Product not found.');
    const current = mapProduct(existing);
    const fields = { ...current, ...input };
    validateProductReferences(db, fields);
    const values = productWriteValues(fields);
    try {
      const updateProduct = db.transaction(() => {
        db.prepare(`
          UPDATE products SET sku = @sku, name = @name, category = @category, price = @price,
            low_stock_threshold = @lowStockThreshold, description = @description,
            category_id = @categoryId, supplier_id = @supplierId, unit_cost = @unitCost,
            max_stock = @maxStock, unit_of_measure = @unitOfMeasure, is_active = @isActive,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = @id
        `).run({ ...values, id: productId });
        const quantityDelta = values.quantity - existing.quantity;
        if (quantityDelta !== 0) {
          ledgerStockMovement(db, {
            productId,
            movementType: 'adjustment',
            quantityDelta,
            referenceType: 'product_update',
            referenceId: productId,
            reason: 'Stock quantity changed through product update',
          });
        }
      });
      updateProduct.immediate();
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'A product with this SKU already exists.' });
      }
      throw error;
    }
    res.json({ product: mapProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(productId)) });
  });

  app.patch('/api/products/:id/stock', (req, res) => {
    const input = validate(stockSchema, req.body);
    const productId = parseId(req.params.id);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) throw notFound('Product not found.');
    const quantity = input.operation === 'adjust' ? product.quantity + input.quantity : input.quantity;
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2_147_483_647) {
      const error = new Error('The resulting stock quantity is outside the supported range.');
      error.status = 400;
      throw error;
    }
    const quantityDelta = quantity - product.quantity;
    if (quantityDelta !== 0) {
      ledgerStockMovement(db, {
        productId,
        movementType: 'adjustment',
        quantityDelta,
        referenceType: 'legacy_stock_endpoint',
        referenceId: productId,
        reason: 'Stock changed through the legacy stock endpoint',
      });
    }
    res.json({ product: mapProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(productId)) });
  });

  app.post('/api/products/:id/stock-adjustments', (req, res) => {
    if (!authorizeStockAdjustment(req)) {
      const error = new Error('An authorized stock-adjustment credential is required.');
      error.status = 403;
      throw error;
    }
    const input = validate(adjustmentSchema, req.body);
    const productId = parseId(req.params.id);
    const product = ledgerStockMovement(db, {
      productId,
      movementType: 'adjustment',
      quantityDelta: input.quantityDelta,
      referenceType: 'manual_adjustment',
      referenceId: null,
      reason: input.reason,
      notes: input.notes,
    });
    const movement = db.prepare('SELECT * FROM stock_movements WHERE id = last_insert_rowid()').get();
    res.status(201).json({ product: mapProduct(product), movement: mapStockMovement({
      ...movement,
      product_name: product.name,
      sku: product.sku,
    }) });
  });

  app.get('/api/stock-movements', (req, res) => {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const pageSize = req.query.pageSize === undefined ? 50 : Number(req.query.pageSize);
    const productId = req.query.productId === undefined ? undefined : Number(req.query.productId);
    const movementType = req.query.type;
    const validTypes = ['initial_stock', 'sale', 'purchase', 'adjustment', 'return_in', 'return_out', 'write_off'];
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return res.status(400).json({ error: 'page must be positive and pageSize must be between 1 and 100.' });
    }
    if (productId !== undefined && (!Number.isSafeInteger(productId) || productId < 1)) {
      return res.status(400).json({ error: 'productId must be a positive integer.' });
    }
    if (movementType !== undefined && !validTypes.includes(movementType)) {
      return res.status(400).json({ error: 'Unsupported stock movement type.' });
    }
    const conditions = [];
    const params = [];
    if (productId !== undefined) conditions.push('sm.product_id = ?'), params.push(productId);
    if (movementType !== undefined) conditions.push('sm.movement_type = ?'), params.push(movementType);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS count FROM stock_movements sm ${where}`).get(...params).count;
    const movements = db.prepare(`
      SELECT sm.*, p.name AS product_name, p.sku
      FROM stock_movements sm JOIN products p ON p.id = sm.product_id
      ${where}
      ORDER BY sm.id DESC LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize);
    res.json({ movements: movements.map(mapStockMovement), total, page, pageSize });
  });

  app.get('/api/products/:id/stock-movements', (req, res) => {
    const productId = parseId(req.params.id);
    const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
    if (!product) throw notFound('Product not found.');
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const pageSize = req.query.pageSize === undefined ? 50 : Number(req.query.pageSize);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return res.status(400).json({ error: 'page must be positive and pageSize must be between 1 and 100.' });
    }
    const total = db.prepare('SELECT COUNT(*) AS count FROM stock_movements WHERE product_id = ?').get(productId).count;
    const movements = db.prepare(`
      SELECT sm.*, p.name AS product_name, p.sku
      FROM stock_movements sm JOIN products p ON p.id = sm.product_id
      WHERE sm.product_id = ?
      ORDER BY sm.id DESC LIMIT ? OFFSET ?
    `).all(productId, pageSize, (page - 1) * pageSize);
    res.json({ movements: movements.map(mapStockMovement), total, page, pageSize });
  });

  app.delete('/api/products/:id', (req, res) => {
    const productId = parseId(req.params.id);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
    if (!product) throw notFound('Product not found.');
    try {
      db.prepare('DELETE FROM products WHERE id = ?').run(productId);
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || error.code === 'SQLITE_CONSTRAINT_TRIGGER') {
        return res.status(409).json({ error: 'Products referenced by orders or stock history cannot be deleted.' });
      }
      throw error;
    }
    res.status(204).end();
  });

  app.post('/api/purchase-orders', (req, res) => {
    const input = validate(purchaseOrderSchema, req.body);
    const supplier = db.prepare('SELECT id, is_active FROM suppliers WHERE id = ?').get(input.supplierId);
    if (!supplier) {
      const error = new Error('Supplier not found.');
      error.status = 400;
      throw error;
    }
    if (!supplier.is_active) {
      const error = new Error('Inactive suppliers cannot be selected for a new purchase order.');
      error.status = 409;
      throw error;
    }
    const products = new Map();
    for (const line of input.items) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(line.productId);
      if (!product) {
        const error = new Error(`Product ${line.productId} was not found.`);
        error.status = 400;
        throw error;
      }
      products.set(line.productId, product);
    }
    const totals = computePurchaseLines(input.items, products);
    const create = db.transaction(() => {
      const inserted = db.prepare(`
        INSERT INTO purchase_orders (order_number, supplier_id, status, subtotal, tax_total, total, notes)
        VALUES ('pending', ?, 'draft', ?, ?, ?, ?)
      `).run(input.supplierId, totals.subtotal, totals.taxTotal, totals.total, input.notes);
      const id = Number(inserted.lastInsertRowid);
      const orderNumber = `PO-${String(id).padStart(5, '0')}`;
      db.prepare('UPDATE purchase_orders SET order_number = ? WHERE id = ?').run(orderNumber, id);
      const insertItem = db.prepare(`
        INSERT INTO purchase_order_items (
          purchase_order_id, product_id, product_name, sku, ordered_quantity,
          unit_cost, discount_amount, tax_rate_basis_points, line_subtotal, line_tax, line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const line of totals.lines) {
        insertItem.run(id, line.product.id, line.product.name, line.product.sku, line.quantity,
          line.unitCost, line.discountAmount, line.taxRateBasisPoints, line.lineSubtotal, line.lineTax, line.lineTotal);
      }
      return getPurchaseOrder(db, id);
    });
    res.status(201).json({ purchaseOrder: create.immediate() });
  });

  app.get('/api/purchase-orders', (req, res) => {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const pageSize = req.query.pageSize === undefined ? 50 : Number(req.query.pageSize);
    const status = req.query.status;
    const supplierId = req.query.supplierId === undefined ? undefined : Number(req.query.supplierId);
    const from = req.query.from;
    const to = req.query.to;
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return res.status(400).json({ error: 'page must be positive and pageSize must be between 1 and 100.' });
    }
    if (status !== undefined && !['draft', 'ordered', 'partially_received', 'received', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Unsupported purchase order status.' });
    }
    if (supplierId !== undefined && (!Number.isSafeInteger(supplierId) || supplierId < 1)) {
      return res.status(400).json({ error: 'supplierId must be a positive integer.' });
    }
    for (const date of [from, to]) {
      if (date !== undefined && (typeof date !== 'string' || Number.isNaN(Date.parse(date)))) {
        return res.status(400).json({ error: 'from and to must be valid dates.' });
      }
    }
    const conditions = [];
    const params = [];
    if (status) conditions.push('po.status = ?'), params.push(status);
    if (supplierId !== undefined) conditions.push('po.supplier_id = ?'), params.push(supplierId);
    if (from) conditions.push('po.created_at >= ?'), params.push(from);
    if (to) conditions.push('po.created_at <= ?'), params.push(to);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS count FROM purchase_orders po ${where}`).get(...params).count;
    const rows = db.prepare(`
      SELECT po.*, s.business_name AS supplier_name, s.supplier_code
      FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
      ${where} ORDER BY po.id DESC LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize);
    res.json({
      purchaseOrders: rows.map((row) => mapPurchaseOrder(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  });

  app.get('/api/purchase-orders/:id', (req, res) => {
    const purchaseOrder = getPurchaseOrder(db, parseId(req.params.id, 'Purchase order'));
    if (!purchaseOrder) throw notFound('Purchase order not found.');
    res.json({ purchaseOrder });
  });

  app.put('/api/purchase-orders/:id', (req, res) => {
    const input = validate(updatePurchaseOrderSchema, req.body);
    const purchaseOrderId = parseId(req.params.id, 'Purchase order');
    const existing = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(purchaseOrderId);
    if (!existing) throw notFound('Purchase order not found.');
    if (existing.status !== 'draft') {
      const error = new Error('Only draft purchase orders can be edited.');
      error.status = 409;
      throw error;
    }
    const supplierId = input.supplierId ?? existing.supplier_id;
    const supplier = db.prepare('SELECT id, is_active FROM suppliers WHERE id = ?').get(supplierId);
    if (!supplier) {
      const error = new Error('Supplier not found.');
      error.status = 400;
      throw error;
    }
    if (!supplier.is_active) {
      const error = new Error('Inactive suppliers cannot be selected for a purchase order.');
      error.status = 409;
      throw error;
    }
    const existingItems = db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY id').all(purchaseOrderId);
    const lines = input.items ?? existingItems.map((item) => ({
      productId: item.product_id,
      quantity: item.ordered_quantity,
      unitCost: item.unit_cost / 100,
      discountAmount: item.discount_amount / 100,
      taxRate: item.tax_rate_basis_points / 100,
    }));
    const products = new Map();
    for (const line of lines) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(line.productId);
      if (!product) {
        const error = new Error(`Product ${line.productId} was not found.`);
        error.status = 400;
        throw error;
      }
      products.set(line.productId, product);
    }
    const totals = computePurchaseLines(lines, products);
    const update = db.transaction(() => {
      db.prepare(`
        UPDATE purchase_orders SET supplier_id = ?, subtotal = ?, tax_total = ?, total = ?, notes = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND status = 'draft'
      `).run(supplierId, totals.subtotal, totals.taxTotal, totals.total,
        input.notes === undefined ? existing.notes : input.notes, purchaseOrderId);
      if (input.items !== undefined) {
        db.prepare('DELETE FROM purchase_order_items WHERE purchase_order_id = ?').run(purchaseOrderId);
        const insertItem = db.prepare(`
          INSERT INTO purchase_order_items (
            purchase_order_id, product_id, product_name, sku, ordered_quantity,
            unit_cost, discount_amount, tax_rate_basis_points, line_subtotal, line_tax, line_total
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const line of totals.lines) {
          insertItem.run(purchaseOrderId, line.product.id, line.product.name, line.product.sku, line.quantity,
            line.unitCost, line.discountAmount, line.taxRateBasisPoints, line.lineSubtotal, line.lineTax, line.lineTotal);
        }
      }
    });
    update.immediate();
    res.json({ purchaseOrder: getPurchaseOrder(db, purchaseOrderId) });
  });

  app.post('/api/purchase-orders/:id/submit', (req, res) => {
    const purchaseOrderId = parseId(req.params.id, 'Purchase order');
    const result = db.prepare(`
      UPDATE purchase_orders
      SET status = 'ordered', submitted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND status = 'draft'
    `).run(purchaseOrderId);
    if (!result.changes) {
      const order = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(purchaseOrderId);
      if (!order) throw notFound('Purchase order not found.');
      const error = new Error('Only draft purchase orders can be submitted.');
      error.status = 409;
      throw error;
    }
    res.json({ purchaseOrder: getPurchaseOrder(db, purchaseOrderId) });
  });

  app.post('/api/purchase-orders/:id/cancel', (req, res) => {
    const purchaseOrderId = parseId(req.params.id, 'Purchase order');
    const order = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(purchaseOrderId);
    if (!order) throw notFound('Purchase order not found.');
    const receivedCount = db.prepare(`
      SELECT COALESCE(SUM(received_quantity), 0) AS quantity
      FROM purchase_order_items WHERE purchase_order_id = ?
    `).get(purchaseOrderId).quantity;
    if (!['draft', 'ordered'].includes(order.status) || receivedCount > 0) {
      const error = new Error('A purchase order can only be cancelled before any goods are received.');
      error.status = 409;
      throw error;
    }
    db.prepare(`
      UPDATE purchase_orders SET status = 'cancelled', cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(purchaseOrderId);
    res.json({ purchaseOrder: getPurchaseOrder(db, purchaseOrderId) });
  });

  app.post('/api/purchase-orders/:id/receipts', (req, res) => {
    const input = validate(receiptSchema, req.body);
    const purchaseOrderId = parseId(req.params.id, 'Purchase order');
    const receive = db.transaction(() => {
      const order = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(purchaseOrderId);
      if (!order) throw notFound('Purchase order not found.');
      if (!['ordered', 'partially_received'].includes(order.status)) {
        const error = new Error('Goods can only be received against an ordered purchase order.');
        error.status = 409;
        throw error;
      }
      const lines = input.items.map((requested) => {
        const line = db.prepare(`
          SELECT * FROM purchase_order_items WHERE id = ? AND purchase_order_id = ?
        `).get(requested.purchaseOrderItemId, purchaseOrderId);
        if (!line) {
          const error = new Error(`Purchase order line ${requested.purchaseOrderItemId} was not found.`);
          error.status = 400;
          throw error;
        }
        const outstanding = line.ordered_quantity - line.received_quantity;
        if (requested.quantity > outstanding) {
          const error = new Error(`Receipt quantity exceeds the outstanding quantity for ${line.product_name}.`);
          error.status = 409;
          throw error;
        }
        return { ...requested, line, outstanding };
      });
      const inserted = db.prepare(`
        INSERT INTO goods_receipts (receipt_number, purchase_order_id, supplier_id, received_at, notes)
        VALUES (?, ?, ?, COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), ?)
      `).run(input.receiptNumber, purchaseOrderId, order.supplier_id, input.receivedAt ?? null, input.notes);
      const receiptId = Number(inserted.lastInsertRowid);
      const insertItem = db.prepare(`
        INSERT INTO goods_receipt_items (goods_receipt_id, purchase_order_item_id, product_id, quantity, unit_cost)
        VALUES (?, ?, ?, ?, ?)
      `);
      const updateLine = db.prepare(`
        UPDATE purchase_order_items SET received_quantity = received_quantity + ?
        WHERE id = ? AND purchase_order_id = ? AND received_quantity + ? <= ordered_quantity
      `);
      for (const item of lines) {
        const updated = updateLine.run(item.quantity, item.line.id, purchaseOrderId, item.quantity);
        if (updated.changes !== 1) {
          const error = new Error('The outstanding quantity changed. Refresh and retry the receipt.');
          error.status = 409;
          throw error;
        }
        insertItem.run(receiptId, item.line.id, item.line.product_id, item.quantity, item.line.unit_cost);
        ledgerStockMovement(db, {
          productId: item.line.product_id,
          movementType: 'purchase',
          quantityDelta: item.quantity,
          referenceType: 'goods_receipt',
          referenceId: receiptId,
          reason: `Goods received on ${input.receiptNumber}`,
        });
      }
      const remaining = db.prepare(`
        SELECT COALESCE(SUM(ordered_quantity - received_quantity), 0) AS quantity
        FROM purchase_order_items WHERE purchase_order_id = ?
      `).get(purchaseOrderId).quantity;
      const nextStatus = remaining === 0 ? 'received' : 'partially_received';
      db.prepare(`
        UPDATE purchase_orders SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(nextStatus, purchaseOrderId);
      return receiptId;
    });
    let receiptId;
    try {
      receiptId = receive.immediate();
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        const conflict = new Error('Receipt number already exists.');
        conflict.status = 409;
        throw conflict;
      }
      throw error;
    }
    const receipt = db.prepare(`
      SELECT gr.*, po.order_number AS purchase_order_number, s.business_name AS supplier_name
      FROM goods_receipts gr JOIN purchase_orders po ON po.id = gr.purchase_order_id
      JOIN suppliers s ON s.id = gr.supplier_id WHERE gr.id = ?
    `).get(receiptId);
    const items = db.prepare(`
      SELECT gri.*, p.name AS product_name, p.sku
      FROM goods_receipt_items gri JOIN products p ON p.id = gri.product_id
      WHERE gri.goods_receipt_id = ? ORDER BY gri.id
    `).all(receiptId);
    res.status(201).json({ receipt: mapGoodsReceipt(receipt, items), purchaseOrder: getPurchaseOrder(db, purchaseOrderId) });
  });

  app.get('/api/goods-receipts', (req, res) => {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const pageSize = req.query.pageSize === undefined ? 50 : Number(req.query.pageSize);
    const supplierId = req.query.supplierId === undefined ? undefined : Number(req.query.supplierId);
    const purchaseOrderId = req.query.purchaseOrderId === undefined ? undefined : Number(req.query.purchaseOrderId);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return res.status(400).json({ error: 'page must be positive and pageSize must be between 1 and 100.' });
    }
    const conditions = [];
    const params = [];
    if (supplierId !== undefined) conditions.push('gr.supplier_id = ?'), params.push(supplierId);
    if (purchaseOrderId !== undefined) conditions.push('gr.purchase_order_id = ?'), params.push(purchaseOrderId);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS count FROM goods_receipts gr ${where}`).get(...params).count;
    const rows = db.prepare(`
      SELECT gr.*, po.order_number AS purchase_order_number, s.business_name AS supplier_name
      FROM goods_receipts gr JOIN purchase_orders po ON po.id = gr.purchase_order_id
      JOIN suppliers s ON s.id = gr.supplier_id
      ${where} ORDER BY gr.id DESC LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize);
    res.json({ receipts: rows.map((row) => {
      const items = db.prepare(`
        SELECT gri.*, p.name AS product_name, p.sku
        FROM goods_receipt_items gri JOIN products p ON p.id = gri.product_id
        WHERE gri.goods_receipt_id = ? ORDER BY gri.id
      `).all(row.id);
      return mapGoodsReceipt(row, items);
    }), total, page, pageSize });
  });

  app.get('/api/goods-receipts/:id', (req, res) => {
    const receiptId = parseId(req.params.id, 'Goods receipt');
    const receipt = db.prepare(`
      SELECT gr.*, po.order_number AS purchase_order_number, s.business_name AS supplier_name
      FROM goods_receipts gr JOIN purchase_orders po ON po.id = gr.purchase_order_id
      JOIN suppliers s ON s.id = gr.supplier_id WHERE gr.id = ?
    `).get(receiptId);
    if (!receipt) throw notFound('Goods receipt not found.');
    const items = db.prepare(`
      SELECT gri.*, p.name AS product_name, p.sku
      FROM goods_receipt_items gri JOIN products p ON p.id = gri.product_id
      WHERE gri.goods_receipt_id = ? ORDER BY gri.id
    `).all(receiptId);
    res.json({ receipt: mapGoodsReceipt(receipt, items) });
  });

  app.get('/api/suppliers/:id/purchase-orders', (req, res) => {
    const supplierId = parseId(req.params.id, 'Supplier');
    if (!db.prepare('SELECT id FROM suppliers WHERE id = ?').get(supplierId)) throw notFound('Supplier not found.');
    const rows = db.prepare(`
      SELECT po.*, s.business_name AS supplier_name, s.supplier_code
      FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.supplier_id = ? ORDER BY po.id DESC
    `).all(supplierId);
    res.json({ purchaseOrders: rows.map((row) => mapPurchaseOrder(row)) });
  });

  app.get('/api/products/:id/history', (req, res) => {
    const productId = parseId(req.params.id);
    const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
    if (!product) throw notFound('Product not found.');
    const purchases = db.prepare(`
      SELECT poi.id AS line_id, poi.purchase_order_id, po.order_number, po.status,
        poi.ordered_quantity, poi.received_quantity, poi.unit_cost, po.created_at
      FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id
      WHERE poi.product_id = ? ORDER BY po.id DESC
    `).all(productId).map((row) => ({
      purchaseOrderItemId: row.line_id,
      purchaseOrderId: row.purchase_order_id,
      purchaseOrderNumber: row.order_number,
      status: row.status,
      orderedQuantity: row.ordered_quantity,
      receivedQuantity: row.received_quantity,
      unitCost: row.unit_cost / 100,
      createdAt: row.created_at,
    }));
    const sales = db.prepare(`
      SELECT oi.id AS line_id, o.id AS order_id, o.order_number, o.customer_name,
        o.customer_id, o.status, oi.quantity, oi.unit_price, o.created_at
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = ? ORDER BY o.id DESC
    `).all(productId).map((row) => ({
      orderItemId: row.line_id,
      orderId: row.order_id,
      orderNumber: row.order_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      status: row.status,
      quantity: row.quantity,
      unitPrice: row.unit_price / 100,
      createdAt: row.created_at,
    }));
    res.json({ purchases, sales });
  });

  app.get('/api/orders', (req, res) => {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const pageSize = req.query.pageSize === undefined ? 100 : Number(req.query.pageSize);
    const status = req.query.status;
    const customerId = req.query.customerId === undefined ? undefined : Number(req.query.customerId);
    const from = req.query.from;
    const to = req.query.to;
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return res.status(400).json({ error: 'page must be positive and pageSize must be between 1 and 100.' });
    }
    if (status !== undefined && !['draft', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Unsupported sales order status.' });
    }
    if (customerId !== undefined && (!Number.isSafeInteger(customerId) || customerId < 1)) {
      return res.status(400).json({ error: 'customerId must be a positive integer.' });
    }
    for (const date of [from, to]) {
      if (date !== undefined && (typeof date !== 'string' || Number.isNaN(Date.parse(date)))) {
        return res.status(400).json({ error: 'from and to must be valid dates.' });
      }
    }
    const conditions = [];
    const params = [];
    if (status) conditions.push('status = ?'), params.push(status);
    if (customerId !== undefined) conditions.push('customer_id = ?'), params.push(customerId);
    if (from) conditions.push('created_at >= ?'), params.push(from);
    if (to) conditions.push('created_at <= ?'), params.push(to);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS count FROM orders ${where}`).get(...params).count;
    const rows = db.prepare(`SELECT * FROM orders ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize);
    res.json({
      orders: rows.map((row) => mapOrder(row, db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(row.id))),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  });

  app.get('/api/orders/:id', (req, res) => {
    const order = getOrderWithItems(db, parseId(req.params.id, 'Order'));
    if (!order) throw notFound('Order not found.');
    res.json({ order });
  });

  app.post('/api/orders/drafts', (req, res) => {
    const input = validate(salesDraftSchema, req.body);
    res.status(201).json({ order: createSalesOrder(db, input, 'draft') });
  });

  app.put('/api/orders/:id', (req, res) => {
    const input = validate(salesDraftSchema, req.body);
    const orderId = parseId(req.params.id, 'Order');
    const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!existing) throw notFound('Order not found.');
    if (existing.status !== 'draft') {
      const error = new Error('Only draft sales orders can be edited.');
      error.status = 409;
      throw error;
    }
    let customerId = input.customerId === undefined ? existing.customer_id : input.customerId;
    let customerName = input.customerName;
    if (customerId !== null && customerId !== undefined) {
      const customer = db.prepare('SELECT id, name, is_active FROM customers WHERE id = ?').get(customerId);
      if (!customer) {
        const error = new Error('Customer not found.');
        error.status = 404;
        throw error;
      }
      if (!customer.is_active) {
        const error = new Error('Inactive customers cannot be selected for a sales order.');
        error.status = 409;
        throw error;
      }
      customerName = customer.name;
    } else if (input.customerName === undefined) {
      customerName = existing.customer_name;
    }
    const items = input.items.map((item) => {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.productId);
      if (!product) {
        const error = new Error(`Product ${item.productId} was not found.`);
        error.status = 404;
        throw error;
      }
      return { ...item, product };
    });
    const total = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    if (!Number.isSafeInteger(total)) {
      const error = new Error('Order total exceeds the supported amount.');
      error.status = 400;
      throw error;
    }
    const replaceDraft = db.transaction(() => {
      db.prepare(`
        UPDATE orders SET customer_name = ?, customer_id = ?, total = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND status = 'draft' AND stock_deducted_at IS NULL
      `).run(customerName, customerId ?? null, total, orderId);
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
      const insert = db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, sku, quantity, unit_price)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const item of items) {
        insert.run(orderId, item.product.id, item.product.name, item.product.sku, item.quantity, item.product.price);
      }
    });
    replaceDraft.immediate();
    res.json({ order: getOrderWithItems(db, orderId) });
  });

  app.patch('/api/orders/:id/status', (req, res) => {
    const input = validate(salesStatusSchema, req.body);
    const orderId = parseId(req.params.id, 'Order');
    const transition = db.transaction(() => {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order) throw notFound('Order not found.');
      const allowed = {
        draft: ['confirmed', 'cancelled'],
        confirmed: ['processing', 'cancelled'],
        processing: ['shipped'],
        shipped: ['delivered'],
        delivered: [],
        cancelled: [],
      };
      if (!allowed[order.status]?.includes(input.status)) {
        const error = new Error(`Cannot transition a ${order.status} order to ${input.status}.`);
        error.status = 409;
        throw error;
      }
      if (input.status === 'cancelled') {
        const financialRecord = db.prepare(`
          SELECT 1 FROM invoices
          WHERE order_id = ? AND status != 'void'
          UNION ALL
          SELECT 1 FROM sales_returns
          WHERE order_id = ? AND status != 'rejected'
          LIMIT 1
        `).get(orderId, orderId);
        if (financialRecord) {
          const error = new Error('An order with an active invoice or return cannot be cancelled.');
          error.status = 409;
          throw error;
        }
      }
      if (input.status === 'confirmed') {
        if (order.stock_deducted_at) {
          const error = new Error('Stock has already been deducted for this order.');
          error.status = 409;
          throw error;
        }
        const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId);
        for (const item of items) {
          ledgerStockMovement(db, {
            productId: item.product_id,
            movementType: 'sale',
            quantityDelta: -item.quantity,
            referenceType: 'order',
            referenceId: orderId,
            reason: `Stock deducted for order ${order.order_number}`,
          });
        }
        db.prepare(`
          UPDATE orders SET stock_deducted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ? AND stock_deducted_at IS NULL
        `).run(orderId);
      }
      if (input.status === 'cancelled' && order.stock_deducted_at) {
        const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId);
        for (const item of items) {
          const saleMovement = db.prepare(`
            SELECT 1 FROM stock_movements
            WHERE product_id = ? AND movement_type = 'sale'
              AND reference_type = 'order' AND reference_id = ?
            LIMIT 1
          `).get(item.product_id, orderId);
          if (!saleMovement) {
            const error = new Error('This historical order has no matching sale movement, so stock cannot be safely restored.');
            error.status = 409;
            throw error;
          }
        }
        for (const item of items) {
          ledgerStockMovement(db, {
            productId: item.product_id,
            movementType: 'return_in',
            quantityDelta: item.quantity,
            referenceType: 'order_cancellation',
            referenceId: orderId,
            reason: `Stock restored for cancelled order ${order.order_number}`,
          });
        }
      }
      db.prepare(`
        UPDATE orders SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
      `).run(input.status, orderId);
      return getOrderWithItems(db, orderId);
    });
    res.json({ order: transition.immediate() });
  });

  app.post('/api/orders', (req, res) => {
    const input = validate(orderSchema, req.body);
    res.status(201).json({ order: createSalesOrder(db, input, 'confirmed') });
  });

  app.post('/api/invoices', (req, res) => {
    const input = validate(invoiceCreateSchema, req.body);
    const create = db.transaction(() => {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(input.orderId);
      if (!order) throw notFound('Sales order not found.');
      if (!['confirmed', 'processing', 'shipped', 'delivered'].includes(order.status) || !order.stock_deducted_at) {
        const error = new Error('Only confirmed or fulfilled sales orders can be invoiced.');
        error.status = 409;
        throw error;
      }
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(order.id);
      const subtotal = items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
      if (!items.length || !Number.isSafeInteger(subtotal) || subtotal !== order.total) {
        const error = new Error('Sales order lines do not reconcile with the stored order total.');
        error.status = 409;
        throw error;
      }
      const customer = order.customer_id
        ? db.prepare('SELECT name, email, address FROM customers WHERE id = ?').get(order.customer_id)
        : null;
      const invoiceDate = input.invoiceDate ?? new Date().toISOString();
      if (input.dueDate && Date.parse(input.dueDate) < Date.parse(invoiceDate)) {
        const error = new Error('dueDate cannot be earlier than invoiceDate.');
        error.status = 400;
        throw error;
      }
      const inserted = db.prepare(`
        INSERT INTO invoices (
          invoice_number, order_id, customer_id, order_number, customer_name,
          customer_email, billing_address, invoice_date, due_date, status,
          subtotal, discount_total, tax_total, total
        ) VALUES ('INVOICE-PENDING', ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, 0, 0, ?)
      `).run(
        order.id,
        order.customer_id,
        order.order_number,
        customer?.name ?? order.customer_name,
        customer?.email ?? null,
        customer?.address ?? null,
        invoiceDate,
        input.dueDate ?? null,
        subtotal,
        subtotal,
      );
      const invoiceId = Number(inserted.lastInsertRowid);
      const invoiceNumber = input.invoiceNumber ?? `INV-${String(invoiceId).padStart(5, '0')}`;
      db.prepare('UPDATE invoices SET invoice_number = ? WHERE id = ?').run(invoiceNumber, invoiceId);
      const insertItem = db.prepare(`
        INSERT INTO invoice_items (
          invoice_id, order_item_id, product_id, product_name, sku,
          quantity, unit_price, subtotal, discount_amount, tax_amount, total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
      `);
      for (const item of items) {
        const lineTotal = item.unit_price * item.quantity;
        if (!Number.isSafeInteger(lineTotal)) {
          const error = new Error('Invoice line total exceeds the supported amount.');
          error.status = 400;
          throw error;
        }
        insertItem.run(
          invoiceId,
          item.id,
          item.product_id,
          item.product_name,
          item.sku,
          item.quantity,
          item.unit_price,
          lineTotal,
          lineTotal,
        );
      }
      return invoiceId;
    });
    const invoiceId = conflictOnUnique(() => create.immediate(), 'An active invoice already exists for this sales order or the invoice number is already in use.');
    res.status(201).json({ invoice: mapInvoice(db, db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId),
      db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(invoiceId)) });
  });

  app.get('/api/invoices', (req, res) => {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const pageSize = req.query.pageSize === undefined ? 50 : Number(req.query.pageSize);
    const customerId = req.query.customerId === undefined ? undefined : Number(req.query.customerId);
    const { status, from, to } = req.query;
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return res.status(400).json({ error: 'page must be positive and pageSize must be between 1 and 100.' });
    }
    if (customerId !== undefined && (!Number.isSafeInteger(customerId) || customerId < 1)) {
      return res.status(400).json({ error: 'customerId must be a positive integer.' });
    }
    if (status !== undefined && !['draft', 'issued', 'partially_paid', 'paid', 'credited', 'void'].includes(status)) {
      return res.status(400).json({ error: 'Unsupported invoice status.' });
    }
    for (const date of [from, to]) {
      if (date !== undefined && (typeof date !== 'string' || Number.isNaN(Date.parse(date)))) {
        return res.status(400).json({ error: 'from and to must be valid dates.' });
      }
    }
    const conditions = [];
    const params = [];
    if (status) conditions.push('status = ?'), params.push(status);
    if (customerId !== undefined) conditions.push('customer_id = ?'), params.push(customerId);
    if (from) conditions.push('invoice_date >= ?'), params.push(from);
    if (to) conditions.push('invoice_date <= ?'), params.push(to);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS count FROM invoices ${where}`).get(...params).count;
    const invoices = db.prepare(`
      SELECT * FROM invoices ${where} ORDER BY id DESC LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize);
    res.json({
      invoices: invoices.map((invoice) => mapInvoice(db, invoice)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  });

  app.get('/api/invoices/:id', (req, res) => {
    const invoiceId = parseId(req.params.id, 'Invoice');
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
    if (!invoice) throw notFound('Invoice not found.');
    const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(invoiceId);
    const payments = db.prepare(`
      SELECT p.*, i.invoice_number FROM payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE p.invoice_id = ? ORDER BY p.id
    `).all(invoiceId);
    const returns = db.prepare('SELECT id FROM sales_returns WHERE invoice_id = ? ORDER BY id').all(invoiceId)
      .map((row) => getSalesReturn(db, row.id));
    res.json({
      invoice: mapInvoice(db, invoice, items),
      payments: payments.map(mapPayment),
      returns,
    });
  });

  app.post('/api/invoices/:id/issue', (req, res) => {
    const invoiceId = parseId(req.params.id, 'Invoice');
    const issue = db.transaction(() => {
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
      if (!invoice) throw notFound('Invoice not found.');
      if (invoice.status !== 'draft') {
        const error = new Error(`Cannot issue an invoice in ${invoice.status} status.`);
        error.status = 409;
        throw error;
      }
      db.prepare(`
        UPDATE invoices SET status = 'issued', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND status = 'draft'
      `).run(invoiceId);
      if (invoice.total === 0) updateInvoiceFinancialStatus(db, invoiceId);
      return db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
    });
    const invoice = issue.immediate();
    res.json({ invoice: mapInvoice(db, invoice, db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(invoiceId)) });
  });

  app.post('/api/invoices/:id/void', (req, res) => {
    const invoiceId = parseId(req.params.id, 'Invoice');
    const voidInvoice = db.transaction(() => {
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
      if (!invoice) throw notFound('Invoice not found.');
      if (!['draft', 'issued'].includes(invoice.status)) {
        const error = new Error('Only unpaid draft or issued invoices can be voided.');
        error.status = 409;
        throw error;
      }
      const hasFinancialActivity = db.prepare(`
        SELECT 1 FROM payments WHERE invoice_id = ? AND status = 'completed'
        UNION ALL SELECT 1 FROM sales_returns WHERE invoice_id = ? AND status != 'rejected'
        UNION ALL SELECT 1 FROM refunds WHERE invoice_id = ? AND status IN ('requested', 'completed')
        LIMIT 1
      `).get(invoiceId, invoiceId, invoiceId);
      if (hasFinancialActivity) {
        const error = new Error('An invoice with completed payments or an active return/refund cannot be voided.');
        error.status = 409;
        throw error;
      }
      db.prepare(`
        UPDATE invoices SET status = 'void', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(invoiceId);
      db.prepare("UPDATE orders SET payment_status = 'unpaid' WHERE id = ?").run(invoice.order_id);
      return db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
    });
    res.json({ invoice: mapInvoice(db, voidInvoice.immediate(), db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(invoiceId)) });
  });

  app.post('/api/invoices/:id/payments', (req, res) => {
    const input = validate(paymentCreateSchema, req.body);
    const invoiceId = parseId(req.params.id, 'Invoice');
    const amount = moneyToMinorUnits(input.amount, 'Payment amount');
    const record = db.transaction(() => {
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
      if (!invoice) throw notFound('Invoice not found.');
      if (!['issued', 'partially_paid'].includes(invoice.status)) {
        const error = new Error('Payments can only be recorded against an issued, collectible invoice.');
        error.status = 409;
        throw error;
      }
      const financials = getInvoiceFinancials(db, invoice);
      if (amount > financials.outstandingBalance) {
        const error = new Error('Payment exceeds the invoice outstanding balance.');
        error.status = 409;
        throw error;
      }
      const inserted = db.prepare(`
        INSERT INTO payments (
          invoice_id, payment_reference, external_reference, amount, method,
          status, payment_date, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        invoiceId,
        input.paymentReference ?? `PAY-${randomUUID()}`,
        input.externalReference ?? null,
        amount,
        input.method,
        input.status,
        input.paymentDate ?? new Date().toISOString(),
        input.notes ?? null,
      );
      const paymentId = Number(inserted.lastInsertRowid);
      if (input.status === 'completed') updateInvoiceFinancialStatus(db, invoiceId);
      return paymentId;
    });
    const paymentId = conflictOnUnique(() => record.immediate(), 'Payment reference or external transaction reference already exists.');
    const payment = db.prepare(`
      SELECT p.*, i.invoice_number FROM payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE p.id = ?
    `).get(paymentId);
    res.status(201).json({ payment: mapPayment(payment) });
  });

  app.get('/api/payments', (req, res) => {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const pageSize = req.query.pageSize === undefined ? 50 : Number(req.query.pageSize);
    const invoiceId = req.query.invoiceId === undefined ? undefined : Number(req.query.invoiceId);
    const { status, from, to } = req.query;
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return res.status(400).json({ error: 'page must be positive and pageSize must be between 1 and 100.' });
    }
    if (invoiceId !== undefined && (!Number.isSafeInteger(invoiceId) || invoiceId < 1)) {
      return res.status(400).json({ error: 'invoiceId must be a positive integer.' });
    }
    if (status !== undefined && !['completed', 'failed', 'reversed'].includes(status)) {
      return res.status(400).json({ error: 'Unsupported payment status.' });
    }
    for (const date of [from, to]) {
      if (date !== undefined && (typeof date !== 'string' || Number.isNaN(Date.parse(date)))) {
        return res.status(400).json({ error: 'from and to must be valid dates.' });
      }
    }
    const conditions = [];
    const params = [];
    if (invoiceId !== undefined) conditions.push('p.invoice_id = ?'), params.push(invoiceId);
    if (status) conditions.push('p.status = ?'), params.push(status);
    if (from) conditions.push('p.payment_date >= ?'), params.push(from);
    if (to) conditions.push('p.payment_date <= ?'), params.push(to);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS count FROM payments p ${where}`).get(...params).count;
    const rows = db.prepare(`
      SELECT p.*, i.invoice_number FROM payments p JOIN invoices i ON i.id = p.invoice_id
      ${where} ORDER BY p.id DESC LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize);
    res.json({ payments: rows.map(mapPayment), total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  });

  app.get('/api/payments/:id', (req, res) => {
    const paymentId = parseId(req.params.id, 'Payment');
    const payment = db.prepare(`
      SELECT p.*, i.invoice_number FROM payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE p.id = ?
    `).get(paymentId);
    if (!payment) throw notFound('Payment not found.');
    res.json({ payment: mapPayment(payment) });
  });

  app.post('/api/payments/:id/reverse', (req, res) => {
    const paymentId = parseId(req.params.id, 'Payment');
    const reverse = db.transaction(() => {
      const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
      if (!payment) throw notFound('Payment not found.');
      if (payment.status !== 'completed') {
        const error = new Error('Only completed payments can be reversed.');
        error.status = 409;
        throw error;
      }
      const hasRefund = db.prepare(`
        SELECT 1 FROM refunds WHERE payment_id = ? AND status IN ('requested', 'completed') LIMIT 1
      `).get(paymentId);
      if (hasRefund) {
        const error = new Error('A payment with a requested or completed refund cannot be reversed.');
        error.status = 409;
        throw error;
      }
      db.prepare(`
        UPDATE payments SET status = 'reversed', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND status = 'completed'
      `).run(paymentId);
      updateInvoiceFinancialStatus(db, payment.invoice_id);
      return db.prepare(`
        SELECT p.*, i.invoice_number FROM payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE p.id = ?
      `).get(paymentId);
    });
    res.json({ payment: mapPayment(reverse.immediate()) });
  });

  app.post('/api/returns', (req, res) => {
    const input = validate(returnCreateSchema, req.body);
    const create = db.transaction(() => {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(input.orderId);
      if (!order) throw notFound('Sales order not found.');
      if (!['confirmed', 'processing', 'shipped', 'delivered'].includes(order.status) || !order.stock_deducted_at) {
        const error = new Error('Returns require a confirmed, non-cancelled sale with deducted stock.');
        error.status = 409;
        throw error;
      }
      const activeInvoice = db.prepare(`
        SELECT * FROM invoices WHERE order_id = ? AND status != 'void' ORDER BY id DESC LIMIT 1
      `).get(order.id);
      const invoiceId = input.invoiceId ?? activeInvoice?.id ?? null;
      let invoice = null;
      if (invoiceId !== null) {
        invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
        if (!invoice || invoice.order_id !== order.id) {
          const error = new Error('Invoice must belong to the referenced sales order.');
          error.status = 400;
          throw error;
        }
        if (!['issued', 'partially_paid', 'paid', 'credited'].includes(invoice.status)) {
          const error = new Error('Returns require an issued, non-void invoice.');
          error.status = 409;
          throw error;
        }
      }
      const orderItems = new Map(
        db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id).map((item) => [item.id, item]),
      );
      const reservedLines = [];
      let returnTotal = 0;
      for (const line of input.items) {
        const orderItem = orderItems.get(line.orderItemId);
        if (!orderItem) {
          const error = new Error(`Order item ${line.orderItemId} does not belong to this sales order.`);
          error.status = 400;
          throw error;
        }
        const reserved = db.prepare(`
          SELECT COALESCE(SUM(sri.quantity), 0) AS quantity
          FROM sales_return_items sri JOIN sales_returns sr ON sr.id = sri.return_id
          WHERE sri.order_item_id = ? AND sr.status IN ('draft', 'accepted')
        `).get(orderItem.id).quantity;
        if (line.quantity + reserved > orderItem.quantity) {
          const error = new Error('Returned quantity exceeds the sold quantity remaining for this order line.');
          error.status = 409;
          throw error;
        }
        const eligibleAmount = orderItem.unit_price * line.quantity;
        if (!Number.isSafeInteger(eligibleAmount)) {
          const error = new Error('Return amount exceeds the supported amount.');
          error.status = 400;
          throw error;
        }
        returnTotal += eligibleAmount;
        reservedLines.push({ line, orderItem, eligibleAmount });
      }
      if (!Number.isSafeInteger(returnTotal)) {
        const error = new Error('Return total exceeds the supported amount.');
        error.status = 400;
        throw error;
      }
      if (invoice) {
        const reservedAmount = db.prepare(`
          SELECT COALESCE(SUM(sri.refund_eligible_amount), 0) AS amount
          FROM sales_return_items sri JOIN sales_returns sr ON sr.id = sri.return_id
          WHERE sr.invoice_id = ? AND sr.status IN ('draft', 'accepted')
        `).get(invoice.id).amount;
        if (reservedAmount + returnTotal > invoice.total) {
          const error = new Error('Return credit would exceed the invoice total.');
          error.status = 409;
          throw error;
        }
      }
      const customer = order.customer_id
        ? db.prepare('SELECT name FROM customers WHERE id = ?').get(order.customer_id)
        : null;
      const inserted = db.prepare(`
        INSERT INTO sales_returns (
          return_number, order_id, invoice_id, customer_id, customer_name,
          return_date, reason, status
        ) VALUES ('RETURN-PENDING', ?, ?, ?, ?, ?, ?, 'draft')
      `).run(
        order.id,
        invoiceId,
        order.customer_id,
        customer?.name ?? order.customer_name,
        input.returnDate ?? new Date().toISOString(),
        input.reason,
      );
      const returnId = Number(inserted.lastInsertRowid);
      const returnNumber = input.returnNumber ?? `RET-${String(returnId).padStart(5, '0')}`;
      db.prepare('UPDATE sales_returns SET return_number = ? WHERE id = ?').run(returnNumber, returnId);
      const insertItem = db.prepare(`
        INSERT INTO sales_return_items (
          return_id, order_item_id, product_id, product_name, sku,
          quantity, restockable, restock_reason, unit_price, refund_eligible_amount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const { line, orderItem, eligibleAmount } of reservedLines) {
        insertItem.run(
          returnId,
          orderItem.id,
          orderItem.product_id,
          orderItem.product_name,
          orderItem.sku,
          line.quantity,
          Number(line.restockable),
          line.restockReason,
          orderItem.unit_price,
          eligibleAmount,
        );
      }
      return returnId;
    });
    const returnId = conflictOnUnique(() => create.immediate(), 'Return number already exists.');
    res.status(201).json({ salesReturn: getSalesReturn(db, returnId) });
  });

  app.get('/api/returns', (req, res) => {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const pageSize = req.query.pageSize === undefined ? 50 : Number(req.query.pageSize);
    const orderId = req.query.orderId === undefined ? undefined : Number(req.query.orderId);
    const invoiceId = req.query.invoiceId === undefined ? undefined : Number(req.query.invoiceId);
    const { status, from, to } = req.query;
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return res.status(400).json({ error: 'page must be positive and pageSize must be between 1 and 100.' });
    }
    for (const [value, field] of [[orderId, 'orderId'], [invoiceId, 'invoiceId']]) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
        return res.status(400).json({ error: `${field} must be a positive integer.` });
      }
    }
    if (status !== undefined && !['draft', 'accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Unsupported return status.' });
    }
    for (const date of [from, to]) {
      if (date !== undefined && (typeof date !== 'string' || Number.isNaN(Date.parse(date)))) {
        return res.status(400).json({ error: 'from and to must be valid dates.' });
      }
    }
    const conditions = [];
    const params = [];
    if (orderId !== undefined) conditions.push('order_id = ?'), params.push(orderId);
    if (invoiceId !== undefined) conditions.push('invoice_id = ?'), params.push(invoiceId);
    if (status) conditions.push('status = ?'), params.push(status);
    if (from) conditions.push('return_date >= ?'), params.push(from);
    if (to) conditions.push('return_date <= ?'), params.push(to);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS count FROM sales_returns ${where}`).get(...params).count;
    const rows = db.prepare(`SELECT id FROM sales_returns ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize);
    res.json({
      returns: rows.map((row) => getSalesReturn(db, row.id)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  });

  app.get('/api/returns/:id', (req, res) => {
    const salesReturn = getSalesReturn(db, parseId(req.params.id, 'Return'));
    if (!salesReturn) throw notFound('Return not found.');
    res.json({ salesReturn });
  });

  app.post('/api/returns/:id/complete', (req, res) => {
    const input = validate(returnCompleteSchema, req.body);
    const returnId = parseId(req.params.id, 'Return');
    const complete = db.transaction(() => {
      const salesReturn = db.prepare('SELECT * FROM sales_returns WHERE id = ?').get(returnId);
      if (!salesReturn) throw notFound('Return not found.');
      if (salesReturn.status !== 'draft') {
        const error = new Error(`Cannot complete a return in ${salesReturn.status} status.`);
        error.status = 409;
        throw error;
      }
      if (input.status === 'accepted') {
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(salesReturn.order_id);
        if (!order || order.status === 'cancelled' || !order.stock_deducted_at) {
          const error = new Error('A cancelled or unconfirmed sale cannot be accepted for return.');
          error.status = 409;
          throw error;
        }
        const items = db.prepare('SELECT * FROM sales_return_items WHERE return_id = ? ORDER BY id').all(returnId);
        for (const item of items) {
          const previouslyAccepted = db.prepare(`
            SELECT COALESCE(SUM(sri.quantity), 0) AS quantity
            FROM sales_return_items sri JOIN sales_returns sr ON sr.id = sri.return_id
            WHERE sri.order_item_id = ? AND sr.status = 'accepted'
          `).get(item.order_item_id).quantity;
          const sold = db.prepare('SELECT quantity FROM order_items WHERE id = ?').get(item.order_item_id).quantity;
          if (previouslyAccepted + item.quantity > sold) {
            const error = new Error('Accepted return quantities exceed the sold quantity.');
            error.status = 409;
            throw error;
          }
        }
        if (salesReturn.invoice_id) {
          const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(salesReturn.invoice_id);
          if (!invoice || invoice.status === 'void' || invoice.status === 'draft') {
            const error = new Error('The associated invoice is no longer eligible for return credit.');
            error.status = 409;
            throw error;
          }
          const acceptedCredit = db.prepare(`
            SELECT COALESCE(SUM(sri.refund_eligible_amount), 0) AS amount
            FROM sales_return_items sri JOIN sales_returns sr ON sr.id = sri.return_id
            WHERE sr.invoice_id = ? AND sr.status = 'accepted'
          `).get(invoice.id).amount;
          const currentCredit = items.reduce((sum, item) => sum + item.refund_eligible_amount, 0);
          if (acceptedCredit + currentCredit > invoice.total) {
            const error = new Error('Accepted return credit would exceed the invoice total.');
            error.status = 409;
            throw error;
          }
        }
        for (const item of items) {
          if (item.restockable) {
            ledgerStockMovement(db, {
              productId: item.product_id,
              movementType: 'return_in',
              quantityDelta: item.quantity,
              referenceType: 'sales_return',
              referenceId: returnId,
              reason: item.restock_reason,
            });
          }
        }
      }
      db.prepare(`
        UPDATE sales_returns SET status = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND status = 'draft'
      `).run(input.status, returnId);
      if (input.status === 'accepted' && salesReturn.invoice_id) {
        updateInvoiceFinancialStatus(db, salesReturn.invoice_id);
      }
      return getSalesReturn(db, returnId);
    });
    res.json({ salesReturn: complete.immediate() });
  });

  app.post('/api/returns/:id/refunds', (req, res) => {
    const input = validate(refundCreateSchema, req.body);
    const returnId = parseId(req.params.id, 'Return');
    const amount = moneyToMinorUnits(input.amount, 'Refund amount');
    const create = db.transaction(() => {
      const salesReturn = db.prepare('SELECT * FROM sales_returns WHERE id = ?').get(returnId);
      if (!salesReturn) throw notFound('Return not found.');
      if (salesReturn.status !== 'accepted' || !salesReturn.invoice_id) {
        const error = new Error('Refunds require an accepted return linked to an invoice.');
        error.status = 409;
        throw error;
      }
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(salesReturn.invoice_id);
      const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(input.paymentId);
      if (!invoice || !payment || payment.invoice_id !== invoice.id) {
        const error = new Error('Payment must belong to the return invoice.');
        error.status = 400;
        throw error;
      }
      if (payment.status !== 'completed') {
        const error = new Error('Refunds can only be paid from a completed payment.');
        error.status = 409;
        throw error;
      }
      const returnCredit = db.prepare(`
        SELECT COALESCE(SUM(refund_eligible_amount), 0) AS amount
        FROM sales_return_items WHERE return_id = ?
      `).get(returnId).amount;
      const reservedRefunds = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS amount FROM refunds
        WHERE return_id = ? AND status IN ('requested', 'completed')
      `).get(returnId).amount;
      if (amount + reservedRefunds > returnCredit) {
        const error = new Error('Refund exceeds the remaining eligible amount for this return.');
        error.status = 409;
        throw error;
      }
      const paymentRefunds = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS amount FROM refunds
        WHERE payment_id = ? AND status IN ('requested', 'completed')
      `).get(payment.id).amount;
      if (amount + paymentRefunds > payment.amount) {
        const error = new Error('Refund exceeds the unrefunded amount of the selected payment.');
        error.status = 409;
        throw error;
      }
      const inserted = db.prepare(`
        INSERT INTO refunds (
          refund_reference, return_id, invoice_id, payment_id,
          amount, method, external_reference, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'requested', ?)
      `).run(
        input.refundReference ?? `REF-${randomUUID()}`,
        returnId,
        invoice.id,
        payment.id,
        amount,
        input.method,
        input.externalReference ?? null,
        input.notes ?? null,
      );
      const refundId = Number(inserted.lastInsertRowid);
      return refundId;
    });
    const refundId = conflictOnUnique(() => create.immediate(), 'Refund reference or external transaction reference already exists.');
    res.status(201).json({ refund: mapRefund(db.prepare('SELECT * FROM refunds WHERE id = ?').get(refundId)) });
  });

  app.post('/api/refunds/:id/complete', (req, res) => {
    const refundId = parseId(req.params.id, 'Refund');
    const complete = db.transaction(() => {
      const refund = db.prepare('SELECT * FROM refunds WHERE id = ?').get(refundId);
      if (!refund) throw notFound('Refund not found.');
      if (refund.status !== 'requested') {
        const error = new Error(`Cannot complete a refund in ${refund.status} status.`);
        error.status = 409;
        throw error;
      }
      const salesReturn = db.prepare('SELECT status FROM sales_returns WHERE id = ?').get(refund.return_id);
      const payment = db.prepare('SELECT status, amount FROM payments WHERE id = ?').get(refund.payment_id);
      if (salesReturn?.status !== 'accepted' || payment?.status !== 'completed') {
        const error = new Error('Refund eligibility changed before completion.');
        error.status = 409;
        throw error;
      }
      const reservedForReturn = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS amount FROM refunds
        WHERE return_id = ? AND status IN ('requested', 'completed')
      `).get(refund.return_id).amount;
      const eligible = db.prepare(`
        SELECT COALESCE(SUM(refund_eligible_amount), 0) AS amount
        FROM sales_return_items WHERE return_id = ?
      `).get(refund.return_id).amount;
      if (reservedForReturn > eligible) {
        const error = new Error('Refund reservations exceed the eligible return credit.');
        error.status = 409;
        throw error;
      }
      const reservedForPayment = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS amount FROM refunds
        WHERE payment_id = ? AND status IN ('requested', 'completed')
      `).get(refund.payment_id).amount;
      if (reservedForPayment > payment.amount) {
        const error = new Error('Refund reservations exceed the completed payment.');
        error.status = 409;
        throw error;
      }
      db.prepare(`
        UPDATE refunds SET status = 'completed', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND status = 'requested'
      `).run(refundId);
      updateInvoiceFinancialStatus(db, refund.invoice_id);
      return db.prepare('SELECT * FROM refunds WHERE id = ?').get(refundId);
    });
    res.json({ refund: mapRefund(complete.immediate()) });
  });

  app.post('/api/refunds/:id/fail', (req, res) => {
    const refundId = parseId(req.params.id, 'Refund');
    const fail = db.transaction(() => {
      const refund = db.prepare('SELECT * FROM refunds WHERE id = ?').get(refundId);
      if (!refund) throw notFound('Refund not found.');
      if (refund.status !== 'requested') {
        const error = new Error(`Cannot fail a refund in ${refund.status} status.`);
        error.status = 409;
        throw error;
      }
      db.prepare(`
        UPDATE refunds SET status = 'failed', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND status = 'requested'
      `).run(refundId);
      return db.prepare('SELECT * FROM refunds WHERE id = ?').get(refundId);
    });
    res.json({ refund: mapRefund(fail.immediate()) });
  });

  app.get('/api/refunds', (req, res) => {
    const page = req.query.page === undefined ? 1 : Number(req.query.page);
    const pageSize = req.query.pageSize === undefined ? 50 : Number(req.query.pageSize);
    const invoiceId = req.query.invoiceId === undefined ? undefined : Number(req.query.invoiceId);
    const returnId = req.query.returnId === undefined ? undefined : Number(req.query.returnId);
    const { status } = req.query;
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return res.status(400).json({ error: 'page must be positive and pageSize must be between 1 and 100.' });
    }
    for (const [value, field] of [[invoiceId, 'invoiceId'], [returnId, 'returnId']]) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
        return res.status(400).json({ error: `${field} must be a positive integer.` });
      }
    }
    if (status !== undefined && !['requested', 'completed', 'failed'].includes(status)) {
      return res.status(400).json({ error: 'Unsupported refund status.' });
    }
    const conditions = [];
    const params = [];
    if (invoiceId !== undefined) conditions.push('invoice_id = ?'), params.push(invoiceId);
    if (returnId !== undefined) conditions.push('return_id = ?'), params.push(returnId);
    if (status) conditions.push('status = ?'), params.push(status);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS count FROM refunds ${where}`).get(...params).count;
    const refunds = db.prepare(`SELECT * FROM refunds ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize);
    res.json({ refunds: refunds.map(mapRefund), total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  });

  app.get('/api/refunds/:id', (req, res) => {
    const refund = db.prepare('SELECT * FROM refunds WHERE id = ?').get(parseId(req.params.id, 'Refund'));
    if (!refund) throw notFound('Refund not found.');
    res.json({ refund: mapRefund(refund) });
  });

  app.use((error, _req, res, _next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      return res.status(400).json({ error: 'Request body must contain valid JSON.' });
    }
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: status === 500 ? 'An unexpected server error occurred.' : error.message });
  });

  return app;
}
