import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Boxes,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  Command,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  Minus,
  Package,
  Plus,
  Search,
  Settings2,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Tag,
  TrendingUp,
  X,
} from 'lucide-react';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (response.status === 204) return null;
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Something went wrong.');
  return body;
}

const initialProduct = { sku: '', name: '', category: '', price: '', quantity: '', lowStockThreshold: '5' };

function App() {
  const [page, setPage] = useState('Dashboard');
  const [dashboard, setDashboard] = useState(null);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [stockFilter, setStockFilter] = useState('');
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const hasLoaded = useRef(false);

  const refreshDashboard = useCallback(async () => {
    const result = await api('/dashboard');
    setDashboard(result);
  }, []);

  const refreshProducts = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('q', search.trim());
    if (category) params.set('category', category);
    if (stockFilter) params.set('stock', stockFilter);
    const result = await api(`/products?${params.toString()}`);
    setProducts(result.products);
    setCategories(result.categories);
  }, [search, category, stockFilter]);

  const refreshOrders = useCallback(async () => {
    const result = await api('/orders');
    setOrders(result.orders);
  }, []);

  const refreshAll = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      await Promise.all([refreshDashboard(), refreshProducts(), refreshOrders()]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [refreshDashboard, refreshProducts, refreshOrders]);

  useEffect(() => {
    refreshAll().finally(() => { hasLoaded.current = true; });
  }, []);

  useEffect(() => {
    if (!hasLoaded.current) return undefined;
    const timer = window.setTimeout(() => {
      refreshProducts().catch((requestError) => setError(requestError.message));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [refreshProducts]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleMutation = async (action, message) => {
    try {
      await action();
      await refreshAll();
      setModal(null);
      setToast(message);
    } catch (requestError) {
      setError(requestError.message);
      throw requestError;
    }
  };

  const navItems = [
    { label: 'Dashboard', icon: LayoutDashboard },
    { label: 'Products', icon: Package },
    { label: 'Orders', icon: ClipboardList },
  ];

  const changePage = (nextPage) => {
    setPage(nextPage);
    setMobileNav(false);
    setError('');
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); changePage('Dashboard'); }}>
          <span className="brand-mark"><Command size={19} strokeWidth={2.6} /></span>
          <span>stock<span className="brand-light">pilot</span></span>
          <span className="brand-plan">STUDIO</span>
        </a>
        <div className="workspace">
          <span className="workspace-avatar">M</span>
          <span className="workspace-copy"><strong>Maple & Moss</strong><small>Workspace</small></span>
          <ChevronDown size={15} />
        </div>
        <span className="nav-caption">WORKSPACE</span>
        <nav className="primary-nav" aria-label="Main navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button className={`nav-link ${page === item.label ? 'active' : ''}`} key={item.label} onClick={() => changePage(item.label)}>
                <Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>
                {item.label === 'Products' && dashboard?.lowStockCount > 0 && <span className="nav-count">{dashboard.lowStockCount}</span>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <span className="tip-icon"><Sparkles size={15} /></span>
            <strong>Good things are in stock.</strong>
            <p>Keep your bestsellers ready for the next order.</p>
            <button onClick={() => { changePage('Products'); setModal({ type: 'product' }); }}>Add a product <ArrowRight size={14} /></button>
          </div>
          <button className="nav-link settings-link" onClick={() => setToast('You’re all set — settings are coming soon.')}><Settings2 size={17} /><span>Settings</span></button>
          <div className="profile-row">
            <span className="profile-avatar">JD</span>
            <span className="profile-copy"><strong>Jamie Dawson</strong><small>Store owner</small></span>
            <ChevronDown size={15} />
          </div>
        </div>
      </aside>

      {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={20} /></button>
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{page}</strong></div>
          <div className="topbar-right">
            <div className="global-search"><Search size={15} /><input aria-label="Search products" placeholder="Search anything..." value={search} onChange={(event) => { setSearch(event.target.value); if (page !== 'Products') setPage('Products'); }} /><kbd>⌘ K</kbd></div>
            <button className="icon-button notification-button" aria-label="Low stock alerts" onClick={() => { changePage('Products'); setStockFilter('low'); }}><Bell size={18} />{dashboard?.lowStockCount > 0 && <i />}</button>
            <span className="topbar-divider" />
            <span className="top-date">{new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date())}</span>
          </div>
        </header>

        <div className="content-wrap">
          {error && <div className="error-banner" role="alert"><AlertTriangle size={17} /><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
          {loading ? <LoadingState /> : (
            <>
              {page === 'Dashboard' && <DashboardPage dashboard={dashboard} onNavigate={changePage} onModal={setModal} />}
              {page === 'Products' && (
                <ProductsPage
                  products={products}
                  categories={categories}
                  search={search}
                  category={category}
                  stockFilter={stockFilter}
                  onSearch={setSearch}
                  onCategory={setCategory}
                  onStockFilter={setStockFilter}
                  onModal={setModal}
                  onDelete={(product) => setModal({ type: 'delete', product })}
                />
              )}
              {page === 'Orders' && <OrdersPage orders={orders} onModal={setModal} />}
            </>
          )}
        </div>
      </main>

      {modal && (
        <Modal onClose={() => setModal(null)} title={modal.type === 'product' ? (modal.product ? 'Edit product' : 'Add a product') : modal.type === 'stock' ? 'Update stock' : modal.type === 'order' ? 'Create an order' : 'Delete product'}>
          {modal.type === 'product' && <ProductForm product={modal.product} onCancel={() => setModal(null)} onSubmit={(data) => handleMutation(() => api(modal.product ? `/products/${modal.product.id}` : '/products', { method: modal.product ? 'PUT' : 'POST', body: JSON.stringify(data) }), modal.product ? 'Product details updated.' : 'Product added to your inventory.')} />}
          {modal.type === 'stock' && <StockForm product={modal.product} onCancel={() => setModal(null)} onSubmit={(data) => handleMutation(() => api(`/products/${modal.product.id}/stock`, { method: 'PATCH', body: JSON.stringify(data) }), 'Stock levels updated.')} />}
          {modal.type === 'order' && <OrderForm products={products} onCancel={() => setModal(null)} onSubmit={(data) => handleMutation(() => api('/orders', { method: 'POST', body: JSON.stringify(data) }), 'Order placed and inventory updated.')} />}
          {modal.type === 'delete' && <DeleteConfirm product={modal.product} onCancel={() => setModal(null)} onDelete={() => handleMutation(() => api(`/products/${modal.product.id}`, { method: 'DELETE' }), 'Product deleted.')} />}
        </Modal>
      )}
      {toast && <div className="toast" role="status"><span><Check size={15} /></span>{toast}</div>}
    </div>
  );
}

function LoadingState() {
  return <div className="loading-state"><LoaderCircle size={25} className="spin" /><span>Getting your workspace ready…</span></div>;
}

function PageHeading({ eyebrow, title, description, action, icon: Icon }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <button className="button button-primary" onClick={action.onClick}>{Icon && <Icon size={16} />}{action.label}</button>}
    </div>
  );
}

