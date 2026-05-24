// ============================================================
//  JJ Fabrics POS — Application Logic
//  Backend: Supabase (via db.js)
//  IDs match pos.html exactly
// ============================================================

// ── State ──
let CU          = null;
let allProducts = [];
let cart        = [];

// ─────────────────────────────────────────
//  STORAGE (localStorage for config/sales cache)
// ─────────────────────────────────────────
const K = { sales:'jj_sales', config:'jj_config' };
const get  = k => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };
const set  = (k,v) => localStorage.setItem(k, JSON.stringify(v));
const getCfg = () => { try { return JSON.parse(localStorage.getItem(K.config)) || {}; } catch { return {}; } };

function seed() {
  if (!localStorage.getItem(K.config)) set(K.config, {
    name:'JJ Fabrics', address:'Sher Bahadur Plaza, K-Block, Near Dr. Ibadat Hospital, Main Bazar, Attock City',
    phone:'+92 314 5777344', vat:0
  });
  if (!localStorage.getItem(K.sales)) set(K.sales, []);
}

// ─────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────
async function doLogin() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const errEl    = document.getElementById('login-error');
  const btn      = document.getElementById('login-btn');

  errEl.style.display = 'none';
  if (!username || !password) { errEl.textContent = 'Enter username and password.'; errEl.style.display = 'block'; return; }

  btn.textContent = 'Signing in…';
  btn.disabled    = true;

  try {
    const user = await dbLogin(username, password);
    if (!user) {
      errEl.textContent = 'Invalid username or password.';
      errEl.style.display = 'block';
      btn.textContent = 'Sign In →';
      btn.disabled = false;
      return;
    }
    CU = user;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display          = 'block';
    document.getElementById('user-display').textContent   = user.username;
    document.getElementById('role-display').textContent   = user.role.toUpperCase();
    document.getElementById('dash-name').textContent      = user.username;
    document.getElementById('mob-user-label').textContent = user.username;

    // Role-based nav visibility
    if (user.role === 'cashier') {
      document.getElementById('nav-settings').style.display = 'none';
      document.getElementById('nav-website').style.display  = 'none';
    }
    const resetBtn = document.getElementById('dash-reset-btn');
    if (resetBtn) resetBtn.style.display = user.role === 'owner' ? '' : 'none';

    await loadProducts();
    showPage('dashboard');
  } catch (e) {
    errEl.textContent = 'Login error — check your connection.';
    errEl.style.display = 'block';
    btn.textContent = 'Sign In →';
    btn.disabled = false;
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('login-screen').style.display !== 'none') doLogin();
});

function doLogout() {
  CU = null; cart = []; allProducts = [];
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display          = 'none';
  ['nav-settings','nav-website'].forEach(id => document.getElementById(id).style.display = '');
  document.getElementById('login-user').value  = '';
  document.getElementById('login-pass').value  = '';
  document.getElementById('login-error').style.display = 'none';
  document.getElementById('login-btn').textContent = 'Sign In →';
  document.getElementById('login-btn').disabled = false;
}

// ─────────────────────────────────────────
//  NAVIGATION
// ─────────────────────────────────────────
function showPage(p) {
  document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active'));
  document.getElementById(p + '-page').classList.add('active');
  document.querySelector(`.nav-item[data-page="${p}"]`)?.classList.add('active');

  const fns = {
    dashboard: refreshDashboard,
    pos:       renderProducts,
    inventory: loadAndRenderInventory,
    sales:     () => { setDefaultDates(); renderSales(); },
    reports:   renderReports,
    settings:  renderSettings,
    website:   renderWebsiteEditor
  };
  fns[p]?.();
}

// ─────────────────────────────────────────
//  PRODUCTS — load from Supabase
// ─────────────────────────────────────────
async function loadProducts() {
  try {
    allProducts = await dbGetProducts();
  } catch(e) {
    allProducts = [];
    showToast('Could not load products — check connection', 'error');
  }
}

// ─────────────────────────────────────────
//  DASHBOARD
// ─────────────────────────────────────────
function syncDashboard() {
  const btn = document.getElementById('dash-sync-btn');
  if (btn) { btn.textContent = '⟳ Syncing…'; btn.disabled = true; }
  loadProducts().then(() => {
    refreshDashboard(); renderProducts();
    if (btn) { btn.textContent = '⟳ Refresh Data'; btn.disabled = false; }
    showToast('Dashboard refreshed ✅', 'success');
  });
}

function ownerResetData() {
  if (CU.role !== 'owner') { showToast('Owner only!', 'error'); return; }
  if (!confirm('Reset all local sales records? This cannot be undone.')) return;
  set(K.sales, []);
  refreshDashboard();
  showToast('Reset complete ✅', 'success');
}

