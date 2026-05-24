// ═══════════════════════════════════
//  GOOGLE SHEETS API (same as store)
// ═══════════════════════════════════
const API_URL = 'https://script.google.com/macros/s/AKfycbzIyZ1-ov6XyOK5CCmwQ9bEoBYeQcxqYIEynk57uA_RQtKwI-FNHmbEy4yN0Nxt8Bt-4w/exec';

// ── In-memory cache for Sheets data ──
let _gsProducts = null;   // products from Google Sheets
let _gsSite     = null;   // site settings from Google Sheets
let _gsLoaded   = false;

// ── JSONP helper (mirrors store.html) ──
function jsonpFetch(action, params='') {
  return new Promise((resolve, reject) => {
    const cbName = '_poscb_' + action + '_' + Date.now();
    const script = document.createElement('script');
    const timeout = setTimeout(() => { delete window[cbName]; script.remove(); reject(new Error('Timeout')); }, 10000);
    window[cbName] = data => { clearTimeout(timeout); delete window[cbName]; script.remove(); data&&data.success?resolve(data.data):reject(new Error('API error: '+action)); };
    script.src = `${API_URL}?action=${action}${params}&callback=${cbName}`;
    script.onerror = () => { clearTimeout(timeout); delete window[cbName]; script.remove(); reject(new Error('Script load failed')); };
    document.head.appendChild(script);
  });
}
async function gsFetch(action, params='') {
  try {
    const res  = await fetch(`${API_URL}?action=${action}${params}`);
    const data = await res.json();
    if (data && data.success) return data.data;
  } catch(_) {}
  return jsonpFetch(action, params).catch(() => null);
}
// All writes go via JSONP GET — Google Apps Script blocks POST from browsers (CORS).
// We encode the payload as a base64 URL param so the Apps Script can decode it.
// Available actions: saveProducts, saveSale, saveSalesBatch, saveSiteSettings
async function gsPost(action, body) {
  return new Promise((resolve) => {
    const cbName = '_poscb_post_' + action + '_' + Date.now();
    const script = document.createElement('script');
    const timeout = setTimeout(() => {
      delete window[cbName]; script.remove();
      console.warn('[gsPost] Timeout after 18s for action:', action);
      resolve(null);
    }, 18000); // increased to 18s — Apps Script cold starts can be slow
    window[cbName] = data => {
      clearTimeout(timeout); delete window[cbName]; script.remove();
      resolve(data);
    };
    // Encode body as base64 so it survives URL encoding intact
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify(body))));
    const url = API_URL + '?action=' + action + '&payload=' + encodeURIComponent(payload) + '&callback=' + cbName;
    // Warn if URL is dangerously long (browser limit ~8000 chars)
    if (url.length > 7500) {
      console.warn('[gsPost] URL too long (' + url.length + ' chars) for action:', action, '— payload may be rejected');
    }
    script.src = url;
    script.onerror = () => { clearTimeout(timeout); delete window[cbName]; script.remove(); resolve(null); };
    document.head.appendChild(script);
  });
}

// ── Load products + site from Sheets ──
async function loadSheetsData() {
  showSyncStatus('syncing');
  try {
    const [products, site, users] = await Promise.all([
      gsFetch('getProducts'),
      gsFetch('getSiteSettings'),
      gsFetch('getUsers')
    ]);
    if (Array.isArray(products) && products.length) {
      // Normalize column names: Sheets returns capitalized headers (SKU, Name, ImageURL…)
      // Storing lowercase keys means resolveImg, SKU_IMG_MAP, and all other lookups work correctly.
      const normalized = products.map(p => ({
        sku      : p.sku      || p.SKU      || '',
        name     : p.name     || p.Name     || '',
        brand    : p.brand    || p.Brand    || '',
        category : p.category || p.Category || '',
        size     : p.size     || p.Size     || '',
        price    : Number(p.price    || p.Price)    || 0,
        cost     : Number(p.cost     || p.Cost)     || 0,
        stock    : Number(p.stock    || p.Stock)    || 0,
        minStock : Number(p.minStock || p.MinStock) || 5,
        desc     : p.desc || p.Description || '',
        img      : p.img  || p.ImageURL    || ''
      })).filter(p => p.sku);
      _gsProducts = normalized;
      set(K.products, normalized);
    }
    if (site && typeof site === 'object' && !Array.isArray(site)) {
      _gsSite = site;
      set(K.site, site);
    }
    // Map Sheets Users tab columns: Username, Password, Role, FullName, Active
    if (Array.isArray(users) && users.length) {
      const mapped = users
        .filter(u => String(u.Active).toUpperCase() === 'TRUE')
        .map(u => ({
          username: u.Username || u.username || '',
          password: u.Password || u.password || '',
          name:     u.FullName  || u.name     || u.Username || '',
          role:     (u.Role     || u.role     || 'cashier').toLowerCase()
        }))
        .filter(u => u.username);
      if (mapped.length) set(K.users, mapped);
    }
    _gsLoaded = true;
    showSyncStatus('ok');
    return true;
  } catch(e) {
    console.warn('Sheets sync failed:', e);
    showSyncStatus('error');
    return false;
  }
}

// ── Test Sheets connection ──
async function testSheetsConnection() {
  showToast('Testing connection to Google Sheets…', '');
  document.getElementById('inv-sheets-info').textContent = 'Testing connection…';
  try {
    const result = await gsFetch('getProducts');
    if (Array.isArray(result) && result.length) {
      showToast('✅ Connected! Sheets returned ' + result.length + ' products.', 'success');
      document.getElementById('inv-sheets-info').textContent = 'Connected ✅ — ' + result.length + ' products in Sheets';
    } else if (result !== null) {
      showToast('⚠ Sheets reachable but returned empty data.', 'error');
      document.getElementById('inv-sheets-info').textContent = 'Reachable but empty response';
    } else {
      showToast('❌ Cannot reach Google Sheets — check internet connection.', 'error');
      document.getElementById('inv-sheets-info').textContent = 'Cannot reach Sheets — check internet';
    }
  } catch(e) {
    showToast('❌ Connection failed: ' + e.message, 'error');
  }
}

// ── Push products back to Sheets ──
// Base64 images cannot go to Sheets (URL too long + Sheets can't render them).
// Strip data: URIs before sending — they stay in localStorage for POS display only.
async function pushProductsToSheets(products) {
  showSyncStatus('syncing');
  try {
    // Strip base64 images — Sheets can't render them and they bloat the URL
    const sheetsProds = products.map(p => ({
      ...p,
      img: (p.img && p.img.startsWith('http')) ? p.img : ''
    }));

    // CHUNKED SAVE — 23 products in one URL = ~12,000 chars → Google rejects it.
    // Send in batches of 14 max (~7,300 chars each, safely under the 8,000 char limit).
    const CHUNK = 14;
    const chunks = [];
    for (let i = 0; i < sheetsProds.length; i += CHUNK) {
      chunks.push(sheetsProds.slice(i, i + CHUNK));
    }

    for (let i = 0; i < chunks.length; i++) {
      const info = document.getElementById('inv-sheets-info');
      if (info) info.textContent = 'Saving ' + (i+1) + ' of ' + chunks.length + '…';

      const result = await gsPost('saveProducts', {
        products:    chunks[i],
        replaceAll:  i === 0,        // first chunk: clear sheet + write headers fresh
        chunkIndex:  i,
        totalChunks: chunks.length
      });

      if (!result)          throw new Error('Timeout on chunk ' + (i+1) + ' — check internet');
      if (!result.success)  throw new Error(result.error || 'Chunk ' + (i+1) + ' rejected by Sheets');
    }

    showSyncStatus('ok');
    return true;
  } catch(e) {
    console.warn('Push to Sheets failed:', e);
    showSyncStatus('error');
    return false;
  }
}

// ── Push site settings to Sheets ──
async function pushSiteToSheets(site) {
  showSyncStatus('syncing');
  try {
    const result = await gsPost('saveSiteSettings', { settings: site });
    if (result && result.success) { showSyncStatus('ok'); return true; }
    throw new Error('Save failed');
  } catch(e) {
    showSyncStatus('error');
    return false;
  }
}

function showSyncStatus(state) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  const map = { syncing:['⟳ Syncing…','#ca8a04'], ok:['☁ Synced','#16a34a'], error:['⚠ Offline','#dc2626'] };
  const [txt, color] = map[state] || map.ok;
  el.textContent = txt; el.style.color = color;
}

// ═══════════════════════════════════
//  STORAGE KEYS (localStorage = offline cache)
// ═══════════════════════════════════
const K = { products:'jj_products', sales:'elume_sales', config:'elume_config', users:'elume_users', site:'jj_site' };
const get = k => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };
const set = (k,v) => localStorage.setItem(k, JSON.stringify(v));
const getCfg  = () => { try { return JSON.parse(localStorage.getItem(K.config)) || {}; } catch { return {}; } };
const getSite = () => { try { return JSON.parse(localStorage.getItem(K.site)) || {}; } catch { return {}; } };