function DashboardPage({ dashboard, onNavigate, onModal }) {
  if (!dashboard) return null;
  const stats = [
    { label: 'Inventory value', value: currency.format(dashboard.inventoryValue), note: 'Across all products', icon: CircleDollarSign, tone: 'mint', change: 'On hand' },
    { label: 'Total products', value: dashboard.productCount.toLocaleString(), note: 'Unique items in catalog', icon: Package, tone: 'peach', change: 'In catalog' },
    { label: 'Units in stock', value: dashboard.unitsInStock.toLocaleString(), note: 'Ready to be sold', icon: Boxes, tone: 'lavender', change: 'Available' },
    { label: 'Orders this month', value: dashboard.monthlyOrderCount.toLocaleString(), note: `${currency.format(dashboard.monthlyRevenue)} in sales`, icon: TrendingUp, tone: 'blue', change: 'This month' },
  ];
  return (
    <>
      <PageHeading eyebrow={new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase()} title="Your business, at a glance." description="Here’s what’s happening with your inventory today." action={{ label: 'New order', onClick: () => onModal({ type: 'order' }) }} icon={Plus} />
      <div className="welcome-strip">
        <div className="welcome-art"><span className="art-circle art-one" /><span className="art-circle art-two" /><span className="art-leaf">✳</span><Package size={25} /></div>
        <div className="welcome-copy"><span className="welcome-kicker">A LITTLE MOMENTUM</span><strong>Your shop is looking good.</strong><p>You’ve got <b>{dashboard.unitsInStock} {dashboard.unitsInStock === 1 ? 'item' : 'items'}</b> ready to go. Keep an eye on your low-stock list and stay one step ahead.</p></div>
        <button className="welcome-link" onClick={() => onNavigate('Products')}>Explore inventory <ArrowRight size={15} /></button>
        <span className="welcome-spark spark-a">✦</span><span className="welcome-spark spark-b">·</span>
      </div>
      <section className="stats-grid" aria-label="Business summary">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <article className="stat-card" key={stat.label}>
              <div className="stat-card-top"><span className={`stat-icon ${stat.tone}`}><Icon size={18} strokeWidth={1.9} /></span><span className="stat-period"><span className="period-dot" />{stat.change}</span></div>
              <div className="stat-value">{stat.value}</div><div className="stat-label">{stat.label}</div>
              <div className={`stat-note ${index === 3 ? 'note-accent' : ''}`}>{stat.note}</div>
            </article>
          );
        })}
      </section>
      <div className="dashboard-grid">
        <section className="panel inventory-panel">
          <div className="panel-heading"><div><div className="panel-title-row"><h2>Stock watch</h2>{dashboard.lowStockCount > 0 && <span className="alert-count">{dashboard.lowStockCount}</span>}</div><p>A little heads-up on what needs a restock.</p></div><button className="text-link" onClick={() => { onNavigate('Products'); }}>View inventory <ArrowRight size={14} /></button></div>
          {dashboard.lowStockProducts.length ? (
            <div className="stock-list">
              {dashboard.lowStockProducts.map((product, index) => (
                <div className="stock-row" key={product.id}>
                  <span className={`product-art product-art-${index % 4}`}><Package size={17} /></span>
                  <span className="stock-product"><strong>{product.name}</strong><small>{product.sku} <span>·</span> {product.category}</small></span>
                  <span className="stock-status"><span className={`stock-rail ${product.quantity === 0 ? 'rail-empty' : ''}`}><i style={{ width: `${Math.max(8, Math.min(100, product.quantity / Math.max(product.lowStockThreshold, 1) * 100))}%` }} /></span><b className={product.quantity === 0 ? 'out-text' : ''}>{product.quantity} <small>left</small></b></span>
                </div>
              ))}
            </div>
          ) : <EmptyInline icon={Check} title="All stocked up!" text="Nothing needs your attention right now." />}
          <button className="panel-footer-link" onClick={() => onNavigate('Products')}><SlidersHorizontal size={14} /> Manage stock levels <ArrowRight size={14} /></button>
        </section>
        <section className="panel orders-panel">
          <div className="panel-heading"><div><h2>Recent orders</h2><p>A fresh look at your latest sales.</p></div><button className="icon-button panel-more" aria-label="View all orders" onClick={() => onNavigate('Orders')}><ArrowRight size={17} /></button></div>
          {dashboard.recentOrders.length ? (
            <div className="orders-list">
              {dashboard.recentOrders.slice(0, 5).map((order, index) => (
                <div className="order-row" key={order.id}>
                  <span className={`order-avatar order-avatar-${index % 4}`}>{order.customerName.charAt(0).toUpperCase()}</span>
                  <span className="order-person"><strong>{order.customerName}</strong><small>{order.orderNumber} · {order.items.reduce((sum, item) => sum + item.quantity, 0)} items</small></span>
                  <span className="order-price">{currency.format(order.total)}<small>{timeFormat.format(new Date(order.createdAt))}</small></span>
                </div>
              ))}
            </div>
          ) : <EmptyInline icon={ShoppingBag} title="Your next sale starts here." text="Orders will appear here as soon as they come in." />}
          <button className="panel-footer-link" onClick={() => onNavigate('Orders')}><ClipboardList size={14} /> View all orders <ArrowRight size={14} /></button>
        </section>
      </div>
      <div className="bottom-note"><Sparkles size={15} /><span>Little by little, a little becomes a lot.</span><span className="note-by">— Tanzanian proverb</span></div>
    </>
  );
}

