// ═══════════════════════════════════════════════════════════════
//  JJ Fabrics POS — pos.js
//  Requires: db.js loaded first in pos.html
// ═══════════════════════════════════════════════════════════════

// ── localStorage keys (offline cache only) ──
const K = {
  products: 'jj_products',
  sales:    'jj_sales',
  config:   'jj_config',
  users:    'jj_users',
  site:     'jj_site'
};
const get    = k => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };
const getObj = k => { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; } };
const set    = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// ═══════════════════════════════════════════════════════════════
//  SEED (first-run local defaults only)
// ═══════════════════════════════════════════════════════════════
function seed() {
  if (!localStorage.getItem(K.config))
    set(K.config, { name:'JJ Fabrics', address:'Sher Bahadur Plaza, K-Block, Near Dr. Ibadat Hospital, Main Bazar, Attock City', phone:'+92 314 5777344', vat:0 });
  if (!localStorage.getItem(K.sales))
    set(K.sales, []);
  // Seed fallback users — will be overwritten by DB on login
  if (!localStorage.getItem(K.users))
    set(K.users, [
      { username:'nora',     password:'nora',    name:'Noraliah',         role:'owner'   },
      { username:'hamza',    password:'hamza',   name:'M. Hamza Javed',   role:'admin'   },
      { username:'cashier1', password:'cashier', name:'Front Desk Staff', role:'cashier' }
    ]);
}

// ═══════════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════════
let CU = null;

async function doLogin() {
  const u   = document.getElementById('login-user').value.trim();
  const p   = document.getElementById('login-pass').value;
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');
  if (!u || !p) { err.textContent = 'Enter username and password.'; err.style.display = 'block'; return; }
  err.style.display = 'none';
  btn.textContent = 'Signing in…'; btn.disabled = true;

  // Always try DB first — if offline fall back to cached users
  try {
    const dbUsers = await dbGetUsers();
    if (dbUsers.length) set(K.users, dbUsers);
  } catch(_) {}

  const user = get(K.users).find(x => x.username === u && x.password === p);
  btn.textContent = 'Sign In →'; btn.disabled = false;

  if (!user) { err.textContent = 'Invalid username or password.'; err.style.display = 'block'; return; }

  CU = user;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('user-display').textContent = user.name;
  document.getElementById('role-display').textContent  = user.role.toUpperCase();
  document.getElementById('dash-name').textContent = user.name.split(' ')[0];

  if (user.role === 'cashier') {
    document.getElementById('nav-settings').style.display = 'none';
    document.getElementById('nav-website').style.display  = 'none';
  }
  const resetBtn = document.getElementById('dash-reset-btn');
  if (resetBtn) resetBtn.style.display = user.role === 'owner' ? '' : 'none';

  showPage('dashboard');

  // Load products from DB and update local cache
  loadFromDB();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('login-screen').style.display !== 'none') doLogin();
});

function doLogout() {
  CU = null;
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  ['nav-settings','nav-website'].forEach(id => document.getElementById(id).style.display = '');
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-error').style.display = 'none';
  cart = [];
}

// ═══════════════════════════════════════════════════════════════
//  DATABASE SYNC
// ═══════════════════════════════════════════════════════════════
function showSyncStatus(state) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  const map = {
    syncing: ['⟳ Syncing…', '#ca8a04'],
    ok:      ['☁ Synced',   '#16a34a'],
    error:   ['⚠ Offline',  '#dc2626']
  };
  const [txt, color] = map[state] || map.ok;
  el.textContent = txt; el.style.color = color;
}

async function loadFromDB() {
  showSyncStatus('syncing');
  try {
    const products = await dbGetProducts();
    set(K.products, products);
    refreshDashboard(); renderProducts();
    if (document.getElementById('inv-tbody')) renderInventory();
    showSyncStatus('ok');
    setSaveState('synced');
  } catch(e) {
    console.warn('DB load failed:', e);
    showSyncStatus('error');
  }
}

