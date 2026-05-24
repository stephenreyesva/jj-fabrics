// ============================================================
//  JJ Fabrics POS — Application Logic
//  Backend: Supabase (via db.js)
// ============================================================

// ── State ──
let CU        = null;   // current user
let allProducts = [];   // in-memory product cache
let cart      = [];
let activeTab = 'sales';
let activeCat = 'all';

// ─────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────
async function doLogin() {
  const username = document.getElementById('l-user').value.trim();
  const password = document.getElementById('l-pass').value;
  const errEl    = document.getElementById('login-err');
  const btn      = document.querySelector('#login-screen .btn-primary');

  errEl.textContent = '';
  if (!username || !password) { errEl.textContent = 'Enter username and password.'; return; }

  btn.textContent = 'Signing in…';
  btn.disabled    = true;

  try {
    const user = await dbLogin(username, password);
    if (!user) {
      errEl.textContent = 'Invalid username or password.';
      btn.textContent = 'Sign In';
      btn.disabled = false;
      return;
    }
    CU = user;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display          = 'flex';
    document.getElementById('sidebar-user').textContent   = user.username;

    // Role-based nav visibility
    if (user.role === 'cashier') {
      document.querySelector('[data-tab="inventory"]').style.display = 'none';
      document.querySelector('[data-tab="reports"]').style.display   = 'none';
    }

    await loadProducts();
    showTab('sales');
  } catch (e) {
    errEl.textContent = 'Login error — check connection.';
    btn.textContent = 'Sign In';
    btn.disabled = false;
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('login-screen').style.display !== 'none') doLogin();
});

function doLogout() {
  CU = null;
  cart = [];
  allProducts = [];
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display          = 'none';
  document.getElementById('l-user').value               = '';
  document.getElementById('l-pass').value               = '';
  document.getElementById('login-err').textContent      = '';
  // Restore nav items
  document.querySelectorAll('.nav-item').forEach(el => el.style.display = '');
}

// ─────────────────────────────────────────
//  NAVIGATION
// ─────────────────────────────────────────
function showTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelector(`.nav-item[data-tab="${tab}"]`)?.classList.add('active');

  if (tab === 'sales')     renderProducts();
  if (tab === 'inventory') loadAndRenderInventory();
  if (tab === 'reports')   loadAndRenderReports();
}

// ─────────────────────────────────────────
//  PRODUCTS — load & cache
// ─────────────────────────────────────────
async function loadProducts() {
  try {
    allProducts = await dbGetProducts();
  } catch (e) {
    console.error('Failed to load products:', e);
    allProducts = [];
  }
}

// ─────────────────────────────────────────
//  SALES TAB — Product Grid
// ─────────────────────────────────────────
let salesSearchQ = '';

function filterCat(cat, btn) {
  activeCat = cat;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderProducts();
}

function filterProducts() {
  salesSearchQ = document.getElementById('search-box').value.toLowerCase();
  renderProducts();
}