function refreshDashboard() {
  const now = new Date();
  document.getElementById('dash-date').textContent = now.toLocaleDateString('en-PH',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const sales = get(K.sales).filter(s=>!s.voided);
  const today = now.toLocaleDateString('en-CA'), month = now.toISOString().slice(0,7);
  const td = sales.filter(s=>s.date&&s.date.startsWith(today));
  const mo = sales.filter(s=>s.date&&s.date.startsWith(month));
  const fmt = n => 'Rs. ' + n.toLocaleString('en-PH',{minimumFractionDigits:2});
  document.getElementById('dash-today-sales').textContent = fmt(td.reduce((a,s)=>a+s.total,0));
  document.getElementById('dash-today-txn').textContent   = td.length + ' transactions';
  document.getElementById('dash-month-sales').textContent = fmt(mo.reduce((a,s)=>a+s.total,0));
  document.getElementById('dash-month-txn').textContent   = mo.length + ' transactions';
  document.getElementById('dash-products').textContent    = allProducts.length;
  const low = allProducts.filter(p=>p.stock>0&&p.stock<=5), out=allProducts.filter(p=>p.stock===0);
  document.getElementById('dash-low-stock').textContent   = low.length + ' low stock';
  document.getElementById('dash-alerts').textContent      = low.length + out.length;
  const al = [...out,...low];
  document.getElementById('dash-alerts-list').innerHTML = al.length
    ? al.map(p=>`<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--gray-50);font-size:12px;">
        <span style="font-weight:500;">${p.name}</span>
        <span class="badge ${p.stock===0?'out-stock':'low-stock'}">${p.stock===0?'Out':p.stock+' left'}</span>
      </div>`).join('')
    : '<p style="font-size:13px;color:var(--gray-400);">✅ All stock levels OK</p>';
  const rec = [...sales].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,6);
  document.getElementById('dash-recent-list').innerHTML = rec.length
    ? rec.map(s=>`<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--gray-50);font-size:12px;">
        <span><strong>${s.txnNum}</strong> · ${s.customer}</span>
        <span style="font-weight:700;color:var(--gold-600);">${fmt(s.total)}</span>
      </div>`).join('')
    : '<p style="font-size:13px;color:var(--gray-400);">No transactions yet.</p>';
  renderDashChart();
}

function renderDashChart() {
  const sales = get(K.sales);
  const now = new Date();
  const days = Array.from({length:7},(_,i)=>{
    const d=new Date(now); d.setDate(d.getDate()-(6-i));
    return {label:d.toLocaleDateString('en-PH',{weekday:'short'}),date:d.toLocaleDateString('en-CA'),total:0};
  });
  sales.forEach(s=>{const d=days.find(x=>s.date&&s.date.startsWith(x.date));if(d)d.total+=s.total;});
  const max=Math.max(...days.map(d=>d.total),1);
  const el=document.getElementById('dash-chart');
  if(el) el.innerHTML=`<div style="display:flex;align-items:flex-end;gap:8px;height:80px;margin-top:12px;">
    ${days.map(d=>`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
      <div style="width:100%;background:${d.total>0?'var(--gold-400)':'var(--gray-100)'};border-radius:4px 4px 0 0;height:${Math.max(4,Math.round((d.total/max)*72))}px;" title="Rs. ${d.total.toLocaleString()}"></div>
      <div style="font-size:10px;color:var(--gray-400);font-weight:600;">${d.label}</div>
    </div>`).join('')}
  </div><div style="font-size:11px;color:var(--gray-400);margin-top:6px;">Sales last 7 days</div>`;
}

// ─────────────────────────────────────────
//  POS — Product Grid
// ─────────────────────────────────────────
const catEmoji = {'Ladies Suiting':'👘','Gents Suiting':'👔','Accessories':'💎','Kids':'👦'};

function renderProducts() {
  const q = (document.getElementById('pos-search')?.value||'').toLowerCase();
  const c = document.getElementById('pos-cat')?.value||'';
  const prods = allProducts.filter(p=>
    (!q||p.name.toLowerCase().includes(q)||p.sku.toLowerCase().includes(q)) &&
    (!c||p.category===c)
  );
  const grid = document.getElementById('product-grid');
  if(!prods.length){grid.innerHTML='<p style="grid-column:1/-1;font-size:13px;color:var(--gray-400);">No products found.</p>';return;}
  grid.innerHTML=prods.map(p=>{
    const isOut=p.stock===0, isLow=p.stock>0&&p.stock<=5;
    const emoji=catEmoji[p.category]||'🛍️';
    const imgHtml=p.img?`<img src="${p.img}" alt="${p.name}" loading="lazy" style="width:100%;height:100%;object-fit:cover;border-radius:8px;display:block;" onerror="this.parentNode.innerHTML='<span style=font-size:32px>${emoji}</span>'">`:`<span style="font-size:32px;">${emoji}</span>`;
    return`<div class="product-card ${isOut?'out-of-stock':''}" data-sku="${p.sku}">
      ${isLow?'<span class="stock-badge low">Low</span>':''}${isOut?'<span class="stock-badge out">Out</span>':''}
      <div class="pc-img">${imgHtml}</div>
      <div class="pc-name">${p.name}</div>
      <div class="pc-price">Rs. ${Number(p.price).toLocaleString()}</div>
      <div class="pc-stock">${p.stock} in stock</div>
    </div>`;
  }).join('');
  grid.onclick=function(e){
    const card=e.target.closest('.product-card[data-sku]');
    if(!card||card.classList.contains('out-of-stock'))return;
    addToCart(card.dataset.sku);
  };
}