function ProductsPage({ products, categories, search, category, stockFilter, onSearch, onCategory, onStockFilter, onModal, onDelete }) {
  const lowCount = products.filter((product) => product.quantity <= product.lowStockThreshold).length;
  return (
    <>
      <PageHeading eyebrow="YOUR CATALOG" title="Products" description="Everything you sell, all in one place." action={{ label: 'Add product', onClick: () => onModal({ type: 'product' }) }} icon={Plus} />
      <div className="catalog-summary">
        <div><span className="catalog-symbol"><Package size={17} /></span><span><strong>{products.length}</strong><small> products shown</small></span></div>
        <span className="summary-separator" />
        <div><span className="summary-dot summary-dot-green" /><span><strong>{products.filter((product) => product.quantity > product.lowStockThreshold).length}</strong><small> healthy stock</small></span></div>
        <span className="summary-separator" />
        <div><span className="summary-dot summary-dot-orange" /><span><strong>{lowCount}</strong><small> need attention</small></span></div>
      </div>
      <section className="panel catalog-panel">
        <div className="catalog-toolbar">
          <div className="table-search"><Search size={16} /><input aria-label="Filter products" placeholder="Search products, SKU…" value={search} onChange={(event) => onSearch(event.target.value)} />{search && <button aria-label="Clear search" onClick={() => onSearch('')}><X size={14} /></button>}</div>
          <div className="filter-group">
            <span className="filter-label"><SlidersHorizontal size={14} /> Filter</span>
            <select aria-label="Filter by category" value={category} onChange={(event) => onCategory(event.target.value)}><option value="">All categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select>
            <select aria-label="Filter by stock" value={stockFilter} onChange={(event) => onStockFilter(event.target.value)}><option value="">Any stock</option><option value="low">Low stock</option><option value="in_stock">In stock</option></select>
          </div>
        </div>
        {products.length ? (
          <>
            <div className="table-scroll"><table className="product-table"><thead><tr><th>PRODUCT</th><th>SKU</th><th>CATEGORY</th><th>PRICE</th><th>IN STOCK</th><th>STATUS</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{products.map((product, index) => {
                const low = product.quantity <= product.lowStockThreshold;
                return <tr key={product.id}>
                  <td><span className={`table-product-art product-art-${index % 4}`}><Package size={17} /></span><span className="table-product-copy"><strong>{product.name}</strong><small>Added {dateFormat.format(new Date(product.createdAt))}</small></span></td>
                  <td className="sku-cell">{product.sku}</td><td><span className="category-pill">{product.category}</span></td><td className="price-cell">{currency.format(product.price)}</td>
                  <td><span className="quantity-cell">{product.quantity}<small> units</small></span></td>
                  <td><span className={`status-pill ${low ? 'status-low' : 'status-healthy'}`}><i />{product.quantity === 0 ? 'Out of stock' : low ? 'Low stock' : 'Healthy'}</span></td>
                  <td><div className="row-actions"><button title="Update stock" aria-label={`Update stock for ${product.name}`} onClick={() => onModal({ type: 'stock', product })}><Boxes size={15} /></button><button title="Edit product" aria-label={`Edit ${product.name}`} onClick={() => onModal({ type: 'product', product })}><Settings2 size={15} /></button><button title="Delete product" aria-label={`Delete ${product.name}`} onClick={() => onDelete(product)}><X size={15} /></button></div></td>
                </tr>;
              })}</tbody></table></div>
            <div className="table-footer"><span>Showing <b>{products.length}</b> {products.length === 1 ? 'product' : 'products'}</span><span>Inventory value <b>{currency.format(products.reduce((sum, product) => sum + product.price * product.quantity, 0))}</b></span></div>
          </>
        ) : <EmptyCatalog onAdd={() => onModal({ type: 'product' })} hasFilters={Boolean(search || category || stockFilter)} onClear={() => { onSearch(''); onCategory(''); onStockFilter(''); }} />}
      </section>
      <div className="catalog-footnote"><Sparkles size={15} /> Stock levels update automatically when an order is placed.</div>
    </>
  );
}