function renderProducts() {
  const grid = document.getElementById('product-grid');
  let list = allProducts;

  if (activeCat !== 'all') list = list.filter(p => p.category === activeCat);
  if (salesSearchQ)        list = list.filter(p =>
    p.name.toLowerCase().includes(salesSearchQ) ||
    p.sku.toLowerCase().includes(salesSearchQ)
  );

  if (!list.length) {
    grid.innerHTML = '<div class="empty-state"><span>🧵</span>No products found.</div>';
    return;
  }

  grid.innerHTML = list.map(p => {
    const isOut = p.stock <= 0;
    const isLow = p.stock > 0 && p.stock <= 5;
    return `<div class="product-card ${isOut ? 'out-of-stock' : ''}" onclick="${isOut ? '' : `addToCart('${p.sku}')`}">
      ${p.img ? `<img src="${p.img}" alt="${p.name}" onerror="this.style.display='none'"/>` : ''}
      <div class="pc-name">${p.name}</div>
      <div class="pc-price">Rs. ${Number(p.price).toLocaleString()}</div>
      <div class="pc-stock ${isLow ? 'low' : ''}">${isOut ? 'Out of stock' : isLow ? p.stock + ' left' : p.stock + ' in stock'}</div>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────
//  CART
// ─────────────────────────────────────────
function addToCart(sku) {
  const p = allProducts.find(x => x.sku === sku);
  if (!p || p.stock <= 0) return;
  const existing = cart.find(c => c.sku === sku);
  if (existing) {
    if (existing.qty >= p.stock) { showToast('Max stock reached!', 'error'); return; }
    existing.qty++;
  } else {
    cart.push({ sku: p.sku, name: p.name, price: p.price, qty: 1, maxStock: p.stock });
  }
  renderCart();
}

function changeQty(index, delta) {
  cart[index].qty += delta;
  if (cart[index].qty <= 0) cart.splice(index, 1);
  else if (cart[index].qty > cart[index].maxStock) cart[index].qty = cart[index].maxStock;
  renderCart();
}

function removeFromCart(index) {
  cart.splice(index, 1);
  renderCart();
}

function clearCart() {
  cart = [];
  document.getElementById('s-discount').value = '0';
  renderCart();
}

function renderCart() {
  const listEl = document.getElementById('cart-list');
  if (!cart.length) {
    listEl.innerHTML = '<div class="empty-state"><span>🛒</span>Cart is empty</div>';
  } else {
    listEl.innerHTML = cart.map((it, i) => `
      <div class="cart-item">
        <div class="cart-item-top">
          <span class="cart-item-name">${it.name}</span>
          <button class="cart-item-remove" onclick="removeFromCart(${i})">✕</button>
        </div>
        <div class="cart-item-bottom">
          <span class="cart-item-price">Rs. ${Number(it.price).toLocaleString()} × ${it.qty}</span>
          <div class="qty-control">
            <button class="qty-btn" onclick="changeQty(${i},-1)">−</button>
            <span class="qty-val">${it.qty}</span>
            <button class="qty-btn" onclick="changeQty(${i},1)">+</button>
          </div>
        </div>
      </div>`).join('');
  }
  recalc();
}

function recalc() {
  const subtotal = cart.reduce((a, c) => a + c.qty * c.price, 0);
  const discount = parseFloat(document.getElementById('s-discount').value) || 0;
  const total    = Math.max(0, subtotal - discount);
  document.getElementById('s-subtotal').textContent = 'Rs. ' + subtotal.toLocaleString();
  document.getElementById('s-total').textContent    = 'Rs. ' + total.toLocaleString();
}

// ─────────────────────────────────────────
//  CHECKOUT
// ─────────────────────────────────────────
async function checkout() {
  if (!cart.length) { showToast('Cart is empty!', 'error'); return; }

  const subtotal = cart.reduce((a, c) => a + c.qty * c.price, 0);
  const discount = parseFloat(document.getElementById('s-discount').value) || 0;
  const total    = Math.max(0, subtotal - discount);
  const method   = document.getElementById('s-payment').value;
  const ref      = 'TXN-' + Date.now();

  const btn = document.querySelector('.btn-checkout');
  btn.textContent = 'Processing…';
  btn.disabled = true;

  try {
    // 1. Save sale to Supabase
    await dbSaveSale({
      ref,
      items: cart.map(i => ({ sku: i.sku, name: i.name, qty: i.qty, price: i.price })),
      subtotal,
      discount,
      total,
      paymentMethod: method,
      cashier: CU.username
    });

    // 2. Update stock for each item
    for (const item of cart) {
      const prod = allProducts.find(p => p.sku === item.sku);
      if (prod) {
        const newStock = Math.max(0, prod.stock - item.qty);
        await dbUpdateStock(item.sku, newStock);
        prod.stock = newStock; // update local cache
      }
    }

    // 3. Show receipt
    showReceipt({ ref, items: [...cart], subtotal, discount, total, paymentMethod: method });

    clearCart();
    renderProducts();
    showToast(ref + ' completed ✅', 'success');
  } catch (e) {
    showToast('Checkout failed: ' + e.message, 'error');
  } finally {
    btn.textContent = 'Complete Sale';
    btn.disabled = false;
  }
}

function showReceipt(sale) {
  const el = document.getElementById('receipt-body');
  el.innerHTML = `
    <div class="r-row"><span>Ref</span><span>${sale.ref}</span></div>
    <div class="r-row"><span>Date</span><span>${new Date().toLocaleString()}</span></div>
    <div class="r-row"><span>Cashier</span><span>${CU.username}</span></div>
    <hr class="r-divider"/>
    ${sale.items.map(i => `
      <div class="r-row">
        <span>${i.name} × ${i.qty}</span>
        <span>Rs. ${(i.qty * i.price).toLocaleString()}</span>
      </div>`).join('')}
    <hr class="r-divider"/>
    <div class="r-row"><span>Subtotal</span><span>Rs. ${sale.subtotal.toLocaleString()}</span></div>
    ${sale.discount > 0 ? `<div class="r-row"><span>Discount</span><span>-Rs. ${sale.discount.toLocaleString()}</span></div>` : ''}
    <div class="r-row r-total"><span>TOTAL</span><span>Rs. ${sale.total.toLocaleString()}</span></div>
    <div class="r-row"><span>Payment</span><span>${sale.paymentMethod.toUpperCase()}</span></div>
  `;
  document.getElementById('receipt-modal').style.display = 'flex';
}

function closeReceipt() {
  document.getElementById('receipt-modal').style.display = 'none';
}

// ─────────────────────────────────────────
//  INVENTORY TAB
// ─────────────────────────────────────────
async function loadAndRenderInventory() {
  const statusEl = document.getElementById('db-status');
  statusEl.textContent = 'Loading from Supabase…';
  statusEl.className = 'db-status';
  try {
    allProducts = await dbGetProducts();
    statusEl.textContent = '✓ Connected — ' + allProducts.length + ' products';
    statusEl.className = 'db-status ok';
    renderInventory();
  } catch (e) {
    statusEl.textContent = '✗ Connection failed';
    statusEl.className = 'db-status err';
  }
}

function renderInventory() {
  const q    = (document.getElementById('inv-search')?.value || '').toLowerCase();
  const list = q
    ? allProducts.filter(p => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
    : allProducts;

  const badgeClass = cat => {
    if (cat === 'Ladies Suiting') return 'badge-ladies';
    if (cat === 'Gents Suiting')  return 'badge-gents';
    if (cat === 'Kids Wear')      return 'badge-kids';
    return 'badge-acc';
  };

  const canEdit = CU && CU.role !== 'cashier';

  document.getElementById('inv-body').innerHTML = list.map(p => `
    <tr>
      <td>${p.img ? `<img class="thumb" src="${p.img}" alt="${p.name}" onerror="this.style.display='none'"/>` : '—'}</td>
      <td><code>${p.sku}</code></td>
      <td>${p.name}</td>
      <td><span class="badge ${badgeClass(p.category)}">${p.category}</span></td>
      <td>Rs. ${Number(p.price).toLocaleString()}</td>
      <td class="${p.stock <= 0 ? 'low' : p.stock <= 5 ? 'low' : ''}">${p.stock}</td>
      <td>
        ${canEdit ? `
          <button class="btn-edit" onclick="openEditProduct('${p.sku}')">Edit</button>
          <button class="btn-del"  onclick="deleteProduct('${p.sku}')">Delete</button>
        ` : '—'}
      </td>
    </tr>`).join('');
}

// ─────────────────────────────────────────
//  PRODUCT MODAL — Add / Edit
// ─────────────────────────────────────────
let _editingSku = null;
let _imgData    = '';

function openAddProduct() {
  _editingSku = null;
  _imgData    = '';
  document.getElementById('modal-title').textContent = 'Add Product';
  ['p-sku','p-name','p-price','p-stock','p-desc','p-img-url'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('p-cat').value = 'Ladies Suiting';
  document.getElementById('p-img-preview').style.display = 'none';
  document.getElementById('drop-zone').classList.remove('has-img');
  document.getElementById('drop-label').textContent = '📁 Drag & drop image here or click to browse';
  document.getElementById('product-modal').style.display = 'flex';
}

function openEditProduct(sku) {
  const p = allProducts.find(x => x.sku === sku);
  if (!p) return;
  _editingSku = sku;
  _imgData    = p.img || '';

  document.getElementById('modal-title').textContent = 'Edit Product';
  document.getElementById('p-sku').value   = p.sku;
  document.getElementById('p-name').value  = p.name;
  document.getElementById('p-cat').value   = p.category;
  document.getElementById('p-price').value = p.price;
  document.getElementById('p-stock').value = p.stock;
  document.getElementById('p-desc').value  = p.description || '';

  if (p.img) {
    document.getElementById('p-img-url').value = p.img.startsWith('http') ? p.img : '';
    const preview = document.getElementById('p-img-preview');
    preview.src     = p.img;
    preview.style.display = 'block';
    document.getElementById('drop-zone').classList.add('has-img');
  } else {
    document.getElementById('p-img-url').value = '';
    document.getElementById('p-img-preview').style.display = 'none';
    document.getElementById('drop-zone').classList.remove('has-img');
  }

  document.getElementById('product-modal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('product-modal').style.display = 'none';
}

// Image handling
function handleImgFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const MAX = 800;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      _imgData = canvas.toDataURL('image/jpeg', 0.82);
      document.getElementById('p-img-preview').src   = _imgData;
      document.getElementById('p-img-preview').style.display = 'block';
      document.getElementById('drop-zone').classList.add('has-img');
      document.getElementById('drop-label').textContent = '✅ Image loaded — click to change';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function handleImgDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleImgFile({ files: [file] });
}

function handleUrlInput() {
  const url = document.getElementById('p-img-url').value.trim();
  _imgData  = url;
  if (url) {
    document.getElementById('p-img-preview').src = url;
    document.getElementById('p-img-preview').style.display = 'block';
    document.getElementById('drop-zone').classList.add('has-img');
  }
}

function clearImg() {
  _imgData = '';
  document.getElementById('p-img-url').value            = '';
  document.getElementById('p-img-preview').style.display = 'none';
  document.getElementById('p-img-file').value            = '';
  document.getElementById('drop-zone').classList.remove('has-img');
  document.getElementById('drop-label').textContent = '📁 Drag & drop image here or click to browse';
}

async function saveProduct() {
  const sku   = document.getElementById('p-sku').value.trim();
  const name  = document.getElementById('p-name').value.trim();
  if (!sku || !name) { showToast('SKU and Name are required!', 'error'); return; }

  // Use URL from the text field if no file was uploaded
  const urlInput = document.getElementById('p-img-url').value.trim();
  const imgToSave = _imgData || urlInput;

  const product = {
    sku,
    name,
    category:    document.getElementById('p-cat').value,
    price:       parseFloat(document.getElementById('p-price').value) || 0,
    stock:       parseInt(document.getElementById('p-stock').value)   || 0,
    description: document.getElementById('p-desc').value.trim(),
    img:         imgToSave
  };

  const btn = document.querySelector('#product-modal .btn-primary');
  btn.textContent = 'Saving…';
  btn.disabled    = true;

  try {
    await dbSaveProduct(product);
    allProducts = await dbGetProducts(); // refresh cache
    closeModal();
    renderInventory();
    renderProducts();
    showToast('Product saved ✅', 'success');
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  } finally {
    btn.textContent = 'Save & Push to Database';
    btn.disabled    = false;
  }
}

async function deleteProduct(sku) {
  if (!confirm('Delete this product from the database?')) return;
  try {
    await dbDeleteProduct(sku);
    allProducts = allProducts.filter(p => p.sku !== sku);
    renderInventory();
    renderProducts();
    showToast('Product deleted ✅', 'success');
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

// ─────────────────────────────────────────
//  REPORTS TAB
// ─────────────────────────────────────────
async function loadAndRenderReports() {
  const el = document.getElementById('reports-body');
  el.innerHTML = '<div style="text-align:center;padding:40px;color:#888;">Loading sales…</div>';
  try {
    const sales = await dbGetSales();
    if (!sales.length) {
      el.innerHTML = '<div class="empty-state"><span>📊</span>No sales recorded yet.</div>';
      return;
    }

    const fmt = n => 'Rs. ' + Number(n).toLocaleString();

    el.innerHTML = sales.map(s => {
      const items = Array.isArray(s.items) ? s.items : [];
      const date  = new Date(s.created_at).toLocaleString();
      return `<div class="report-card">
        <div class="report-ref">${s.sale_ref}</div>
        <div class="report-meta">${date} · ${s.cashier} · ${s.payment_method?.toUpperCase()}</div>
        <div class="report-meta">${items.length} item(s)${s.discount > 0 ? ' · Discount: ' + fmt(s.discount) : ''}</div>
        <div class="report-total">${fmt(s.total)}</div>
      </div>`;
    }).join('');
  } catch (e) {
    el.innerHTML = '<div class="empty-state"><span>⚠️</span>Failed to load reports.</div>';
  }
}

// ─────────────────────────────────────────
//  TOAST
// ─────────────────────────────────────────
function showToast(msg, type = '') {
  // Reuse existing toast container if pos.html has one, else body
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `padding:10px 18px;border-radius:8px;font-size:0.85rem;font-weight:600;
    background:${type === 'error' ? '#e74c3c' : type === 'success' ? '#2ecc71' : '#333'};
    color:#fff;box-shadow:0 4px 16px rgba(0,0,0,0.4);animation:fadeIn .2s ease;`;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