// ─────────────────────────────────────────
//  CART
// ─────────────────────────────────────────
function addToCart(sku) {
  const p=allProducts.find(x=>x.sku===sku);
  if(!p||p.stock===0)return;
  const ex=cart.find(c=>c.sku===sku);
  if(ex){if(ex.qty>=p.stock){showToast('Max stock reached!','error');return;}ex.qty++;}
  else cart.push({sku:p.sku,name:p.name,price:p.price,qty:1,maxStock:p.stock});
  renderCart(); showToast(p.name+' added ✓','success');
}

function renderCart() {
  const total=cart.reduce((a,c)=>a+c.qty,0);
  document.getElementById('cart-count').textContent=total;
  const box=document.getElementById('cart-items');
  if(!cart.length){
    box.innerHTML='<div class="cart-empty"><div class="empty-icon">🛍️</div><p>Cart is empty</p></div>';
    document.getElementById('cash-calc').style.display='none';
    updateCartTotals();return;
  }
  document.getElementById('cash-calc').style.display='block';
  box.innerHTML=cart.map((it,i)=>`
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
  const sub=cart.reduce((a,c)=>a+c.qty*c.price,0),disc=getDisc(sub);
  const cfg=getCfg(),total=Math.max(0,sub-disc+(sub-disc)*(cfg.vat/100));
  const tendered=parseFloat(document.getElementById('cash-tendered').value)||0;
  const change=tendered-total;
  document.getElementById('cash-change').textContent='Rs. '+(change>=0?change:0).toLocaleString('en-PH',{minimumFractionDigits:2});
  document.getElementById('cash-change').style.color=change<0?'var(--red)':'var(--green)';
}

function chQty(i,d){cart[i].qty+=d;if(cart[i].qty<=0)cart.splice(i,1);else if(cart[i].qty>cart[i].maxStock)cart[i].qty=cart[i].maxStock;renderCart();}
function rmCart(i){cart.splice(i,1);renderCart();}
function clearCart(){
  cart=[];
  const cn=document.getElementById('customer-name'); if(cn)cn.value='';
  const dv=document.getElementById('discount-val'); if(dv)dv.value='';
  const ct=document.getElementById('cash-tendered'); if(ct)ct.value='';
  document.getElementById('cash-calc').style.display='none';
  renderCart();
}

function getDisc(sub){
  const v=parseFloat(document.getElementById('discount-val')?.value)||0;
  const t=document.getElementById('discount-type')?.value;
  return t==='pct'?sub*(v/100):v;
}

function updateCartTotals(){
  const sub=cart.reduce((a,c)=>a+c.qty*c.price,0),disc=getDisc(sub),total=Math.max(0,sub-disc);
  const fmt=n=>'Rs. '+n.toLocaleString('en-PH',{minimumFractionDigits:2});
  document.getElementById('cart-subtotal').textContent=fmt(sub);
  document.getElementById('cart-discount').textContent=fmt(disc);
  document.getElementById('cart-total').textContent=fmt(total);
}

// ─────────────────────────────────────────
//  CHECKOUT
// ─────────────────────────────────────────
async function checkout(method) {
  if(!cart.length){showToast('Cart is empty!','error');return;}
  const sub=cart.reduce((a,c)=>a+c.qty*c.price,0),disc=getDisc(sub);
  const cfg=getCfg(),vat=(sub-disc)*(cfg.vat/100),total=sub-disc+vat;
  const txnNum=nextTxnNum(),now=new Date();
  const customer=(document.getElementById('customer-name')?.value||'').trim()||'Walk-in';
  const sale={txnNum,date:now.toISOString(),customer,items:JSON.parse(JSON.stringify(cart)),subtotal:sub,discount:disc,vat,total,payment:method,cashier:CU.username};

  try {
    // Save to Supabase
    await dbSaveSale({
      ref: txnNum,
      items: cart.map(i=>({sku:i.sku,name:i.name,qty:i.qty,price:i.price})),
      subtotal:sub, discount:disc, total, paymentMethod:method, cashier:CU.username
    });
    // Update stock in Supabase
    for(const item of cart){
      const prod=allProducts.find(p=>p.sku===item.sku);
      if(prod){ const ns=Math.max(0,prod.stock-item.qty); await dbUpdateStock(item.sku,ns); prod.stock=ns; }
    }
  } catch(e) {
    showToast('⚠ DB save failed — recording locally only','error');
  }

  // Always save locally too
  const sales=get(K.sales); sales.push(sale); set(K.sales,sales);

  if(method==='cash') showInvoice(sale);
  else showToast('Card payment recorded ✅','success');
  clearCart(); renderProducts(); refreshDashboard();
  showToast(txnNum+' completed!','success');
}

// ─────────────────────────────────────────
//  INVOICE
// ─────────────────────────────────────────
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

// ─────────────────────────────────────────
//  INVENTORY
// ─────────────────────────────────────────
async function loadAndRenderInventory() {
  showToast('Loading from Supabase…','');
  try {
    allProducts = await dbGetProducts();
    renderInventory();
  } catch(e) {
    showToast('Failed to load products','error');
  }
}

// stub for old HTML buttons — now just reloads from Supabase
function syncFromSheets() { loadAndRenderInventory().then(()=>showToast('Synced from Supabase ✅','success')); }
function saveInventoryToSheets() { showToast('Products are live in Supabase — no manual push needed ✅','success'); }
function testSheetsConnection() {
  dbGetProducts().then(p=>showToast('✅ Connected — '+p.length+' products','success')).catch(()=>showToast('❌ Cannot reach Supabase','error'));
}

function renderInventory(){
  const q=(document.getElementById('inv-search')?.value||'').toLowerCase();
  const c=document.getElementById('inv-cat')?.value||'';
  const s=document.getElementById('inv-status')?.value||'';
  const prods=allProducts.filter(p=>{
    const mq=!q||p.name.toLowerCase().includes(q)||p.sku.toLowerCase().includes(q);
    const mc=!c||p.category===c;
    const ms=!s||(s==='in'&&p.stock>5)||(s==='low'&&p.stock>0&&p.stock<=5)||(s==='out'&&p.stock===0);
    return mq&&mc&&ms;
  });
  const alerts=prods.filter(p=>p.stock<=5);
  const alertEl=document.getElementById('inv-alerts');
  if(alertEl) alertEl.innerHTML=alerts.length?`<div class="alert-box warning">⚠️ <div><strong>${alerts.length} item(s) need restocking:</strong> ${alerts.map(a=>a.name).join(', ')}</div></div>`:'';
  const canEdit=CU&&CU.role!=='cashier';
  document.getElementById('inv-tbody').innerHTML=prods.map(p=>{
    const sc=p.stock===0?'out-stock':p.stock<=5?'low-stock':'in-stock';
    const sl=p.stock===0?'Out of Stock':p.stock<=5?'Low Stock':'In Stock';
    const emoji=catEmoji[p.category]||'🛍️';
    const thumbHtml=p.img
      ?`<img src="${p.img}" style="width:36px;height:36px;object-fit:cover;border-radius:6px;flex-shrink:0;" onerror="this.outerHTML='<span style=font-size:20px>${emoji}</span>'">`
      :`<span style="font-size:20px;">${emoji}</span>`;
    return`<tr>
      <td><code>${p.sku}</code></td>
      <td><div style="display:flex;align-items:center;gap:10px;">${thumbHtml}<div><strong>${p.name}</strong><br><span style="font-size:11px;color:var(--gray-400);">${p.description||''}</span></div></div></td>
      <td>${p.category}</td>
      <td>${p.size||'—'}</td>
      <td style="font-weight:700;">Rs. ${Number(p.price).toLocaleString()}</td>
      <td style="color:var(--gray-400);">—</td>
      <td><strong>${p.stock}</strong></td>
      <td>5</td>
      <td><span class="badge ${sc}">${sl}</span></td>
      <td style="white-space:nowrap;">${canEdit?`<button class="btn btn-outline btn-sm" onclick="openEditProduct('${p.sku}')">Edit</button> <button class="btn btn-green btn-sm" onclick="openRestock('${p.sku}')">+Stock</button> <button class="btn btn-danger btn-sm" onclick="delProduct('${p.sku}')">Del</button>`:'—'}</td>
    </tr>`;
  }).join('');
}

// ─────────────────────────────────────────
//  IMAGE HELPERS
// ─────────────────────────────────────────
function handleImgFile(input) {
  const file=(input.files||input)[0]; if(!file)return;
  const label=document.getElementById('img-drop-label');
  if(label)label.textContent='⏳ Processing '+file.name+'…';
  const reader=new FileReader();
  reader.onload=function(e){
    const img=new Image();
    img.onload=function(){
      const MAX=800,scale=Math.min(1,MAX/Math.max(img.width,img.height));
      const canvas=document.createElement('canvas');
      canvas.width=Math.round(img.width*scale); canvas.height=Math.round(img.height*scale);
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      const b64=canvas.toDataURL('image/jpeg',0.82);
      setImgPreview(b64);
      document.getElementById('p-img-final').value=b64;
      if(label)label.innerHTML='✅ '+file.name+' — <span style="color:var(--gold);font-weight:700;">change photo</span>';
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}
function onImgUrlInput(val){
  document.getElementById('p-img-final').value=val.trim();
  if(val.trim())setImgPreview(val.trim());
  else document.getElementById('p-img-preview').style.display='none';
}
function setImgPreview(src){
  document.getElementById('p-img-thumb').src=src;
  document.getElementById('p-img-preview').style.display='flex';
}
function clearImgField(){
  document.getElementById('p-img-final').value='';
  document.getElementById('p-img-file').value='';
  document.getElementById('p-img').value='';
  document.getElementById('p-img-preview').style.display='none';
  const label=document.getElementById('img-drop-label');
  if(label)label.innerHTML='🖼 Drag &amp; drop photo here, or <span style="color:var(--gold);font-weight:700;">click to browse</span>';
}
function _setModalImg(val){
  document.getElementById('p-img-final').value=val||'';
  if(val&&val.startsWith('http')){ document.getElementById('p-img').value=val; setImgPreview(val); }
  else if(val&&val.startsWith('data:')){ setImgPreview(val); }
  else clearImgField();
}

// ─────────────────────────────────────────
//  PRODUCT MODAL
// ─────────────────────────────────────────
function openAddProduct(){
  if(CU.role==='cashier'){showToast('Access denied','error');return;}
  document.getElementById('product-modal-title').textContent='Add Product';
  document.getElementById('edit-sku-orig').value='';
  ['p-sku','p-name','p-size','p-desc','p-img'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  ['p-price','p-cost','p-stock','p-minstock'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  clearImgField();
  openModal('product-modal');
}

function openEditProduct(sku){
  const p=allProducts.find(x=>x.sku===sku); if(!p)return;
  document.getElementById('product-modal-title').textContent='Edit Product';
  document.getElementById('edit-sku-orig').value=sku;
  document.getElementById('p-sku').value=p.sku;
  document.getElementById('p-name').value=p.name;
  document.getElementById('p-cat').value=p.category;
  const sizeEl=document.getElementById('p-size'); if(sizeEl)sizeEl.value=p.size||'';
  document.getElementById('p-price').value=p.price;
  const costEl=document.getElementById('p-cost'); if(costEl)costEl.value=p.cost||0;
  document.getElementById('p-stock').value=p.stock;
  const msEl=document.getElementById('p-minstock'); if(msEl)msEl.value=p.minStock||5;
  document.getElementById('p-desc').value=p.description||'';
  _setModalImg(p.img||'');
  openModal('product-modal');
}

async function saveProduct(pushNow=false){
  const sku=document.getElementById('p-sku').value.trim();
  const name=document.getElementById('p-name').value.trim();
  if(!sku||!name){showToast('SKU and Name required!','error');return;}
  const product={
    sku, name,
    category: document.getElementById('p-cat').value,
    size:     (document.getElementById('p-size')?.value||'').trim(),
    price:    parseFloat(document.getElementById('p-price').value)||0,
    cost:     parseFloat(document.getElementById('p-cost')?.value)||0,
    stock:    parseInt(document.getElementById('p-stock').value)||0,
    minStock: parseInt(document.getElementById('p-minstock')?.value)||5,
    description: document.getElementById('p-desc').value.trim(),
    img:      document.getElementById('p-img-final').value.trim()
  };
  try {
    await dbSaveProduct(product);
    allProducts = await dbGetProducts();
    closeModal('product-modal');
    renderInventory(); renderProducts();
    showToast('Product saved to Supabase ✅','success');
  } catch(e) {
    showToast('Save failed: '+e.message,'error');
  }
}

async function delProduct(sku){
  if(!confirm('Delete this product from database?'))return;
  try {
    await dbDeleteProduct(sku);
    allProducts=allProducts.filter(p=>p.sku!==sku);
    renderInventory(); renderProducts();
    showToast('Deleted ✅','success');
  } catch(e) {
    showToast('Delete failed: '+e.message,'error');
  }
}

// ─────────────────────────────────────────
//  RESTOCK
// ─────────────────────────────────────────
function openRestock(sku){
  const p=allProducts.find(x=>x.sku===sku); if(!p)return;
  document.getElementById('restock-sku').value=sku;
  document.getElementById('restock-product-name').textContent=p.name;
  document.getElementById('restock-current-stock').textContent='Current stock: '+p.stock+' units';
  document.getElementById('restock-qty').value='';
  const noteEl=document.getElementById('restock-note'); if(noteEl)noteEl.value='';
  openModal('restock-modal');
}

async function doRestock(pushNow=false){
  const sku=document.getElementById('restock-sku').value;
  const qty=parseInt(document.getElementById('restock-qty').value)||0;
  if(qty<=0){showToast('Enter a valid quantity!','error');return;}
  const idx=allProducts.findIndex(p=>p.sku===sku); if(idx<0)return;
  const newStock=allProducts[idx].stock+qty;
  try {
    await dbUpdateStock(sku,newStock);
    allProducts[idx].stock=newStock;
    closeModal('restock-modal');
    renderInventory(); renderProducts(); refreshDashboard();
    showToast('+'+qty+' units restocked ✅','success');
  } catch(e) {
    showToast('Restock failed: '+e.message,'error');
  }
}

// ─────────────────────────────────────────
//  SALES HISTORY (from localStorage)
// ─────────────────────────────────────────
function setDefaultDates(){
  const now=new Date(),from=new Date(now.getFullYear(),now.getMonth(),1);
  document.getElementById('sales-from').value=from.toLocaleDateString('en-CA');
  document.getElementById('sales-to').value=now.toLocaleDateString('en-CA');
}

let _salesMap={};

function viewSaleByTxn(txnNum){const s=_salesMap[txnNum];if(s)showInvoice(s);}

function renderSales(){
  const isOwner=CU&&CU.role==='owner';
  document.getElementById('sales-void-th').style.display=isOwner?'':'none';
  const clearBtn=document.getElementById('clear-all-sales-btn');
  if(clearBtn)clearBtn.style.display=isOwner?'':'none';
  const from=document.getElementById('sales-from').value,to=document.getElementById('sales-to').value;
  const pay=document.getElementById('sales-pay').value;
  const allSales=get(K.sales);
  _salesMap={};allSales.forEach(s=>{_salesMap[s.txnNum]=s;});
  const sales=allSales.filter(s=>{const d=(s.date||'').slice(0,10);return(!from||d>=from)&&(!to||d<=to)&&(!pay||s.payment===pay);}).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const fmt=n=>'Rs. '+n.toLocaleString('en-PH',{minimumFractionDigits:2});
  document.getElementById('sales-tbody').innerHTML=sales.length
    ?sales.map(s=>{
      const voided=!!s.voided;
      return`<tr class="${voided?'void-row':''}">
        <td><code>${s.txnNum}</code>${voided?`<br><span style="font-size:10px;color:var(--red);font-weight:700;">VOID</span>`:''}</td>
        <td>${new Date(s.date).toLocaleString('en-PH')}</td>
        <td>${s.customer}</td>
        <td>${s.items.length} item(s)</td>
        <td><span class="badge ${voided?'voided':s.payment}">${voided?'VOIDED':s.payment.toUpperCase()}</span></td>
        <td style="color:var(--green);">${s.discount>0?'-'+fmt(s.discount):'—'}</td>
        <td style="font-weight:700;color:${voided?'var(--red)':'var(--gold-600)'};">${voided?'<s>'+fmt(s.total)+'</s>':fmt(s.total)}</td>
        <td><button class="btn btn-outline btn-sm" onclick="viewSaleByTxn('${s.txnNum}')">👁 View</button></td>
        ${isOwner?`<td><button class="btn-void" onclick="voidSale('${s.txnNum}')">⊘ Void</button></td>`:''}
      </tr>`;
    }).join('')
    :'<tr><td colspan="9" style="text-align:center;color:var(--gray-400);padding:24px;">No sales in this range.</td></tr>';
}

function voidSale(txnNum){
  if(CU.role!=='owner'){showToast('Only the owner can void sales!','error');return;}
  if(!confirm('Void transaction '+txnNum+'?'))return;
  const sales=get(K.sales),idx=sales.findIndex(s=>s.txnNum===txnNum);
  if(idx<0)return;
  sales[idx].voided=true;set(K.sales,sales);
  renderSales();refreshDashboard();
  showToast(txnNum+' voided ✅','success');
}

function clearAllSales(){
  if(CU.role!=='owner'){showToast('Only the owner can do this!','error');return;}
  if(!confirm('Delete ALL sales records? This cannot be undone.'))return;
  set(K.sales,[]); renderSales(); refreshDashboard();
  showToast('All sales cleared 🗑','success');
}

// Stub — sales are local; no Sheets to push to
function pushAllSalesToSheets(){ showToast('Sales are stored in Supabase via checkout ✅','success'); }
function toggleSaveLog(){}

// ─────────────────────────────────────────
//  REPORTS
// ─────────────────────────────────────────
function switchReport(id,el){
  ['sales-report','inv-report'].forEach(r=>document.getElementById(r).style.display='none');
  document.getElementById(id).style.display='block';
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
}

function renderReports(){
  const now=new Date();
  const fromEl=document.getElementById('rpt-from'),toEl=document.getElementById('rpt-to');
  if(!fromEl.value&&!toEl.value){
    fromEl.value=new Date(now.getFullYear(),now.getMonth(),1).toLocaleDateString('en-CA');
    toEl.value=now.toLocaleDateString('en-CA');
  }
  const from=fromEl.value,to=toEl.value;
  const fmt=n=>'Rs. '+n.toLocaleString('en-PH',{minimumFractionDigits:0});
  const allSales=get(K.sales).filter(s=>!s.voided);
  const sales=allSales.filter(s=>{const d=(s.date||'').slice(0,10);return(!from||d>=from)&&(!to||d<=to);});
  const totalRev=sales.reduce((a,s)=>a+s.total,0);
  const cashRev=sales.filter(s=>s.payment==='cash').reduce((a,s)=>a+s.total,0);
  const cardRev=sales.filter(s=>s.payment==='card').reduce((a,s)=>a+s.total,0);
  const avgOrder=sales.length?totalRev/sales.length:0;
  const totalDisc=sales.reduce((a,s)=>a+(s.discount||0),0);
  document.getElementById('report-mini').innerHTML=`
    <div class="mini-stat"><div class="label">Revenue</div><div class="value">${fmt(totalRev)}</div></div>
    <div class="mini-stat"><div class="label">Total Orders</div><div class="value">${sales.length}</div></div>
    <div class="mini-stat"><div class="label">Avg Order</div><div class="value">${fmt(avgOrder)}</div></div>
    <div class="mini-stat"><div class="label">Cash Sales</div><div class="value">${fmt(cashRev)}</div></div>
    <div class="mini-stat"><div class="label">Card Sales</div><div class="value">${fmt(cardRev)}</div></div>
    <div class="mini-stat"><div class="label">Total Discounts</div><div class="value">${fmt(totalDisc)}</div></div>`;
  const ps={};
  sales.forEach(s=>s.items.forEach(it=>{
    if(!ps[it.name])ps[it.name]={units:0,rev:0,cat:''};
    ps[it.name].units+=it.qty; ps[it.name].rev+=it.qty*it.price;
  }));
  allProducts.forEach(p=>{if(ps[p.name])ps[p.name].cat=p.category;});
  const top=Object.entries(ps).sort((a,b)=>b[1].rev-a[1].rev).slice(0,15);
  document.getElementById('report-top').innerHTML=top.length
    ?top.map(([n,d],i)=>`<tr><td style="color:var(--gray-400);font-weight:700;">#${i+1}</td><td>${n}</td><td>${d.cat||'—'}</td><td>${d.units}</td><td style="font-weight:700;color:var(--gold-600);">Rs. ${d.rev.toLocaleString('en-PH',{minimumFractionDigits:2})}</td></tr>`).join('')
    :'<tr><td colspan="5" style="text-align:center;color:var(--gray-400);padding:16px;">No sales in this period.</td></tr>';
  document.getElementById('report-inv').innerHTML=allProducts.length
    ?allProducts.map(p=>{
      const sc=p.stock===0?'out-stock':p.stock<=5?'low-stock':'in-stock';
      const sl=p.stock===0?'Out of Stock':p.stock<=5?'Low Stock':'In Stock';
      let unitsSold=0; sales.forEach(s=>s.items.forEach(it=>{if(it.sku===p.sku)unitsSold+=it.qty;}));
      return`<tr><td><code>${p.sku}</code></td><td><strong>${p.name}</strong></td><td>${p.category}</td><td><strong>${p.stock}</strong></td><td>${unitsSold>0?'<span style="color:var(--green);font-weight:700;">'+unitsSold+' sold</span>':'—'}</td><td>—</td><td>Rs. ${Number(p.price).toLocaleString()}</td><td>—</td><td><span class="badge ${sc}">${sl}</span></td></tr>`;
    }).join('')
    :'<tr><td colspan="9" style="text-align:center;color:var(--gray-400);padding:16px;">No products.</td></tr>';
}

// ─────────────────────────────────────────
//  SETTINGS
// ─────────────────────────────────────────
function renderSettings(){
  if(CU.role==='cashier'){document.getElementById('settings-page').innerHTML='<div class="no-access"><span style="font-size:48px;">🔒</span><p>Access Denied</p></div>';return;}
  const cfg=getCfg();
  document.getElementById('cfg-name').value=cfg.name||'';
  document.getElementById('cfg-address').value=cfg.address||'';
  document.getElementById('cfg-phone').value=cfg.phone||'';
  document.getElementById('cfg-vat').value=cfg.vat||0;
}
function saveConfig(){
  set(K.config,{name:document.getElementById('cfg-name').value,address:document.getElementById('cfg-address').value,phone:document.getElementById('cfg-phone').value,vat:parseFloat(document.getElementById('cfg-vat').value)||0});
  showToast('Settings saved ✅','success');
}

// ─────────────────────────────────────────
//  WEBSITE EDITOR
// ─────────────────────────────────────────
async function renderWebsiteEditor() {
  const noAccess = document.getElementById('website-no-access');
  const editor   = document.getElementById('website-editor');
  if (CU.role !== 'developer' && CU.role !== 'owner') {
    if (noAccess) noAccess.style.display = 'flex';
    if (editor)   editor.style.display   = 'none';
    return;
  }
  if (noAccess) noAccess.style.display = 'none';
  if (editor)   editor.style.display   = 'block';

  // Load current settings from Supabase and populate fields
  try {
    const s = await dbGetSettings();
    const v = (id, val) => { const e = document.getElementById(id); if (e) e.value = val || ''; };
    v('ws-name',     s.name);
    v('ws-tagline',  s.tagline);
    v('ws-about',    s.about);
    v('ws-address',  s.address);
    v('ws-phone',    s.phone);
    v('ws-email',    s.email);
    v('ws-fb',       s.facebook);
    v('ws-ig',       s.instagram);
    v('ws-map',      s.map);
    v('ws-emoji',    s.emoji);
    v('ws-hero-color',     s.hero_color     || '#FFFDF0');
    v('ws-hero-color-txt', s.hero_color     || '#FFFDF0');
    v('ws-accent-color',     s.accent_color || '#EAB308');
    v('ws-accent-color-txt', s.accent_color || '#EAB308');

    // Sync color pickers with text inputs
    ['hero-color','accent-color'].forEach(key => {
      const picker = document.getElementById('ws-' + key);
      const txt    = document.getElementById('ws-' + key + '-txt');
      if (picker && txt) {
        picker.oninput = () => txt.value   = picker.value;
        txt.oninput    = () => picker.value = txt.value;
      }
    });

    syncFeaturedFromInventory();
  } catch(e) {
    showToast('Could not load site settings', 'error');
  }
}

async function publishSiteData() {
  const g = id => (document.getElementById(id)?.value || '').trim();

  // Build array of {key, value} pairs matching the Supabase settings table schema
  const entries = [
    { key: 'name',         value: g('ws-name')            },
    { key: 'tagline',      value: g('ws-tagline')          },
    { key: 'about',        value: g('ws-about')            },
    { key: 'address',      value: g('ws-address')          },
    { key: 'phone',        value: g('ws-phone')            },
    { key: 'email',        value: g('ws-email')            },
    { key: 'facebook',     value: g('ws-fb')               },
    { key: 'instagram',    value: g('ws-ig')               },
    { key: 'map',          value: g('ws-map')              },
    { key: 'emoji',        value: g('ws-emoji')            },
    { key: 'hero_color',   value: g('ws-hero-color-txt')   },
    { key: 'accent_color', value: g('ws-accent-color-txt') },
  ];

  const btn = document.querySelector('[onclick="publishSiteData()"]');
  if (btn) { btn.textContent = '⏳ Publishing…'; btn.disabled = true; }

  try {
    await dbSaveSettings(entries);
    showToast('✅ Website settings published!', 'success');
  } catch(e) {
    showToast('❌ Publish failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.textContent = '🚀 Publish Changes'; btn.disabled = false; }
  }
}

function syncFeaturedFromInventory() {
  const list = document.getElementById('featured-product-list');
  if (!list) return;
  const inStock = allProducts.filter(p => p.stock > 0);
  if (!inStock.length) { list.innerHTML = '<p style="font-size:13px;color:var(--gray-400);">No in-stock products found.</p>'; return; }
  list.innerHTML = inStock.map(p => `
    <div style="background:var(--gray-50);border-radius:10px;padding:12px;font-size:12px;">
      <div style="font-weight:700;margin-bottom:4px;">${p.name}</div>
      <div style="color:var(--gray-400);">${p.category} · Rs. ${Number(p.price).toLocaleString()}</div>
      <div style="color:var(--green);margin-top:4px;">${p.stock} in stock</div>
    </div>`).join('');
}

function toggleFeatured() {}

// ─────────────────────────────────────────
//  CSV EXPORT
// ─────────────────────────────────────────
function exportProductsCSV(){
  const rows=[['SKU','Name','Category','Price','Stock','Description']];
  allProducts.forEach(p=>rows.push([p.sku,p.name,p.category,p.price,p.stock,p.description||'']));
  dlCSV(rows,'jj_products.csv');
}
function exportSalesCSV(){
  const rows=[['TxnNum','Date','Customer','Items','Subtotal','Discount','Total','Payment','Cashier']];
  get(K.sales).forEach(s=>rows.push([s.txnNum,new Date(s.date).toLocaleString('en-PH'),s.customer,s.items.map(i=>`${i.name}(${i.qty})`).join(';'),s.subtotal,s.discount,s.total,s.payment,s.cashier]));
  dlCSV(rows,'jj_sales.csv');
}
function dlCSV(rows,fn){
  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv); a.download=fn; a.click();
}
function doImportCSV(){showToast('Import not available in Supabase mode','error');}

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────
function nextTxnNum(){
  const sales=get(K.sales);if(!sales.length)return'TXN-000001';
  const nums=sales.map(s=>parseInt((s.txnNum||'0').replace(/\D/g,''))||0);
  return'TXN-'+String(Math.max(...nums)+1).padStart(6,'0');
}

function openModal(id){document.getElementById(id).classList.add('active');}
function closeModal(id){document.getElementById(id).classList.remove('active');}
document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('.modal-overlay').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('active');}));
});