function OrdersPage({ orders, onModal }) {
  const totalSales = orders.reduce((sum, order) => sum + order.total, 0);
  return (
    <>
      <PageHeading eyebrow="SALES & FULFILLMENT" title="Orders" description="Every sale, neatly accounted for." action={{ label: 'Create order', onClick: () => onModal({ type: 'order' }) }} icon={Plus} />
      <section className="orders-overview">
        <div className="overview-card"><span className="overview-icon lavender"><ClipboardList size={18} /></span><span><small>Orders recorded</small><strong>{orders.length}</strong></span><span className="overview-decoration">↗</span></div>
        <div className="overview-card"><span className="overview-icon mint"><CircleDollarSign size={18} /></span><span><small>Sales recorded</small><strong>{currency.format(totalSales)}</strong></span><span className="overview-decoration">✳</span></div>
        <div className="overview-card"><span className="overview-icon peach"><Boxes size={18} /></span><span><small>Items sold</small><strong>{orders.reduce((sum, order) => sum + order.items.reduce((n, item) => n + item.quantity, 0), 0)}</strong></span><span className="overview-decoration">·</span></div>
      </section>
      <section className="panel full-orders-panel">
        <div className="panel-heading"><div><h2>All orders</h2><p>Your most recent 100 orders, newest first.</p></div><span className="orders-total">{orders.length} total</span></div>
        {orders.length ? <div className="table-scroll"><table className="orders-table"><thead><tr><th>ORDER</th><th>CUSTOMER</th><th>ITEMS</th><th>DATE</th><th>TOTAL</th><th>STATUS</th></tr></thead><tbody>
          {orders.map((order, index) => <tr key={order.id}><td><strong className="order-number">{order.orderNumber}</strong></td><td><span className={`order-avatar small order-avatar-${index % 4}`}>{order.customerName.charAt(0).toUpperCase()}</span><strong className="customer-name">{order.customerName}</strong></td><td>{order.items.reduce((sum, item) => sum + item.quantity, 0)} items</td><td>{dateFormat.format(new Date(order.createdAt))}</td><td className="price-cell">{currency.format(order.total)}</td><td><span className="status-pill status-healthy"><i />Complete</span></td></tr>)}
        </tbody></table></div> : <EmptyInline icon={ShoppingBag} title="Nothing on the books yet." text="Once you create an order, it’ll show up here." />}
      </section>
    </>
  );
}