// ═══════════════════════════════════
//  SEED
// ═══════════════════════════════════
function seed() {
  // Users — seeded once, refreshed live from Google Sheets on login
  if (!localStorage.getItem(K.users)) set(K.users, [
    { username:'nora',     password:'nora',    name:'Noraliah',         role:'owner' },
    { username:'hamza',    password:'hamza',   name:'M. Hamza Javed',   role:'admin' },
    { username:'cashier1', password:'cashier', name:'Front Desk Staff', role:'cashier' },
  ]);
  // Store config
  if (!localStorage.getItem(K.config)) set(K.config, { name:'JJ Fabrics', address:'Sher Bahadur Plaza, K-Block, Near Dr. Ibadat Hospital, Main Bazar, Attock City', phone:'+92 314 5777344', vat:0 });
  // Site settings
  if (!localStorage.getItem(K.site)) set(K.site, {
    name:'JJ Fabrics', tagline:'Gents & Ladies Suiting Place', about:'We offer the finest selection of women\'s and men\'s fashion, from casual sundresses to formal gowns. Style for every occasion.',
    address:'Sher Bahadur Plaza, K-Block, Near Dr. Ibadat Hospital, Main Bazar, Attock City', phone:'923145777344', email:'jjfabrics@gmail.com',
    facebook:'https://facebook.com', instagram:'https://instagram.com',
    map:'', emoji:'👗', heroColor:'#0a0a0a', accentColor:'#D4A017',
    featured:[], publishedAt: null
  });

  // No default products — all products added manually via + Add Product
  if (!localStorage.getItem(K.sales)) set(K.sales, []);
}

// ═══════════════════════════════════
//  AUTH
// ═══════════════════════════════════
let CU = null; // current user