function showToast(msg,type=''){
  const toast=document.getElementById('toast')||document.body;
  const t=document.createElement('div'); t.className='toast-msg '+(type||''); t.textContent=msg;
  toast.appendChild(t); setTimeout(()=>t.remove(),3200);
}

// Mobile helpers
let _cartOpen=false;
function toggleMobileSidebar(){
  const sb=document.querySelector('.sidebar'),ov=document.getElementById('sidebar-overlay');
  const isOpen=sb.classList.contains('mob-open');
  if(isOpen){closeMobileSidebar();}else{sb.classList.add('mob-open');if(ov)ov.classList.add('open');}
}
function closeMobileSidebar(){
  document.querySelector('.sidebar').classList.remove('mob-open');
  const ov=document.getElementById('sidebar-overlay');if(ov)ov.classList.remove('open');
}
function toggleMobileCart(){
  _cartOpen=!_cartOpen;
  const panel=document.querySelector('.pos-right'),bar=document.getElementById('cart-toggle-bar');
  if(panel)panel.classList.toggle('cart-open',_cartOpen);
  if(bar)bar.querySelector('span').textContent=_cartOpen?'✕ Close Cart':'🛒 View Cart';
}
function setMobNav(el){
  document.querySelectorAll('.mob-nav-item').forEach(x=>x.classList.remove('active'));
  if(el)el.classList.add('active');
  closeMobileSidebar();
  if(el&&el.dataset.page!=='pos'){
    _cartOpen=false;
    const panel=document.querySelector('.pos-right');if(panel)panel.classList.remove('cart-open');
  }
}

// Keep mobile nav in sync with showPage
const _origShowPage=showPage;
showPage=function(p){
  _origShowPage(p);
  document.querySelectorAll('.mob-nav-item').forEach(x=>{x.classList.toggle('active',x.dataset.page===p);});
};

// ─────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────
seed();
