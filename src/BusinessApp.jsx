import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, ArrowLeftRight, BarChart3, Boxes, Check,
  ChevronDown, CircleDollarSign, ClipboardList, FileText, LayoutDashboard,
  LoaderCircle, Menu, Package, Plus, RefreshCw, RotateCcw, Search, ShoppingCart,
  Tag, Truck, Users, Wallet, X,
} from 'lucide-react';
import './business.css';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const navGroups = [
  { title: 'Overview', items: [['Dashboard', LayoutDashboard], ['Reports', BarChart3]] },
  { title: 'Catalog', items: [['Products', Package], ['Categories', Tag], ['Suppliers', Truck], ['Customers', Users]] },
  { title: 'Operations', items: [['Sales orders', ShoppingCart], ['Purchase orders', ClipboardList], ['Goods receipts', Truck], ['Stock movements', ArrowLeftRight]] },
  { title: 'Finance', items: [['Invoices', FileText], ['Payments', Wallet], ['Returns & refunds', CircleDollarSign]] },
];
const salesStates = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
  } catch {
    throw new Error('Could not reach StockPilot. Check that the API server is running and try again.');
  }
  if (response.status === 204) return null;
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`The API returned an unreadable response (${response.status}).`);
  }
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

const queryString = (values) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== '' && value !== undefined && value !== null) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : '';
};
const send = (method, body) => ({ method, body: JSON.stringify(body) });
const textDate = (value) => value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(value)) : '—';
const asIso = (value, endOfDay = false) => value ? new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`).toISOString() : undefined;
const asMoney = (value) => money.format(Number(value || 0));
const isMoneyField = (key) => /(?:amount|total|balance|price|cost|payments|refunds|credits|cash)$/i.test(key) || key === 'netCashRetained';
const statusClass = (value = '') => `badge badge-${String(value).toLowerCase().replaceAll('_', '-').replaceAll(' ', '-')}`;
const shortId = (prefix, id) => `${prefix}-${String(id).padStart(5, '0')}`;

function dateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

function presetDateRange(preset) {
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = new Date(end);
  if (preset === '7' || preset === '30' || preset === '90') {
    start.setUTCDate(start.getUTCDate() - (Number(preset) - 1));
  } else if (preset === 'month') {
    start.setUTCDate(1);
  } else if (preset === 'year') {
    start.setUTCMonth(0, 1);
  }
  return { from: dateInputValue(start), to: dateInputValue(end) };
}

async function downloadAnalyticsCsv(dataset, range) {
  const query = queryString({
    from: range.from,
    to: range.to,
    period: range.period,
    categoryId: range.categoryId,
    supplierId: range.supplierId,
    windowDays: range.windowDays,
  });
  let response;
  try {
    response = await fetch(`/api/analytics/exports/${dataset}.csv${query}`);
  } catch {
    throw new Error('Could not reach StockPilot. Check that the API server is running and try again.');
  }
  if (!response.ok) {
    let message = `CSV export failed (${response.status}).`;
    try {
      message = (await response.json()).error || message;
    } catch {
      // Keep the explicit status message when the server response is not JSON.
    }
    throw new Error(message);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `${dataset}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function BusinessApp() {
  const [page, setPage] = useState('Dashboard');
  const [mobileNav, setMobileNav] = useState(false);
  const menuButtonRef = useRef(null);
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(() => ({
    Dashboard: { preset: '30', period: 'daily', ...presetDateRange('30') },
    Reports: { preset: '30', period: 'daily', ...presetDateRange('30') },
  }));
  const [pageIndex, setPageIndex] = useState({});
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState('');
  const exportInFlight = useRef(false);
  const loadSequence = useRef(0);

  const loadPage = useCallback(async (target = page) => {
    const requestSequence = ++loadSequence.current;
    const setCurrentData = (updater) => {
      if (requestSequence === loadSequence.current) setData(updater);
    };
    setLoading(true);
    setError('');
    try {
      const filter = filters[target] || {};
      let result;
      switch (target) {
        case 'Dashboard':
          {
            const dimensions = { categoryId: filter.categoryId, supplierId: filter.supplierId };
            const query = queryString({ from: filter.from, to: filter.to, period: filter.period || 'daily', ...dimensions, windowDays: filter.windowDays || 90 });
            const [overview, inventory, salesTrend, topProducts, stockMovements, categories, suppliers] = await Promise.all([
              api(`/analytics/overview${query}`),
              api(`/analytics/inventory${queryString({ ...dimensions, windowDays: filter.windowDays || 90 })}`),
              api(`/analytics/sales-trend${query}`),
              api(`/analytics/top-products${queryString({ from: filter.from, to: filter.to, limit: 5, ...dimensions })}`),
              api(`/analytics/stock-movements${queryString({ from: filter.from, to: filter.to, limit: 8, ...dimensions })}`),
              api('/categories'),
              api('/suppliers'),
            ]);
            setCurrentData((old) => ({
              ...old,
              analytics: { overview, inventory, salesTrend, topProducts, stockMovements, categories: categories.categories, suppliers: suppliers.suppliers },
            }));
          }
          break;
        case 'Reports':
          {
            const dimensions = { categoryId: filter.categoryId, supplierId: filter.supplierId };
            const rangeQuery = queryString({ from: filter.from, to: filter.to, period: filter.period || 'daily', ...dimensions, windowDays: filter.windowDays || 90 });
            const [sales, topProducts, purchasing, inventory, financials, returnsRefunds, statuses, movements, categories, suppliers] = await Promise.all([
              api(`/analytics/sales-trend${rangeQuery}`),
              api(`/analytics/top-products${queryString({ from: filter.from, to: filter.to, limit: 100, ...dimensions })}`),
              api(`/analytics/purchasing${rangeQuery}`),
              api(`/analytics/inventory${queryString({ ...dimensions, windowDays: filter.windowDays || 90 })}`),
              api(`/analytics/financials${queryString({ from: filter.from, to: filter.to })}`),
              api(`/analytics/returns-refunds${queryString({ from: filter.from, to: filter.to })}`),
              api(`/analytics/status-distribution${rangeQuery}`),
              api(`/analytics/stock-movements${queryString({ from: filter.from, to: filter.to, limit: 100, ...dimensions })}`),
              api('/categories'),
              api('/suppliers'),
            ]);
            setCurrentData((old) => ({
              ...old,
              reports: { sales, topProducts, purchasing, inventory, financials, returnsRefunds, statuses, movements },
              reportOptions: { categories: categories.categories, suppliers: suppliers.suppliers },
            }));
          }
          break;
        case 'Products':
          {
            const [products, categories] = await Promise.all([
              api(`/products${queryString({ q: search, categoryId: filter.categoryId, stock: filter.stock, active: filter.active, page: pageIndex[target] || 1, pageSize: 25 })}`),
              api('/categories'),
            ]);
            setCurrentData((old) => ({ ...old, products: products.products, productMeta: products, categories: categories.categories }));
          }
          break;
        case 'Categories':
          result = await api('/categories');
          setCurrentData((old) => ({ ...old, categories: result.categories }));
          break;
        case 'Suppliers':
          result = await api(`/suppliers${queryString({ q: search, active: filter.active })}`);
          setCurrentData((old) => ({ ...old, suppliers: result.suppliers }));
          break;
        case 'Customers':
          result = await api(`/customers${queryString({ q: search, active: filter.active })}`);
          setCurrentData((old) => ({ ...old, customers: result.customers }));
          break;
        case 'Sales orders':
          {
            const [orders, customers] = await Promise.all([
              api(`/orders${queryString({ status: filter.status, customerId: filter.customerId, from: asIso(filter.from), to: asIso(filter.to, true), page: pageIndex[target] || 1, pageSize: 25 })}`),
              api('/customers?active=true'),
            ]);
            setCurrentData((old) => ({ ...old, orders: orders.orders, orderMeta: orders, customers: customers.customers }));
          }
          break;
        case 'Purchase orders':
          {
            const [purchaseOrders, suppliers] = await Promise.all([
              api(`/purchase-orders${queryString({ status: filter.status, supplierId: filter.supplierId, from: asIso(filter.from), to: asIso(filter.to, true), page: pageIndex[target] || 1, pageSize: 25 })}`),
              api('/suppliers?active=true'),
            ]);
            setCurrentData((old) => ({ ...old, purchaseOrders: purchaseOrders.purchaseOrders, purchaseMeta: purchaseOrders, suppliers: suppliers.suppliers }));
          }
          break;
        case 'Goods receipts':
          {
            const [receipts, suppliers, purchaseOrders] = await Promise.all([
              api(`/goods-receipts${queryString({ supplierId: filter.supplierId, purchaseOrderId: filter.purchaseOrderId, page: pageIndex[target] || 1, pageSize: 25 })}`),
              api('/suppliers?active=true'),
              api('/purchase-orders?page=1&pageSize=100'),
            ]);
            setCurrentData((old) => ({ ...old, receipts: receipts.receipts, receiptMeta: receipts, suppliers: suppliers.suppliers, purchaseOrders: purchaseOrders.purchaseOrders }));
          }
          break;
        case 'Invoices':
          {
            const [invoices, customers, orders] = await Promise.all([
              api(`/invoices${queryString({ status: filter.status, customerId: filter.customerId, from: asIso(filter.from), to: asIso(filter.to, true), page: pageIndex[target] || 1, pageSize: 25 })}`),
              api('/customers?active=true'),
              api('/orders?page=1&pageSize=100'),
            ]);
            setCurrentData((old) => ({ ...old, invoices: invoices.invoices, invoiceMeta: invoices, customers: customers.customers, orders: orders.orders }));
          }
          break;
        case 'Payments':
          {
            const [payments, invoices] = await Promise.all([
              api(`/payments${queryString({ status: filter.status, invoiceId: filter.invoiceId, from: asIso(filter.from), to: asIso(filter.to, true), page: pageIndex[target] || 1, pageSize: 25 })}`),
              api('/invoices?page=1&pageSize=100'),
            ]);
            setCurrentData((old) => ({ ...old, payments: payments.payments, paymentMeta: payments, invoices: invoices.invoices }));
          }
          break;
        case 'Returns & refunds': {
          const [returnResult, refundResult] = await Promise.all([
            api(`/returns${queryString({ status: filter.status, page: pageIndex[target] || 1, pageSize: 25 })}`),
            api(`/refunds${queryString({ status: filter.refundStatus, page: pageIndex[target] || 1, pageSize: 25 })}`),
          ]);
          setCurrentData((old) => ({ ...old, returns: returnResult.returns, returnMeta: returnResult, refunds: refundResult.refunds, refundMeta: refundResult }));
          break;
        }
        case 'Stock movements':
          {
            const [movements, products] = await Promise.all([
              api(`/stock-movements${queryString({ productId: filter.productId, type: filter.type, page: pageIndex[target] || 1, pageSize: 25 })}`),
              api('/products?page=1&pageSize=100'),
            ]);
            setCurrentData((old) => ({ ...old, movements: movements.movements, movementMeta: movements, products: products.products }));
          }
          break;
        default:
          break;
      }
    } catch (requestError) {
      if (requestSequence === loadSequence.current) setError(requestError.message);
    } finally {
      if (requestSequence === loadSequence.current) setLoading(false);
    }
  }, [filters, page, pageIndex, search]);

  useEffect(() => { loadPage(page); }, [page, loadPage]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!mobileNav) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setMobileNav(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileNav]);

  const closeMobileNav = () => {
    setMobileNav(false);
    menuButtonRef.current?.focus();
  };
  const navigate = (target) => {
    setPage(target);
    if (mobileNav) closeMobileNav();
    setError('');
    setSearch('');
  };
  const setFilter = (key, value) => {
    setFilters((old) => ({ ...old, [page]: { ...(old[page] || {}), [key]: value } }));
    setPageIndex((old) => ({ ...old, [page]: 1 }));
  };
  const setAnalyticsFilter = (target, key, value) => {
    setFilters((old) => {
      const current = old[target] || {};
      if (key === 'preset' && value !== 'custom') {
        return { ...old, [target]: { ...current, ...presetDateRange(value), preset: value } };
      }
      return { ...old, [target]: { ...current, [key]: value, ...(key === 'from' || key === 'to' ? { preset: 'custom' } : {}) } };
    });
  };
  const setDashboardFilter = (key, value) => setAnalyticsFilter('Dashboard', key, value);
  const setReportFilter = (key, value) => setAnalyticsFilter('Reports', key, value);
  const exportAnalyticsCsv = async (dataset, range = filters[page] || {}) => {
    if (exportInFlight.current) return;
    exportInFlight.current = true;
    setExporting(dataset);
    try {
      await downloadAnalyticsCsv(dataset, range);
      setToast(`${dataset.replaceAll('-', ' ')} CSV downloaded.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      exportInFlight.current = false;
      setExporting('');
    }
  };
  const updateSearch = (value) => {
    setSearch(value);
    setPageIndex((old) => ({ ...old, [page]: 1 }));
  };
  const changePage = (target, value) => setPageIndex((old) => ({ ...old, [target]: value }));
  const refresh = () => loadPage(page);
  const mutate = async (action, success, refreshTargets = [page]) => {
    setBusy(true);
    setError('');
    try {
      await action();
      setDialog(null);
      for (const target of new Set(refreshTargets)) await loadPage(target);
      setToast(success);
      return null;
    } catch (requestError) {
      setError(requestError.message);
      return requestError.message;
    } finally {
      setBusy(false);
    }
  };
  const openDetails = async (kind, id) => {
    setBusy(true);
    setError('');
    try {
      const routes = {
        product: `/products/${id}`,
        category: `/categories/${id}`,
        supplier: `/suppliers/${id}`,
        customer: `/customers/${id}`,
        order: `/orders/${id}`,
        purchaseOrder: `/purchase-orders/${id}`,
        receipt: `/goods-receipts/${id}`,
        invoice: `/invoices/${id}`,
        payment: `/payments/${id}`,
        salesReturn: `/returns/${id}`,
        refund: `/refunds/${id}`,
        productHistory: `/products/${id}/history`,
      };
      const response = await api(routes[kind]);
      if (kind === 'invoice') {
        const payments = await api(`/payments?invoiceId=${id}&page=1&pageSize=100`);
        response.invoice.payments = payments.payments;
      }
      setDialog({ type: 'details', kind, record: response[kind] || response.order || response.purchaseOrder || response.receipt || response.invoice || response.payment || response.salesReturn || response.refund || response });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const showCreate = async (kind, record = null) => {
    setError('');
    const optionRequests = {
      product: { categories: '/categories', suppliers: '/suppliers?active=true' },
      purchaseOrder: { products: '/products?page=1&pageSize=100', suppliers: '/suppliers?active=true' },
      salesOrder: { products: '/products?page=1&pageSize=100', customers: '/customers?active=true' },
      invoice: { orders: '/orders?page=1&pageSize=100', invoices: '/invoices?page=1&pageSize=100' },
      return: { orders: '/orders?page=1&pageSize=100', invoices: '/invoices?page=1&pageSize=100' },
      refund: { payments: `/payments?status=completed&invoiceId=${record?.invoiceId || ''}&page=1&pageSize=100` },
    }[kind];
    if (optionRequests) {
      try {
        const entries = await Promise.all(Object.entries(optionRequests).map(async ([key, path]) => [key, await api(path)]));
        setData((old) => entries.reduce((next, [key, result]) => ({
          ...next,
          [key]: result[key],
        }), old));
        setDialog({ type: 'form', kind, record });
      } catch (requestError) {
        setError(requestError.message);
      }
      return;
    }
    if (kind === 'category') {
      try {
        const response = await api('/categories');
        setData((old) => ({ ...old, categories: response.categories }));
      } catch (requestError) {
        setError(requestError.message);
        return;
      }
    }
    setDialog({ type: 'form', kind, record });
  };

  const confirmAction = (title, description, action, success, targets = [page]) => {
    setDialog({ type: 'confirm', title, description, action: () => mutate(action, success, targets) });
  };

  const dashboard = data.dashboard;
  const pagesThatNeedData = ['Dashboard', 'Reports', 'Products', 'Categories', 'Suppliers', 'Customers', 'Sales orders', 'Purchase orders', 'Goods receipts', 'Invoices', 'Payments', 'Returns & refunds', 'Stock movements'];
  const title = page;

  return (
    <div className="biz-shell">
      <aside className={`biz-sidebar ${mobileNav ? 'open' : ''}`}>
        <a className="biz-brand" href="#" onClick={(event) => { event.preventDefault(); navigate('Dashboard'); }}>
          <span className="biz-brand-mark"><Boxes size={19} /></span><span>stock<span>pilot</span></span>
          <small>BUSINESS</small>
        </a>
        <div className="biz-workspace"><span className="biz-workspace-icon">SP</span><span><strong>StockPilot</strong><small>Inventory workspace</small></span><ChevronDown size={15} /></div>
        <nav id="main-navigation" className="biz-nav" aria-label="Main navigation">
          {navGroups.map((group) => (
            <section key={group.title}>
              <h2>{group.title}</h2>
              {group.items.map(([label, _Icon]) => (
                <button key={label} className={`biz-nav-item ${page === label ? 'active' : ''}`} onClick={() => navigate(label)}>
                  <_Icon size={17} /><span>{label}</span>
                  {label === 'Products' && dashboard?.lowStockCount > 0 && <b>{dashboard.lowStockCount}</b>}
                </button>
              ))}
            </section>
          ))}
        </nav>
        <div className="biz-sidebar-note">
          <span><Activity size={15} /></span>
          <strong>{import.meta.env.DEV ? 'Development sample data' : 'Connected workspace'}</strong>
          <p>{import.meta.env.DEV
            ? 'This local database may include seeded sample records. Do not use it as production data.'
            : 'Business activity is loaded from your local StockPilot database.'}</p>
        </div>
      </aside>
      {mobileNav && <button className="biz-scrim" aria-label="Close navigation" onClick={closeMobileNav} />}
      <main className="biz-main">
        <header className="biz-topbar">
          <button ref={menuButtonRef} className="biz-menu" aria-label={mobileNav ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileNav} aria-controls="main-navigation" onClick={() => mobileNav ? closeMobileNav() : setMobileNav(true)}><Menu size={20} /></button>
          <div><span className="biz-crumb">Workspace /</span><strong>{title}</strong></div>
          <div className="biz-top-actions">
            {page !== 'Dashboard' && <label className="biz-search"><Search size={16} /><input aria-label="Search current list" value={search} onChange={(event) => updateSearch(event.target.value)} placeholder={`Search ${title.toLowerCase()}…`} /></label>}
            <button className="biz-icon-button" onClick={refresh} aria-label="Refresh page"><RefreshCw size={16} /></button>
            <span>{new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</span>
          </div>
        </header>
        <div className="biz-content">
          {error && <div className="biz-error" role="alert"><X size={17} /><span>{error}</span><button aria-label="Retry loading this page" onClick={refresh}>Retry</button><button aria-label="Dismiss error" onClick={() => setError('')}>Dismiss</button></div>}
          {loading ? <Loading /> : pagesThatNeedData.includes(page) ? (
            <PageView
              page={page} data={data} search={search} filters={filters[page] || {}}
              onFilter={setFilter} onNavigate={navigate} onCreate={showCreate} onPageChange={(value) => changePage(page, value)}
              onDetails={openDetails} onConfirm={confirmAction}
              onDashboardFilter={setDashboardFilter} onReportFilter={setReportFilter} onExport={exportAnalyticsCsv} exporting={exporting}
              onEdit={async (kind, record) => {
                if (kind === 'purchaseOrder' || kind === 'salesOrder') {
                  try {
                    const route = kind === 'purchaseOrder' ? `/purchase-orders/${record.id}` : `/orders/${record.id}`;
                    const response = await api(route);
                    await showCreate(kind, response.purchaseOrder || response.order);
                  } catch (requestError) {
                    setError(requestError.message);
                  }
                } else {
                  await showCreate(kind, record);
                }
              }}
            />
          ) : <Empty title="Page unavailable" />}
        </div>
      </main>
      {dialog?.type === 'form' && (
        <FormDialog
          key={`${dialog.kind}-${dialog.record?.id || 'new'}`}
          kind={dialog.kind}
          record={dialog.record}
          data={data}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(action, message, targets = [page]) => mutate(action, message, targets)}
          onError={setError}
        />
      )}
      {dialog?.type === 'details' && (
        <DetailsDialog
          kind={dialog.kind} record={dialog.record} onClose={() => setDialog(null)}
          onCreate={showCreate} onConfirm={confirmAction} onDetails={openDetails} data={data}
        />
      )}
      {dialog?.type === 'confirm' && (
        <Dialog title={dialog.title} onClose={() => setDialog(null)}>
          <div className="biz-confirm"><p>{dialog.description}</p><div className="biz-dialog-actions">
            <button className="biz-button secondary" onClick={() => setDialog(null)}>Keep as is</button>
            <button className="biz-button danger" disabled={busy} onClick={dialog.action}>{busy ? 'Working…' : 'Confirm'}</button>
          </div></div>
        </Dialog>
      )}
      {toast && <div className="biz-toast" role="status"><Check size={16} />{toast}</div>}
    </div>
  );
}

function Loading() {
  return <div className="biz-loading"><LoaderCircle className="spin" size={24} /><span>Loading saved records…</span></div>;
}

function Empty({ title = 'No records yet', detail = 'Records created in StockPilot will appear here.' }) {
  return <div className="biz-empty"><span><Package size={21} /></span><strong>{title}</strong><p>{detail}</p></div>;
}

function PageView({ page, data, search, filters, onFilter, onNavigate, onCreate, onDetails, onConfirm, onPageChange, onEdit, onDashboardFilter, onReportFilter, onExport, exporting }) {
  if (page === 'Dashboard') return <Dashboard data={data.analytics} range={filters} navigate={onNavigate} onCreate={onCreate} onFilter={onDashboardFilter} onExport={onExport} exporting={exporting} />;
  if (page === 'Reports') return <Reports data={data.reports} options={data.reportOptions || {}} range={filters} onFilter={onReportFilter} onExport={onExport} exporting={exporting} />;
  if (page === 'Products') return <Products data={data} search={search} filters={filters} onFilter={onFilter} onCreate={onCreate} onDetails={onDetails} onConfirm={onConfirm} onPageChange={onPageChange} />;
  if (page === 'Categories') return <Categories rows={data.categories || []} search={search} onCreate={onCreate} onDetails={onDetails} onEdit={onEdit} onConfirm={onConfirm} />;
  if (page === 'Suppliers') return <Suppliers rows={data.suppliers || []} search={search} filters={filters} onFilter={onFilter} onCreate={onCreate} onDetails={onDetails} onEdit={onEdit} onConfirm={onConfirm} />;
  if (page === 'Customers') return <Customers rows={data.customers || []} search={search} filters={filters} onFilter={onFilter} onCreate={onCreate} onDetails={onDetails} onEdit={onEdit} onConfirm={onConfirm} />;
  if (page === 'Sales orders') return <SalesOrders rows={matchRows(data.orders, search, ['orderNumber', 'customerName', 'status'])} customers={data.customers || []} meta={data.orderMeta} filters={filters} onFilter={onFilter} onCreate={onCreate} onEdit={onEdit} onDetails={onDetails} onConfirm={onConfirm} onPageChange={onPageChange} />;
  if (page === 'Purchase orders') return <PurchaseOrders rows={matchRows(data.purchaseOrders, search, ['orderNumber', 'supplierName', 'status'])} suppliers={data.suppliers || []} meta={data.purchaseMeta} filters={filters} onFilter={onFilter} onCreate={onCreate} onDetails={onDetails} onEdit={onEdit} onConfirm={onConfirm} onPageChange={onPageChange} />;
  if (page === 'Goods receipts') return <GoodsReceipts rows={matchRows(data.receipts, search, ['receiptNumber', 'purchaseOrderNumber', 'supplierName'])} suppliers={data.suppliers || []} purchaseOrders={data.purchaseOrders || []} meta={data.receiptMeta} filters={filters} onFilter={onFilter} onDetails={onDetails} onPageChange={onPageChange} />;
  if (page === 'Invoices') return <Invoices rows={matchRows(data.invoices, search, ['invoiceNumber', 'orderNumber', 'customerName', 'status'])} customers={data.customers || []} orders={data.orders || []} meta={data.invoiceMeta} filters={filters} onFilter={onFilter} onCreate={onCreate} onDetails={onDetails} onConfirm={onConfirm} onPageChange={onPageChange} />;
  if (page === 'Payments') return <Payments rows={matchRows(data.payments, search, ['paymentReference', 'invoiceNumber', 'externalReference', 'method', 'status'])} invoices={data.invoices || []} meta={data.paymentMeta} filters={filters} onFilter={onFilter} onDetails={onDetails} onConfirm={onConfirm} onPageChange={onPageChange} />;
  if (page === 'Returns & refunds') return <Returns rows={matchRows(data.returns, search, ['returnNumber', 'orderNumber', 'customerName', 'reason', 'status'])} refunds={matchRows(data.refunds, search, ['refundReference', 'method', 'status'])} meta={data.returnMeta} refundMeta={data.refundMeta} filters={filters} onFilter={onFilter} onCreate={onCreate} onDetails={onDetails} onConfirm={onConfirm} onPageChange={onPageChange} />;
  if (page === 'Stock movements') return <Movements rows={matchRows(data.movements, search, ['productName', 'sku', 'movementType', 'reason', 'referenceType'])} meta={data.movementMeta} products={data.products || []} filters={filters} onFilter={onFilter} onDetails={onDetails} onPageChange={onPageChange} />;
  return <Empty />;
}

function matchRows(rows = [], search, fields) {
  const query = search.trim().toLowerCase();
  return query ? rows.filter((row) => fields.some((field) => String(row[field] ?? '').toLowerCase().includes(query))) : rows;
}

function PageHeader({ kicker, title, description, action, icon: _Icon = Plus }) {
  return <div className="biz-page-header"><div><span className="biz-kicker">{kicker}</span><h1>{title}</h1><p>{description}</p></div>{action && <button className="biz-button primary" onClick={action.onClick}><_Icon size={16} />{action.label}</button>}</div>;
}

function Dashboard({ data, range, navigate, onCreate, onFilter, onExport, exporting }) {
  if (!data) return <Empty title="Dashboard unavailable" detail="Refresh the page to retry loading the dashboard." />;
  const overview = data.overview;
  const inventory = data.inventory;
  const categories = data.categories || [];
  const suppliers = data.suppliers || [];
  const salesTrend = data.salesTrend.salesTrend;
  const financials = overview.financials;
  const movementByDay = new Map();
  for (const movement of data.stockMovements.movementsByPeriodAndType) {
    const day = movementByDay.get(movement.period) || { period: movement.period, inbound: 0, outbound: 0 };
    day.inbound += movement.inbound_quantity;
    day.outbound += movement.outbound_quantity;
    movementByDay.set(movement.period, day);
  }
  const stockTrend = [...movementByDay.values()].slice(-14);
  const cards = [
    ['Inventory cost value', asMoney(overview.inventory.inventoryValuation), `Retail value ${asMoney(overview.inventory.retailValue)}`, CircleDollarSign],
    ['Units in stock', Number(overview.inventory.totalUnitsInStock).toLocaleString(), 'All non-archived products', Boxes],
    ['Low-stock items', Number(overview.inventory.lowStockCount).toLocaleString(), 'Active products at reorder level', Package],
    ['Out of stock', Number(overview.inventory.outOfStockCount).toLocaleString(), 'Active products at zero', Package],
    ['Sales orders', Number(overview.sales.orderCount).toLocaleString(), 'Qualifying stock-deducted orders', ShoppingCart],
    ['Average order value', asMoney(overview.sales.averageOrderValue), 'Gross sales / qualifying orders', CircleDollarSign],
    ['Net sales', asMoney(overview.sales.netSalesValue), `${asMoney(overview.sales.acceptedReturnCredits)} accepted return credits`, ShoppingCart],
    ['Missing costs', Number(overview.inventory.missingCostCount).toLocaleString(), 'Products excluded from cost valuation', CircleDollarSign],
    ['Ledger warnings', Number(overview.inventory.reconciliationWarningCount).toLocaleString(), 'Stock differs from latest movement', Activity],
    ['Outstanding invoices', asMoney(financials.outstandingReceivables), 'Current open receivables', FileText],
    ['Net cash retained', asMoney(financials.netCashRetained), 'Completed payments less completed refunds', CircleDollarSign],
    ['Unsettled return credits', asMoney(financials.unsettledReturnCredits), 'Current accepted credits not yet refunded', RotateCcw],
  ];
  const maxSales = Math.max(...salesTrend.map((point) => point.salesValue), 0);
  const maxCategoryValue = Math.max(...inventory.byCategory.map((category) => category.inventoryValue), 0);
  const maxTopSales = Math.max(...data.topProducts.products.map((product) => product.unitsSold), 0);
  const purchaseTrend = overview.purchasing.purchaseTrend;
  const maxPurchaseValue = Math.max(...purchaseTrend.map((point) => point.purchaseValue), 0);
  const maxStockValue = Math.max(...stockTrend.map((point) => point.inbound), ...stockTrend.map((point) => point.outbound), 0);
  return <>
    <PageHeader kicker="BUSINESS INTELLIGENCE" title="Analytics dashboard" description="Inventory, sales, purchasing and cash-flow insights from persisted records." action={{ label: 'Create sales order', onClick: () => onCreate('salesOrder') }} icon={Plus} />
    <section className="biz-panel analytics-controls" aria-label="Analytics date filters">
      <div className="analytics-date-fields">
        <label className="biz-field"><span>Date range</span><select aria-label="Date range preset" value={range.preset || '30'} onChange={(event) => onFilter('preset', event.target.value)}>
          <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="month">This month</option><option value="year">This year</option><option value="custom">Custom range</option>
        </select></label>
        <label className="biz-field"><span>From</span><input aria-label="Analytics start date" type="date" value={range.from || ''} onChange={(event) => onFilter('from', event.target.value)} /></label>
        <label className="biz-field"><span>To</span><input aria-label="Analytics end date" type="date" value={range.to || ''} onChange={(event) => onFilter('to', event.target.value)} /></label>
        <label className="biz-field"><span>Sales interval</span><select aria-label="Sales trend interval" value={range.period || 'daily'} onChange={(event) => onFilter('period', event.target.value)}>
          <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
        </select></label>
        <label className="biz-field"><span>Category</span><select aria-label="Analytics category filter" value={range.categoryId || ''} onChange={(event) => onFilter('categoryId', event.target.value)}>
          <option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select></label>
        <label className="biz-field"><span>Supplier</span><select aria-label="Analytics supplier filter" value={range.supplierId || ''} onChange={(event) => onFilter('supplierId', event.target.value)}>
          <option value="">All suppliers</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.businessName}</option>)}
        </select></label>
        <label className="biz-field"><span>Movement window</span><select aria-label="Slow-moving stock window" value={range.windowDays || 90} onChange={(event) => onFilter('windowDays', event.target.value)}>
          {[30, 60, 90, 180, 365].map((days) => <option key={days} value={days}>{days} days</option>)}
        </select></label>
      </div>
      <div className="analytics-exports" aria-label="Download analytics CSV files">
        <strong>Export CSV</strong>
        {['inventory', 'low-stock', 'out-of-stock', 'top-products', 'sales-trend', 'sales-by-category', 'sales-summary', 'supplier-purchases', 'purchases-by-supplier', 'purchasing-trend', 'order-status', 'invoice-payment-status', 'returns-refunds', 'stock-movements'].map((dataset) => <ExportButton key={dataset} dataset={dataset} range={range} onExport={onExport} exporting={exporting}>{dataset.replaceAll('-', ' ')}</ExportButton>)}
      </div>
    </section>
    <div className="biz-stats">{cards.map(([label, value, note, _Icon]) => <article className="biz-stat" key={label}><span><_Icon size={18} /></span><small>{label}</small><strong>{value}</strong><em>{note}</em></article>)}</div>
    <div className="biz-dashboard-grid">
      <section className="biz-panel analytics-panel"><div className="biz-panel-heading"><div><h2>Gross sales trend</h2><p>Qualifying order totals by {data.salesTrend.period} · return credits shown separately</p></div><ExportButton dataset="sales-trend" range={range} onExport={onExport} exporting={exporting} /></div>
        {salesTrend.some((point) => point.orderCount) ? <div className="analytics-chart-scroll"><div className="analytics-sales-chart" role="img" aria-label="Sales value trend chart">
          {salesTrend.map((point) => <div className="analytics-bar-column" key={point.period} title={`${point.period}: ${asMoney(point.salesValue)} · ${point.orderCount} orders`}><div className="analytics-bar-track"><span className="analytics-bar sales" style={{ height: `${maxSales ? Math.max(3, point.salesValue / maxSales * 100) : 0}%` }} /></div><small>{point.period.slice(5)}</small></div>)}
        </div></div> : <Empty title="No sales in this range" detail="Confirmed and fulfilled orders will appear here." />}
      </section>
      <section className="biz-panel analytics-panel"><div className="biz-panel-heading"><div><h2>Inventory by category</h2><p>Current cost and retail value · missing cost is not inferred</p></div><ExportButton dataset="inventory" range={range} onExport={onExport} exporting={exporting} /></div>
        {inventory.byCategory.length ? <div className="analytics-ranked-list">{inventory.byCategory.map((category) => <div className="analytics-ranked" key={`${category.categoryId}-${category.category}`}><div><strong>{category.category}</strong><span>{category.unitsInStock.toLocaleString()} units · {category.productCount} products · cost {asMoney(category.inventoryValue)} · retail {asMoney(category.retailValue)}</span></div><div className="analytics-rank-track"><span style={{ width: `${maxCategoryValue ? category.inventoryValue / maxCategoryValue * 100 : 0}%` }} /></div></div>)}</div> : <Empty title="No inventory records" />}
      </section>
      <section className="biz-panel analytics-panel"><div className="biz-panel-heading"><div><h2>Sales by category</h2><p>Current product category · accepted return credits shown separately</p></div><ExportButton dataset="sales-by-category" range={range} onExport={onExport} exporting={exporting} /></div>
        {overview.sales.byCategory.length ? <div className="biz-table-wrap"><table className="biz-table analytics-table"><thead><tr><th>Category</th><th>Units net</th><th>Gross sales</th><th>Return credits</th><th>Net sales</th></tr></thead><tbody>{overview.sales.byCategory.map((row) => <tr key={`${row.categoryId}-${row.category}`}><td><strong>{row.category}</strong></td><td>{row.netUnitsSold.toLocaleString()}</td><td>{asMoney(row.grossSalesValue)}</td><td>{asMoney(row.acceptedReturnCredits)}</td><td>{asMoney(row.netSalesValue)}</td></tr>)}</tbody></table></div> : <Empty title="No category sales in this range" /> }
        <div className="analytics-status-list">{overview.sales.statusBreakdown.map((row) => <span key={row.status}><Badge value={row.status} /> {row.orderCount} · {asMoney(row.orderValue)}</span>)}</div>
      </section>
      <section className="biz-panel analytics-panel"><div className="biz-panel-heading"><div><h2>Top-selling products</h2><p>Historical order-line snapshots · units sold</p></div><ExportButton dataset="top-products" range={range} onExport={onExport} exporting={exporting} /></div>
        {data.topProducts.products.length ? <div className="analytics-ranked-list">{data.topProducts.products.map((product) => <div className="analytics-ranked" key={product.productId}><div><strong>{product.productName} <small>{product.sku}</small></strong><span>{product.netUnitsSold.toLocaleString()} net units · {product.orderCount} orders · gross {asMoney(product.salesValue)} · net {asMoney(product.netSalesValue)}</span></div><div className="analytics-rank-track"><span style={{ width: `${maxTopSales ? product.unitsSold / maxTopSales * 100 : 0}%` }} /></div></div>)}</div> : <Empty title="No qualifying sales" detail="Products will rank here after confirmed orders." />}
      </section>
      <section className="biz-panel analytics-panel"><div className="biz-panel-heading"><div><h2>Recent sales</h2><p>Most recent qualifying orders in the selected range</p></div><button className="biz-text-button" onClick={() => navigate('Sales orders')}>View sales orders →</button></div>
        {overview.sales.recentSales.length ? <div className="biz-table-wrap"><table className="biz-table analytics-table"><thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Status</th><th>Total</th></tr></thead><tbody>{overview.sales.recentSales.map((order) => <tr key={order.id}><td><strong>{order.orderNumber}</strong></td><td>{order.customerName || 'Walk-in'}</td><td>{textDate(order.createdAt)}</td><td><Badge value={order.status} /></td><td>{asMoney(order.total)}</td></tr>)}</tbody></table></div> : <Empty title="No recent qualifying sales" detail="Sales appear after stock is deducted for an eligible order." />}
      </section>
      <section className="biz-panel analytics-panel"><div className="biz-panel-heading"><div><h2>Purchasing trend</h2><p>Ordered {asMoney(overview.purchasing.orderedValue)} · received {asMoney(overview.purchasing.receivedValue)} ({overview.purchasing.receivedQuantity} units) · order creation vs receipt date</p></div><button className="biz-text-button" onClick={() => navigate('Purchase orders')}>View purchases →</button></div>
        {purchaseTrend.some((point) => point.orderCount) ? <div className="analytics-chart-scroll"><div className="analytics-sales-chart" role="img" aria-label="Purchase order value trend chart">
          {purchaseTrend.map((point) => <div className="analytics-bar-column" key={point.period} title={`${point.period}: ${asMoney(point.purchaseValue)} · ${point.orderCount} purchase orders`}><div className="analytics-bar-track"><span className="analytics-bar purchase" style={{ height: `${maxPurchaseValue ? Math.max(3, point.purchaseValue / maxPurchaseValue * 100) : 0}%` }} /></div><small>{point.period.slice(5)}</small></div>)}
        </div></div> : <Empty title="No submitted purchases in this range" detail="Submitted and received purchase orders will appear here." />}
      </section>
      <section className="biz-panel analytics-panel"><div className="biz-panel-heading"><div><h2>Stock movement trend</h2><p>Ledger quantities · selected period</p></div><ExportButton dataset="stock-movements" range={range} onExport={onExport} exporting={exporting} /></div>
        {stockTrend.length ? <div className="analytics-chart-scroll"><div className="analytics-sales-chart" role="img" aria-label="Stock movement inbound and outbound quantity chart">
          {stockTrend.map((point) => <div className="analytics-bar-column" key={point.period} title={`${point.period}: ${point.inbound} inbound · ${point.outbound} outbound`}><div className="analytics-bar-track analytics-double"><span className="analytics-bar inbound" style={{ height: `${maxStockValue ? Math.max(point.inbound ? 3 : 0, point.inbound / maxStockValue * 100) : 0}%` }} /><span className="analytics-bar outbound" style={{ height: `${maxStockValue ? Math.max(point.outbound ? 3 : 0, point.outbound / maxStockValue * 100) : 0}%` }} /></div><small>{point.period.slice(5)}</small></div>)}
        </div><div className="analytics-legend"><span><i className="inbound" /> Inbound</span><span><i className="outbound" /> Outbound</span></div></div> : <Empty title="No stock movements in this range" />}
      </section>
    </div>
    <div className="biz-dashboard-grid analytics-bottom-grid">
      <section className="biz-panel analytics-panel"><div className="biz-panel-heading"><div><h2>Restock watch</h2><p>{overview.inventory.lowStockCount} active products at or below reorder threshold</p></div><button className="biz-text-button" onClick={() => navigate('Products')}>View inventory →</button></div>
        {inventory.lowStockProducts.length ? <div className="biz-table-wrap"><table className="biz-table analytics-table"><thead><tr><th>Product</th><th>On hand</th><th>Reorder at</th><th>Stock value</th></tr></thead><tbody>{inventory.lowStockProducts.slice(0, 8).map((product) => <tr key={product.id}><td><strong>{product.name}</strong><small className="analytics-table-sub">{product.sku} · {product.category}</small></td><td>{product.quantity}</td><td>{product.reorderThreshold}</td><td>{asMoney(product.stockValue)}</td></tr>)}</tbody></table></div> : <Empty title="Stock levels look good" detail="No active products are at their reorder threshold." />}
      </section>
      <section className="biz-panel analytics-panel"><div className="biz-panel-heading"><div><h2>Financial summary</h2><p>Period flows and current outstanding balance</p></div><button className="biz-text-button" onClick={() => navigate('Invoices')}>View invoices →</button></div>
        <div className="analytics-financial-list">
          {[['Invoices issued', financials.invoicesIssued, 'Period by invoice date'], ['Payments received', financials.paymentsReceived, 'Completed payments by payment date'], ['Accepted return credits', financials.acceptedReturnCredits, 'Period by return date'], ['Refunds completed', financials.completedRefunds, 'Period by completion date'], ['Net cash retained', financials.netCashRetained, 'Payments less refunds in the selected period'], ['Unsettled return credits', financials.unsettledReturnCredits, 'Current accepted credits less completed refunds'], ['Outstanding receivables', financials.outstandingReceivables, 'Current: invoice total less completed payments and accepted credits']].map(([label, value, note]) => <div className="analytics-financial-row" key={label}><span><strong>{label}</strong><small>{note}</small></span><b>{asMoney(value)}</b></div>)}
        </div>
      </section>
      <section className="biz-panel analytics-panel"><div className="biz-panel-heading"><div><h2>Supplier delivery performance</h2><p>Order date for ordered value · receipt date for deliveries</p></div><ExportButton dataset="supplier-purchases" range={range} onExport={onExport} exporting={exporting} /></div>
        {overview.purchasing.suppliers.length ? <div className="biz-table-wrap"><table className="biz-table analytics-table"><thead><tr><th>Supplier</th><th>Ordered</th><th>Received</th><th>Outstanding units</th><th>Avg. first receipt</th></tr></thead><tbody>{overview.purchasing.suppliers.map((supplier) => <tr key={supplier.supplierId}><td><strong>{supplier.supplierName}</strong><small className="analytics-table-sub">{supplier.supplierCode} · {supplier.purchaseOrderCount} orders</small></td><td>{asMoney(supplier.orderedValue)}</td><td>{asMoney(supplier.receivedValue)} · {supplier.receivedQuantity} units</td><td>{supplier.outstandingQuantity}</td><td>{supplier.averageDaysToFirstReceipt === null ? '—' : `${supplier.averageDaysToFirstReceipt} days`}</td></tr>)}</tbody></table></div> : <Empty title="No submitted purchases in this range" /> }
      </section>
      <section className="biz-panel analytics-panel"><div className="biz-panel-heading"><div><h2>Stock movement insights</h2><p>{inventory.slowMovement.windowDays}-day lookback · active products with stock on hand</p></div><button className="biz-text-button" onClick={() => navigate('Stock movements')}>View ledger →</button></div>
        <div className="analytics-financial-list">
          <div className="analytics-financial-row"><span><strong>Non-moving</strong><small>No qualifying sales history</small></span><b>{inventory.slowMovement.nonMovingCount}</b></div>
          <div className="analytics-financial-row"><span><strong>Slow-moving</strong><small>Last qualifying sale predates the lookback window</small></span><b>{inventory.slowMovement.slowMovingCount}</b></div>
          <div className="analytics-financial-row"><span><strong>Stock reconciliation warnings</strong><small>Latest ledger balance differs from product stock</small></span><b>{inventory.reconciliationWarnings.length}</b></div>
        </div>
        {[...inventory.slowMovement.nonMovingProducts, ...inventory.slowMovement.slowMovingProducts].slice(0, 6).map((product) => <div className="biz-row" key={product.id}><span className="biz-avatar"><Package size={16} /></span><div><strong>{product.name} · {product.quantity} on hand</strong><small>{product.sku} · last sold {product.lastSoldAt ? textDate(product.lastSoldAt) : 'never'}</small></div><b>{asMoney(product.stockValue)}</b></div>)}
        {inventory.reconciliationWarnings.slice(0, 4).map((warning) => <div className="biz-row" key={`warning-${warning.id}`}><span className="biz-avatar"><Activity size={16} /></span><div><strong>{warning.name} · stock mismatch</strong><small>{warning.sku} · product {warning.currentQuantity} / ledger {warning.ledgerQuantity}</small></div></div>)}
      </section>
      <section className="biz-panel analytics-panel"><div className="biz-panel-heading"><div><h2>Recent stock activity</h2><p>Latest ledger entries in the selected range</p></div><button className="biz-text-button" onClick={() => navigate('Stock movements')}>View ledger →</button></div>
        {data.stockMovements.recentMovements.length ? <div className="biz-row-list">{data.stockMovements.recentMovements.map((movement) => <div className="biz-row" key={movement.id}><span className="biz-avatar"><Activity size={16} /></span><div><strong>{movement.productName} · {movement.movementType.replaceAll('_', ' ')}</strong><small>{movement.sku} · {textDate(movement.createdAt)} · {movement.referenceType || 'no reference'}</small></div><b className={movement.quantityDelta < 0 ? 'biz-negative' : 'biz-positive'}>{movement.quantityDelta > 0 ? '+' : ''}{movement.quantityDelta}</b></div>)}</div> : <Empty title="No recent stock activity" />}
      </section>
    </div>
    <div className="biz-quick-links">{[['Products', Package], ['Purchase orders', Truck], ['Invoices', FileText], ['Stock movements', ArrowLeftRight]].map(([name, _Icon]) => <button key={name} onClick={() => navigate(name)}><_Icon size={17} /><span>{name}</span><b>→</b></button>)}</div>
  </>;
}

function Reports({ data, options, range, onFilter, onExport, exporting }) {
  if (!data) return <Empty title="Reports unavailable" detail="Retry loading to fetch saved analytics reports." />;
  const { sales, topProducts, purchasing, inventory, financials, returnsRefunds, statuses, movements } = data;
  const categories = options.categories || [];
  const suppliers = options.suppliers || [];
  const exportDatasets = [
    'sales-summary', 'sales-trend', 'sales-by-category', 'top-products',
    'purchases-by-supplier', 'purchasing-trend', 'inventory', 'low-stock',
    'out-of-stock', 'order-status', 'invoice-payment-status', 'returns-refunds',
    'stock-movements',
  ];
  return <>
    <PageHeader kicker="BUSINESS INTELLIGENCE" title="Reports" description="Explore persisted sales, purchasing, inventory, financial and stock-ledger data." />
    <section className="biz-panel analytics-controls" aria-label="Report filters">
      <div className="analytics-date-fields">
        <label className="biz-field"><span>Date range</span><select aria-label="Report date range preset" value={range.preset || '30'} onChange={(event) => onFilter('preset', event.target.value)}>
          <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="month">This month</option><option value="year">This year</option><option value="custom">Custom range</option>
        </select></label>
        <label className="biz-field"><span>From</span><input aria-label="Report start date" type="date" value={range.from || ''} onChange={(event) => onFilter('from', event.target.value)} /></label>
        <label className="biz-field"><span>To</span><input aria-label="Report end date" type="date" value={range.to || ''} onChange={(event) => onFilter('to', event.target.value)} /></label>
        <label className="biz-field"><span>Interval</span><select aria-label="Report interval" value={range.period || 'daily'} onChange={(event) => onFilter('period', event.target.value)}>
          <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
        </select></label>
        <label className="biz-field"><span>Category</span><select aria-label="Report category filter" value={range.categoryId || ''} onChange={(event) => onFilter('categoryId', event.target.value)}>
          <option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select></label>
        <label className="biz-field"><span>Supplier</span><select aria-label="Report supplier filter" value={range.supplierId || ''} onChange={(event) => onFilter('supplierId', event.target.value)}>
          <option value="">All suppliers</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.businessName}</option>)}
        </select></label>
      </div>
      <div className="analytics-exports" aria-label="Report CSV downloads">
        <strong>Download reports</strong>
        {exportDatasets.map((dataset) => <ExportButton key={dataset} dataset={dataset} range={range} onExport={onExport} exporting={exporting}>{dataset.replaceAll('-', ' ')}</ExportButton>)}
      </div>
    </section>
    <div className="biz-stats report-stats">
      {[
        ['Gross sales', asMoney(sales.grossSalesValue)],
        ['Orders', Number(sales.salesTrend.reduce((total, item) => total + item.orderCount, 0)).toLocaleString()],
        ['Purchases ordered', asMoney(purchasing.orderedValue)],
        ['Goods received', asMoney(purchasing.receivedValue)],
      ].map(([label, value]) => <article className="biz-stat" key={label}><small>{label}</small><strong>{value}</strong></article>)}
    </div>
    <div className="biz-dashboard-grid">
      <section className="biz-panel analytics-panel"><div className="biz-panel-heading"><div><h2>Sales by period</h2><p>{sales.dateBasis} · accepted credits are separate</p></div></div>
        <div className="biz-table-wrap"><RecordTable rows={sales.salesTrend.map((row) => ({ key: row.period, record: row }))} emptyTitle="No sales in this range" columns={[
          { label: 'Period', render: (_, row) => textDate(row.period) },
          { label: 'Orders', render: (_, row) => row.orderCount.toLocaleString() },
          { label: 'Gross sales', render: (_, row) => asMoney(row.salesValue) },
          { label: 'Return credits', render: (_, row) => asMoney(row.acceptedReturnCredits) },
          { label: 'Net sales', render: (_, row) => asMoney(row.netSalesValue) },
        ]} /></div>
      </section>
      <section className="biz-panel analytics-panel"><div className="biz-panel-heading"><div><h2>Sales by product</h2><p>Persisted order-line snapshots · top 100 results</p></div></div>
        <div className="biz-table-wrap"><RecordTable rows={topProducts.products.map((row) => ({ key: row.productId, record: row }))} emptyTitle="No qualifying product sales" columns={[
          { label: 'Product', render: (_, row) => <div className="biz-cell-main"><strong>{row.productName}</strong><small>{row.sku}</small></div> },
          { label: 'Units', render: (_, row) => row.unitsSold.toLocaleString() },
          { label: 'Gross sales', render: (_, row) => asMoney(row.salesValue) },
          { label: 'Net sales', render: (_, row) => asMoney(row.netSalesValue) },
        ]} /></div>
      </section>
      <section className="biz-panel analytics-panel"><div className="biz-panel-heading"><div><h2>Sales by category</h2><p>Current product category assignment</p></div></div>
        <div className="biz-table-wrap"><RecordTable rows={sales.byCategory.map((row) => ({ key: `${row.categoryId}-${row.category}`, record: row }))} emptyTitle="No category sales in this range" columns={[
          { label: 'Category', key: 'category' }, { label: 'Units sold', render: (_, row) => row.unitsSold.toLocaleString() },
          { label: 'Gross sales', render: (_, row) => asMoney(row.grossSalesValue) }, { label: 'Return credits', render: (_, row) => asMoney(row.acceptedReturnCredits) },
          { label: 'Net sales', render: (_, row) => asMoney(row.netSalesValue) },
        ]} /></div>
      </section>
      <section className="biz-panel analytics-panel"><div className="biz-panel-heading"><div><h2>Purchases by supplier</h2><p>Ordered totals and actual receipt totals</p></div></div>
        <div className="biz-table-wrap"><RecordTable rows={purchasing.suppliers.map((row) => ({ key: row.supplierId, record: row }))} emptyTitle="No submitted purchase orders in this range" columns={[
          { label: 'Supplier', render: (_, row) => <div className="biz-cell-main"><strong>{row.supplierName}</strong><small>{row.supplierCode}</small></div> },
          { label: 'Orders', key: 'purchaseOrderCount' }, { label: 'Ordered', render: (_, row) => asMoney(row.orderedValue) },
          { label: 'Received', render: (_, row) => asMoney(row.receivedValue) }, { label: 'Outstanding units', key: 'outstandingQuantity' },
        ]} /></div>
      </section>
      <section className="biz-panel analytics-panel"><div className="biz-panel-heading"><div><h2>Inventory valuation</h2><p>Current cost basis; retail value shown separately</p></div></div>
        <div className="biz-table-wrap"><RecordTable rows={inventory.byCategory.map((row) => ({ key: `${row.categoryId}-${row.category}`, record: row }))} emptyTitle="No inventory records" columns={[
          { label: 'Category', key: 'category' }, { label: 'Products', key: 'productCount' }, { label: 'Units', render: (_, row) => row.unitsInStock.toLocaleString() },
          { label: 'Cost value', render: (_, row) => asMoney(row.inventoryValue) }, { label: 'Retail value', render: (_, row) => asMoney(row.retailValue) },
        ]} /></div>
        <p className="biz-hint">Total cost valuation: {asMoney(inventory.inventoryValuation)} · missing unit costs: {inventory.missingCostCount}</p>
      </section>
      <section className="biz-panel analytics-panel"><div className="biz-panel-heading"><div><h2>Low-stock and out-of-stock</h2><p>Current active products at configured reorder thresholds</p></div></div>
        <div className="biz-table-wrap"><RecordTable rows={[...inventory.lowStockProducts, ...inventory.outOfStockProducts.filter((row) => !inventory.lowStockProducts.some((low) => low.id === row.id))].map((row) => ({ key: row.id, record: row }))} emptyTitle="No stock alerts" columns={[
          { label: 'Product', render: (_, row) => <div className="biz-cell-main"><strong>{row.name}</strong><small>{row.sku} · {row.category}</small></div> },
          { label: 'On hand', key: 'quantity' }, { label: 'Reorder at', key: 'reorderThreshold' },
          { label: 'Cost value', render: (_, row) => asMoney(row.stockValue) },
        ]} /></div>
      </section>
      <section className="biz-panel analytics-panel"><div className="biz-panel-heading"><div><h2>Order and invoice/payment status</h2><p>Persisted status counts for selected date range</p></div></div>
        <div className="analytics-status-list">{[
          ['Orders', statuses.orderStatusDistribution],
          ['Invoices', statuses.invoiceStatusDistribution],
          ['Payments', statuses.paymentStatusDistribution],
        ].flatMap(([label, rows]) => rows.map((row) => <span key={`${label}-${row.status}`}><strong>{label}</strong> <Badge value={row.status} /> {row.count} · {asMoney(row.orderValue ?? row.amount)}</span>))}</div>
      </section>
      <section className="biz-panel analytics-panel"><div className="biz-panel-heading"><div><h2>Returns and refunds</h2><p>Return credits and refunds remain separate financial measures</p></div></div>
        <div className="analytics-financial-list">
          <div className="analytics-financial-row"><span><strong>Accepted return credits</strong><small>By return date</small></span><b>{asMoney(returnsRefunds.returns.acceptedReturnCredits)}</b></div>
          <div className="analytics-financial-row"><span><strong>Completed refunds</strong><small>Refund status summary by creation date</small></span><b>{asMoney(returnsRefunds.refunds.completedAmount)}</b></div>
          <div className="analytics-status-list">{[
            ...returnsRefunds.returns.byStatus.map((row) => ['Return', row]),
            ...returnsRefunds.refunds.byStatus.map((row) => ['Refund', row]),
          ].map(([label, row]) => <span key={`${label}-${row.status}`}><strong>{label}</strong> <Badge value={row.status} /> {row.count}</span>)}</div>
        </div>
      </section>
      <section className="biz-panel analytics-panel"><div className="biz-panel-heading"><div><h2>Stock movements</h2><p>Latest 100 ledger entries in the selected range</p></div></div>
        <div className="biz-table-wrap"><RecordTable rows={movements.recentMovements.map((row) => ({ key: row.id, record: row }))} emptyTitle="No stock movements in this range" columns={[
          { label: 'Date', render: (_, row) => textDate(row.createdAt) },
          { label: 'Product', render: (_, row) => <div className="biz-cell-main"><strong>{row.productName}</strong><small>{row.sku}</small></div> },
          { label: 'Type', render: (_, row) => <Badge value={row.movementType} /> }, { label: 'Change', key: 'quantityDelta' },
          { label: 'Resulting stock', key: 'newQuantity' }, { label: 'Reference', key: 'referenceType' },
        ]} /></div>
      </section>
    </div>
    <section className="biz-panel report-financial-summary"><div className="biz-panel-heading"><div><h2>Financial status and balances</h2><p>Date-filtered flows plus separately labeled current-state balances</p></div></div>
      <div className="analytics-financial-list">
        {[
          ['Invoices issued', financials.invoicesIssued],
          ['Completed payments', financials.paymentsReceived],
          ['Accepted return credits', financials.acceptedReturnCredits],
          ['Completed refunds', financials.completedRefunds],
          ['Net cash retained', financials.netCashRetained],
          ['Outstanding receivables (current)', financials.outstandingReceivables],
        ].map(([label, value]) => <div className="analytics-financial-row" key={label}><span><strong>{label}</strong></span><b>{asMoney(value)}</b></div>)}
      </div>
    </section>
  </>;
}

function Table({ columns, rows, emptyTitle }) {
  if (!rows.length) return <Empty title={emptyTitle || 'No matching records'} />;
  return <div className="biz-table-wrap"><table className="biz-table"><thead><tr>{columns.map((column) => <th key={column.label}>{column.label}</th>)}</tr></thead><tbody>
    {rows.map((row) => <tr key={row.key}>{columns.map((column) => <td key={column.label}>{column.render ? column.render(row.value, row.record) : row.record[column.key]}</td>)}</tr>)}
  </tbody></table></div>;
}

function ExportButton({ dataset, range, onExport, exporting, children = 'Download CSV' }) {
  const current = exporting === dataset;
  return <button type="button" className={children === 'Download CSV' ? 'biz-text-button' : 'biz-action'} disabled={Boolean(exporting)} aria-busy={current} onClick={() => onExport(dataset, range)}>
    {current ? 'Preparing CSV…' : children}
  </button>;
}

function RecordTable({ columns, rows, emptyTitle }) {
  return <Table columns={columns} rows={rows} emptyTitle={emptyTitle} />;
}

function Pager({ meta, onPageChange }) {
  const totalPages = meta?.totalPages ?? (meta?.pageSize ? Math.ceil(meta.total / meta.pageSize) : 0);
  if (!meta || totalPages <= 1) return null;
  return <div className="biz-pager">
    <span>{meta.total.toLocaleString()} records · page {meta.page} of {totalPages}</span>
    <div>
      <button className="biz-action" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)}>Previous</button>
      <button className="biz-action" disabled={meta.page >= totalPages} onClick={() => onPageChange(meta.page + 1)}>Next</button>
    </div>
  </div>;
}

function Actions({ children }) { return <div className="biz-row-buttons">{children}</div>; }
function ActionButton({ children, onClick, disabled = false, tone = 'plain', title }) {
  return <button type="button" title={title} className={`biz-action ${tone}`} disabled={disabled} onClick={onClick}>{children}</button>;
}
function Badge({ value }) { return <span className={statusClass(value)}>{String(value || '—').replaceAll('_', ' ')}</span>; }
function FilterBar({ children }) { return <div className="biz-filterbar">{children}</div>; }
function SelectFilter({ label, value, onChange, options }) {
  return <label className="biz-filter"><span>{label}</span><select value={value || ''} onChange={(event) => onChange(event.target.value)}><option value="">All</option>{options.map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>;
}
function DateFilters({ filters, onFilter }) {
  return <><label className="biz-filter"><span>From</span><input type="date" value={filters.from || ''} onChange={(event) => onFilter('from', event.target.value)} /></label><label className="biz-filter"><span>To</span><input type="date" value={filters.to || ''} onChange={(event) => onFilter('to', event.target.value)} /></label></>;
}
function IdSelect({ label, value, onChange, rows, idKey = 'id', text, includeAll = true }) {
  return <label className="biz-filter"><span>{label}</span><select value={value || ''} onChange={(event) => onChange(event.target.value)}>{includeAll && <option value="">All</option>}{rows.map((row) => <option key={row[idKey]} value={row[idKey]}>{text(row)}</option>)}</select></label>;
}

function Products({ data, search, filters, onFilter, onCreate, onDetails, onConfirm, onPageChange }) {
  const rows = (data.products || []).filter((product) => !search || `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <PageHeader kicker="CATALOG & INVENTORY" title="Products" description="Manage product details, pricing and stock levels." action={{ label: 'Add product', onClick: () => onCreate('product') }} />
    <FilterBar><SelectFilter label="Stock" value={filters.stock} onChange={(value) => onFilter('stock', value)} options={ [['low', 'Low stock'], ['in_stock', 'In stock']] } /><SelectFilter label="Active" value={filters.active} onChange={(value) => onFilter('active', value)} options={ [['true', 'Active'], ['false', 'Inactive']] } /></FilterBar>
    <section className="biz-panel"><RecordTable rows={rows.map((product) => ({ key: product.id, record: product, value: product }))} columns={[
      { label: 'Product', render: (_, p) => <div className="biz-cell-main"><strong>{p.name}</strong><small>{p.description || p.sku}</small></div> },
      { label: 'SKU', render: (_, p) => <span className="biz-code">{p.sku}</span> },
      { label: 'Category', render: (_, p) => p.category || '—' },
      { label: 'Price', render: (_, p) => asMoney(p.price) },
      { label: 'On hand', render: (_, p) => <div><strong>{p.quantity}</strong><small className="biz-subline"> · reorder at {p.lowStockThreshold}</small></div> },
      { label: 'Status', render: (_, p) => <Badge value={p.isActive ? (p.quantity <= p.lowStockThreshold ? 'low_stock' : 'active') : 'inactive'} /> },
      { label: 'Actions', render: (_, p) => <Actions><ActionButton onClick={() => onDetails('product', p.id)}>View</ActionButton><ActionButton onClick={() => onCreate('product', p)}>Edit</ActionButton><ActionButton onClick={() => onCreate('stock', p)}>Stock</ActionButton><ActionButton tone="danger" disabled={p.quantity > 0} onClick={() => onConfirm('Delete product', `Delete ${p.name}? Products with order or stock history cannot be deleted.`, () => api(`/products/${p.id}`, { method: 'DELETE' }), 'Product deleted.')}>Delete</ActionButton></Actions> },
    ]} emptyTitle="No products match these filters" /><Pager meta={data.productMeta} onPageChange={onPageChange} /></section>
  </>;
}

function Categories({ rows, search, onCreate, onDetails, onEdit, onConfirm }) {
  const filtered = rows.filter((row) => !search || `${row.name} ${row.description || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <PageHeader kicker="PRODUCT ORGANIZATION" title="Categories" description="Review product usage and organize your catalog." action={{ label: 'Add category', onClick: () => onCreate('category') }} />
    <section className="biz-panel"><RecordTable rows={filtered.map((record) => ({ key: record.id, record, value: record }))} columns={[
      { label: 'Category', render: (_, r) => <div className="biz-cell-main"><strong>{r.name}</strong><small>{r.description || 'No description'}</small></div> },
      { label: 'Products', render: (_, r) => r.productCount },
      { label: 'Units in stock', render: (_, r) => r.unitsInStock },
      { label: 'Inventory value', render: (_, r) => asMoney(r.inventoryValue) },
      { label: 'Actions', render: (_, r) => <Actions><ActionButton onClick={() => onDetails('category', r.id)}>Usage</ActionButton><ActionButton onClick={() => onEdit('category', r)}>Edit</ActionButton><ActionButton tone="danger" disabled={r.productCount > 0} onClick={() => onConfirm('Delete category', `Delete ${r.name}? Categories linked to products cannot be deleted.`, () => api(`/categories/${r.id}`, { method: 'DELETE' }), 'Category deleted.')}>Delete</ActionButton></Actions> },
    ]} /></section>
  </>;
}

function Suppliers({ rows, search, filters, onFilter, onCreate, onDetails, onEdit, onConfirm }) {
  const filtered = rows.filter((row) => !search || `${row.businessName} ${row.supplierCode} ${row.contactPerson || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <PageHeader kicker="SUPPLY PARTNERS" title="Suppliers" description="Maintain supplier records and review purchase history." action={{ label: 'Add supplier', onClick: () => onCreate('supplier') }} />
    <FilterBar><SelectFilter label="Status" value={filters.active} onChange={(value) => onFilter('active', value)} options={ [['true', 'Active'], ['false', 'Inactive']] } /></FilterBar>
    <section className="biz-panel"><RecordTable rows={filtered.map((record) => ({ key: record.id, record }))} columns={[
      { label: 'Supplier', render: (_, r) => <div className="biz-cell-main"><strong>{r.businessName}</strong><small>{r.supplierCode} · {r.contactPerson || 'No contact person'}</small></div> },
      { label: 'Email / phone', render: (_, r) => <div className="biz-cell-main"><span>{r.email || '—'}</span><small>{r.phone || '—'}</small></div> },
      { label: 'Status', render: (_, r) => <Badge value={r.isActive ? 'active' : 'inactive'} /> },
      { label: 'Actions', render: (_, r) => <Actions><ActionButton onClick={() => onDetails('supplier', r.id)}>History</ActionButton><ActionButton onClick={() => onEdit('supplier', r)}>Edit</ActionButton><ActionButton disabled={!r.isActive} tone="danger" onClick={() => onConfirm('Deactivate supplier', `Deactivate ${r.businessName}? Existing purchases remain available.`, () => api(`/suppliers/${r.id}/deactivate`, send('PATCH', {})), 'Supplier deactivated.')}>Deactivate</ActionButton></Actions> },
    ]} /></section>
  </>;
}

function Customers({ rows, search, filters, onFilter, onCreate, onDetails, onEdit, onConfirm }) {
  const filtered = rows.filter((row) => !search || `${row.name} ${row.customerCode} ${row.email || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <PageHeader kicker="CUSTOMER DIRECTORY" title="Customers" description="Manage customer contacts and preserve their sales history." action={{ label: 'Add customer', onClick: () => onCreate('customer') }} />
    <FilterBar><SelectFilter label="Status" value={filters.active} onChange={(value) => onFilter('active', value)} options={ [['true', 'Active'], ['false', 'Inactive']] } /></FilterBar>
    <section className="biz-panel"><RecordTable rows={filtered.map((record) => ({ key: record.id, record }))} columns={[
      { label: 'Customer', render: (_, r) => <div className="biz-cell-main"><strong>{r.name}</strong><small>{r.customerCode}</small></div> },
      { label: 'Email / phone', render: (_, r) => <div className="biz-cell-main"><span>{r.email || '—'}</span><small>{r.phone || '—'}</small></div> },
      { label: 'Status', render: (_, r) => <Badge value={r.isActive ? 'active' : 'inactive'} /> },
      { label: 'Actions', render: (_, r) => <Actions><ActionButton onClick={() => onDetails('customer', r.id)}>Sales history</ActionButton><ActionButton onClick={() => onEdit('customer', r)}>Edit</ActionButton><ActionButton disabled={!r.isActive} tone="danger" onClick={() => onConfirm('Deactivate customer', `Deactivate ${r.name}? Existing orders and history will remain intact.`, () => api(`/customers/${r.id}/deactivate`, send('PATCH', {})), 'Customer deactivated.')}>Deactivate</ActionButton></Actions> },
    ]} /></section>
  </>;
}

function SalesOrders({ rows, customers, meta, filters, onFilter, onCreate, onEdit, onDetails, onConfirm, onPageChange }) {
  return <>
    <PageHeader kicker="SALES & FULFILLMENT" title="Sales orders" description="Create drafts, confirm stock deductions and follow fulfillment." action={{ label: 'New draft', onClick: () => onCreate('salesOrder') }} />
    <FilterBar><SelectFilter label="Status" value={filters.status} onChange={(value) => onFilter('status', value)} options={Object.keys(salesStates).map((s) => [s, s.replaceAll('_', ' ')])} /><IdSelect label="Customer" value={filters.customerId} onChange={(value) => onFilter('customerId', value)} rows={customers} text={(r) => r.name} /><DateFilters filters={filters} onFilter={onFilter} /></FilterBar>
    <section className="biz-panel"><RecordTable rows={rows.map((record) => ({ key: record.id, record }))} columns={[
      { label: 'Order', render: (_, r) => <div className="biz-cell-main"><strong>{r.orderNumber}</strong><small>{textDate(r.createdAt)} · {r.customerName}</small></div> },
      { label: 'Items', render: (_, r) => r.items.reduce((sum, item) => sum + item.quantity, 0) },
      { label: 'Total', render: (_, r) => asMoney(r.total) },
      { label: 'Status', render: (_, r) => <Badge value={r.status} /> },
      { label: 'Stock', render: (_, r) => r.stockDeductedAt ? `Deducted ${textDate(r.stockDeductedAt)}` : 'Not deducted' },
      { label: 'Actions', render: (_, r) => <Actions><ActionButton onClick={() => onDetails('order', r.id)}>Details</ActionButton>{salesStates[r.status]?.map((next) => <ActionButton key={next} tone={next === 'cancelled' ? 'danger' : 'plain'} onClick={() => onConfirm(`Set order ${next}`, `Move ${r.orderNumber} from ${r.status} to ${next}? Stock changes are handled by the server.`, () => api(`/orders/${r.id}/status`, send('PATCH', { status: next })), `Order ${shortId('SP', r.id)} updated.`)}>{next.replaceAll('_', ' ')}</ActionButton>)}{r.status === 'draft' && <ActionButton onClick={() => onEdit('salesOrder', r)}>Edit</ActionButton>}</Actions> },
    ]} /><Pager meta={meta} onPageChange={onPageChange} /></section>
  </>;
}

function PurchaseOrders({ rows, suppliers, meta, filters, onFilter, onCreate, onDetails, onEdit, onConfirm, onPageChange }) {
  const statuses = ['draft', 'ordered', 'partially_received', 'received', 'cancelled'];
  return <>
    <PageHeader kicker="PROCUREMENT" title="Purchase orders" description="Build supplier orders and receive goods into inventory." action={{ label: 'New purchase order', onClick: () => onCreate('purchaseOrder') }} />
    <FilterBar><SelectFilter label="Status" value={filters.status} onChange={(value) => onFilter('status', value)} options={statuses.map((s) => [s, s.replaceAll('_', ' ')])} /><IdSelect label="Supplier" value={filters.supplierId} onChange={(value) => onFilter('supplierId', value)} rows={suppliers} text={(r) => r.businessName} /><DateFilters filters={filters} onFilter={onFilter} /></FilterBar>
    <section className="biz-panel"><RecordTable rows={rows.map((record) => ({ key: record.id, record }))} columns={[
      { label: 'Purchase order', render: (_, r) => <div className="biz-cell-main"><strong>{r.orderNumber}</strong><small>{r.supplierName} · {textDate(r.createdAt)}</small></div> },
      { label: 'Status', render: (_, r) => <Badge value={r.status} /> },
      { label: 'Total', render: (_, r) => asMoney(r.total) },
      { label: 'Items', render: (_, r) => r.items?.length || 'Open details' },
      { label: 'Actions', render: (_, r) => <Actions><ActionButton onClick={() => onDetails('purchaseOrder', r.id)}>Details / receive</ActionButton>{r.status === 'draft' && <ActionButton onClick={() => onEdit('purchaseOrder', r)}>Edit</ActionButton>}{['draft', 'ordered'].includes(r.status) && <ActionButton tone="danger" onClick={() => onConfirm('Cancel purchase order', `Cancel ${r.orderNumber}? Received quantities cannot be erased.`, () => api(`/purchase-orders/${r.id}/cancel`, send('POST', {})), 'Purchase order cancelled.')}>Cancel</ActionButton>}</Actions> },
    ]} /><Pager meta={meta} onPageChange={onPageChange} /></section>
  </>;
}

function GoodsReceipts({ rows, suppliers, purchaseOrders, meta, filters, onFilter, onDetails, onPageChange }) {
  return <>
    <PageHeader kicker="PROCUREMENT" title="Goods receipts" description="Review persisted deliveries, received lines and purchase-order references." />
    <FilterBar>
      <IdSelect label="Supplier" value={filters.supplierId} onChange={(value) => onFilter('supplierId', value)} rows={suppliers} text={(row) => row.businessName} />
      <IdSelect label="Purchase order" value={filters.purchaseOrderId} onChange={(value) => onFilter('purchaseOrderId', value)} rows={purchaseOrders} text={(row) => row.orderNumber} />
    </FilterBar>
    <section className="biz-panel"><RecordTable rows={rows.map((record) => ({ key: record.id, record }))} columns={[
      { label: 'Receipt', render: (_, row) => <div className="biz-cell-main"><strong>{row.receiptNumber}</strong><small>{textDate(row.receivedAt)}</small></div> },
      { label: 'Purchase order', render: (_, row) => <div className="biz-cell-main"><strong>{row.purchaseOrderNumber}</strong><small>{row.supplierName}</small></div> },
      { label: 'Lines', render: (_, row) => row.items.reduce((sum, item) => sum + item.quantity, 0) },
      { label: 'Notes', render: (_, row) => row.notes || '—' },
      { label: 'Actions', render: (_, row) => <ActionButton onClick={() => onDetails('receipt', row.id)}>Details</ActionButton> },
    ]} emptyTitle="No goods receipts recorded" /><Pager meta={meta} onPageChange={onPageChange} /></section>
  </>;
}

function Invoices({ rows, customers, orders, meta, filters, onFilter, onCreate, onDetails, onConfirm, onPageChange }) {
  const options = ['draft', 'issued', 'partially_paid', 'paid', 'credited', 'void'];
  const activeOrderIds = new Set(rows.filter((invoice) => invoice.status !== 'void').map((invoice) => invoice.orderId));
  const eligibleOrders = orders.filter((order) => ['confirmed', 'processing', 'shipped', 'delivered'].includes(order.status) && order.stockDeductedAt && !activeOrderIds.has(order.id));
  return <>
    <PageHeader kicker="ACCOUNTS RECEIVABLE" title="Invoices" description="Issue sales snapshots and track collectible balances." action={{ label: 'Create invoice', onClick: () => onCreate('invoice') }} />
    <FilterBar><SelectFilter label="Status" value={filters.status} onChange={(value) => onFilter('status', value)} options={options.map((s) => [s, s.replaceAll('_', ' ')])} /><IdSelect label="Customer" value={filters.customerId} onChange={(value) => onFilter('customerId', value)} rows={customers} text={(r) => r.name} /><DateFilters filters={filters} onFilter={onFilter} /><span className="biz-hint">{eligibleOrders.length} uninvoiced eligible sales</span></FilterBar>
    <section className="biz-panel"><RecordTable rows={rows.map((record) => ({ key: record.id, record }))} columns={[
      { label: 'Invoice', render: (_, r) => <div className="biz-cell-main"><strong>{r.invoiceNumber}</strong><small>{r.orderNumber} · {r.customerName}</small></div> },
      { label: 'Date', render: (_, r) => textDate(r.invoiceDate) },
      { label: 'Status', render: (_, r) => <Badge value={r.status} /> },
      { label: 'Total', render: (_, r) => asMoney(r.total) },
      { label: 'Collected', render: (_, r) => asMoney(r.completedPayments) },
      { label: 'Refunds', render: (_, r) => asMoney(r.completedRefunds) },
      { label: 'Outstanding', render: (_, r) => <strong>{asMoney(r.outstandingBalance)}</strong> },
      { label: 'Actions', render: (_, r) => <Actions><ActionButton onClick={() => onDetails('invoice', r.id)}>Details</ActionButton>{r.status === 'draft' && <ActionButton onClick={() => onConfirm('Issue invoice', `Issue ${r.invoiceNumber}? Its financial snapshot will be locked.`, () => api(`/invoices/${r.id}/issue`, send('POST', {})), 'Invoice issued.')}>Issue</ActionButton>}{['draft', 'issued'].includes(r.status) && <ActionButton tone="danger" onClick={() => onConfirm('Void invoice', `Void ${r.invoiceNumber}? This action is irreversible.`, () => api(`/invoices/${r.id}/void`, send('POST', {})), 'Invoice voided.')}>Void</ActionButton>}{['issued', 'partially_paid'].includes(r.status) && <ActionButton onClick={() => onCreate('payment', r)}>Record payment</ActionButton>}</Actions> },
    ]} /><Pager meta={meta} onPageChange={onPageChange} /></section>
  </>;
}

function Payments({ rows, invoices, meta, filters, onFilter, onDetails, onConfirm, onPageChange }) {
  return <>
    <PageHeader kicker="CASH COLLECTION" title="Payments" description="Review recorded payment transactions and their status." />
    <FilterBar><SelectFilter label="Status" value={filters.status} onChange={(value) => onFilter('status', value)} options={['completed', 'failed', 'reversed'].map((s) => [s, s])} /><IdSelect label="Invoice" value={filters.invoiceId} onChange={(value) => onFilter('invoiceId', value)} rows={invoices} text={(r) => `${r.invoiceNumber} · ${asMoney(r.total)}`} /></FilterBar>
    <section className="biz-panel"><RecordTable rows={rows.map((record) => ({ key: record.id, record }))} columns={[
      { label: 'Payment', render: (_, r) => <div className="biz-cell-main"><strong>{r.paymentReference}</strong><small>{r.invoiceNumber} · {textDate(r.paymentDate)}</small></div> },
      { label: 'Method', render: (_, r) => r.method },
      { label: 'External reference', render: (_, r) => r.externalReference || '—' },
      { label: 'Amount', render: (_, r) => asMoney(r.amount) },
      { label: 'Status', render: (_, r) => <Badge value={r.status} /> },
      { label: 'Actions', render: (_, r) => <Actions><ActionButton onClick={() => onDetails('payment', r.id)}>Details</ActionButton>{r.status === 'completed' && <ActionButton tone="danger" onClick={() => onConfirm('Reverse payment', `Reverse ${r.paymentReference}? It will no longer count as collected cash.`, () => api(`/payments/${r.id}/reverse`, send('POST', {})), 'Payment reversed.')}>Reverse</ActionButton>}</Actions> },
    ]} /><Pager meta={meta} onPageChange={onPageChange} /></section>
  </>;
}

function Returns({ rows, refunds, meta, refundMeta, filters, onFilter, onCreate, onDetails, onConfirm, onPageChange }) {
  return <>
    <PageHeader kicker="AFTER-SALES" title="Returns & refunds" description="Review return decisions, stock disposition and refunds." action={{ label: 'Create return', onClick: () => onCreate('return') }} />
    <FilterBar><SelectFilter label="Return status" value={filters.status} onChange={(value) => onFilter('status', value)} options={['draft', 'accepted', 'rejected'].map((s) => [s, s])} /><SelectFilter label="Refund status" value={filters.refundStatus} onChange={(value) => onFilter('refundStatus', value)} options={['requested', 'completed', 'failed'].map((s) => [s, s])} /></FilterBar>
    <div className="biz-two-panels">
      <section className="biz-panel"><div className="biz-panel-heading"><div><h2>Sales returns</h2><p>Returns from saved sales orders</p></div></div><RecordTable rows={rows.map((record) => ({ key: record.id, record }))} columns={[
        { label: 'Return', render: (_, r) => <div className="biz-cell-main"><strong>{r.returnNumber}</strong><small>{r.orderNumber} · {r.customerName}</small></div> },
        { label: 'Credit', render: (_, r) => asMoney(r.total) },
        { label: 'Status', render: (_, r) => <Badge value={r.status} /> },
        { label: 'Actions', render: (_, r) => <Actions><ActionButton onClick={() => onDetails('salesReturn', r.id)}>Details</ActionButton>{r.status === 'draft' && <><ActionButton onClick={() => onConfirm('Accept return', `Accept ${r.returnNumber}? Restockable items will be added to inventory through the stock ledger.`, () => api(`/returns/${r.id}/complete`, send('POST', { status: 'accepted' })), 'Return accepted.')}>Accept</ActionButton><ActionButton tone="danger" onClick={() => onConfirm('Reject return', `Reject ${r.returnNumber}?`, () => api(`/returns/${r.id}/complete`, send('POST', { status: 'rejected' })), 'Return rejected.')}>Reject</ActionButton></>}{r.status === 'accepted' && r.invoiceId && <ActionButton onClick={() => onCreate('refund', r)}>Request refund</ActionButton>}</Actions> },
      ]} emptyTitle="No returns recorded" /><Pager meta={meta} onPageChange={onPageChange} /></section>
      <section className="biz-panel"><div className="biz-panel-heading"><div><h2>Refunds</h2><p>Requested, completed and failed refund records</p></div></div><RecordTable rows={refunds.map((record) => ({ key: record.id, record }))} columns={[
        { label: 'Refund', render: (_, r) => <div className="biz-cell-main"><strong>{r.refundReference}</strong><small>{r.method} · {textDate(r.createdAt)}</small></div> },
        { label: 'Amount', render: (_, r) => asMoney(r.amount) },
        { label: 'Status', render: (_, r) => <Badge value={r.status} /> },
        { label: 'Actions', render: (_, r) => <Actions><ActionButton onClick={() => onDetails('refund', r.id)}>Details</ActionButton>{r.status === 'requested' && <><ActionButton onClick={() => onConfirm('Complete refund', `Mark refund ${r.refundReference} as completed?`, () => api(`/refunds/${r.id}/complete`, send('POST', {})), 'Refund completed.')}>Complete</ActionButton><ActionButton tone="danger" onClick={() => onConfirm('Fail refund', `Mark refund ${r.refundReference} as failed?`, () => api(`/refunds/${r.id}/fail`, send('POST', {})), 'Refund marked failed.')}>Fail</ActionButton></>}</Actions> },
      ]} emptyTitle="No refunds recorded" /><Pager meta={refundMeta} onPageChange={onPageChange} /></section>
    </div>
  </>;
}

function Movements({ rows, meta, products, filters, onFilter, onDetails, onPageChange }) {
  return <>
    <PageHeader kicker="INVENTORY AUDIT TRAIL" title="Stock movements" description="Read the persisted inventory ledger without changing stock." />
    <FilterBar><IdSelect label="Product" value={filters.productId} onChange={(value) => onFilter('productId', value)} rows={products} text={(r) => `${r.name} · ${r.sku}`} /><SelectFilter label="Movement" value={filters.type} onChange={(value) => onFilter('type', value)} options={['initial_stock', 'sale', 'purchase', 'adjustment', 'return_in', 'return_out', 'write_off'].map((s) => [s, s.replaceAll('_', ' ')])} /></FilterBar>
    <section className="biz-panel"><RecordTable rows={rows.map((record) => ({ key: record.id, record }))} columns={[
      { label: 'Product', render: (_, r) => <div className="biz-cell-main"><strong>{r.productName}</strong><small>{r.sku}</small></div> },
      { label: 'Type', render: (_, r) => <Badge value={r.movementType} /> },
      { label: 'Change', render: (_, r) => <strong className={r.quantityDelta < 0 ? 'biz-negative' : 'biz-positive'}>{r.quantityDelta > 0 ? '+' : ''}{r.quantityDelta}</strong> },
      { label: 'Previous → result', render: (_, r) => `${r.previousQuantity} → ${r.resultingQuantity}` },
      { label: 'Reference', render: (_, r) => `${r.referenceType || '—'} ${r.referenceId || ''}` },
      { label: 'Reason', render: (_, r) => r.reason || r.notes || '—' },
      { label: 'Date', render: (_, r) => textDate(r.createdAt) },
      { label: 'Actions', render: (_, r) => <ActionButton onClick={() => onDetails('product', r.productId)}>Product</ActionButton> },
    ]} emptyTitle="No stock movements match this filter" /><Pager meta={meta} onPageChange={onPageChange} /></section>
  </>;
}

function Dialog({ title, onClose, children, wide = false }) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    const focusable = () => [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
    (focusable()[0] || dialog).focus();
    const keyHandler = (event) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key === 'Tab') {
        const items = focusable();
        if (!items.length) {
          event.preventDefault();
          dialog.focus();
        } else if (event.shiftKey && document.activeElement === items[0]) {
          event.preventDefault();
          items.at(-1).focus();
        } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
          event.preventDefault();
          items[0].focus();
        }
      }
    };
    window.addEventListener('keydown', keyHandler);
    return () => {
      window.removeEventListener('keydown', keyHandler);
      previousFocus?.focus?.();
    };
  }, []);
  return <div className="biz-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} tabIndex="-1" className={`biz-dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="biz-dialog-title">
      <header><div><span className="biz-kicker">STOCKPILOT RECORD</span><h2 id="biz-dialog-title">{title}</h2></div><button className="biz-icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></header>
      {children}
    </section>
  </div>;
}

function Field({ label, name, value, onChange, type = 'text', required = false, min, max, step, placeholder, children, disabled }) {
  return <label className="biz-field"><span>{label}{required && <b> *</b>}</span>{children || <input name={name} type={type} value={value ?? ''} onChange={onChange} required={required} min={min} max={max} step={step} placeholder={placeholder} disabled={disabled} />}</label>;
}

function FormDialog({ kind, record, data, busy, onClose, onError, onSubmit }) {
  const formTitle = {
    product: record ? 'Edit product' : 'Create product', stock: `Update stock · ${record?.name}`,
    category: record ? 'Edit category' : 'Create category', supplier: record ? 'Edit supplier' : 'Create supplier',
    customer: record ? 'Edit customer' : 'Create customer', salesOrder: record ? `Edit ${record.orderNumber}` : 'New sales draft',
    purchaseOrder: record ? `Edit ${record.orderNumber}` : 'New purchase order', receipt: 'Receive goods',
    invoice: 'Create invoice', payment: `Record payment · ${record?.invoiceNumber}`,
    return: 'Create sales return', refund: `Request refund · ${record?.returnNumber}`,
  }[kind] || 'Create record';
  const [values, setValues] = useState(() => initialValues(kind, record));
  const [formError, setFormError] = useState('');
  const [reservedReturns, setReservedReturns] = useState([]);
  const [returnEligibilityLoading, setReturnEligibilityLoading] = useState(false);
  const [returnEligibilityError, setReturnEligibilityError] = useState('');
  useEffect(() => {
    if (kind !== 'return' || !values.orderId) {
      setReservedReturns([]);
      setReturnEligibilityLoading(false);
      setReturnEligibilityError('');
      return undefined;
    }
    let active = true;
    setReturnEligibilityLoading(true);
    setReturnEligibilityError('');
    api(`/returns?orderId=${encodeURIComponent(values.orderId)}&page=1&pageSize=100`)
      .then((result) => { if (active) setReservedReturns(result.returns); })
      .catch((requestError) => { if (active) setReturnEligibilityError(requestError.message); })
      .finally(() => { if (active) setReturnEligibilityLoading(false); });
    return () => { active = false; };
  }, [kind, onError, values.orderId]);
  const update = (event) => setValues((old) => ({ ...old, [event.target.name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const setValue = (name, value) => setValues((old) => ({ ...old, [name]: value }));
  const submitMutation = async (...args) => {
    const message = await onSubmit(...args);
    if (message) throw new Error(message);
  };
  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError('');
    onError('');
    try {
      const result = await submitForm(kind, values, record, data);
      if (kind === 'invoice') {
        await submitMutation(() => api('/invoices', send('POST', result)), 'Invoice draft created.', ['Invoices', 'Sales orders']);
      } else if (kind === 'payment') {
        await submitMutation(() => api(`/invoices/${record.id}/payments`, send('POST', result)), 'Payment recorded.', ['Payments', 'Invoices']);
      } else if (kind === 'return') {
        await submitMutation(() => api('/returns', send('POST', result)), 'Return saved as a draft.', ['Returns & refunds']);
      } else if (kind === 'refund') {
        await submitMutation(() => api(`/returns/${record.id}/refunds`, send('POST', result)), 'Refund request recorded.', ['Returns & refunds', 'Invoices']);
      } else if (kind === 'receipt') {
        await submitMutation(() => api(`/purchase-orders/${record.id}/receipts`, send('POST', result)), 'Receipt recorded and inventory updated.', ['Purchase orders', 'Products', 'Stock movements', 'Suppliers']);
      } else if (kind === 'salesOrder') {
        const route = record ? `/orders/${record.id}` : '/orders/drafts';
        await submitMutation(() => api(route, send(record ? 'PUT' : 'POST', result)), record ? 'Draft order updated.' : 'Sales draft created.', ['Sales orders', 'Dashboard']);
      } else if (kind === 'purchaseOrder') {
        if (record) await submitMutation(() => api(`/purchase-orders/${record.id}`, send('PUT', result)), 'Purchase order draft updated.', ['Purchase orders']);
        else await submitMutation(() => api('/purchase-orders', send('POST', result)), 'Purchase order draft created.', ['Purchase orders', 'Suppliers']);
      } else if (kind === 'stock') {
        await submitMutation(() => api(`/products/${record.id}/stock`, send('PATCH', result)), 'Stock quantity updated through the ledger.', ['Products', 'Dashboard', 'Stock movements']);
      } else {
        const routes = { product: '/products', category: '/categories', supplier: '/suppliers', customer: '/customers' };
        const body = result;
        await submitMutation(() => api(record ? `${routes[kind]}/${record.id}` : routes[kind], send(record ? 'PUT' : 'POST', body)), `${kind[0].toUpperCase()}${kind.slice(1)} ${record ? 'updated' : 'created'}.`, [kind === 'product' ? 'Products' : kind === 'category' ? 'Categories' : kind === 'supplier' ? 'Suppliers' : 'Customers', ...(kind === 'product' ? ['Dashboard'] : [])]);
      }
    } catch (requestError) {
      setFormError(requestError.message);
    }
  };

  return <Dialog title={formTitle} onClose={onClose} wide={['salesOrder', 'purchaseOrder', 'receipt', 'return'].includes(kind)}>
    <form className="biz-form" onSubmit={handleSubmit}>
      {formError && <div className="biz-error-inline" role="alert">{formError}</div>}
      <FormFields kind={kind} values={values} update={update} setValue={setValue} record={record} data={data} reservedReturns={reservedReturns} returnEligibilityLoading={returnEligibilityLoading} returnEligibilityError={returnEligibilityError} />
      <div className="biz-dialog-actions"><button type="button" className="biz-button secondary" onClick={onClose}>Cancel</button><button className="biz-button primary" disabled={busy || (kind === 'return' && (returnEligibilityLoading || Boolean(returnEligibilityError))) || (kind === 'refund' && record.refundableBalance <= 0)}>{busy ? 'Saving…' : formTitle.startsWith('Receive') ? 'Record receipt' : kind === 'invoice' ? 'Create draft invoice' : kind === 'return' ? 'Save return draft' : kind === 'refund' ? 'Request refund' : 'Save'}</button></div>
    </form>
  </Dialog>;
}

function initialValues(kind, record) {
  const values = {
    product: record ? { ...record, categoryId: record.categoryId || '', supplierId: record.supplierId || '' } : { sku: '', name: '', category: '', price: '', quantity: 0, lowStockThreshold: 5, description: '', categoryId: '', supplierId: '', unitCost: '', maxStock: '', unitOfMeasure: 'each', isActive: true },
    category: record || { name: '', description: '' },
    supplier: record || { supplierCode: '', businessName: '', contactPerson: '', email: '', phone: '', address: '', notes: '', isActive: true },
    customer: record || { customerCode: '', name: '', email: '', phone: '', address: '', notes: '', isActive: true },
    stock: { quantity: record?.quantity ?? 0, operation: 'set' },
    salesOrder: { customerId: record?.customerId || '', items: record?.items?.map((item) => ({ productId: item.productId, quantity: item.quantity })) || [] },
    purchaseOrder: { supplierId: record?.supplierId || '', notes: record?.notes || '', items: record?.items?.map((item) => ({ productId: item.productId, quantity: item.orderedQuantity, unitCost: item.unitCost, discountAmount: item.discountAmount, taxRate: item.taxRate })) || [] },
    receipt: { receiptNumber: '', notes: '', items: [] },
    invoice: { orderId: '' },
    payment: { amount: '', method: 'cash', externalReference: '', status: 'completed', notes: '' },
    return: { orderId: '', invoiceId: '', reason: '', items: [] },
    refund: { paymentId: '', amount: '', method: 'cash', externalReference: '', notes: '' },
  };
  return values[kind] || {};
}

function FormFields({ kind, values, update, setValue, record, data, reservedReturns, returnEligibilityLoading, returnEligibilityError }) {
  const products = data.products || [];
  const suppliers = (data.suppliers || []).filter((item) => item.isActive);
  const customers = (data.customers || []).filter((item) => item.isActive);
  if (kind === 'product') return <div className="biz-grid-form">
    <Field label="SKU" name="sku" value={values.sku} onChange={update} required /><Field label="Product name" name="name" value={values.name} onChange={update} required />
    <Field label="Category" name="category" value={values.category} onChange={update} required />
    <Field label="Category record" name="categoryId" value={values.categoryId} onChange={update}><select name="categoryId" value={values.categoryId || ''} onChange={(event) => {
      update(event);
      const selected = (data.categories || []).find((item) => String(item.id) === event.target.value);
      if (selected) setValue('category', selected.name);
    }}><option value="">No linked category</option>{(data.categories || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    <Field label="Supplier" name="supplierId" value={values.supplierId} onChange={update}><select name="supplierId" value={values.supplierId || ''} onChange={update}><option value="">No supplier</option>{(data.suppliers || []).map((item) => <option key={item.id} value={item.id}>{item.businessName}</option>)}</select></Field>
    <Field label="Selling price" name="price" type="number" min="0" step="0.01" value={values.price} onChange={update} required />
    {!record && <Field label="Opening quantity" name="quantity" type="number" min="0" step="1" value={values.quantity} onChange={update} required />}
    <Field label="Unit cost" name="unitCost" type="number" min="0" step="0.01" value={values.unitCost ?? ''} onChange={update} />
    <Field label="Low-stock threshold" name="lowStockThreshold" type="number" min="0" step="1" value={values.lowStockThreshold} onChange={update} required />
    <Field label="Maximum stock" name="maxStock" type="number" min="0" step="1" value={values.maxStock ?? ''} onChange={update} />
    <Field label="Unit of measure" name="unitOfMeasure" value={values.unitOfMeasure} onChange={update} />
    <Field label="Description" name="description" value={values.description} onChange={update} />
    <label className="biz-check"><input type="checkbox" name="isActive" checked={Boolean(values.isActive)} onChange={update} /> Product is active</label>
  </div>;
  if (kind === 'category') return <div className="biz-grid-form"><Field label="Category name" name="name" value={values.name} onChange={update} required /><Field label="Description" name="description" value={values.description} onChange={update} /></div>;
  if (kind === 'supplier') return <div className="biz-grid-form"><Field label="Supplier code" name="supplierCode" value={values.supplierCode} onChange={update} required /><Field label="Business name" name="businessName" value={values.businessName} onChange={update} required /><Field label="Contact person" name="contactPerson" value={values.contactPerson} onChange={update} /><Field label="Email" name="email" type="email" value={values.email} onChange={update} /><Field label="Phone" name="phone" value={values.phone} onChange={update} /><Field label="Address" name="address" value={values.address} onChange={update} /><Field label="Notes" name="notes" value={values.notes} onChange={update} /><label className="biz-check"><input type="checkbox" name="isActive" checked={Boolean(values.isActive)} onChange={update} /> Supplier is active</label></div>;
  if (kind === 'customer') return <div className="biz-grid-form"><Field label="Customer code" name="customerCode" value={values.customerCode} onChange={update} required /><Field label="Customer name" name="name" value={values.name} onChange={update} required /><Field label="Email" name="email" type="email" value={values.email} onChange={update} /><Field label="Phone" name="phone" value={values.phone} onChange={update} /><Field label="Address" name="address" value={values.address} onChange={update} /><Field label="Notes" name="notes" value={values.notes} onChange={update} /><label className="biz-check"><input type="checkbox" name="isActive" checked={Boolean(values.isActive)} onChange={update} /> Customer is active</label></div>;
  if (kind === 'stock') return <div className="biz-form-section"><div className="biz-callout">Current stock: <strong>{record.quantity}</strong>. This update is recorded in the stock movement ledger.</div><Field label="Set quantity" name="quantity" type="number" min="0" step="1" value={values.quantity} onChange={update} required /></div>;
  if (kind === 'salesOrder' || kind === 'purchaseOrder') {
    const purchase = kind === 'purchaseOrder';
    const items = values.items || [];
    const updateLine = (index, key, value) => setValue('items', items.map((item, i) => i === index ? { ...item, [key]: value } : item));
    return <div className="biz-form-section">
      {purchase ? <Field label="Supplier" name="supplierId" value={values.supplierId} onChange={update} required><select name="supplierId" value={values.supplierId} onChange={update} required><option value="">Choose supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.businessName}</option>)}</select></Field>
        : <Field label="Customer (optional)" name="customerId" value={values.customerId} onChange={update}><select name="customerId" value={values.customerId} onChange={update}><option value="">Walk-in customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></Field>}
      {purchase && <Field label="Notes" name="notes" value={values.notes} onChange={update} />}
      <div className="biz-line-heading"><strong>Order items</strong><button type="button" className="biz-button secondary small" onClick={() => setValue('items', [...items, { productId: '', quantity: 1, ...(purchase ? { unitCost: '', discountAmount: 0, taxRate: 0 } : {}) }])}><Plus size={14} /> Add line</button></div>
      {items.map((item, index) => <div className="biz-line-editor" key={`${index}-${item.productId}`}>
        <select aria-label={`Product for line ${index + 1}`} value={item.productId} onChange={(event) => updateLine(index, 'productId', event.target.value)} required><option value="">Choose product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}{!purchase ? ` · ${product.quantity} available` : ''}</option>)}</select>
        <input aria-label={`Quantity for line ${index + 1}`} type="number" min="1" step="1" value={item.quantity} onChange={(event) => updateLine(index, 'quantity', event.target.value)} required placeholder="Qty" />
        {purchase && <><input aria-label={`Unit cost for line ${index + 1}`} type="number" min="0" step="0.01" value={item.unitCost} onChange={(event) => updateLine(index, 'unitCost', event.target.value)} required placeholder="Unit cost" /><input aria-label={`Discount for line ${index + 1}`} type="number" min="0" step="0.01" value={item.discountAmount} onChange={(event) => updateLine(index, 'discountAmount', event.target.value)} placeholder="Discount" /><input aria-label={`Tax percent for line ${index + 1}`} type="number" min="0" max="100" step="0.01" value={item.taxRate} onChange={(event) => updateLine(index, 'taxRate', event.target.value)} placeholder="Tax %" /></>}
        <button type="button" className="biz-remove-line" aria-label={`Remove line ${index + 1}`} onClick={() => setValue('items', items.filter((_, i) => i !== index))}><X size={16} /></button>
      </div>)}
      {!items.length && <p className="biz-hint">Add at least one product line. The server validates stock and calculates persisted totals.</p>}
    </div>;
  }
  if (kind === 'receipt') {
    const items = values.items || [];
    const selected = new Set(items.map((line) => line.purchaseOrderItemId));
    return <div className="biz-form-section">
      <div className="biz-callout"><strong>{record.orderNumber}</strong> · {record.supplierName} · {record.status}</div>
      <Field label="Receipt number" name="receiptNumber" value={values.receiptNumber} onChange={update} required />
      <Field label="Notes" name="notes" value={values.notes} onChange={update} />
      <strong className="biz-section-title">Outstanding lines</strong>
      {record.items.filter((item) => item.outstandingQuantity > 0).map((item) => {
        const current = items.find((line) => Number(line.purchaseOrderItemId) === item.id);
        return <label className="biz-receipt-line" key={item.id}><span><strong>{item.productName}</strong><small>{item.receivedQuantity} received · {item.outstandingQuantity} outstanding</small></span><input aria-label={`Receive quantity for ${item.productName}`} type="number" min="0" max={item.outstandingQuantity} step="1" value={current?.quantity ?? 0} onChange={(event) => {
          const next = items.filter((line) => Number(line.purchaseOrderItemId) !== item.id);
          if (Number(event.target.value) > 0) next.push({ purchaseOrderItemId: item.id, quantity: event.target.value });
          setValue('items', next);
        }} /></label>;
      })}
      {record.items.every((item) => item.outstandingQuantity === 0) && <p className="biz-hint">All ordered quantities have been received.</p>}
      {selected.size > 0 && <small className="biz-hint">The server performs the final over-receipt validation and stock transaction.</small>}
    </div>;
  }
  if (kind === 'invoice') {
    const eligible = (data.orders || []).filter((order) => ['confirmed', 'processing', 'shipped', 'delivered'].includes(order.status) && order.stockDeductedAt && !(data.invoices || []).some((invoice) => invoice.orderId === order.id && invoice.status !== 'void'));
    return <div className="biz-form-section"><Field label="Eligible sales order" name="orderId" value={values.orderId} onChange={update} required><select name="orderId" value={values.orderId} onChange={update} required><option value="">Select order</option>{eligible.map((order) => <option key={order.id} value={order.id}>{order.orderNumber} · {order.customerName} · {asMoney(order.total)}</option>)}</select></Field><p className="biz-hint">The server snapshots the order lines and calculates invoice totals. Legacy orders have no tax/discount breakdown.</p></div>;
  }
  if (kind === 'payment') return <div className="biz-grid-form"><div className="biz-callout field-full">Invoice total {asMoney(record.total)} · outstanding {asMoney(record.outstandingBalance)}</div><Field label="Payment amount" name="amount" type="number" min="0.01" max={record.outstandingBalance} step="0.01" value={values.amount} onChange={update} required /><Field label="Method" name="method" value={values.method} onChange={update} required /><Field label="External reference" name="externalReference" value={values.externalReference} onChange={update} /><Field label="Status" name="status" value={values.status} onChange={update}><select name="status" value={values.status} onChange={update}><option value="completed">Completed</option><option value="failed">Failed</option></select></Field><Field label="Notes" name="notes" value={values.notes} onChange={update} /></div>;
  if (kind === 'return') {
    const eligible = (data.orders || []).filter((order) => ['confirmed', 'processing', 'shipped', 'delivered'].includes(order.status) && order.stockDeductedAt);
    const order = eligible.find((item) => String(item.id) === String(values.orderId));
    const invoices = (data.invoices || []).filter((invoice) => invoice.orderId === Number(values.orderId) && ['issued', 'partially_paid', 'paid', 'credited'].includes(invoice.status));
    return <div className="biz-form-section"><Field label="Sales order" name="orderId" value={values.orderId} onChange={(event) => { update(event); setValue('items', []); setValue('invoiceId', ''); }} required><select name="orderId" value={values.orderId} onChange={(event) => { update(event); setValue('items', []); setValue('invoiceId', ''); }} required><option value="">Select eligible sale</option>{eligible.map((r) => <option key={r.id} value={r.id}>{r.orderNumber} · {r.customerName}</option>)}</select></Field>
      {invoices.length > 0 && <Field label="Invoice (required for refunds)" name="invoiceId" value={values.invoiceId} onChange={update}><select name="invoiceId" value={values.invoiceId} onChange={update}><option value="">No invoice</option>{invoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} · {asMoney(invoice.total)}</option>)}</select></Field>}
      <Field label="Return reason" name="reason" value={values.reason} onChange={update} required />
      {returnEligibilityLoading && <p className="biz-hint">Checking remaining return quantities from saved return history…</p>}
      {returnEligibilityError && <p className="biz-error-inline">Could not load return history: {returnEligibilityError}. Close and retry before creating a return.</p>}
      {order?.items.map((line) => {
        const existing = values.items.find((item) => Number(item.orderItemId) === line.orderItemId);
        const reserved = reservedReturns
          .filter((salesReturn) => ['draft', 'accepted'].includes(salesReturn.status))
          .flatMap((salesReturn) => salesReturn.items)
          .filter((item) => item.orderItemId === line.orderItemId)
          .reduce((sum, item) => sum + item.quantity, 0);
        const remaining = Math.max(0, line.quantity - reserved);
        return <div className="biz-return-line" key={line.orderItemId}><div><strong>{line.productName}</strong><small>{line.sku} · sold {line.quantity} · {reserved} reserved · {remaining} returnable · {asMoney(line.unitPrice)} each</small></div>
          <input aria-label={`Return quantity for ${line.productName}`} type="number" min="0" max={remaining} step="1" disabled={remaining === 0} value={existing?.quantity ?? 0} onChange={(event) => {
            const rest = values.items.filter((item) => Number(item.orderItemId) !== line.orderItemId);
            if (Number(event.target.value) > 0) rest.push({ orderItemId: line.orderItemId, quantity: event.target.value, restockable: true, restockReason: '' });
            setValue('items', rest);
          }} />
          {existing && <div className="biz-return-options"><label><input type="checkbox" checked={existing.restockable} onChange={(event) => setValue('items', values.items.map((item) => item.orderItemId === line.orderItemId ? { ...item, restockable: event.target.checked } : item))} /> Restockable</label><input aria-label={`Restock reason for ${line.productName}`} required value={existing.restockReason} onChange={(event) => setValue('items', values.items.map((item) => item.orderItemId === line.orderItemId ? { ...item, restockReason: event.target.value } : item))} placeholder="Restock / disposition reason" /></div>}
        </div>;
      })}
      {!order && <p className="biz-hint">Choose a sale to see its order lines. The backend checks cumulative return quantities.</p>}
    </div>;
  }
  if (kind === 'refund') {
    const accepted = (data.returns || []).find((item) => item.id === record.id);
    const invoice = (data.invoices || []).find((item) => item.id === record.invoiceId);
    const payments = (data.payments || []).filter((payment) => payment.invoiceId === record.invoiceId && payment.status === 'completed');
    return <div className="biz-form-section"><div className="biz-callout">Accepted return credit: <strong>{asMoney(record.total)}</strong>{accepted && ` · remaining refund eligibility: ${asMoney(accepted.refundableBalance)}`}</div>
      {!invoice && <p className="biz-error-inline">The linked invoice is not available. Refresh and retry.</p>}
      <Field label="Completed payment" name="paymentId" value={values.paymentId} onChange={update} required><select name="paymentId" value={values.paymentId} onChange={update} required><option value="">Select payment</option>{payments.map((payment) => <option key={payment.id} value={payment.id}>{payment.paymentReference} · {asMoney(payment.amount)}</option>)}</select></Field>
      <Field label="Refund amount" name="amount" type="number" min="0.01" max={record.refundableBalance} step="0.01" value={values.amount} onChange={update} required /><Field label="Method" name="method" value={values.method} onChange={update} required /><Field label="External reference" name="externalReference" value={values.externalReference} onChange={update} /><Field label="Notes" name="notes" value={values.notes} onChange={update} />
    </div>;
  }
  return null;
}

function DetailsDialog({ kind, record, data, onClose, onCreate, onConfirm, onDetails }) {
  if (!record) return <Dialog title="Record details" onClose={onClose}><Empty title="Record unavailable" detail="Refresh the list and try again." /></Dialog>;
  const title = {
    product: record.name,
    productHistory: 'Product purchase & sales history',
    category: record.name,
    supplier: record.businessName,
    customer: record.name,
    order: record.orderNumber,
    purchaseOrder: record.orderNumber,
    receipt: record.receiptNumber,
    invoice: record.invoiceNumber,
    payment: record.paymentReference,
    salesReturn: record.returnNumber,
    refund: record.refundReference,
  }[kind] || 'Record details';
  const actions = [];
  if (kind === 'product') actions.push(<ActionButton key="history" onClick={() => onDetails('productHistory', record.id)}>Purchase & sales history</ActionButton>);
  if (kind === 'purchaseOrder' && ['ordered', 'partially_received'].includes(record.status) && record.items.some((item) => item.outstandingQuantity > 0)) {
    actions.push(<ActionButton key="receive" onClick={() => onCreate('receipt', record)}>Receive goods</ActionButton>);
  }
  if (kind === 'purchaseOrder' && record.status === 'draft') {
    actions.push(<ActionButton key="submit" onClick={() => onConfirm('Submit purchase order', `Submit ${record.orderNumber} to ${record.supplierName}? Its commercial details will be retained.`, () => api(`/purchase-orders/${record.id}/submit`, send('POST', {})), 'Purchase order submitted.', ['Purchase orders'])}>Submit order</ActionButton>);
    actions.push(<ActionButton key="cancel" tone="danger" onClick={() => onConfirm('Cancel purchase order', `Cancel ${record.orderNumber}?`, () => api(`/purchase-orders/${record.id}/cancel`, send('POST', {})), 'Purchase order cancelled.', ['Purchase orders'])}>Cancel</ActionButton>);
  }
  if (kind === 'order') {
    for (const next of salesStates[record.status] || []) {
      actions.push(<ActionButton key={next} tone={next === 'cancelled' ? 'danger' : 'plain'} onClick={() => onConfirm(`Set order ${next}`, `Move ${record.orderNumber} from ${record.status} to ${next}? Stock changes are handled by the server.`, () => api(`/orders/${record.id}/status`, send('PATCH', { status: next })), `Order ${record.orderNumber} updated.`, ['Sales orders', 'Dashboard', 'Stock movements'])}>{next.replaceAll('_', ' ')}</ActionButton>);
    }
    if (record.status === 'draft') actions.push(<ActionButton key="edit" onClick={() => onCreate('salesOrder', record)}>Edit draft</ActionButton>);
  }
  if (kind === 'purchaseOrder' && record.status === 'draft') actions.push(<ActionButton key="edit" onClick={() => onCreate('purchaseOrder', record)}>Edit draft</ActionButton>);
  if (kind === 'invoice') {
    if (record.status === 'draft') actions.push(<ActionButton key="issue" onClick={() => onConfirm('Issue invoice', `Issue ${record.invoiceNumber}? Its financial snapshot will be locked.`, () => api(`/invoices/${record.id}/issue`, send('POST', {})), 'Invoice issued.', ['Invoices'])}>Issue</ActionButton>);
    if (['draft', 'issued'].includes(record.status)) actions.push(<ActionButton key="void" tone="danger" onClick={() => onConfirm('Void invoice', `Void ${record.invoiceNumber}? This action is irreversible.`, () => api(`/invoices/${record.id}/void`, send('POST', {})), 'Invoice voided.', ['Invoices'])}>Void</ActionButton>);
    if (['issued', 'partially_paid'].includes(record.status)) actions.push(<ActionButton key="payment" onClick={() => onCreate('payment', record)}>Record payment</ActionButton>);
  }
  if (kind === 'payment' && record.status === 'completed') actions.push(<ActionButton key="reverse" tone="danger" onClick={() => onConfirm('Reverse payment', `Reverse ${record.paymentReference}?`, () => api(`/payments/${record.id}/reverse`, send('POST', {})), 'Payment reversed.', ['Payments', 'Invoices'])}>Reverse payment</ActionButton>);
  if (kind === 'salesReturn' && record.status === 'draft') {
    actions.push(<ActionButton key="accept" onClick={() => onConfirm('Accept return', `Accept ${record.returnNumber}? Restockable items will be returned to inventory.`, () => api(`/returns/${record.id}/complete`, send('POST', { status: 'accepted' })), 'Return accepted.', ['Returns & refunds', 'Products', 'Stock movements'])}>Accept</ActionButton>);
    actions.push(<ActionButton key="reject" tone="danger" onClick={() => onConfirm('Reject return', `Reject ${record.returnNumber}?`, () => api(`/returns/${record.id}/complete`, send('POST', { status: 'rejected' })), 'Return rejected.', ['Returns & refunds'])}>Reject</ActionButton>);
  }
  if (kind === 'salesReturn' && record.status === 'accepted' && record.invoiceId) actions.push(<ActionButton key="refund" onClick={() => onCreate('refund', record)}>Request refund</ActionButton>);
  if (kind === 'refund' && record.status === 'requested') {
    actions.push(<ActionButton key="complete" onClick={() => onConfirm('Complete refund', `Mark ${record.refundReference} as completed?`, () => api(`/refunds/${record.id}/complete`, send('POST', {})), 'Refund completed.', ['Returns & refunds', 'Invoices'])}>Complete refund</ActionButton>);
    actions.push(<ActionButton key="fail" tone="danger" onClick={() => onConfirm('Fail refund', `Mark ${record.refundReference} as failed?`, () => api(`/refunds/${record.id}/fail`, send('POST', {})), 'Refund marked failed.', ['Returns & refunds'])}>Mark failed</ActionButton>);
  }

  const excluded = new Set(['items', 'receipts', 'purchaseHistory', 'orderHistory', 'purchases', 'sales', 'refunds']);
  const fields = Object.entries(record).filter(([key, value]) => !excluded.has(key) && value !== null && typeof value !== 'object');
  return <Dialog title={title || 'Record details'} onClose={onClose} wide>
    <div className="biz-detail">
      {actions.length > 0 && <div className="biz-detail-actions">{actions}</div>}
      <dl className="biz-detail-grid">{fields.map(([key, value]) => <div key={key}><dt>{key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</dt><dd>{key.toLowerCase().includes('status') ? <Badge value={value} /> : isMoneyField(key) ? asMoney(value) : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : key.toLowerCase().endsWith('at') || key.toLowerCase().endsWith('date') ? textDate(value) : String(value)}</dd></div>)}</dl>
      {kind === 'productHistory' ? <>
        <DetailList title="Purchases" rows={record.purchases} columns={['purchaseOrderNumber', 'status', 'orderedQuantity', 'receivedQuantity', 'unitCost', 'createdAt']} />
        <DetailList title="Sales" rows={record.sales} columns={['orderNumber', 'customerName', 'status', 'quantity', 'unitPrice', 'createdAt']} />
      </> : null}
      {record.items && <DetailList title="Line items" rows={record.items} columns={kind === 'purchaseOrder' ? ['productName', 'sku', 'orderedQuantity', 'receivedQuantity', 'outstandingQuantity', 'unitCost', 'total'] : ['productName', 'sku', 'quantity', 'unitPrice', 'total', 'restockable']} />}
      {record.receipts && <ReceiptHistory rows={record.receipts} onDetails={onDetails} />}
      {record.purchaseHistory && <DetailList title="Purchase history" rows={record.purchaseHistory} columns={['orderNumber', 'status', 'subtotal', 'taxTotal', 'total', 'createdAt']} />}
      {record.orderHistory && <DetailList title="Sales history" rows={record.orderHistory} columns={['orderNumber', 'status', 'paymentStatus', 'total', 'createdAt']} />}
      {record.refunds && <DetailList title="Refund history" rows={record.refunds} columns={['refundReference', 'amount', 'method', 'status', 'createdAt']} />}
      {kind === 'invoice' && <DetailList title="Payments recorded" rows={record.payments || (data.payments || []).filter((payment) => payment.invoiceId === record.id)} columns={['paymentReference', 'amount', 'method', 'status', 'paymentDate']} />}
      {kind === 'receipt' && <DetailList title="Received lines" rows={record.items} columns={['productName', 'sku', 'quantity', 'unitCost']} />}
    </div>
  </Dialog>;
}

function ReceiptHistory({ rows, onDetails }) {
  return <section className="biz-detail-list"><h3>Receipt history</h3>{rows.length ? <div className="biz-table-wrap"><table className="biz-table"><thead><tr><th>Receipt</th><th>Received</th><th>Lines</th><th></th></tr></thead><tbody>{rows.map((receipt) => <tr key={receipt.id}><td>{receipt.receiptNumber}</td><td>{textDate(receipt.receivedAt)}</td><td>{receipt.items.length}</td><td><ActionButton onClick={() => onDetails('receipt', receipt.id)}>Details</ActionButton></td></tr>)}</tbody></table></div> : <p className="biz-hint">No goods have been received.</p>}</section>;
}

function DetailList({ title, rows = [], columns }) {
  return <section className="biz-detail-list"><h3>{title}</h3>{rows.length ? <div className="biz-table-wrap"><table className="biz-table"><thead><tr>{columns.map((column) => <th key={column}>{column.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || row.purchaseOrderId || row.orderId || index}>{columns.map((column) => <td key={column}>{isMoneyField(column) ? asMoney(row[column]) : column.toLowerCase().endsWith('at') || column.toLowerCase().endsWith('date') ? textDate(row[column]) : column === 'items' ? `${row.items?.length || 0} line(s)` : column === 'restockable' ? (row[column] ? 'Yes' : 'No') : row[column] ?? '—'}</td>)}</tr>)}</tbody></table></div> : <p className="biz-hint">No saved records.</p>}</section>;
}

function numberValue(value, field) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${field} must be a valid number.`);
  return number;
}

function submitForm(kind, values, record) {
  const number = (field) => numberValue(values[field], field);
  if (kind === 'product') {
    const payload = {
      sku: values.sku,
      name: values.name,
      category: values.category,
      price: number('price'),
      lowStockThreshold: number('lowStockThreshold'),
      description: values.description?.trim() || null,
      categoryId: number('categoryId'),
      supplierId: number('supplierId'),
      unitCost: number('unitCost'),
      maxStock: number('maxStock'),
      unitOfMeasure: values.unitOfMeasure?.trim() || null,
      isActive: Boolean(values.isActive),
    };
    if (!record) payload.quantity = number('quantity');
    return payload;
  }
  if (kind === 'category') return { name: values.name, description: values.description || null };
  if (kind === 'supplier') return { supplierCode: values.supplierCode, businessName: values.businessName, contactPerson: values.contactPerson || null, email: values.email || null, phone: values.phone || null, address: values.address || null, notes: values.notes || null, isActive: Boolean(values.isActive) };
  if (kind === 'customer') return { customerCode: values.customerCode, name: values.name, email: values.email || null, phone: values.phone || null, address: values.address || null, notes: values.notes || null, isActive: Boolean(values.isActive) };
  if (kind === 'stock') return { operation: 'set', quantity: number('quantity') };
  if (kind === 'salesOrder') return { ...(values.customerId ? { customerId: number('customerId') } : {}), items: values.items.map((item) => ({ productId: numberValue(item.productId, 'Product'), quantity: numberValue(item.quantity, 'Quantity') })) };
  if (kind === 'purchaseOrder') return { supplierId: number('supplierId'), notes: values.notes || null, items: values.items.map((item) => ({ productId: numberValue(item.productId, 'Product'), quantity: numberValue(item.quantity, 'Quantity'), unitCost: numberValue(item.unitCost, 'Unit cost'), discountAmount: numberValue(item.discountAmount, 'Discount') ?? 0, taxRate: numberValue(item.taxRate, 'Tax rate') ?? 0 })) };
  if (kind === 'receipt') return { receiptNumber: values.receiptNumber, notes: values.notes || null, items: values.items.map((item) => ({ purchaseOrderItemId: numberValue(item.purchaseOrderItemId, 'Purchase order item'), quantity: numberValue(item.quantity, 'Quantity') })) };
  if (kind === 'invoice') return { orderId: number('orderId') };
  if (kind === 'payment') return { amount: number('amount'), method: values.method, status: values.status, externalReference: values.externalReference || null, notes: values.notes || null };
  if (kind === 'return') return { orderId: number('orderId'), ...(values.invoiceId ? { invoiceId: number('invoiceId') } : {}), reason: values.reason, items: values.items.map((item) => ({ orderItemId: numberValue(item.orderItemId, 'Order item'), quantity: numberValue(item.quantity, 'Quantity'), restockable: Boolean(item.restockable), restockReason: item.restockReason })) };
  if (kind === 'refund') return { paymentId: number('paymentId'), amount: number('amount'), method: values.method, externalReference: values.externalReference || null, notes: values.notes || null };
  return {};
}