function EmptyInline({ icon, title, text }) {
  const Icon = icon;
  return <div className="empty-inline"><span><Icon size={19} /></span><strong>{title}</strong><p>{text}</p></div>;
}

function EmptyCatalog({ onAdd, hasFilters, onClear }) {
  return <div className="empty-catalog"><span className="empty-art"><Package size={29} /></span><h3>{hasFilters ? 'No products match those filters.' : 'Your inventory starts here.'}</h3><p>{hasFilters ? 'Try another search or clear your filters to see everything.' : 'Add your first product to start keeping track of what you sell.'}</p>{hasFilters ? <button className="button button-secondary" onClick={onClear}>Clear filters</button> : <button className="button button-primary" onClick={onAdd}><Plus size={16} /> Add your first product</button>}</div>;
}

function Modal({ onClose, title, children }) {
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><span className="modal-eyebrow">STOCKPILOT WORKSPACE</span><h2 id="modal-title">{title}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={19} /></button></div>{children}</section></div>;
}

function ProductForm({ product, onCancel, onSubmit }) {
  const [values, setValues] = useState(product ? { sku: product.sku, name: product.name, category: product.category, price: String(product.price), quantity: String(product.quantity), lowStockThreshold: String(product.lowStockThreshold) } : initialProduct);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const update = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true); setFormError('');
    try {
      await onSubmit({ sku: values.sku.trim(), name: values.name.trim(), category: values.category.trim(), price: Number(values.price), quantity: Number(values.quantity), lowStockThreshold: Number(values.lowStockThreshold) });
    } catch (error) { setFormError(error.message); } finally { setSaving(false); }
  };
  return <form className="form-body" onSubmit={submit}>
    <div className="form-grid">
      <label className="field field-full">Product name<input autoFocus required maxLength="120" placeholder="e.g. Ceramic pour-over" value={values.name} onChange={update('name')} /></label>
      <label className="field">SKU<input required maxLength="40" placeholder="e.g. MUG-024" value={values.sku} onChange={update('sku')} /></label>
      <label className="field">Category<input required maxLength="60" placeholder="e.g. Drinkware" value={values.category} onChange={update('category')} /></label>
      <label className="field">Price <span className="input-prefix-wrap"><span>$</span><input required type="number" min="0" step="0.01" placeholder="0.00" value={values.price} onChange={update('price')} /></span></label>
      <label className="field">Quantity in stock<input required type="number" min="0" step="1" placeholder="0" value={values.quantity} onChange={update('quantity')} /></label>
      <label className="field field-full">Low-stock alert threshold<input required type="number" min="0" step="1" value={values.lowStockThreshold} onChange={update('lowStockThreshold')} /><small>We’ll flag this product when its stock reaches this number.</small></label>
    </div>
    {formError && <p className="form-error" role="alert">{formError}</p>}
    <div className="form-actions"><button type="button" className="button button-secondary" onClick={onCancel}>Cancel</button><button className="button button-primary" disabled={saving}>{saving && <LoaderCircle size={15} className="spin" />}{product ? 'Save changes' : <><Plus size={15} /> Add product</>}</button></div>
  </form>;
}

