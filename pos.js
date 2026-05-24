// ============================================================
//  JJ Fabrics POS — Main Logic
// ============================================================

let currentUser = null;
let products = [];
let cart = [];
let editingSku = null;
let activeCat = 'all';

// ── INIT ─────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  const saved = sessionStorage.getItem('jj-user');
  if (saved) {
    currentUser = JSON.parse(saved);
    startApp();
  }
});

// ── LOGIN ─────────────────────────────────────────────────

async function doLogin() {
  const user = document.getElementById('l-user').value.trim();
  const pass = document.getElementById('l-pass').value.trim();
  const err  = document.getElementById('login-err');
  err.textContent = '';
  if (!user || !pass) { err.textContent = 'Please enter username and password.'; return; }
  try {
    const u = await dbLogin(user, pass);
    if (!u) { err.textContent = 'Invalid username or password.'; return; }
    currentUser = u;
    sessionStorage.setItem('jj-user', JSON.stringify(u));
    startApp();
  } catch(e) {
    err.textContent = 'Connection error. Please try again.';
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('login-screen').style.display !== 'none') doLogin();
});

function doLogout() {
  sessionStorage.removeItem('jj-user');
  location.reload();
}

async function startApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('sidebar-user').textContent = currentUser.username + ' (' + currentUser.role + ')';
  await loadProducts();
}

// ── TABS ─────────────────────────────────────────────────

function showTab(tab) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  if (tab === 'inventory') renderInventory();
  if (tab === 'reports') loadReports();
}

// ── PRODUCTS ─────────────────────────────────────────────

async function loadProducts() {
  try {
    products = await dbGetProducts();
    renderProductGrid();
    setStatus('☁ Connected — ' + products.length + ' products', 'ok');
  } catch(e) {
    setStatus('⚠ Cannot reach database', 'err');
  }
}