async function saveProductsToDB(products) {
  setSaveState('saving');
  try {
    await dbSaveProducts(products);
    set(K.products, products);
    setSaveState('synced');
    return true;
  } catch(e) {
    console.warn('DB save failed:', e);
    setSaveState('error');
    showToast('⚠ Database save failed: ' + e.message, 'error');
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
//  SAVE STATE UI
// ═══════════════════════════════════════════════════════════════
let _lastSaved = null;

function setSaveState(state) {
  const pill    = document.getElementById('inv-sheets-pill');
  const dot     = document.getElementById('inv-pending-dot');
  const info    = document.getElementById('inv-sheets-info');
  const btn     = document.getElementById('inv-save-btn');
  const lastSav = document.getElementById('inv-last-saved');
  if (!pill) return;
  const map = {
    synced:  { cls:'synced',  txt:'✅ Saved to Database', dot:false, infoTxt:'All changes saved.' },
    pending: { cls:'pending', txt:'● Unsaved changes',    dot:true,  infoTxt:'Unsaved changes — click Save to Database.' },
    saving:  { cls:'syncing', txt:'⟳ Saving…',            dot:false, infoTxt:'Saving to database…' },
    error:   { cls:'error',   txt:'⚠ Save failed',         dot:true,  infoTxt:'Save failed — check internet & retry.' },
  };
  const m = map[state] || map.synced;
  pill.className  = 'sheets-status-pill ' + m.cls;
  pill.textContent = m.txt;
  if (dot) dot.style.display = m.dot ? 'inline-block' : 'none';
  if (info) info.textContent = m.infoTxt;
  if (btn) btn.disabled = state === 'saving';
  if (state === 'synced') {
    _lastSaved = new Date();
    if (lastSav) lastSav.textContent = 'Saved at ' + _lastSaved.toLocaleTimeString('en-PH');
  }
}

// ═══════════════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════════════
function showPage(p) {
  document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
  document.getElementById(p + '-page').classList.add('active');
  document.querySelector(`.nav-item[data-page="${p}"]`)?.classList.add('active');
  const fns = {
    dashboard: refreshDashboard,
    pos:       renderProducts,
    inventory: renderInventory,
    sales:     () => { setDefaultDates(); renderSales(); },
    reports:   renderReports,
    settings:  renderSettings
  };
  fns[p]?.();
}

// ═══════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════
function syncDashboard() {
  const btn = document.getElementById('dash-sync-btn');
  if (btn) { btn.textContent = '⟳ Syncing…'; btn.disabled = true; }
  loadFromDB().then(() => {
    if (btn) { btn.textContent = '⟳ Refresh Data'; btn.disabled = false; }
  });
}

function ownerResetData() {
  if (CU.role !== 'owner') { showToast('Owner only!', 'error'); return; }
  if (!confirm('⚠️ RESET?\n\nDeletes all local sales & products cache.\n\nCannot be undone. Continue?')) return;
  set(K.sales, []); set(K.products, []);
  refreshDashboard(); renderProducts();
  if (document.getElementById('inv-tbody')) renderInventory();
  showToast('Reset complete ✅', 'success');
}

function refreshDashboard() {
  const now = new Date();
  document.getElementById('dash-date').textContent =
    now.toLocaleDateString('en-PH', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const sales = get(K.sales).filter(s => !s.voided);
  const prods = get(K.products);
  const today = now.toLocaleDateString('en-CA');
  const month = now.toISOString().slice(0, 7);
  const td = sales.filter(s => s.date.startsWith(today));
  const mo = sales.filter(s => s.date.startsWith(month));
  const fmt = n => 'Rs. ' + n.toLocaleString('en-PH', { minimumFractionDigits:2 });
  document.getElementById('dash-today-sales').textContent  = fmt(td.reduce((a,s) => a + s.total, 0));
  document.getElementById('dash-today-txn').textContent    = td.length + ' transactions';
  document.getElementById('dash-month-sales').textContent  = fmt(mo.reduce((a,s) => a + s.total, 0));
  document.getElementById('dash-month-txn').textContent    = mo.length + ' transactions';
  document.getElementById('dash-products').textContent     = prods.length;
  const low = prods.filter(p => p.stock > 0 && p.stock <= p.minStock);
  const out = prods.filter(p => p.stock === 0);
  document.getElementById('dash-low-stock').textContent    = low.length + ' low stock';
  document.getElementById('dash-alerts').textContent       = low.length + out.length;
  const al = [...out, ...low];
  document.getElementById('dash-alerts-list').innerHTML = al.length
    ? al.map(p => `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--gray-50);font-size:12px;">
        <span style="font-weight:500;">${p.name}</span>
        <span class="badge ${p.stock === 0 ? 'out-stock' : 'low-stock'}">${p.stock === 0 ? 'Out' : p.stock + ' left'}</span>
      </div>`).join('')
    : '<p style="font-size:13px;color:var(--gray-400);">✅ All stock levels OK</p>';
  const rec = [...sales].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 6);
  document.getElementById('dash-recent-list').innerHTML = rec.length
    ? rec.map(s => `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--gray-50);font-size:12px;">
        <span><strong>${s.txnNum}</strong> · ${s.customer}</span>
        <span style="font-weight:700;color:var(--gold-600);">${fmt(s.total)}</span>
      </div>`).join('')
    : '<p style="font-size:13px;color:var(--gray-400);">No transactions yet.</p>';
  renderDashChart();
}

// ═══════════════════════════════════════════════════════════════
//  POS / CART
// ═══════════════════════════════════════════════════════════════
let cart = [];
const catEmoji = { 'Ladies Suiting':'👘', 'Gents Suiting':'👔', 'Accessories':'💎', 'Kids':'👦' };

function resolveImg(p) {
  return (p.img || p.image_url || '').trim();
}

function renderProducts() {
  const q = document.getElementById('pos-search').value.toLowerCase();
  const c = document.getElementById('pos-cat').value;
  const prods = get(K.products).filter(p =>
    (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)) &&
    (!c || p.category === c)
  );
  const grid = document.getElementById('product-grid');
  if (!prods.length) {
    grid.innerHTML = '<p style="grid-column:1/-1;font-size:13px;color:var(--gray-400);">No products found. Add products via Inventory → + Add Product.</p>';
    return;
  }
  grid.innerHTML = prods.map(p => {
    const isOut = p.stock === 0, isLow = p.stock > 0 && p.stock <= p.minStock;
    const emoji = catEmoji[p.category] || '🛍️';
    const img   = resolveImg(p);
    const imgHtml = img
      ? `<img src="${img}" alt="${p.name}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:8px;" onerror="this.parentNode.innerHTML='<span style=font-size:32px>${emoji}</span>'">`
      : `<span style="font-size:32px;">${emoji}</span>`;
    return `<div class="product-card ${isOut ? 'out-of-stock' : ''}" data-sku="${p.sku}" ${isOut ? '' : 'style="cursor:pointer;"'}>
      ${isLow ? '<span class="stock-badge low">Low</span>' : ''}${isOut ? '<span class="stock-badge out">Out</span>' : ''}
      <div class="pc-img">${imgHtml}</div>
      <div class="pc-name">${p.name}</div>
      <div class="pc-price">Rs. ${Number(p.price).toLocaleString()}</div>
      <div class="pc-stock">${p.size} · ${p.stock} in stock</div>
    </div>`;
  }).join('');
  grid.onclick = function(e) {
    const card = e.target.closest('.product-card[data-sku]');
    if (!card || card.classList.contains('out-of-stock')) return;
    addToCart(card.dataset.sku);
  };
}

function addToCart(sku) {
  const p = get(K.products).find(x => x.sku === sku);
  if (!p || p.stock === 0) return;
  const ex = cart.find(c => c.sku === sku);
  if (ex) { if (ex.qty >= p.stock) { showToast('Max stock reached!', 'error'); return; } ex.qty++; }
  else cart.push({ sku:p.sku, name:p.name, price:p.price, qty:1, maxStock:p.stock });
  renderCart(); showToast(p.name + ' added ✓', 'success');
}

function renderCart() {
  const total = cart.reduce((a,c) => a + c.qty, 0);
  document.getElementById('cart-count').textContent = total;
  const box = document.getElementById('cart-items');
  if (!cart.length) {
    box.innerHTML = '<div class="cart-empty"><div class="empty-icon">🛍️</div><p>Cart is empty</p></div>';
    document.getElementById('cash-calc').style.display = 'none';
    updateCartTotals(); return;
  }
  document.getElementById('cash-calc').style.display = 'block';
  box.innerHTML = cart.map((it,i) => `
    <div class="cart-item">
      <div class="cart-item-info">
        <div class="ci-name">${it.name}</div>
        <div class="ci-price">Rs. ${Number(it.price).toLocaleString()} each</div>
      </div>
      <div class="qty-control">
        <button class="qty-btn" onclick="chQty(${i},-1)">−</button>
        <span class="qty-num">${it.qty}</span>
        <button class="qty-btn" onclick="chQty(${i},1)">+</button>
      </div>
      <div class="ci-total">Rs. ${(it.qty * it.price).toLocaleString()}</div>
      <button class="remove-btn" onclick="rmCart(${i})">✕</button>
    </div>`).join('');
  updateCartTotals();
}

function chQty(i,d) { cart[i].qty+=d; if(cart[i].qty<=0)cart.splice(i,1); else if(cart[i].qty>cart[i].maxStock)cart[i].qty=cart[i].maxStock; renderCart(); }
function rmCart(i) { cart.splice(i,1); renderCart(); }
function clearCart() {
  cart = [];
  document.getElementById('customer-name').value = '';
  document.getElementById('discount-val').value  = '';
  document.getElementById('cash-tendered').value = '';
  document.getElementById('cash-calc').style.display = 'none';
  renderCart();
}
function getDisc(sub) {
  const v = parseFloat(document.getElementById('discount-val').value) || 0;
  const t = document.getElementById('discount-type').value;
  return t === 'pct' ? sub * (v / 100) : v;
}
function updateCartTotals() {
  const sub = cart.reduce((a,c) => a + c.qty * c.price, 0), disc = getDisc(sub), total = Math.max(0, sub - disc);
  const fmt = n => 'Rs. ' + n.toLocaleString('en-PH', { minimumFractionDigits:2 });
  document.getElementById('cart-subtotal').textContent = fmt(sub);
  document.getElementById('cart-discount').textContent = fmt(disc);
  document.getElementById('cart-total').textContent    = fmt(total);
}
function calcChange() {
  const sub = cart.reduce((a,c) => a + c.qty * c.price, 0), disc = getDisc(sub);
  const cfg = getObj(K.config), total = Math.max(0, sub - disc + (sub - disc) * (cfg.vat / 100));
  const tendered = parseFloat(document.getElementById('cash-tendered').value) || 0;
  const change = tendered - total;
  document.getElementById('cash-change').textContent = 'Rs. ' + (change >= 0 ? change : 0).toLocaleString('en-PH', { minimumFractionDigits:2 });
  document.getElementById('cash-change').style.color = change < 0 ? 'var(--red)' : 'var(--green)';
}

async function checkout(method) {
  if (!cart.length) { showToast('Cart is empty!', 'error'); return; }
  const sub  = cart.reduce((a,c) => a + c.qty * c.price, 0);
  const disc = getDisc(sub);
  const cfg  = getObj(K.config);
  const vat  = (sub - disc) * (cfg.vat / 100);
  const total = sub - disc + vat;
  const txnNum   = nextTxnNum();
  const now      = new Date();
  const customer = document.getElementById('customer-name').value.trim() || 'Walk-in';
  const sale = { txnNum, date:now.toISOString(), customer, items:JSON.parse(JSON.stringify(cart)),
                 subtotal:sub, discount:disc, vat, total, payment:method, cashier:CU.name };

  // Update stock locally
  const prods = get(K.products);
  cart.forEach(c => { const p = prods.find(x => x.sku === c.sku); if (p) p.stock = Math.max(0, p.stock - c.qty); });
  set(K.products, prods);

  // Save sale locally
  const sales = get(K.sales); sales.push(sale); set(K.sales, sales);

  if (method === 'cash') showInvoice(sale);
  clearCart(); renderProducts(); refreshDashboard();
  showToast(txnNum + ' completed! Saving to database…', 'success');

  // Save to Supabase (stock update + sale record)
  try {
    await dbSaveProducts(prods);
    await dbSaveSale(sale);
    showToast('✅ Sale & stock saved to database.', 'success');
  } catch(e) {
    showToast('⚠ Saved locally — DB push failed. Check connection.', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
//  INVOICE
// ═══════════════════════════════════════════════════════════════
function showInvoice(sale) {
  const cfg = getObj(K.config);
  document.getElementById('inv-store-name').textContent  = cfg.name || 'JJ Fabrics';
  document.getElementById('inv-store-name2').textContent = cfg.name || 'JJ Fabrics';
  document.getElementById('inv-store-addr').textContent  = cfg.address || '';
  document.getElementById('inv-store-phone').textContent = cfg.phone || '';
  document.getElementById('inv-num').textContent      = sale.txnNum;
  document.getElementById('inv-date').textContent     = new Date(sale.date).toLocaleString('en-PH');
  document.getElementById('inv-customer').textContent = sale.customer;
  document.getElementById('inv-cashier').textContent  = sale.cashier;
  document.getElementById('inv-subtotal').textContent = 'Rs. ' + sale.subtotal.toFixed(2);
  document.getElementById('inv-discount').textContent = sale.discount > 0 ? '-Rs. ' + sale.discount.toFixed(2) : 'Rs. 0.00';
  document.getElementById('inv-vat-label').textContent = `VAT (${cfg.vat || 0}%)`;
  document.getElementById('inv-vat').textContent = 'Rs. ' + (sale.vat || 0).toFixed(2);
  document.getElementById('inv-grand').textContent = 'Rs. ' + sale.total.toFixed(2);
  document.getElementById('inv-items').innerHTML = sale.items.map(i =>
    `<tr><td>${i.name}</td><td>${i.qty}</td><td>Rs. ${Number(i.price).toFixed(2)}</td><td>Rs. ${(i.qty*i.price).toFixed(2)}</td></tr>`
  ).join('');
  const tendered = parseFloat(document.getElementById('cash-tendered')?.value) || 0;
  if (sale.payment === 'cash' && tendered > 0) {
    document.getElementById('inv-tendered-row').style.display = 'flex';
    document.getElementById('inv-change-row').style.display   = 'flex';
    document.getElementById('inv-tendered').textContent   = 'Rs. ' + tendered.toFixed(2);
    document.getElementById('inv-change-amt').textContent = 'Rs. ' + Math.max(0, tendered - sale.total).toFixed(2);
  } else {
    document.getElementById('inv-tendered-row').style.display = 'none';
    document.getElementById('inv-change-row').style.display   = 'none';
  }
  openModal('invoice-modal');
}

// ═══════════════════════════════════════════════════════════════
//  INVENTORY
// ═══════════════════════════════════════════════════════════════
function renderInventory() {
  const q = document.getElementById('inv-search').value.toLowerCase();
  const c = document.getElementById('inv-cat').value;
  const s = document.getElementById('inv-status').value;
  const prods = get(K.products).filter(p => {
    const mq = !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    const mc = !c || p.category === c;
    const ms = !s || (s==='in' && p.stock > p.minStock) || (s==='low' && p.stock > 0 && p.stock <= p.minStock) || (s==='out' && p.stock === 0);
    return mq && mc && ms;
  });
  const alerts = prods.filter(p => p.stock <= p.minStock);
  document.getElementById('inv-alerts').innerHTML = alerts.length
    ? `<div class="alert-box warning">⚠️ <div><strong>${alerts.length} item(s) need restocking:</strong> ${alerts.map(a => a.name).join(', ')}</div></div>` : '';
  const canEdit = CU && CU.role !== 'cashier';
  document.getElementById('inv-tbody').innerHTML = prods.map(p => {
    const sc  = p.stock === 0 ? 'out-stock' : p.stock <= p.minStock ? 'low-stock' : 'in-stock';
    const sl  = p.stock === 0 ? 'Out of Stock' : p.stock <= p.minStock ? 'Low Stock' : 'In Stock';
    const emoji  = catEmoji[p.category] || '🛍️';
    const thumb  = resolveImg(p);
    const thumbHtml = thumb
      ? `<img src="${thumb}" style="width:36px;height:36px;object-fit:cover;border-radius:6px;" onerror="this.outerHTML='<span style=font-size:20px>${emoji}</span>'">`
      : `<span style="font-size:20px;">${emoji}</span>`;
    return `<tr>
      <td><code>${p.sku}</code></td>
      <td><div style="display:flex;align-items:center;gap:10px;">${thumbHtml}<div><strong>${p.name}</strong><br><span style="font-size:11px;color:var(--gray-400);">${p.desc || ''}</span></div></div></td>
      <td>${p.category}</td><td>${p.size}</td>
      <td style="font-weight:700;">Rs. ${Number(p.price).toLocaleString()}</td>
      <td style="color:var(--gray-400);">Rs. ${Number(p.cost).toLocaleString()}</td>
      <td><strong>${p.stock}</strong></td><td>${p.minStock}</td>
      <td><span class="badge ${sc}">${sl}</span></td>
      <td style="white-space:nowrap;">${canEdit
        ? `<button class="btn btn-outline btn-sm" onclick="openEditProduct('${p.sku}')">Edit</button>
           <button class="btn btn-green btn-sm" onclick="openRestock('${p.sku}')">+Stock</button>
           <button class="btn btn-danger btn-sm" onclick="delProduct('${p.sku}')">Del</button>`
        : '—'}</td>
    </tr>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
//  IMAGE FIELD HELPERS (drag & drop)
// ═══════════════════════════════════════════════════════════════
function handleImgFile(input) {
  const file = (input.files || input)[0]; if (!file) return;
  const label = document.getElementById('img-drop-label');
  if (label) label.textContent = '⏳ Processing ' + file.name + '…';
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const MAX = 800;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const b64 = canvas.toDataURL('image/jpeg', 0.82);
      setImgPreview(b64);
      document.getElementById('p-img-final').value = b64;
      if (label) label.innerHTML = '✅ ' + file.name + ' — <span style="color:var(--gold);font-weight:700;">change photo</span>';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
function onImgUrlInput(val) {
  document.getElementById('p-img-final').value = val.trim();
  if (val.trim()) setImgPreview(val.trim());
  else document.getElementById('p-img-preview').style.display = 'none';
}
function setImgPreview(src) {
  document.getElementById('p-img-thumb').src = src;
  document.getElementById('p-img-preview').style.display = 'flex';
}
function clearImgField() {
  document.getElementById('p-img-final').value = '';
  document.getElementById('p-img-file').value  = '';
  document.getElementById('p-img').value       = '';
  document.getElementById('p-img-preview').style.display = 'none';
  const label = document.getElementById('img-drop-label');
  if (label) label.innerHTML = '🖼 Drag & drop photo here, or <span style="color:var(--gold);font-weight:700;">click to browse</span>';
}
function _setModalImg(val) {
  document.getElementById('p-img-final').value = val || '';
  if (val && val.startsWith('http')) { document.getElementById('p-img').value = val; setImgPreview(val); }
  else if (val && val.startsWith('data:')) setImgPreview(val);
  else clearImgField();
}

// ═══════════════════════════════════════════════════════════════
//  ADD / EDIT / DELETE PRODUCT
// ═══════════════════════════════════════════════════════════════
function openAddProduct() {
  if (CU.role === 'cashier') { showToast('Access denied', 'error'); return; }
  document.getElementById('product-modal-title').textContent = 'Add Product';
  document.getElementById('edit-sku-orig').value = '';
  ['p-sku','p-name','p-size','p-desc','p-img'].forEach(id => { const e = document.getElementById(id); if(e) e.value = ''; });
  ['p-price','p-cost','p-stock','p-minstock'].forEach(id => document.getElementById(id).value = '');
  clearImgField();
  openModal('product-modal');
}

function openEditProduct(sku) {
  const p = get(K.products).find(x => x.sku === sku); if (!p) return;
  document.getElementById('product-modal-title').textContent = 'Edit Product';
  document.getElementById('edit-sku-orig').value = sku;
  document.getElementById('p-sku').value      = p.sku;
  document.getElementById('p-name').value     = p.name;
  document.getElementById('p-cat').value      = p.category;
  document.getElementById('p-size').value     = p.size;
  document.getElementById('p-price').value    = p.price;
  document.getElementById('p-cost').value     = p.cost;
  document.getElementById('p-stock').value    = p.stock;
  document.getElementById('p-minstock').value = p.minStock;
  document.getElementById('p-desc').value     = p.desc || '';
  _setModalImg(p.img || '');
  openModal('product-modal');
}

async function saveProduct() {
  const sku  = document.getElementById('p-sku').value.trim();
  const name = document.getElementById('p-name').value.trim();
  if (!sku || !name) { showToast('SKU and Name required!', 'error'); return; }
  const orig  = document.getElementById('edit-sku-orig').value;
  const prods = get(K.products);
  const np = {
    sku, name,
    category: document.getElementById('p-cat').value,
    size:     document.getElementById('p-size').value.trim(),
    price:    parseFloat(document.getElementById('p-price').value)    || 0,
    cost:     parseFloat(document.getElementById('p-cost').value)     || 0,
    stock:    parseInt(document.getElementById('p-stock').value)      || 0,
    minStock: parseInt(document.getElementById('p-minstock').value)   || 5,
    desc:     document.getElementById('p-desc').value.trim(),
    img:      document.getElementById('p-img-final').value.trim(),
    active:   true
  };
  if (orig) { const i = prods.findIndex(p => p.sku === orig); if (i >= 0) prods[i] = np; else prods.push(np); }
  else {
    if (prods.find(p => p.sku === sku)) { showToast('SKU already exists!', 'error'); return; }
    prods.push(np);
  }
  set(K.products, prods);
  closeModal('product-modal');
  renderInventory(); renderProducts();
  showToast('Saving to database…', '');
  setSaveState('saving');
  try {
    await dbSaveProduct(np);
    setSaveState('synced');
    showToast('✅ Product saved to database! Store will update on refresh.', 'success');
  } catch(e) {
    setSaveState('error');
    showToast('⚠ Saved locally — DB failed: ' + e.message, 'error');
  }
}

async function delProduct(sku) {
  if (!confirm('Delete this product from the database?')) return;
  const prods = get(K.products).filter(p => p.sku !== sku);
  set(K.products, prods);
  renderInventory();
  try {
    await dbDeleteProduct(sku);
    showToast('Product deleted ✅', 'success');
  } catch(e) {
    showToast('⚠ Deleted locally — DB delete failed: ' + e.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
//  RESTOCK
// ═══════════════════════════════════════════════════════════════
function openRestock(sku) {
  const p = get(K.products).find(x => x.sku === sku); if (!p) return;
  document.getElementById('restock-sku').value = sku;
  document.getElementById('restock-product-name').textContent = p.name;
  document.getElementById('restock-current-stock').textContent = 'Current stock: ' + p.stock + ' units';
  document.getElementById('restock-qty').value  = '';
  document.getElementById('restock-note').value = '';
  openModal('restock-modal');
}

async function doRestock() {
  const sku = document.getElementById('restock-sku').value;
  const qty = parseInt(document.getElementById('restock-qty').value) || 0;
  if (qty <= 0) { showToast('Enter a valid quantity!', 'error'); return; }
  const prods = get(K.products);
  const idx   = prods.findIndex(p => p.sku === sku); if (idx < 0) return;
  prods[idx].stock += qty;
  const newStock = prods[idx].stock;
  const pName    = prods[idx].name;
  set(K.products, prods);
  closeModal('restock-modal');
  renderInventory(); renderProducts(); refreshDashboard();
  showToast('Saving restock to database…', '');
  try {
    await dbUpdateStock(sku, newStock);
    showToast(`+${qty} units on ${pName} saved ✅`, 'success');
  } catch(e) {
    showToast('⚠ Updated locally — DB failed: ' + e.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
//  SAVE INVENTORY BUTTON (manual full sync)
// ═══════════════════════════════════════════════════════════════
async function saveInventoryToSheets() {
  const prods = get(K.products);
  if (!prods.length) { showToast('No products to save!', ''); return; }
  showToast('Saving ' + prods.length + ' products to database…', '');
  const ok = await saveProductsToDB(prods);
  if (ok) showToast('✅ All ' + prods.length + ' products saved! Store will update on refresh.', 'success');
}

// ═══════════════════════════════════════════════════════════════
//  SALES
// ═══════════════════════════════════════════════════════════════
let _salesMap = {};

function setDefaultDates() {
  const now = new Date(), from = new Date(now.getFullYear(), now.getMonth(), 1);
  document.getElementById('sales-from').value = from.toLocaleDateString('en-CA');
  document.getElementById('sales-to').value   = now.toLocaleDateString('en-CA');
}

function viewSaleByTxn(txnNum) {
  const s = _salesMap[txnNum]; if (s) showInvoice(s);
}

function renderSales() {
  const isOwner = CU && CU.role === 'owner';
  document.getElementById('sales-void-th').style.display = isOwner ? '' : 'none';
  const clearBtn = document.getElementById('clear-all-sales-btn');
  if (clearBtn) clearBtn.style.display = isOwner ? '' : 'none';
  const from = document.getElementById('sales-from').value;
  const to   = document.getElementById('sales-to').value;
  const pay  = document.getElementById('sales-pay').value;
  const allSales = get(K.sales);
  _salesMap = {};
  allSales.forEach(s => { _salesMap[s.txnNum] = s; });
  const sales = allSales.filter(s => {
    const d = s.date.slice(0,10);
    return (!from || d >= from) && (!to || d <= to) && (!pay || s.payment === pay);
  }).sort((a,b) => new Date(b.date) - new Date(a.date));
  const fmt = n => 'Rs. ' + n.toLocaleString('en-PH', { minimumFractionDigits:2 });
  document.getElementById('sales-tbody').innerHTML = sales.length
    ? sales.map(s => {
        const voided = !!s.voided;
        return `<tr class="${voided ? 'void-row' : ''}">
          <td><code>${s.txnNum}</code>${voided ? `<br><span style="font-size:10px;color:var(--red);font-weight:700;">VOID</span>` : ''}</td>
          <td>${new Date(s.date).toLocaleString('en-PH')}</td>
          <td>${s.customer}</td>
          <td>${s.items.length} item(s)</td>
          <td><span class="badge ${voided ? 'voided' : s.payment}">${voided ? 'VOIDED' : s.payment.toUpperCase()}</span></td>
          <td style="color:var(--green);">${s.discount > 0 ? '-' + fmt(s.discount) : '—'}</td>
          <td style="font-weight:700;color:${voided ? 'var(--red)' : 'var(--gold-600)'};">${voided ? '<s>' + fmt(s.total) + '</s>' : fmt(s.total)}</td>
          <td style="white-space:nowrap;">
            <button class="btn btn-outline btn-sm" onclick="viewSaleByTxn('${s.txnNum}')">👁 View</button>
            ${isOwner && !voided ? `<button class="btn-void" onclick="voidSale('${s.txnNum}')">⊘ Void</button>` : ''}
          </td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="8" style="text-align:center;color:var(--gray-400);padding:24px;">No sales in this date range.</td></tr>';
}

function voidSale(txnNum) {
  if (CU.role !== 'owner') { showToast('Only the owner can void sales!', 'error'); return; }
  const reason = prompt('Reason for voiding ' + txnNum + '?');
  if (!reason) return;
  const sales = get(K.sales);
  const idx   = sales.findIndex(s => s.txnNum === txnNum); if (idx < 0) return;
  const sale  = sales[idx];
  sales[idx].voided = true; sales[idx].voidReason = reason; sales[idx].voidedAt = new Date().toISOString();
  // Restore stock
  const prods = get(K.products);
  sale.items.forEach(it => { const p = prods.find(x => x.sku === it.sku); if (p) p.stock += it.qty; });
  set(K.products, prods); set(K.sales, sales);
  renderSales(); renderProducts(); refreshDashboard();
  showToast(txnNum + ' voided — stock restored ✅', 'success');
  dbVoidSale(txnNum, reason).catch(() => {});
}

function clearAllSales() {
  if (CU.role !== 'owner') { showToast('Owner only!', 'error'); return; }
  if (!confirm('Delete ALL local sales records? Cannot be undone.')) return;
  set(K.sales, []); renderSales(); refreshDashboard();
  showToast('All sales cleared 🗑', 'success');
}

// ═══════════════════════════════════════════════════════════════
//  REPORTS
// ═══════════════════════════════════════════════════════════════
function switchReport(id,el) {
  ['sales-report','inv-report'].forEach(r => document.getElementById(r).style.display = 'none');
  document.getElementById(id).style.display = 'block';
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
}

function renderReports() {
  const now = new Date();
  const fromEl = document.getElementById('rpt-from');
  const toEl   = document.getElementById('rpt-to');
  if (!fromEl.value && !toEl.value) {
    fromEl.value = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('en-CA');
    toEl.value   = now.toLocaleDateString('en-CA');
  }
  const from = fromEl.value, to = toEl.value;
  const fmt  = n => 'Rs. ' + n.toLocaleString('en-PH', { minimumFractionDigits:0 });
  const allSales = get(K.sales).filter(s => !s.voided);
  const prods    = get(K.products);
  const sales    = allSales.filter(s => { const d = s.date.slice(0,10); return (!from||d>=from)&&(!to||d<=to); });
  const totalRev = sales.reduce((a,s) => a+s.total, 0);
  const cashRev  = sales.filter(s=>s.payment==='cash').reduce((a,s)=>a+s.total,0);
  const cardRev  = sales.filter(s=>s.payment==='card').reduce((a,s)=>a+s.total,0);
  const avgOrder = sales.length ? totalRev/sales.length : 0;
  const totalDisc= sales.reduce((a,s)=>a+(s.discount||0),0);
  document.getElementById('report-mini').innerHTML = `
    <div class="mini-stat"><div class="label">Revenue</div><div class="value">${fmt(totalRev)}</div></div>
    <div class="mini-stat"><div class="label">Orders</div><div class="value">${sales.length}</div></div>
    <div class="mini-stat"><div class="label">Avg Order</div><div class="value">${fmt(avgOrder)}</div></div>
    <div class="mini-stat"><div class="label">Cash</div><div class="value">${fmt(cashRev)}</div></div>
    <div class="mini-stat"><div class="label">Card</div><div class="value">${fmt(cardRev)}</div></div>
    <div class="mini-stat"><div class="label">Discounts</div><div class="value">${fmt(totalDisc)}</div></div>`;
  const ps = {};
  sales.forEach(s => s.items.forEach(it => {
    if (!ps[it.name]) ps[it.name] = { units:0, rev:0 };
    ps[it.name].units += it.qty; ps[it.name].rev += it.qty * it.price;
  }));
  const top = Object.entries(ps).sort((a,b) => b[1].rev - a[1].rev).slice(0,15);
  document.getElementById('report-top').innerHTML = top.length
    ? top.map(([n,d],i) => `<tr><td style="color:var(--gray-400);font-weight:700;">#${i+1}</td><td>${n}</td><td>${d.units}</td><td style="font-weight:700;color:var(--gold-600);">Rs. ${d.rev.toLocaleString('en-PH',{minimumFractionDigits:2})}</td></tr>`).join('')
    : '<tr><td colspan="4" style="text-align:center;color:var(--gray-400);padding:16px;">No sales in this period.</td></tr>';
  document.getElementById('report-inv').innerHTML = prods.length
    ? prods.map(p => {
        const sc = p.stock===0?'out-stock':p.stock<=p.minStock?'low-stock':'in-stock';
        const sl = p.stock===0?'Out of Stock':p.stock<=p.minStock?'Low Stock':'In Stock';
        let unitsSold = 0;
        sales.forEach(s => s.items.forEach(it => { if(it.sku===p.sku) unitsSold+=it.qty; }));
        return `<tr><td><code>${p.sku}</code></td><td><strong>${p.name}</strong></td><td>${p.category}</td>
          <td><strong>${p.stock}</strong></td>
          <td>${unitsSold>0?`<span style="color:var(--green);font-weight:700;">${unitsSold} sold</span>`:'—'}</td>
          <td>Rs. ${Number(p.cost).toLocaleString()}</td><td>Rs. ${Number(p.price).toLocaleString()}</td>
          <td><span class="badge ${sc}">${sl}</span></td></tr>`;
      }).join('')
    : '<tr><td colspan="8" style="text-align:center;color:var(--gray-400);padding:16px;">No products found.</td></tr>';
}

// ═══════════════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════════════
function renderSettings() {
  if (CU.role === 'cashier') { document.getElementById('settings-page').innerHTML='<div class="no-access"><span style="font-size:48px;">🔒</span><p>Access Denied</p></div>'; return; }
  const cfg = getObj(K.config);
  document.getElementById('cfg-name').value    = cfg.name    || '';
  document.getElementById('cfg-address').value = cfg.address || '';
  document.getElementById('cfg-phone').value   = cfg.phone   || '';
  document.getElementById('cfg-vat').value     = cfg.vat     || 0;
}
function saveConfig() {
  const cfg = { name:document.getElementById('cfg-name').value, address:document.getElementById('cfg-address').value, phone:document.getElementById('cfg-phone').value, vat:parseFloat(document.getElementById('cfg-vat').value)||0 };
  set(K.config, cfg); showToast('Settings saved ✅', 'success');
}

// ═══════════════════════════════════════════════════════════════
//  CSV EXPORT
// ═══════════════════════════════════════════════════════════════
function exportProductsCSV() {
  const rows = [['SKU','Name','Category','Size','Price','Cost','Stock','MinStock','Description']];
  get(K.products).forEach(p => rows.push([p.sku,p.name,p.category,p.size,p.price,p.cost,p.stock,p.minStock,p.desc||'']));
  dlCSV(rows, 'jj_products.csv');
}
function exportSalesCSV() {
  const rows = [['TxnNum','Date','Customer','Items','Subtotal','Discount','Total','Payment','Cashier']];
  get(K.sales).forEach(s => rows.push([s.txnNum,new Date(s.date).toLocaleString('en-PH'),s.customer,s.items.map(i=>`${i.name}(${i.qty})`).join(';'),s.subtotal,s.discount,s.total,s.payment,s.cashier]));
  dlCSV(rows, 'jj_sales.csv');
}
function dlCSV(rows, fn) {
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = fn; a.click();
}

// ═══════════════════════════════════════════════════════════════
//  MISC HELPERS
// ═══════════════════════════════════════════════════════════════
function nextTxnNum() {
  const sales = get(K.sales);
  if (!sales.length) return 'TXN-000001';
  const nums = sales.map(s => parseInt((s.txnNum||'0').replace(/\D/g,''))||0);
  return 'TXN-' + String(Math.max(...nums)+1).padStart(6,'0');
}

function renderDashChart() {
  const sales = get(K.sales), now = new Date();
  const days = Array.from({length:7},(_,i)=>{ const d=new Date(now); d.setDate(d.getDate()-(6-i)); return {label:d.toLocaleDateString('en-PH',{weekday:'short'}),date:d.toLocaleDateString('en-CA'),total:0}; });
  sales.forEach(s=>{ const d=days.find(x=>s.date.startsWith(x.date)); if(d)d.total+=s.total; });
  const max=Math.max(...days.map(d=>d.total),1);
  const chartEl=document.getElementById('dash-chart');
  if(!chartEl)return;
  chartEl.innerHTML=`<div style="display:flex;align-items:flex-end;gap:8px;height:80px;margin-top:12px;">${days.map(d=>`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;"><div style="width:100%;background:var(--gold-${d.total>0?'400':'100'});border-radius:4px 4px 0 0;height:${Math.max(4,Math.round((d.total/max)*72))}px;" title="Rs. ${d.total.toLocaleString()}"></div><div style="font-size:10px;color:var(--gray-400);font-weight:600;">${d.label}</div></div>`).join('')}</div><div style="font-size:11px;color:var(--gray-400);margin-top:6px;">Sales last 7 days</div>`;
}

function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
document.querySelectorAll('.modal-overlay').forEach(m => m.addEventListener('click', e => { if(e.target===m) m.classList.remove('active'); }));
function showToast(msg, type='') {
  const t = document.createElement('div'); t.className = 'toast-msg ' + (type||''); t.textContent = msg;
  document.getElementById('toast').appendChild(t); setTimeout(()=>t.remove(), 3200);
}

// ── Mobile helpers ──
let _cartOpen = false;
function toggleMobileSidebar() { const sb=document.querySelector('.sidebar'),ov=document.getElementById('sidebar-overlay'); if(sb.classList.contains('mob-open')){sb.classList.remove('mob-open');ov.classList.remove('open');}else{sb.classList.add('mob-open');ov.classList.add('open');} }
function closeMobileSidebar() { document.querySelector('.sidebar').classList.remove('mob-open'); document.getElementById('sidebar-overlay').classList.remove('open'); }
function toggleMobileCart() { _cartOpen=!_cartOpen; const panel=document.querySelector('.pos-right'),bar=document.getElementById('cart-toggle-bar'); if(panel)panel.classList.toggle('cart-open',_cartOpen); if(bar)bar.querySelector('span').textContent=_cartOpen?'✕ Close Cart':'🛒 View Cart'; }
const _origRenderCart=renderCart;
renderCart=function(){_origRenderCart();const total=cart.reduce((a,c)=>a+c.qty,0),ctBadge=document.getElementById('cart-toggle-count');if(ctBadge)ctBadge.textContent=total+(total===1?' item':' items');if(total>0&&!_cartOpen&&window.innerWidth<=768){_cartOpen=true;const panel=document.querySelector('.pos-right'),bar=document.getElementById('cart-toggle-bar');if(panel)panel.classList.add('cart-open');if(bar)bar.querySelector('span').textContent='✕ Close Cart';}};
const _origShowPage=showPage;
showPage=function(p){_origShowPage(p);document.querySelectorAll('.mob-nav-item').forEach(x=>{x.classList.toggle('active',x.dataset.page===p);});};

// ═══════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════
seed();