function StockForm({ product, onCancel, onSubmit }) {
  const [quantity, setQuantity] = useState('');
  const [operation, setOperation] = useState('set');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setFormError('');
    try { await onSubmit({ quantity: Number(quantity), operation }); } catch (error) { setFormError(error.message); } finally { setSaving(false); }
  };
  return <form className="form-body" onSubmit={submit}>
    <div className="stock-edit-product"><span className="product-art product-art-0"><Package size={18} /></span><span><strong>{product.name}</strong><small>{product.sku} · {product.quantity} currently in stock</small></span></div>
    <label className="field">Adjustment type<select value={operation} onChange={(event) => setOperation(event.target.value)}><option value="set">Set stock to</option><option value="adjust">Adjust by</option></select></label>
    <label className="field">{operation === 'set' ? 'New stock quantity' : 'Quantity change (use − to remove stock)'}<input autoFocus required type="number" step="1" min={operation === 'set' ? '0' : undefined} value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder={operation === 'set' ? String(product.quantity) : 'e.g. 10 or -2'} /></label>
    {formError && <p className="form-error" role="alert">{formError}</p>}
    <div className="form-actions"><button type="button" className="button button-secondary" onClick={onCancel}>Cancel</button><button className="button button-primary" disabled={saving}>{saving && <LoaderCircle size={15} className="spin" />}Update stock</button></div>
  </form>;
}