function setStatus(msg, cls) {
  const el = document.getElementById('db-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'db-status ' + (cls || '');
}

function filterCat(cat, btn) {
  activeCat = cat;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderProductGrid();
}

function filterProducts() { renderProductGrid(); }

function renderProductGrid() {
  const q = (document.getElementById('search-box').value || '').toLowerCase();
  const grid = document.getElementById('product-grid');
  let list = products.filter(p => {
    const matchCat = activeCat === 'all' || p.category === activeCat;
    const matchQ   = !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    return matchCat && matchQ;
  });

  if (!list.length) {
    grid.innerHTML = '<div class="empty-state"><span>📦</span>No products found</div>';
    return;
  }

  grid.innerHTML = list.map(p => {
    const oos = p.stock <= 0;
    return `<div class="product-card ${oos ? 'out-of-stock' : ''}" onclick="${oos ? '' : `addToCart('${p.sku}')`}">
      <img src="${p.img || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22/>'}" 
           onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22/>'"/>
      <div class="pc-name">${p.name}</div>
      <div class="pc-price">Rs. ${Number(p.price).toLocaleString()}</div>
      <div class="pc-stock">${oos ? 'Out of stock' : p.stock + ' in stock'}</div>
    </div>`;
  }).join('');
}

// ── CART ─────────────────────────────────────────────────

function addToCart(sku) {
  const p = products.find(x => x.sku === sku);
  if (!p || p.stock <= 0) return;
  const existing = cart.find(x => x.sku === sku);
  if (existing) {
    if (existing.qty >= p.stock) return;
    existing.qty++;
  } else {
    cart.push({ sku: p.sku, name: p.name, price: p.price, qty: 1 });
  }
  renderCart();
}

function changeQty(sku, delta) {
  const item = cart.find(x => x.sku === sku);
  if (!item) return;
  const p = products.find(x => x.sku === sku);
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter(x => x.sku !== sku);
  if (p && item.qty > p.stock) item.qty = p.stock;
  renderCart();
}

function removeFromCart(sku) {
  cart = cart.filter(x => x.sku !== sku);
  renderCart();
}

function clearCart() { cart = []; renderCart(); }

function renderCart() {
  const el = document.getElementById('cart-list');
  if (!cart.length) {
    el.innerHTML = '<div class="empty-state"><span>🛒</span>Cart is empty</div>';
    recalc();
    return;
  }
  el.innerHTML = cart.map(i => `
    <div class="cart-item">
      <div class="cart-item-top">
        <span class="cart-item-name">${i.name}</span>
        <button class="cart-item-remove" onclick="removeFromCart('${i.sku}')">✕</button>
      </div>
      <div class="cart-item-bottom">
        <span class="cart-item-price">Rs. ${Number(i.price).toLocaleString()} × ${i.qty}</span>
        <div class="qty-control">
          <button class="qty-btn" onclick="changeQty('${i.sku}',-1)">−</button>
          <span class="qty-val">${i.qty}</span>
          <button class="qty-btn" onclick="changeQty('${i.sku}',1)">+</button>
        </div>
      </div>
    </div>`).join('');
  recalc();
}

function recalc() {
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const discount = parseFloat(document.getElementById('s-discount').value) || 0;
  const total = Math.max(0, subtotal - discount);
  document.getElementById('s-subtotal').textContent = 'Rs. ' + subtotal.toLocaleString();
  document.getElementById('s-total').textContent = 'Rs. ' + total.toLocaleString();
}

// ── CHECKOUT ─────────────────────────────────────────────

async function checkout() {
  if (!cart.length) { alert('Cart is empty.'); return; }
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const discount = parseFloat(document.getElementById('s-discount').value) || 0;
  const total    = Math.max(0, subtotal - discount);
  const payment  = document.getElementById('s-payment').value;
  const ref      = 'SALE-' + Date.now();

  try {
    // Save sale
    await dbSaveSale({ ref, items: cart, subtotal, discount, total, paymentMethod: payment, cashier: currentUser.username });

    // Deduct stock
    for (const item of cart) {
      const p = products.find(x => x.sku === item.sku);
      if (p) {
        const newStock = Math.max(0, p.stock - item.qty);
        await dbUpdateStock(item.sku, newStock);
        p.stock = newStock;
      }
    }

    showReceipt({ ref, items: [...cart], subtotal, discount, total, payment });
    cart = [];
    document.getElementById('s-discount').value = 0;
    renderCart();
    renderProductGrid();
  } catch(e) {
    alert('Sale failed: ' + e.message);
  }
}

function showReceipt(sale) {
  const rows = sale.items.map(i =>
    `<div class="r-row"><span>${i.name} × ${i.qty}</span><span>Rs. ${(i.price * i.qty).toLocaleString()}</span></div>`
  ).join('');
  document.getElementById('receipt-body').innerHTML = `
    <div class="r-row"><span>Ref:</span><span>${sale.ref}</span></div>
    <hr class="r-divider"/>
    ${rows}
    <hr class="r-divider"/>
    <div class="r-row"><span>Subtotal</span><span>Rs. ${sale.subtotal.toLocaleString()}</span></div>
    ${sale.discount ? `<div class="r-row"><span>Discount</span><span>−Rs. ${sale.discount.toLocaleString()}</span></div>` : ''}
    <div class="r-row r-total"><span>Total</span><span>Rs. ${sale.total.toLocaleString()}</span></div>
    <div class="r-row" style="margin-top:8px;color:#888;font-size:.8rem"><span>Payment</span><span>${sale.payment}</span></div>
  `;
  document.getElementById('receipt-modal').style.display = 'flex';
}

function closeReceipt() { document.getElementById('receipt-modal').style.display = 'none'; }

// ── INVENTORY ─────────────────────────────────────────────

function renderInventory() {
  const q = (document.getElementById('inv-search').value || '').toLowerCase();
  const list = products.filter(p => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  const body = document.getElementById('inv-body');

  if (!list.length) {
    body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:#666">No products yet. Click + Add Product to get started.</td></tr>';
    return;
  }

  body.innerHTML = list.map(p => {
    const badge = catBadge(p.category);
    return `<tr>
      <td><img class="thumb" src="${p.img || ''}" onerror="this.style.display='none'"/></td>
      <td style="font-family:monospace;color:#888">${p.sku}</td>
      <td>${p.name}</td>
      <td><span class="badge ${badge}">${p.category}</span></td>
      <td>Rs. ${Number(p.price).toLocaleString()}</td>
      <td>${p.stock}</td>
      <td>
        <button class="btn-edit" onclick="openEditProduct('${p.sku}')">Edit</button>
        <button class="btn-del"  onclick="deleteProduct('${p.sku}')">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

function catBadge(cat) {
  if (cat.includes('Ladies')) return 'badge-ladies';
  if (cat.includes('Gents'))  return 'badge-gents';
  if (cat.includes('Kids'))   return 'badge-kids';
  return 'badge-acc';
}

// ── ADD / EDIT PRODUCT ────────────────────────────────────

function openAddProduct() {
  editingSku = null;
  document.getElementById('modal-title').textContent = 'Add Product';
  document.getElementById('p-sku').disabled = false;
  ['p-sku','p-name','p-desc','p-img-url'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('p-price').value = '';
  document.getElementById('p-stock').value = '';
  document.getElementById('p-cat').value = 'Ladies Suiting';
  clearImg();
  document.getElementById('product-modal').style.display = 'flex';
}

function openEditProduct(sku) {
  const p = products.find(x => x.sku === sku);
  if (!p) return;
  editingSku = sku;
  document.getElementById('modal-title').textContent = 'Edit Product';
  document.getElementById('p-sku').value = p.sku;
  document.getElementById('p-sku').disabled = true;
  document.getElementById('p-name').value = p.name;
  document.getElementById('p-cat').value = p.category;
  document.getElementById('p-price').value = p.price;
  document.getElementById('p-stock').value = p.stock;
  document.getElementById('p-desc').value = p.description || '';
  // set image
  clearImg();
  if (p.img) {
    if (p.img.startsWith('data:')) {
      setImgValue(p.img);
    } else {
      document.getElementById('p-img-url').value = p.img;
      setImgValue(p.img);
    }
  }
  document.getElementById('product-modal').style.display = 'flex';
}

function closeModal() { document.getElementById('product-modal').style.display = 'none'; }

async function saveProduct() {
  const sku   = editingSku || document.getElementById('p-sku').value.trim().toUpperCase();
  const name  = document.getElementById('p-name').value.trim();
  const cat   = document.getElementById('p-cat').value;
  const price = parseFloat(document.getElementById('p-price').value);
  const stock = parseInt(document.getElementById('p-stock').value) || 0;
  const desc  = document.getElementById('p-desc').value.trim();
  const img   = document.getElementById('p-img-final').textContent.trim() ||
                document.getElementById('p-img-url').value.trim() || '';

  if (!sku || !name || !cat || isNaN(price)) { alert('Please fill in SKU, Name, Category, and Price.'); return; }

  try {
    const saved = await dbSaveProduct({ sku, name, category: cat, price, stock, img, description: desc });
    closeModal();
    await loadProducts();
    renderInventory();
    setStatus('☁ Saved — ' + products.length + ' products', 'ok');
  } catch(e) {
    alert('Save failed: ' + e.message);
  }
}

async function deleteProduct(sku) {
  if (!confirm('Delete ' + sku + '? This cannot be undone.')) return;
  try {
    await dbDeleteProduct(sku);
    await loadProducts();
    renderInventory();
  } catch(e) {
    alert('Delete failed: ' + e.message);
  }
}

// ── IMAGE HANDLING ────────────────────────────────────────

function setImgValue(val) {
  document.getElementById('p-img-final').textContent = val;
  const prev = document.getElementById('p-img-preview');
  if (val) {
    prev.src = val;
    prev.style.display = 'block';
    document.getElementById('drop-zone').classList.add('has-img');
    document.getElementById('drop-label').textContent = '✓ Image ready';
  }
}

function clearImg() {
  document.getElementById('p-img-final').textContent = '';
  document.getElementById('p-img-url').value = '';
  document.getElementById('p-img-preview').style.display = 'none';
  document.getElementById('p-img-preview').src = '';
  document.getElementById('drop-zone').classList.remove('has-img');
  document.getElementById('drop-label').textContent = '📁 Drag & drop image here or click to browse';
  document.getElementById('p-img-file').value = '';
}

function handleUrlInput() {
  const url = document.getElementById('p-img-url').value.trim();
  if (url) {
    document.getElementById('p-img-final').textContent = '';
    setImgValue(url);
  }
}

function handleImgDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) processImgFile(file);
}

function handleImgFile(input) {
  const file = input.files[0];
  if (file) processImgFile(file);
}

function processImgFile(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    // Compress
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const MAX = 600;
      let w = img.width, h = img.height;
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const data = canvas.toDataURL('image/jpeg', 0.75);
      document.getElementById('p-img-url').value = '';
      setImgValue(data);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ── REPORTS ──────────────────────────────────────────────

async function loadReports() {
  const el = document.getElementById('reports-body');
  el.innerHTML = '<div style="color:#666;padding:20px">Loading…</div>';
  try {
    const sales = await dbGetSales();
    if (!sales.length) { el.innerHTML = '<div class="empty-state"><span>📊</span>No sales yet</div>'; return; }
    el.innerHTML = sales.map(s => {
      const items = Array.isArray(s.items) ? s.items : [];
      return `<div class="report-card">
        <div class="report-ref">${s.sale_ref}</div>
        <div class="report-meta">${new Date(s.created_at).toLocaleString()} · ${s.cashier} · ${s.payment_method}</div>
        <div style="font-size:.8rem;color:#666;margin-top:6px">${items.map(i => i.name + ' ×' + i.qty).join(', ')}</div>
        <div class="report-total">Rs. ${Number(s.total).toLocaleString()}</div>
      </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<div class="empty-state"><span>⚠</span>Failed to load reports</div>';
  }
}