async function doLogin() {
  const u   = document.getElementById('login-user').value.trim();
  const p   = document.getElementById('login-pass').value;
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');

  if (!u || !p) { err.textContent = 'Enter username and password.'; err.style.display = 'block'; return; }
  err.style.display = 'none';
  btn.textContent = 'Signing in…'; btn.disabled = true;

  // ── Step 1: Try to fetch latest users from Google Sheets ──
  // This ensures Sheets passwords always take priority over the local cache.
  try {
    const data = await gsFetch('getUsers');
    if (Array.isArray(data) && data.length) {
      const mapped = data
        .filter(u => String(u.Active).toUpperCase() === 'TRUE')
        .map(u => ({
          username: u.Username || '', password: u.Password || '',
          name: u.FullName || u.Username || '', role: (u.Role || 'cashier').toLowerCase()
        }))
        .filter(u => u.username);
      if (mapped.length) set(K.users, mapped); // update local cache with live Sheets data
    }
  } catch(_) {
    // Network unavailable — fall through and use cached users
  }

  // ── Step 2: Validate against (now-fresh) local cache ──
  const user = get(K.users).find(x => x.username === u && x.password === p);
  btn.textContent = 'Sign In →'; btn.disabled = false;

  if (!user) {
    err.textContent = 'Invalid username or password.';
    err.style.display = 'block';
    return;
  }

  // ── Step 3: Open the app ──
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
  if (user.role === 'owner' || user.role === 'admin') {
    document.getElementById('nav-website').style.display = 'none';
  }
  // Show owner-only dashboard controls
  const resetBtn = document.getElementById('dash-reset-btn');
  if (resetBtn) resetBtn.style.display = user.role === 'owner' ? '' : 'none';
  showPage('dashboard');

  // ── Step 4: Load products + site settings in background ──
  loadSheetsData().then(ok => {
    if (ok) { refreshDashboard(); renderProducts(); }
  });
}
document.addEventListener('keydown', e => {
  if (e.key==='Enter' && document.getElementById('login-screen').style.display!=='none') doLogin();
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

// ═══════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════
function showPage(p) {
  document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
  document.getElementById(p + '-page').classList.add('active');
  document.querySelector(`.nav-item[data-page="${p}"]`)?.classList.add('active');
  const fns = { dashboard: refreshDashboard, pos: renderProducts, inventory: renderInventory,
                sales: () => { setDefaultDates(); renderSales(); }, reports: renderReports,
                settings: renderSettings, website: renderWebsiteEditor };
  fns[p]?.();
}

// ═══════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════
// ═══════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════
function syncDashboard() {
  const btn = document.getElementById('dash-sync-btn');
  if (btn) { btn.textContent = '⟳ Syncing…'; btn.disabled = true; }
  loadSheetsData().then(ok => {
    refreshDashboard(); renderProducts();
    if (btn) { btn.textContent = '⟳ Refresh Data'; btn.disabled = false; }
    showToast(ok ? 'Dashboard refreshed from Sheets ✅' : 'Refreshed from local cache (offline)', ok ? 'success' : 'warning');
  });
}

function ownerResetData() {
  if (CU.role !== 'owner') { showToast('Owner only!', 'error'); return; }
  if (!confirm('⚠️ RESET TO CLEAN START?\n\nThis will permanently delete:\n• All sales records\n• All products/inventory\n\nUser accounts and site settings will be KEPT.\n\nThis cannot be undone. Continue?')) return;
  localStorage.removeItem(K.sales);
  localStorage.removeItem(K.products);
  set(K.sales, []);
  set(K.products, []);
  refreshDashboard(); renderProducts();
  if (document.getElementById('inv-tbody')) renderInventory();
  showToast('Reset complete — clean start ✅', 'success');
}

function refreshDashboard() {
  const now = new Date();
  document.getElementById('dash-date').textContent = now.toLocaleDateString('en-PH',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const sales = get(K.sales).filter(s=>!s.voided), prods = get(K.products);
  const today = now.toLocaleDateString('en-CA'), month = now.toISOString().slice(0,7);
  const td = sales.filter(s=>s.date.startsWith(today)), mo = sales.filter(s=>s.date.startsWith(month));
  const fmt = n => 'Rs. '+n.toLocaleString('en-PH',{minimumFractionDigits:2});
  document.getElementById('dash-today-sales').textContent = fmt(td.reduce((a,s)=>a+s.total,0));
  document.getElementById('dash-today-txn').textContent   = td.length + ' transactions';
  document.getElementById('dash-month-sales').textContent = fmt(mo.reduce((a,s)=>a+s.total,0));
  document.getElementById('dash-month-txn').textContent   = mo.length + ' transactions';
  document.getElementById('dash-products').textContent    = prods.length;
  const low = prods.filter(p=>p.stock>0&&p.stock<=p.minStock), out=prods.filter(p=>p.stock===0);
  document.getElementById('dash-low-stock').textContent   = low.length + ' low stock';
  document.getElementById('dash-alerts').textContent      = low.length + out.length;
  const al = [...out,...low];
  document.getElementById('dash-alerts-list').innerHTML = al.length
    ? al.map(p=>`<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--gray-50);font-size:12px;"><span style="font-weight:500;">${p.name}</span><span class="badge ${p.stock===0?'out-stock':'low-stock'}">${p.stock===0?'Out':p.stock+' left'}</span></div>`).join('')
    : '<p style="font-size:13px;color:var(--gray-400);">✅ All stock levels OK</p>';
  const rec = [...sales].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,6);
  document.getElementById('dash-recent-list').innerHTML = rec.length
    ? rec.map(s=>`<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--gray-50);font-size:12px;"><span><strong>${s.txnNum}</strong> · ${s.customer}</span><span style="font-weight:700;color:var(--gold-600);">${fmt(s.total)}</span></div>`).join('')
    : '<p style="font-size:13px;color:var(--gray-400);">No transactions yet.</p>';
  renderDashChart();
}

// ═══════════════════════════════════
//  POS
// ═══════════════════════════════════
let cart = [];
const catEmoji = {"Ladies Suits":'👘',"Gents Wear":'👔','Accessories':'💎','Kids':'👦'};

// ── Null-safe DOM helpers ──
function posEl(id)        { return document.getElementById(id); }
function posText(id, val) { const e=posEl(id); if(e) e.textContent=val; }
function posHtml(id, val) { const e=posEl(id); if(e) e.innerHTML=val; }

// ── Image resolver: maps SKU → local image file as fallback when Sheets img is empty ──
const SKU_IMG_MAP = {
  'BN-1075':'image/p1.jpeg',
  'BN-1000':'image/p2.jpeg',
  'BN-1056':'image/p3.jpeg',
  'BN-1060':'image/p4.jpeg',
  'BN-1025':'image/p5.jpeg',
  'BN-1053':'image/p6.jpeg',
  'BN-1059':'image/p7.jpeg',
  'PS-001':'image/ps1.jpeg',
  'PS-002':'image/ps2.jpeg',
  'PS-003':'image/ps3.jpeg',
  'PS-004':'image/ps4.jpeg',
  'PS-005':'image/ps5.jpeg',
  'PS-006':'image/ps6.jpeg',
  'PS-007':'image/ps7.jpeg'
};
function resolveImg(p) {
  const imgVal = p.img || p.ImageURL || '';
  if (imgVal && imgVal.trim()) return imgVal.trim();
  const sku = p.sku || p.SKU || '';
  if (SKU_IMG_MAP[sku]) return SKU_IMG_MAP[sku];
  return '';
}

function renderProducts() {
  const q = document.getElementById('pos-search').value.toLowerCase();
  const c = document.getElementById('pos-cat').value;
  const prods = get(K.products).filter(p=>(!q||p.name.toLowerCase().includes(q)||p.sku.toLowerCase().includes(q))&&(!c||p.category===c));
  const grid = document.getElementById('product-grid');
  if (!prods.length) { grid.innerHTML='<p style="grid-column:1/-1;font-size:13px;color:var(--gray-400);">No products found.</p>'; return; }
  grid.innerHTML = prods.map(p=>{
    const isOut=p.stock===0, isLow=p.stock>0&&p.stock<=p.minStock;
    const emoji = catEmoji[p.category]||'🛍️';
    const resolvedImg = resolveImg(p);
    const imgHtml = resolvedImg
      ? `<img src="${resolvedImg}" alt="${p.name}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:8px;display:block;" onerror="this.parentNode.innerHTML='<span style=font-size:32px>${emoji}</span>'">`
      : `<span style="font-size:32px;">${emoji}</span>`;
    return `<div class="product-card ${isOut?'out-of-stock':''}" data-sku="${p.sku}" ${isOut?'':'style="cursor:pointer;"'}>
      ${isLow?'<span class="stock-badge low">Low</span>':''}${isOut?'<span class="stock-badge out">Out</span>':''}
      <div class="pc-img">${imgHtml}</div>
      <div class="pc-name">${p.name}</div>
      <div class="pc-price">Rs. ${Number(p.price).toLocaleString()}</div>
      <div class="pc-stock">${p.size} · ${p.stock} in stock</div>
    </div>`;
  }).join('');
  // Attach click handler fresh each time grid is rendered
  grid.onclick = function(e) {
    const card = e.target.closest('.product-card[data-sku]');
    if (!card || card.classList.contains('out-of-stock')) return;
    addToCart(card.dataset.sku);
  };
}

function addToCart(sku) {
  const p = get(K.products).find(x=>x.sku===sku);
  if (!p||p.stock===0) return;
  const ex = cart.find(c=>c.sku===sku);
  if (ex) { if(ex.qty>=p.stock){showToast('Max stock reached!','error');return;} ex.qty++; }
  else cart.push({sku:p.sku,name:p.name,price:p.price,qty:1,maxStock:p.stock});
  renderCart(); showToast(p.name+' added ✓','success');
}

function renderCart() {
  const total = cart.reduce((a,c)=>a+c.qty,0);
  document.getElementById('cart-count').textContent = total;
  const box = document.getElementById('cart-items');
  if (!cart.length) {
    box.innerHTML='<div class="cart-empty"><div class="empty-icon">🛍️</div><p>Cart is empty</p></div>';
    document.getElementById('cash-calc').style.display='none';
    updateCartTotals(); return;
  }
  document.getElementById('cash-calc').style.display='block';
  box.innerHTML = cart.map((it,i)=>`
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
      <div class="ci-total">Rs. ${(it.qty*it.price).toLocaleString()}</div>
      <button class="remove-btn" onclick="rmCart(${i})">✕</button>
    </div>`).join('');
  updateCartTotals();
}
function calcChange(){
  const sub=cart.reduce((a,c)=>a+c.qty*c.price,0), disc=getDisc(sub);
  const cfg=getCfg(), total=Math.max(0,sub-disc+(sub-disc)*(cfg.vat/100));
  const tendered=parseFloat(document.getElementById('cash-tendered').value)||0;
  const change=tendered-total;
  document.getElementById('cash-change').textContent='Rs. '+(change>=0?change:0).toLocaleString('en-PH',{minimumFractionDigits:2});
  document.getElementById('cash-change').style.color=change<0?'var(--red)':'var(--green)';
}

function chQty(i,d){ cart[i].qty+=d; if(cart[i].qty<=0)cart.splice(i,1); else if(cart[i].qty>cart[i].maxStock)cart[i].qty=cart[i].maxStock; renderCart(); }
function rmCart(i){ cart.splice(i,1); renderCart(); }
function clearCart(){
  cart=[];
  document.getElementById('customer-name').value='';
  document.getElementById('discount-val').value='';
  document.getElementById('cash-tendered').value='';
  document.getElementById('cash-calc').style.display='none';
  renderCart();
}

function getDisc(sub){ const v=parseFloat(document.getElementById('discount-val').value)||0, t=document.getElementById('discount-type').value; return t==='pct'?sub*(v/100):v; }

function updateCartTotals(){
  const sub=cart.reduce((a,c)=>a+c.qty*c.price,0), disc=getDisc(sub), total=Math.max(0,sub-disc);
  const fmt=n=>'Rs. '+n.toLocaleString('en-PH',{minimumFractionDigits:2});
  document.getElementById('cart-subtotal').textContent=fmt(sub);
  document.getElementById('cart-discount').textContent=fmt(disc);
  document.getElementById('cart-total').textContent=fmt(total);
}

function checkout(method){
  if(!cart.length){showToast('Cart is empty!','error');return;}
  const sub=cart.reduce((a,c)=>a+c.qty*c.price,0), disc=getDisc(sub);
  const cfg=getCfg(), vat=(sub-disc)*(cfg.vat/100), total=sub-disc+vat;
  const txnNum=nextTxnNum(), now=new Date();
  const customer=document.getElementById('customer-name').value.trim()||'Walk-in';
  const sale={txnNum,date:now.toISOString(),customer,items:JSON.parse(JSON.stringify(cart)),subtotal:sub,discount:disc,vat,total,payment:method,cashier:CU.name};
  const sales=get(K.sales); sales.push(sale); set(K.sales,sales);
  const prods=get(K.products);
  cart.forEach(c=>{const p=prods.find(x=>x.sku===c.sku);if(p)p.stock=Math.max(0,p.stock-c.qty);});
  set(K.products,prods);
  if(method==='cash') showInvoice(sale);
  else showToast('Card payment recorded ✅','success');
  clearCart(); renderProducts(); refreshDashboard();
  showToast(txnNum+' completed!','success');
  // Sync both stock deductions AND the sale record to Google Sheets
  pushProductsToSheets(prods);
  gsPost('saveSale', {
    sale: { cashier: sale.cashier, total: sale.subtotal, discount: sale.discount,
            grandTotal: sale.total, payment: method, notes: sale.customer },
    items: sale.items.map(i => ({ sku: i.sku, name: i.name, brand: '', qty: i.qty, unitPrice: i.price }))
  });
}

// ═══════════════════════════════════
//  INVOICE
// ═══════════════════════════════════
function showInvoice(sale){
  const cfg=getCfg();
  document.getElementById('inv-store-name').textContent=cfg.name||'JJ Fabrics';
  document.getElementById('inv-store-name2').textContent=cfg.name||'JJ Fabrics';
  document.getElementById('inv-store-addr').textContent=cfg.address||'';
  document.getElementById('inv-store-phone').textContent=cfg.phone||'';
  document.getElementById('inv-num').textContent=sale.txnNum;
  document.getElementById('inv-date').textContent=new Date(sale.date).toLocaleString('en-PH');
  document.getElementById('inv-customer').textContent=sale.customer;
  document.getElementById('inv-cashier').textContent=sale.cashier;
  document.getElementById('inv-subtotal').textContent='Rs. '+sale.subtotal.toFixed(2);
  document.getElementById('inv-discount').textContent=sale.discount>0?'-Rs. '+sale.discount.toFixed(2):'Rs. 0.00';
  document.getElementById('inv-vat-label').textContent=`VAT (${cfg.vat||0}%)`;
  document.getElementById('inv-vat').textContent='Rs. '+(sale.vat||0).toFixed(2);
  document.getElementById('inv-grand').textContent='Rs. '+sale.total.toFixed(2);
  document.getElementById('inv-items').innerHTML=sale.items.map(i=>`<tr><td>${i.name}</td><td>${i.qty}</td><td>Rs. ${Number(i.price).toFixed(2)}</td><td>Rs. ${(i.qty*i.price).toFixed(2)}</td></tr>`).join('');
  // Cash tendered & change
  const tendered=parseFloat(document.getElementById('cash-tendered')?.value)||0;
  if(sale.payment==='cash'&&tendered>0){
    document.getElementById('inv-tendered-row').style.display='flex';
    document.getElementById('inv-change-row').style.display='flex';
    document.getElementById('inv-tendered').textContent='Rs. '+tendered.toFixed(2);
    document.getElementById('inv-change-amt').textContent='Rs. '+Math.max(0,tendered-sale.total).toFixed(2);
  } else {
    document.getElementById('inv-tendered-row').style.display='none';
    document.getElementById('inv-change-row').style.display='none';
  }
  openModal('invoice-modal');
}

// ═══════════════════════════════════
//  INVENTORY
// ═══════════════════════════════════
function syncFromSheets() {
  showToast('Syncing from Google Sheets…', '');
  loadSheetsData().then(ok => {
    if (ok) { renderInventory(); renderProducts(); refreshDashboard(); showToast('Synced from Sheets ✅', 'success'); }
    else showToast('⚠ Sync failed — using cached data', 'error');
  });
}

function renderInventory(){
  const q=document.getElementById('inv-search').value.toLowerCase();
  const c=document.getElementById('inv-cat').value, s=document.getElementById('inv-status').value;
  const prods=get(K.products).filter(p=>{
    const mq=!q||p.name.toLowerCase().includes(q)||p.sku.toLowerCase().includes(q);
    const mc=!c||p.category===c;
    const ms=!s||(s==='in'&&p.stock>p.minStock)||(s==='low'&&p.stock>0&&p.stock<=p.minStock)||(s==='out'&&p.stock===0);
    return mq&&mc&&ms;
  });
  const alerts=prods.filter(p=>p.stock<=p.minStock);
  document.getElementById('inv-alerts').innerHTML=alerts.length?`<div class="alert-box warning">⚠️ <div><strong>${alerts.length} item(s) need restocking:</strong> ${alerts.map(a=>a.name).join(', ')}</div></div>`:'';
  const canEdit=CU&&CU.role!=='cashier';
  document.getElementById('inv-tbody').innerHTML=prods.map(p=>{
    const sc=p.stock===0?'out-stock':p.stock<=p.minStock?'low-stock':'in-stock';
    const sl=p.stock===0?'Out of Stock':p.stock<=p.minStock?'Low Stock':'In Stock';
    const emoji=catEmoji[p.category]||'🛍️';
    const thumb=resolveImg(p);
    const thumbHtml=thumb
      ?`<img src="${thumb}" style="width:36px;height:36px;object-fit:cover;border-radius:6px;flex-shrink:0;" onerror="this.outerHTML='<span style=font-size:20px>${emoji}</span>'">`
      :`<span style="font-size:20px;">${emoji}</span>`;
    return`<tr>
      <td><code>${p.sku}</code></td>
      <td><div style="display:flex;align-items:center;gap:10px;">${thumbHtml}<div><strong>${p.name}</strong><br><span style="font-size:11px;color:var(--gray-400);">${p.desc||''}</span></div></div></td>
      <td>${p.category}</td><td>${p.size}</td>
      <td style="font-weight:700;">Rs. ${Number(p.price).toLocaleString()}</td>
      <td style="color:var(--gray-400);">Rs. ${Number(p.cost).toLocaleString()}</td>
      <td><strong>${p.stock}</strong></td><td>${p.minStock}</td>
      <td><span class="badge ${sc}">${sl}</span></td>
      <td style="white-space:nowrap;">${canEdit?`<button class="btn btn-outline btn-sm" onclick="openEditProduct('${p.sku}')">Edit</button> <button class="btn btn-green btn-sm" onclick="openRestock('${p.sku}')">+Stock</button> <button class="btn btn-danger btn-sm" onclick="delProduct('${p.sku}')">Del</button>`:'—'}</td>
    </tr>`;
  }).join('');
}

// ═══════════════════════════════════
//  IMAGE FIELD HELPERS
// ═══════════════════════════════════
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
  else { document.getElementById('p-img-preview').style.display = 'none'; }
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
  if (label) label.innerHTML = '🖼 Drag &amp; drop photo here, or <span style="color:var(--gold);font-weight:700;">click to browse</span>';
}
function _setModalImg(val) {
  // Called by openEditProduct to pre-fill image
  document.getElementById('p-img-final').value = val || '';
  if (val && val.startsWith('http')) {
    document.getElementById('p-img').value = val;
    setImgPreview(val);
  } else if (val && val.startsWith('data:')) {
    setImgPreview(val);
  } else {
    clearImgField();
  }
}

// ═══════════════════════════════════
//  LOAD ALL DEFAULTS → PUSH TO SHEETS
// ═══════════════════════════════════


function openAddProduct(){
  if(CU.role==='cashier'){showToast('Access denied','error');return;}
  document.getElementById('product-modal-title').textContent='Add Product';
  document.getElementById('edit-sku-orig').value='';
  ['p-sku','p-name','p-size','p-desc','p-img'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  ['p-price','p-cost','p-stock','p-minstock'].forEach(id=>document.getElementById(id).value='');
  clearImgField();
  openModal('product-modal');
}
function openEditProduct(sku){
  const p=get(K.products).find(x=>x.sku===sku); if(!p)return;
  document.getElementById('product-modal-title').textContent='Edit Product';
  document.getElementById('edit-sku-orig').value=sku;
  document.getElementById('p-sku').value=p.sku; document.getElementById('p-name').value=p.name;
  document.getElementById('p-cat').value=p.category; document.getElementById('p-size').value=p.size;
  document.getElementById('p-price').value=p.price; document.getElementById('p-cost').value=p.cost;
  document.getElementById('p-stock').value=p.stock; document.getElementById('p-minstock').value=p.minStock;
  document.getElementById('p-desc').value=p.desc||'';
  _setModalImg(p.img||'');
  openModal('product-modal');
}
// Live preview on URL input (DOMContentLoaded event no longer needed — handled inline)
function saveProduct(pushNow=false){
  const sku=document.getElementById('p-sku').value.trim(), name=document.getElementById('p-name').value.trim();
  if(!sku||!name){showToast('SKU and Name required!','error');return;}
  const orig=document.getElementById('edit-sku-orig').value;
  const prods=get(K.products);
  const np={sku,name,category:document.getElementById('p-cat').value,size:document.getElementById('p-size').value.trim(),
    price:parseFloat(document.getElementById('p-price').value)||0,cost:parseFloat(document.getElementById('p-cost').value)||0,
    stock:parseInt(document.getElementById('p-stock').value)||0,minStock:parseInt(document.getElementById('p-minstock').value)||5,
    desc:document.getElementById('p-desc').value.trim(),img:document.getElementById('p-img-final').value.trim()};
  if(orig){const i=prods.findIndex(p=>p.sku===orig);if(i>=0)prods[i]=np;else prods.push(np);}
  else{if(prods.find(p=>p.sku===sku)){showToast('SKU already exists!','error');return;}prods.push(np);}
  set(K.products,prods);
  markInvPending();
  closeModal('product-modal'); renderInventory(); renderProducts();
  if (pushNow) {
    showToast('Saving to Sheets…', '');
    setInvSaveState('saving');
    pushProductsToSheets(prods).then(ok => {
      if(ok){ showToast('Product saved & pushed to Sheets ✅','success'); setInvSaveState('synced'); addSaveLog('inventory','Products saved to Sheets','ok'); }
      else  { showToast('⚠ Saved locally — Sheets push failed. Use "Save to Sheets" button.','error'); setInvSaveState('error'); addSaveLog('inventory','Products push failed','fail'); }
    });
  } else {
    showToast('Product saved locally 💾 — click "Save to Sheets" to sync','');
    setInvSaveState('pending');
  }
}
function delProduct(sku){
  if(!confirm('Delete this product? This will also remove it from Google Sheets.'))return;
  const prods = get(K.products).filter(p=>p.sku!==sku);
  set(K.products, prods);
  markInvPending();
  renderInventory();
  setInvSaveState('saving');
  pushProductsToSheets(prods).then(ok => {
    if(ok){ showToast('Product deleted & Sheets updated ✅','success'); setInvSaveState('synced'); addSaveLog('delete','Product '+sku+' deleted from Sheets','ok'); }
    else  { showToast('⚠ Deleted locally — Sheets push failed. Use "Save to Sheets" button.','error'); setInvSaveState('error'); addSaveLog('delete','Delete '+sku+' — push failed','fail'); }
  });
}

// ═══════════════════════════════════
//  SALES
// ═══════════════════════════════════
function setDefaultDates(){
  const now=new Date(), from=new Date(now.getFullYear(),now.getMonth(),1);
  document.getElementById('sales-from').value=from.toLocaleDateString('en-CA');
  document.getElementById('sales-to').value=now.toLocaleDateString('en-CA');
}
// Sale lookup map — keyed by txnNum, rebuilt on every renderSales call
let _salesMap = {};

function viewSaleByTxn(txnNum) {
  const s = _salesMap[txnNum];
  if (s) showInvoice(s);
}

function renderSales(){
  const isOwner = CU && CU.role === 'owner';
  document.getElementById('sales-void-th').style.display = isOwner ? '' : 'none';
  const clearBtn = document.getElementById('clear-all-sales-btn');
  if (clearBtn) clearBtn.style.display = isOwner ? '' : 'none';

  const from=document.getElementById('sales-from').value, to=document.getElementById('sales-to').value, pay=document.getElementById('sales-pay').value;
  const allSales = get(K.sales);

  // Rebuild lookup map with ALL sales (unfiltered) so View always works
  _salesMap = {};
  allSales.forEach(s => { _salesMap[s.txnNum] = s; });

  const sales = allSales.filter(s=>{const d=s.date.slice(0,10);return(!from||d>=from)&&(!to||d<=to)&&(!pay||s.payment===pay);}).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const fmt=n=>'Rs. '+n.toLocaleString('en-PH',{minimumFractionDigits:2});
  document.getElementById('sales-tbody').innerHTML=sales.length
    ?sales.map(s=>{
      const voided = !!s.voided;
      const payBadge = voided ? 'voided' : s.payment;
      const payLabel = voided ? 'VOIDED' : s.payment.toUpperCase();
      const ownerBtns = isOwner ? `
        ${voided
          ? `<button class="btn btn-outline btn-sm" onclick="unvoidSale('${s.txnNum}')" title="Restore this record">↩ Restore</button>`
          : `<button class="btn-void" onclick="voidSale('${s.txnNum}')">⊘ Void</button>`}
        <button class="btn btn-danger btn-sm" onclick="deleteSale('${s.txnNum}')" title="Permanently delete record" style="margin-left:4px;">🗑</button>
      ` : '';
      return `<tr class="${voided?'void-row':''}">
        <td><code>${s.txnNum}</code>${voided?`<br><span style="font-size:10px;color:var(--red);font-weight:700;" title="${s.voidReason||''}">VOID${s.voidReason?' · '+s.voidReason.substring(0,24)+(s.voidReason.length>24?'…':''):''}</span>`:''}</td>
        <td>${new Date(s.date).toLocaleString('en-PH')}</td>
        <td>${s.customer}</td>
        <td>${s.items.length} item(s)</td>
        <td><span class="badge ${payBadge}">${payLabel}</span></td>
        <td style="color:var(--green);">${s.discount>0?'-'+fmt(s.discount):'—'}</td>
        <td style="font-weight:700;color:${voided?'var(--red)':'var(--gold-600)'};">${voided?'<s>'+fmt(s.total)+'</s>':fmt(s.total)}</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-outline btn-sm" onclick="viewSaleByTxn('${s.txnNum}')">👁 View</button>
          <button class="sheets-inline-btn" style="margin-left:4px;" onclick="repushSale('${s.txnNum}')" title="Re-send this transaction to Google Sheets">☁ Push</button>
        </td>
        ${isOwner?`<td style="white-space:nowrap;">${ownerBtns}</td>`:''}
      </tr>`;
    }).join('')
    :'<tr><td colspan="9" style="text-align:center;color:var(--gray-400);padding:24px;">No sales in this date range.</td></tr>';
}

// ═══════════════════════════════════
//  VOID (Owner only)
// ═══════════════════════════════════
function voidSale(txnNum) {
  if (CU.role !== 'owner') { showToast('Only the owner can void sales!', 'error'); return; }
  openVoidConfirm(txnNum, false);
}
function unvoidSale(txnNum) {
  if (CU.role !== 'owner') { showToast('Only the owner can restore sales!', 'error'); return; }
  openVoidConfirm(txnNum, true);
}
function openVoidConfirm(txnNum, isRestore) {
  const sales = get(K.sales);
  const sale = sales.find(s => s.txnNum === txnNum);
  if (!sale) return;
  document.getElementById('void-txn-num').textContent = txnNum;
  document.getElementById('void-customer').textContent = sale.customer;
  document.getElementById('void-total').textContent = 'Rs. ' + Number(sale.total).toLocaleString('en-PH', {minimumFractionDigits:2});
  document.getElementById('void-action-label').textContent = isRestore ? 'RESTORE' : 'VOID';
  document.getElementById('void-confirm-btn').textContent = isRestore ? '↩ Yes, Restore Record' : '⊘ Yes, Void Transaction';
  document.getElementById('void-confirm-btn').className = isRestore ? 'btn btn-green' : 'btn btn-danger';
  document.getElementById('void-confirm-btn').onclick = () => doVoid(txnNum, isRestore);
  document.getElementById('void-restore-note').style.display = isRestore ? 'block' : 'none';
  document.getElementById('void-warn-note').style.display = isRestore ? 'none' : 'block';
  const reasonEl = document.getElementById('void-reason');
  if (reasonEl) reasonEl.value = '';
  openModal('void-modal');
}
function doVoid(txnNum, isRestore) {
  if (CU.role !== 'owner') { showToast('Access denied', 'error'); return; }
  if (!isRestore) {
    const reason = (document.getElementById('void-reason').value || '').trim();
    if (!reason) { showToast('Please enter a reason for voiding.', 'error'); return; }
  }
  const sales = get(K.sales);
  const idx = sales.findIndex(s => s.txnNum === txnNum);
  if (idx < 0) return;
  const sale = sales[idx];
  if (!isRestore) {
    const reason = document.getElementById('void-reason').value.trim();
    sales[idx].voided = true;
    sales[idx].voidedAt = new Date().toISOString();
    sales[idx].voidedBy = CU.name;
    sales[idx].voidReason = reason;
    const prods = get(K.products);
    sale.items.forEach(it => {
      const p = prods.find(x => x.sku === it.sku);
      if (p) p.stock = (p.stock || 0) + it.qty;
    });
    set(K.products, prods);
    renderProducts(); refreshDashboard();
    showToast(txnNum + ' voided — stock restored ✅', 'success');
  } else {
    delete sales[idx].voided;
    delete sales[idx].voidedAt;
    delete sales[idx].voidedBy;
    delete sales[idx].voidReason;
    const prods = get(K.products);
    sale.items.forEach(it => {
      const p = prods.find(x => x.sku === it.sku);
      if (p) p.stock = Math.max(0, (p.stock || 0) - it.qty);
    });
    set(K.products, prods);
    renderProducts(); refreshDashboard();
    showToast(txnNum + ' restored ✅', 'success');
  }
  set(K.sales, sales);
  closeModal('void-modal');
  renderSales();
}

function deleteSale(txnNum) {
  if (CU.role !== 'owner') { showToast('Only the owner can delete records!', 'error'); return; }
  const sales = get(K.sales);
  const sale = sales.find(s => s.txnNum === txnNum);
  if (!sale) return;
  const fmt = n => 'Rs. ' + Number(n).toLocaleString('en-PH', {minimumFractionDigits:2});

  // Build confirm modal content
  document.getElementById('void-txn-num').textContent = txnNum;
  document.getElementById('void-customer').textContent = sale.customer;
  document.getElementById('void-total').textContent = fmt(sale.total);
  document.getElementById('void-action-label').textContent = 'DELETE';
  document.getElementById('void-confirm-btn').textContent = '🗑 Yes, Permanently Delete';
  document.getElementById('void-confirm-btn').className = 'btn btn-danger';
  document.getElementById('void-confirm-btn').onclick = () => doDeleteSale(txnNum);
  document.getElementById('void-restore-note').style.display = 'none';
  document.getElementById('void-warn-note').innerHTML = `
    🗑️ <strong>Permanently deleting this record will:</strong><br>
    • Remove it completely from Sales History<br>
    • It will <strong>NOT</strong> be recoverable<br>
    • Stock will <strong>NOT</strong> be automatically restored<br>
    <span style="color:var(--gray-700);font-weight:600;">Tip: Use ⊘ Void instead if you may need to undo this.</span>`;
  document.getElementById('void-warn-note').style.display = 'block';
  openModal('void-modal');
}
function doDeleteSale(txnNum) {
  if (CU.role !== 'owner') { showToast('Access denied', 'error'); return; }
  const sales = get(K.sales).filter(s => s.txnNum !== txnNum);
  set(K.sales, sales);
  closeModal('void-modal');
  renderSales(); refreshDashboard();
  showToast(txnNum + ' permanently deleted 🗑', 'success');
}

// Clear ALL sales — owner only (for trial/testing)
function clearAllSales() {
  if (CU.role !== 'owner') { showToast('Only the owner can do this!', 'error'); return; }
  if (!confirm('⚠️ DELETE ALL SALES RECORDS?\n\nThis cannot be undone. Stock levels will NOT be restored.\n\nType OK to confirm.')) return;
  set(K.sales, []);
  renderSales(); refreshDashboard();
  showToast('All sales records cleared 🗑', 'success');
}

// ═══════════════════════════════════
//  REPORTS
// ═══════════════════════════════════
function switchReport(id,el){
  ['sales-report','inv-report'].forEach(r=>document.getElementById(r).style.display='none');
  document.getElementById(id).style.display='block';
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
}
function renderReports(){
  const now = new Date();
  const fmt = n => 'Rs. ' + n.toLocaleString('en-PH', {minimumFractionDigits:0});

  // Set date defaults only on first load (when both are empty)
  const fromEl = document.getElementById('rpt-from');
  const toEl   = document.getElementById('rpt-to');
  if (!fromEl.value && !toEl.value) {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    fromEl.value = monthStart.toLocaleDateString('en-CA');
    toEl.value   = now.toLocaleDateString('en-CA');
  }
  const from = fromEl.value;
  const to   = toEl.value;

  const allSales = get(K.sales).filter(s=>!s.voided);
  const prods    = get(K.products);

  // Filter sales by selected date range
  const sales = allSales.filter(s => {
    const d = s.date.slice(0, 10);
    return (!from || d >= from) && (!to || d <= to);
  });

  // ── Sales summary cards ──
  const totalRev  = sales.reduce((a,s) => a + s.total, 0);
  const cashRev   = sales.filter(s => s.payment==='cash').reduce((a,s) => a + s.total, 0);
  const cardRev   = sales.filter(s => s.payment==='card').reduce((a,s) => a + s.total, 0);
  const avgOrder  = sales.length ? totalRev / sales.length : 0;
  const totalDisc = sales.reduce((a,s) => a + (s.discount||0), 0);
  document.getElementById('report-mini').innerHTML = `
    <div class="mini-stat"><div class="label">Revenue (Range)</div><div class="value">${fmt(totalRev)}</div></div>
    <div class="mini-stat"><div class="label">Total Orders</div><div class="value">${sales.length}</div></div>
    <div class="mini-stat"><div class="label">Avg Order Value</div><div class="value">${fmt(avgOrder)}</div></div>
    <div class="mini-stat"><div class="label">Cash Sales</div><div class="value">${fmt(cashRev)}</div></div>
    <div class="mini-stat"><div class="label">Card Sales</div><div class="value">${fmt(cardRev)}</div></div>
    <div class="mini-stat"><div class="label">Total Discounts</div><div class="value">${fmt(totalDisc)}</div></div>`;

  // ── Top selling products (within date range) ──
  const ps = {};
  sales.forEach(s => s.items.forEach(it => {
    if (!ps[it.name]) ps[it.name] = {units:0, rev:0, cat:''};
    ps[it.name].units += it.qty;
    ps[it.name].rev   += it.qty * it.price;
  }));
  prods.forEach(p => { if (ps[p.name]) ps[p.name].cat = p.category; });
  const top = Object.entries(ps).sort((a,b) => b[1].rev - a[1].rev).slice(0, 15);
  document.getElementById('report-top').innerHTML = top.length
    ? top.map(([n,d],i) => `<tr>
        <td style="color:var(--gray-400);font-weight:700;">#${i+1}</td>
        <td>${n}</td><td>${d.cat||'—'}</td><td>${d.units}</td>
        <td style="font-weight:700;color:var(--gold-600);">Rs. ${d.rev.toLocaleString('en-PH',{minimumFractionDigits:2})}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" style="text-align:center;color:var(--gray-400);padding:16px;">No sales in this period.</td></tr>';

  // ── Inventory report — also filtered: show products sold in range + all products ──
  // Filter prods sold in this range (for highlighting), but always show all inventory
  const soldSkus = new Set();
  sales.forEach(s => s.items.forEach(it => soldSkus.add(it.sku)));

  document.getElementById('report-inv').innerHTML = prods.length
    ? prods.map(p => {
        const sc = p.stock===0 ? 'out-stock' : p.stock<=p.minStock ? 'low-stock' : 'in-stock';
        const sl = p.stock===0 ? 'Out of Stock' : p.stock<=p.minStock ? 'Low Stock' : 'In Stock';
        const stockVal = (p.stock * p.cost).toLocaleString();
        // Units sold in the filtered date range for this product
        let unitsSold = 0;
        sales.forEach(s => s.items.forEach(it => { if(it.sku===p.sku) unitsSold += it.qty; }));
        return `<tr>
          <td><code>${p.sku}</code></td>
          <td><strong>${p.name}</strong></td>
          <td>${p.category}</td>
          <td><strong>${p.stock}</strong></td>
          <td>${unitsSold > 0 ? '<span style="color:var(--green);font-weight:700;">'+unitsSold+' sold</span>' : '—'}</td>
          <td>Rs. ${Number(p.cost).toLocaleString()}</td>
          <td>Rs. ${Number(p.price).toLocaleString()}</td>
          <td style="font-weight:700;">Rs. ${stockVal}</td>
          <td><span class="badge ${sc}">${sl}</span></td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="9" style="text-align:center;color:var(--gray-400);padding:16px;">No products found.</td></tr>';
}

// ═══════════════════════════════════
//  PUBLIC WEBSITE EDITOR
// ═══════════════════════════════════
function renderWebsiteEditor(){
  if(!CU||CU.role!=='developer'){
    document.getElementById('website-no-access').style.display='flex';
    document.getElementById('website-editor').style.display='none';
    return;
  }
  document.getElementById('website-no-access').style.display='none';
  document.getElementById('website-editor').style.display='block';
  const s=getSite();
  document.getElementById('ws-name').value=s.name||'';
  document.getElementById('ws-tagline').value=s.tagline||'';
  document.getElementById('ws-about').value=s.about||'';
  document.getElementById('ws-address').value=s.address||'';
  document.getElementById('ws-phone').value=s.phone||'';
  document.getElementById('ws-email').value=s.email||'';
  document.getElementById('ws-fb').value=s.facebook||'';
  document.getElementById('ws-ig').value=s.instagram||'';
  document.getElementById('ws-map').value=s.map||'';
  document.getElementById('ws-emoji').value=s.emoji||'👗';
  document.getElementById('ws-hero-color').value=s.heroColor||'#FFFDF0';
  document.getElementById('ws-hero-color-txt').value=s.heroColor||'#FFFDF0';
  document.getElementById('ws-accent-color').value=s.accentColor||'#EAB308';
  document.getElementById('ws-accent-color-txt').value=s.accentColor||'#EAB308';
  // color sync
  document.getElementById('ws-hero-color').oninput=function(){document.getElementById('ws-hero-color-txt').value=this.value;};
  document.getElementById('ws-accent-color').oninput=function(){document.getElementById('ws-accent-color-txt').value=this.value;};
  document.getElementById('ws-hero-color-txt').oninput=function(){document.getElementById('ws-hero-color').value=this.value;};
  document.getElementById('ws-accent-color-txt').oninput=function(){document.getElementById('ws-accent-color').value=this.value;};
  renderFeaturedList();
}
function renderFeaturedList(){
  const prods=get(K.products), s=getSite();
  const featured=s.featured||[];
  document.getElementById('featured-product-list').innerHTML=prods.map(p=>{
    const checked=featured.includes(p.sku);
    const emoji = catEmoji[p.category]||'🛍️';
    const resolvedThumb = resolveImg(p);
    const thumbHtml = resolvedThumb
      ? `<img src="${resolvedThumb}" style="width:40px;height:40px;object-fit:cover;border-radius:8px;flex-shrink:0;" onerror="this.outerHTML='<span style=font-size:22px>${emoji}</span>'">`
      : `<span style="font-size:22px;">${emoji}</span>`;
    return`<label style="display:flex;align-items:center;gap:10px;padding:10px;border:1.5px solid ${checked?'var(--gold-400)':'var(--gray-200)'};border-radius:var(--radius-sm);cursor:pointer;background:${checked?'var(--gold-50)':'white'};transition:all 0.15s;">
      <input type="checkbox" ${checked?'checked':''} onchange="toggleFeatured('${p.sku}',this.checked)" style="accent-color:var(--gold-500);width:16px;height:16px;">
      ${thumbHtml}
      <div style="flex:1;min-width:0;"><div style="font-size:12px;font-weight:700;color:var(--gray-900);">${p.name}</div><div style="font-size:11px;color:var(--gray-400);">Rs. ${Number(p.price).toLocaleString()} · ${p.stock} in stock</div></div>
    </label>`;
  }).join('');
}
function toggleFeatured(sku,checked){
  const s=getSite(), f=s.featured||[];
  if(checked&&!f.includes(sku))f.push(sku);
  else if(!checked){const i=f.indexOf(sku);if(i>=0)f.splice(i,1);}
  s.featured=f; set(K.site,s); renderFeaturedList();
}
function syncFeaturedFromInventory(){
  const prods=get(K.products).filter(p=>p.stock>0).map(p=>p.sku);
  const s=getSite(); s.featured=prods; set(K.site,s); renderFeaturedList();
  showToast('Synced '+prods.length+' in-stock products ✅','success');
}
function publishSiteData(){
  const s=getSite();
  s.name=document.getElementById('ws-name').value.trim();
  s.tagline=document.getElementById('ws-tagline').value.trim();
  s.about=document.getElementById('ws-about').value.trim();
  s.address=document.getElementById('ws-address').value.trim();
  s.phone=document.getElementById('ws-phone').value.trim();
  s.email=document.getElementById('ws-email').value.trim();
  s.facebook=document.getElementById('ws-fb').value.trim();
  s.instagram=document.getElementById('ws-ig').value.trim();
  s.map=document.getElementById('ws-map').value.trim();
  s.emoji=document.getElementById('ws-emoji').value.trim()||'👗';
  s.heroColor=document.getElementById('ws-hero-color-txt').value.trim()||'#FFFDF0';
  s.accentColor=document.getElementById('ws-accent-color-txt').value.trim()||'#EAB308';
  s.publishedAt=new Date().toISOString();
  set(K.site,s);
  showToast('Publishing…','');
  pushSiteToSheets(s).then(ok => {
    showToast(ok ? 'Website published to Sheets! ✅ Store will update shortly.' : '⚠ Saved locally — Sheets sync failed. Check API connection.', ok?'success':'error');
  });
}

// ═══════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════
function renderSettings(){
  if(CU.role==='cashier'){document.getElementById('settings-page').innerHTML='<div class="no-access"><span style="font-size:48px;">🔒</span><p>Access Denied</p></div>';return;}
  const cfg=getCfg();
  document.getElementById('cfg-name').value=cfg.name||'';
  document.getElementById('cfg-address').value=cfg.address||'';
  document.getElementById('cfg-phone').value=cfg.phone||'';
  document.getElementById('cfg-vat').value=cfg.vat||0;
  if(CU.role==='owner'){document.getElementById('users-card').style.display='none';}
  else{
    document.getElementById('users-card').style.display='';
    document.getElementById('users-tbody').innerHTML=get(K.users).map(u=>`<tr><td>${u.username}</td><td>${u.name}</td><td><span class="badge role">${u.role.toUpperCase()}</span></td></tr>`).join('');
  }
}
function saveConfig(){
  const cfg={name:document.getElementById('cfg-name').value,address:document.getElementById('cfg-address').value,phone:document.getElementById('cfg-phone').value,vat:parseFloat(document.getElementById('cfg-vat').value)||0};
  set(K.config,cfg); showToast('Settings saved ✅','success');
}

// ═══════════════════════════════════
//  CSV
// ═══════════════════════════════════
function exportProductsCSV(){
  const rows=[['SKU','Name','Category','Size','Price','Cost','Stock','MinStock','Description','ImageURL']];
  get(K.products).forEach(p=>rows.push([p.sku,p.name,p.category,p.size,p.price,p.cost,p.stock,p.minStock,p.desc||'',p.img||'']));
  dlCSV(rows,'jj_products.csv');
}
function exportSalesCSV(){
  const rows=[['TxnNum','Date','Customer','Items','Subtotal','Discount','VAT','Total','Payment','Cashier']];
  get(K.sales).forEach(s=>rows.push([s.txnNum,new Date(s.date).toLocaleString('en-PH'),s.customer,s.items.map(i=>`${i.name}(${i.qty})`).join(';'),s.subtotal,s.discount,s.vat||0,s.total,s.payment,s.cashier]));
  dlCSV(rows,'elume_sales.csv');
}
function dlCSV(rows,fn){
  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv); a.download=fn; a.click();
}
function doImportCSV(){
  const file=document.getElementById('import-file').files[0];
  if(!file){showToast('Select a file!','error');return;}
  const reader=new FileReader();
  reader.onload=e=>{
    const lines=e.target.result.split('\n').filter(l=>l.trim());
    const headers=lines[0].split(',').map(h=>h.replace(/"/g,'').trim());
    const expected=['SKU','Name','Category','Size','Price','Cost','Stock','MinStock','Description'];
    if(!expected.every(h=>headers.includes(h))){showToast('Invalid CSV format!','error');return;}
    const prods=get(K.products); let added=0,updated=0;
    for(let i=1;i<lines.length;i++){
      const cols=lines[i].split(',').map(c=>c.replace(/^"|"$/g,'').trim());
      const obj={}; headers.forEach((h,j)=>obj[h]=cols[j]);
      const np={sku:obj.SKU,name:obj.Name,category:obj.Category,size:obj.Size,price:parseFloat(obj.Price)||0,cost:parseFloat(obj.Cost)||0,stock:parseInt(obj.Stock)||0,minStock:parseInt(obj.MinStock)||5,desc:obj.Description||'',img:obj.ImageURL||''};
      const idx=prods.findIndex(p=>p.sku===np.sku);
      if(idx>=0){prods[idx]=np;updated++;}else{prods.push(np);added++;}
    }
    set(K.products,prods); closeModal('import-modal'); renderInventory();
    showToast(`Imported: ${added} added, ${updated} updated ✅`,'success');
  };
  reader.readAsText(file);
}

// ═══════════════════════════════════
//  RESTOCK
// ═══════════════════════════════════
function openRestock(sku) {
  const p = get(K.products).find(x => x.sku === sku); if (!p) return;
  document.getElementById('restock-sku').value = sku;
  document.getElementById('restock-product-name').textContent = p.name;
  document.getElementById('restock-current-stock').textContent = 'Current stock: ' + p.stock + ' units';
  document.getElementById('restock-qty').value = '';
  document.getElementById('restock-note').value = '';
  openModal('restock-modal');
}
function doRestock(pushNow=false) {
  const sku = document.getElementById('restock-sku').value;
  const qty = parseInt(document.getElementById('restock-qty').value) || 0;
  if (qty <= 0) { showToast('Enter a valid quantity!', 'error'); return; }
  const prods = get(K.products), idx = prods.findIndex(p => p.sku === sku);
  if (idx < 0) return;
  const pName = prods[idx].name;
  prods[idx].stock += qty;
  set(K.products, prods);
  markInvPending();
  closeModal('restock-modal');
  renderInventory(); renderProducts(); refreshDashboard();
  if (pushNow) {
    showToast('Pushing restock to Sheets…', '');
    setInvSaveState('saving');
    pushProductsToSheets(prods).then(ok => {
      if(ok){ showToast('+'+qty+' units restocked on '+pName+' & saved to Sheets ✅','success'); setInvSaveState('synced'); addSaveLog('restock','+'+qty+' × '+pName+' saved','ok'); }
      else  { showToast('⚠ Restocked locally — Sheets push failed. Use "Save to Sheets" button.','error'); setInvSaveState('error'); addSaveLog('restock','+'+qty+' × '+pName+' — push failed','fail'); }
    });
  } else {
    showToast('+'+qty+' added to '+pName+' 💾 — click "Save to Sheets" to sync','');
    setInvSaveState('pending');
  }
}


// ═══════════════════════════════════════════════════════
//  SHEETS SAVE SYSTEM — Manual & Auto
// ═══════════════════════════════════════════════════════

// ── Inventory Save State ──────────────────────────────
let _invPendingChanges = 0;
let _invLastSaved = null;

function markInvPending() {
  _invPendingChanges++;
  setInvSaveState('pending');
}

function setInvSaveState(state) {
  const pill    = document.getElementById('inv-sheets-pill');
  const dot     = document.getElementById('inv-pending-dot');
  const info    = document.getElementById('inv-sheets-info');
  const btn     = document.getElementById('inv-save-btn');
  const icon    = document.getElementById('inv-save-icon');
  const lastSav = document.getElementById('inv-last-saved');
  if (!pill) return;
  const map = {
    synced:  { cls:'synced',  txt:'☁ Synced',    dot:false, btnDis:false, infoTxt:'All changes saved to Google Sheets', btnIcon:'☁' },
    pending: { cls:'pending', txt:'● Unsaved changes', dot:true, btnDis:false, infoTxt:`${_invPendingChanges} unsaved change(s) — click Save to Sheets`, btnIcon:'⬆' },
    saving:  { cls:'syncing', txt:'⟳ Saving…',   dot:false, btnDis:true,  infoTxt:'Saving to Google Sheets…', btnIcon:'⟳' },
    error:   { cls:'error',   txt:'⚠ Save failed', dot:true, btnDis:false, infoTxt:'Save failed — check internet & retry', btnIcon:'↺' },
  };
  const m = map[state] || map.synced;
  pill.className = 'sheets-status-pill ' + m.cls;
  pill.textContent = m.txt;
  dot.style.display = m.dot ? 'inline-block' : 'none';
  info.textContent = m.infoTxt;
  if (btn) { btn.disabled = m.btnDis; btn.className = 'btn-save-sheets' + (m.btnDis ? ' saving' : ''); }
  if (icon) icon.textContent = m.btnIcon;
  if (state === 'synced' && _invLastSaved) {
    lastSav.textContent = 'Last saved: ' + _invLastSaved.toLocaleTimeString('en-PH');
  }
}

function saveInventoryToSheets() {
  const prods = get(K.products);
  if (!prods.length) { showToast('No products to save!', ''); return; }
  setInvSaveState('saving');
  showToast('Saving all ' + prods.length + ' products to Google Sheets…', '');
  pushProductsToSheets(prods).then(ok => {
    if (ok) {
      _invPendingChanges = 0;
      _invLastSaved = new Date();
      setInvSaveState('synced');
      showToast('✅ ' + prods.length + ' products saved to Sheets!', 'success');
      addSaveLog('inventory', prods.length + ' products saved to Sheets', 'ok');
    } else {
      setInvSaveState('error');
      showToast('⚠ Sheets save failed — check connection & try again', 'error');
      addSaveLog('inventory', 'Bulk save failed', 'fail');
    }
  });
}

// ── Sales Push Functions ──────────────────────────────
let _salesLastPushed = null;

function setSalesSaveState(state, detail) {
  const pill    = document.getElementById('sales-sheets-pill');
  const dot     = document.getElementById('sales-pending-dot');
  const info    = document.getElementById('sales-sheets-info');
  const lastSav = document.getElementById('sales-last-saved');
  if (!pill) return;
  const map = {
    synced:  { cls:'synced',  txt:'☁ Synced',     dot:false },
    pending: { cls:'pending', txt:'● Pending push', dot:true  },
    syncing: { cls:'syncing', txt:'⟳ Pushing…',    dot:false },
    error:   { cls:'error',   txt:'⚠ Push failed',  dot:true  },
  };
  const m = map[state] || map.synced;
  pill.className = 'sheets-status-pill ' + m.cls;
  pill.textContent = m.txt;
  dot.style.display = m.dot ? 'inline-block' : 'none';
  if (detail) info.textContent = detail;
  if (state === 'synced' && _salesLastPushed) {
    lastSav.textContent = 'Last pushed: ' + _salesLastPushed.toLocaleTimeString('en-PH');
  }
}

function repushSale(txnNum) {
  const sale = _salesMap && _salesMap[txnNum];
  if (!sale) { showToast('Sale not found!', 'error'); return; }
  setSalesSaveState('syncing', 'Pushing ' + txnNum + '…');
  showToast('Pushing ' + txnNum + ' to Sheets…', '');
  gsPost('saveSale', {
    sale: { cashier: sale.cashier, total: sale.subtotal, discount: sale.discount,
            grandTotal: sale.total, payment: sale.payment, notes: sale.customer },
    items: sale.items.map(i => ({ sku: i.sku, name: i.name, brand: '', qty: i.qty, unitPrice: i.price }))
  }).then(result => {
    if (result && result.success) {
      _salesLastPushed = new Date();
      setSalesSaveState('synced', txnNum + ' pushed successfully');
      showToast(txnNum + ' pushed to Sheets ✅', 'success');
      addSaveLog('sale', txnNum + ' re-pushed to Sheets', 'ok');
    } else {
      setSalesSaveState('error', txnNum + ' push failed');
      showToast('⚠ Push failed for ' + txnNum, 'error');
      addSaveLog('sale', txnNum + ' re-push failed', 'fail');
    }
  });
}

function pushAllSalesToSheets() {
  const sales = get(K.sales).filter(s => !s.voided);
  if (!sales.length) { showToast('No sales to push!', ''); return; }
  setSalesSaveState('syncing', 'Pushing ' + sales.length + ' records…');
  showToast('Pushing all ' + sales.length + ' sales to Sheets…', '');
  // Push all one-by-one with a small batch aggregator
  const allItems = [];
  sales.forEach(s => {
    allItems.push({ sku: 'BATCH', name: 'BATCH_PUSH', brand: '', qty: 0, unitPrice: 0 });
  });
  gsPost('saveSalesBatch', {
    sales: sales.map(s => ({
      txnNum:    s.txnNum,
      date:      s.date,
      cashier:   s.cashier,
      customer:  s.customer,
      subtotal:  s.subtotal,
      discount:  s.discount,
      grandTotal:s.total,
      payment:   s.payment,
      items:     s.items.map(i => ({ sku:i.sku, name:i.name, qty:i.qty, unitPrice:i.price }))
    }))
  }).then(result => {
    if (result && result.success) {
      _salesLastPushed = new Date();
      setSalesSaveState('synced', sales.length + ' records pushed');
      showToast('✅ ' + sales.length + ' sales pushed to Sheets!', 'success');
      addSaveLog('sales-batch', sales.length + ' sales pushed', 'ok');
    } else {
      setSalesSaveState('error', 'Batch push failed');
      showToast('⚠ Batch push failed — try pushing individual records', 'error');
      addSaveLog('sales-batch', 'Batch push failed', 'fail');
    }
  });
}

// ── Save Log ──────────────────────────────────────────
const _saveLog = [];
function addSaveLog(type, msg, status) {
  const now = new Date();
  _saveLog.unshift({ time: now.toLocaleTimeString('en-PH'), type, msg, status });
  if (_saveLog.length > 30) _saveLog.pop();
  const el = document.getElementById('save-log-entries');
  if (!el) return;
  el.innerHTML = _saveLog.map(e =>
    `<div class="save-log-entry">
      <span><strong>${e.type.toUpperCase()}</strong> — ${e.msg}</span>
      <span class="sle-${e.status === 'ok' ? 'ok' : 'fail'}">[${e.time}] ${e.status === 'ok' ? '✓ OK' : '✗ FAIL'}</span>
    </div>`
  ).join('');
}
function toggleSaveLog() {
  const el = document.getElementById('save-log');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// ═══════════════════════════════════
//  SEQUENTIAL INVOICE NUMBER
// ═══════════════════════════════════
function nextTxnNum() {
  const sales = get(K.sales);
  if (!sales.length) return 'TXN-000001';
  const nums = sales.map(s => parseInt((s.txnNum || '0').replace(/\D/g, '')) || 0);
  return 'TXN-' + String(Math.max(...nums) + 1).padStart(6, '0');
}

// ═══════════════════════════════════
//  DASHBOARD MINI CHART
// ═══════════════════════════════════
function renderDashChart() {
  const sales = get(K.sales);
  const now = new Date();
  // Last 7 days
  const days = Array.from({length:7}, (_,i) => {
    const d = new Date(now); d.setDate(d.getDate() - (6 - i));
    return { label: d.toLocaleDateString('en-PH',{weekday:'short'}), date: d.toLocaleDateString('en-CA'), total: 0 };
  });
  sales.forEach(s => {
    const d = days.find(x => s.date.startsWith(x.date));
    if (d) d.total += s.total;
  });
  const max = Math.max(...days.map(d => d.total), 1);
  const chartHtml = `
    <div style="display:flex;align-items:flex-end;gap:8px;height:80px;margin-top:12px;">
      ${days.map(d => `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
          <div style="width:100%;background:var(--gold-${d.total>0?'400':'100'});border-radius:4px 4px 0 0;height:${Math.max(4,Math.round((d.total/max)*72))}px;transition:height 0.4s ease;" title="Rs. ${d.total.toLocaleString()}"></div>
          <div style="font-size:10px;color:var(--gray-400);font-weight:600;">${d.label}</div>
        </div>`).join('')}
    </div>
    <div style="font-size:11px;color:var(--gray-400);margin-top:6px;">Sales last 7 days</div>`;
  const chartEl = document.getElementById('dash-chart');
  if (chartEl) chartEl.innerHTML = chartHtml;
}

// ═══════════════════════════════════
//  MODAL / TOAST helpers
// ═══════════════════════════════════
function openModal(id){document.getElementById(id).classList.add('active');}
function closeModal(id){document.getElementById(id).classList.remove('active');}
document.querySelectorAll('.modal-overlay').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('active');}));
function showToast(msg,type=''){
  const t=document.createElement('div'); t.className='toast-msg '+(type||''); t.textContent=msg;
  document.getElementById('toast').appendChild(t); setTimeout(()=>t.remove(),3200);
}

// ═══════════════════════════════════
//  INIT — seed defaults, then load from Sheets
// ═══════════════════════════════════
// ═══════════════════════════════════
//  MOBILE RESPONSIVE HELPERS
// ═══════════════════════════════════
let _cartOpen = false;

function toggleMobileSidebar() {
  const sb = document.querySelector('.sidebar');
  const ov = document.getElementById('sidebar-overlay');
  const isOpen = sb.classList.contains('mob-open');
  if (isOpen) { closeMobileSidebar(); }
  else { sb.classList.add('mob-open'); ov.classList.add('open'); }
}
function closeMobileSidebar() {
  document.querySelector('.sidebar').classList.remove('mob-open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

function toggleMobileCart() {
  _cartOpen = !_cartOpen;
  const panel = document.querySelector('.pos-right');
  const bar   = document.getElementById('cart-toggle-bar');
  if (panel) panel.classList.toggle('cart-open', _cartOpen);
  if (bar)   bar.querySelector('span').textContent = _cartOpen ? '✕ Close Cart' : '🛒 View Cart';
}

function setMobNav(el) {
  document.querySelectorAll('.mob-nav-item').forEach(x => x.classList.remove('active'));
  if (el) el.classList.add('active');
  closeMobileSidebar();
  // Close cart when leaving POS
  if (el && el.dataset.page !== 'pos') {
    _cartOpen = false;
    const panel = document.querySelector('.pos-right');
    if (panel) panel.classList.remove('cart-open');
  }
}

// Sync cart toggle count badge
const _origRenderCart = renderCart;
renderCart = function() {
  _origRenderCart();
  const total = cart.reduce((a,c) => a + c.qty, 0);
  const ctBadge = document.getElementById('cart-toggle-count');
  if (ctBadge) ctBadge.textContent = total + (total === 1 ? ' item' : ' items');
  // Auto-open cart on mobile when first item added
  if (total > 0 && !_cartOpen && window.innerWidth <= 768) {
    _cartOpen = true;
    const panel = document.querySelector('.pos-right');
    const bar   = document.getElementById('cart-toggle-bar');
    if (panel) panel.classList.add('cart-open');
    if (bar) bar.querySelector('span').textContent = '✕ Close Cart';
  }
};

// Keep desktop sidebar nav and mobile bottom nav in sync
const _origShowPage = showPage;
showPage = function(p) {
  _origShowPage(p);
  document.querySelectorAll('.mob-nav-item').forEach(x => {
    x.classList.toggle('active', x.dataset.page === p);
  });
};

seed();

// ── One-time migration: clear ONLY old demo sales from earlier trial sessions ──
// Products are intentionally kept — do NOT remove them here.
(function migrateCleanStart() {
  const flag = 'jj_v11_clean'; // bumped from v10 → v11 so old affected browsers re-run this
  if (localStorage.getItem(flag)) return; // already done
  localStorage.removeItem(K.sales);
  set(K.sales, []);
  localStorage.setItem(flag, '1');
})();