function OrderForm({ products, onCancel, onSubmit }) {
  const [productOptions, setProductOptions] = useState(products);
  const [customerName, setCustomerName] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  useEffect(() => {
    api('/products').then(({ products: allProducts }) => setProductOptions(allProducts))
      .catch((error) => setFormError(error.message));
  }, []);
  const availableProducts = productOptions.filter((product) => product.quantity > 0);
  const selectedProduct = availableProducts.find((product) => product.id === Number(selectedId));
  const total = useMemo(() => items.reduce((sum, item) => sum + item.product.price * item.quantity, 0), [items]);
  const addItem = () => {
    if (!selectedProduct || Number(quantity) < 1) return;
    setItems((current) => {
      const existing = current.find((item) => item.product.id === selectedProduct.id);
      if (existing) return current.map((item) => item.product.id === selectedProduct.id ? { ...item, quantity: Math.min(selectedProduct.quantity, item.quantity + Number(quantity)) } : item);
      return [...current, { product: selectedProduct, quantity: Math.min(selectedProduct.quantity, Number(quantity)) }];
    });
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!items.length) { setFormError('Add at least one item to this order.'); return; }
    setSaving(true); setFormError('');
    try { await onSubmit({ customerName: customerName.trim() || 'Walk-in customer', items: items.map((item) => ({ productId: item.product.id, quantity: item.quantity })) }); } catch (error) { setFormError(error.message); } finally { setSaving(false); }
  };
  return <form className="form-body order-form" onSubmit={submit}>
    <label className="field">Customer name <span className="optional-label">OPTIONAL</span><input autoFocus maxLength="120" placeholder="Walk-in customer" value={customerName} onChange={(event) => setCustomerName(event.target.value)} /></label>
    <div className="field-label">Add items</div>
    {availableProducts.length ? <div className="order-add-row"><select aria-label="Choose a product" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Choose a product…</option>{availableProducts.map((product) => <option key={product.id} value={product.id}>{product.name} · {currency.format(product.price)} ({product.quantity} available)</option>)}</select><input aria-label="Quantity to add" type="number" min="1" max={selectedProduct?.quantity || 1} value={quantity} onChange={(event) => setQuantity(event.target.value)} /><button type="button" className="button button-secondary add-item-button" disabled={!selectedProduct} onClick={addItem}><Plus size={15} /> Add</button></div> : <div className="no-products-note">No products with available stock. Add stock before placing an order.</div>}
    {items.length > 0 && <div className="cart-list">{items.map((item) => <div className="cart-item" key={item.product.id}><span className="cart-item-icon"><Tag size={15} /></span><span className="cart-item-name"><strong>{item.product.name}</strong><small>{currency.format(item.product.price)} each · max {item.product.quantity}</small></span><span className="cart-quantity"><button type="button" aria-label={`Remove one ${item.product.name}`} onClick={() => setItems((current) => current.map((row) => row.product.id === item.product.id ? { ...row, quantity: row.quantity - 1 } : row).filter((row) => row.quantity > 0))}><Minus size={12} /></button><b>{item.quantity}</b><button type="button" aria-label={`Add one ${item.product.name}`} disabled={item.quantity >= item.product.quantity} onClick={() => setItems((current) => current.map((row) => row.product.id === item.product.id ? { ...row, quantity: row.quantity + 1 } : row))}><Plus size={12} /></button></span><strong className="cart-subtotal">{currency.format(item.product.price * item.quantity)}</strong><button type="button" className="cart-remove" aria-label={`Remove ${item.product.name} from order`} onClick={() => setItems((current) => current.filter((row) => row.product.id !== item.product.id))}><X size={15} /></button></div>)}</div>}
    <div className="order-total-row"><span>Order total</span><strong>{currency.format(total)}</strong></div>
    {formError && <p className="form-error" role="alert">{formError}</p>}
    <div className="form-actions"><button type="button" className="button button-secondary" onClick={onCancel}>Cancel</button><button className="button button-primary" disabled={saving || items.length === 0}>{saving && <LoaderCircle size={15} className="spin" />}<ShoppingBag size={15} /> Place order</button></div>
  </form>;
}

function DeleteConfirm({ product, onCancel, onDelete }) {
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState('');
  const submit = async () => {
    setDeleting(true); setFormError('');
    try { await onDelete(); } catch (error) { setFormError(error.message); } finally { setDeleting(false); }
  };
  return <div className="delete-confirm"><span className="delete-icon"><AlertTriangle size={22} /></span><p>Are you sure you want to delete <strong>{product.name}</strong>? This action can’t be undone.</p>{formError && <p className="form-error" role="alert">{formError}</p>}<div className="form-actions"><button className="button button-secondary" onClick={onCancel}>Keep product</button><button className="button button-danger" disabled={deleting} onClick={submit}>{deleting ? 'Deleting…' : 'Delete product'}</button></div></div>;
}

export default App;
