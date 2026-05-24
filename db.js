// ═══════════════════════════════════════════════════════════════
//  JJ Fabrics — Supabase Database Layer (shared by POS + Store)
//  File: db.js  —  include BEFORE pos.js or store.js
// ═══════════════════════════════════════════════════════════════
//
//  SETUP (one-time, 5 minutes):
//  1. Go to https://supabase.com → New project → name it "jj-fabrics"
//  2. After project loads → Settings → API
//     Copy "Project URL" and "anon public" key into the two lines below
//  3. Go to SQL Editor → paste and run the SQL from jj-fabrics-setup.sql
//  4. Done — all products saved via POS appear instantly in the store
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL  = 'YOUR_SUPABASE_URL';   // e.g. https://xxxx.supabase.co
const SUPABASE_KEY  = 'YOUR_SUPABASE_ANON_KEY'; // starts with "eyJ..."

// ── Low-level REST helper ──────────────────────────────────────
async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        options.prefer || 'return=representation',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Supabase error ${res.status}: ${err.message || res.statusText}`);
  }
  // 204 No Content has no body
  if (res.status === 204) return [];
  return res.json();
}

// ═══════════════════════════════════════════════════════════════
//  PRODUCTS
// ═══════════════════════════════════════════════════════════════

// Read all active products ordered by created_at
async function dbGetProducts() {
  const rows = await sbFetch('products?select=*&active=eq.true&order=created_at.asc');
  return rows.map(r => ({
    sku:      r.sku,
    name:     r.name,
    brand:    r.brand     || '',
    category: r.category  || '',
    size:     r.size      || '',
    price:    Number(r.price)    || 0,
    cost:     Number(r.cost)     || 0,
    stock:    Number(r.stock)    || 0,
    minStock: Number(r.min_stock)|| 0,
    desc:     r.description || '',
    img:      r.image_url   || '',
    active:   r.active !== false
  }));
}

// Upsert (insert or update) a single product
async function dbSaveProduct(p) {
  const row = {
    sku:         p.sku,
    name:        p.name,
    brand:       p.brand     || '',
    category:    p.category  || '',
    size:        p.size       || '',
    price:       p.price      || 0,
    cost:        p.cost       || 0,
    stock:       p.stock      || 0,
    min_stock:   p.minStock   || 0,
    description: p.desc       || '',
    image_url:   p.img        || '',
    active:      p.active !== false
  };
  return sbFetch('products', {
    method:  'POST',
    prefer:  'resolution=merge-duplicates,return=representation',
    body:    JSON.stringify(row)
  });
}

// Upsert multiple products at once
async function dbSaveProducts(products) {
  const rows = products.map(p => ({
    sku:         p.sku,
    name:        p.name,
    brand:       p.brand     || '',
    category:    p.category  || '',
    size:        p.size       || '',
    price:       p.price      || 0,
    cost:        p.cost       || 0,
    stock:       p.stock      || 0,
    min_stock:   p.minStock   || 0,
    description: p.desc       || '',
    image_url:   p.img        || '',
    active:      p.active !== false
  }));
  return sbFetch('products', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body:   JSON.stringify(rows)
  });
}

// Delete a product by SKU
async function dbDeleteProduct(sku) {
  return sbFetch(`products?sku=eq.${encodeURIComponent(sku)}`, {
    method: 'DELETE',
    prefer: 'return=minimal'
  });
}

// Update only the stock for a product
async function dbUpdateStock(sku, newStock) {
  return sbFetch(`products?sku=eq.${encodeURIComponent(sku)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body:   JSON.stringify({ stock: newStock, updated_at: new Date().toISOString() })
  });
}

// ═══════════════════════════════════════════════════════════════
//  SALES
// ═══════════════════════════════════════════════════════════════

async function dbSaveSale(sale) {
  // Insert sale header
  const [savedSale] = await sbFetch('sales', {
    method: 'POST',
    prefer: 'return=representation',
    body:   JSON.stringify({
      txn_num:    sale.txnNum,
      date:       sale.date,
      customer:   sale.customer   || 'Walk-in',
      cashier:    sale.cashier    || '',
      subtotal:   sale.subtotal   || 0,
      discount:   sale.discount   || 0,
      vat:        sale.vat        || 0,
      total:      sale.total      || 0,
      payment:    sale.payment    || 'cash',
      voided:     sale.voided     || false,
      void_reason:sale.voidReason || null
    })
  });
  // Insert sale items
  if (savedSale && sale.items && sale.items.length) {
    const items = sale.items.map(it => ({
      sale_id:    savedSale.id,
      txn_num:    sale.txnNum,
      sku:        it.sku,
      name:       it.name,
      qty:        it.qty,
      unit_price: it.price,
      total:      it.qty * it.price
    }));
    await sbFetch('sale_items', {
      method: 'POST',
      prefer: 'return=minimal',
      body:   JSON.stringify(items)
    });
  }
  return savedSale;
}

async function dbGetSales(from, to) {
  let path = 'sales?select=*,sale_items(*)&order=date.desc';
  if (from) path += `&date=gte.${from}`;
  if (to)   path += `&date=lte.${to}T23:59:59`;
  const rows = await sbFetch(path);
  return rows.map(r => ({
    txnNum:    r.txn_num,
    date:      r.date,
    customer:  r.customer,
    cashier:   r.cashier,
    subtotal:  r.subtotal,
    discount:  r.discount,
    vat:       r.vat,
    total:     r.total,
    payment:   r.payment,
    voided:    r.voided,
    voidReason:r.void_reason,
    items:     (r.sale_items || []).map(it => ({
      sku:   it.sku,
      name:  it.name,
      qty:   it.qty,
      price: it.unit_price
    }))
  }));
}

async function dbVoidSale(txnNum, reason) {
  return sbFetch(`sales?txn_num=eq.${encodeURIComponent(txnNum)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body:   JSON.stringify({ voided: true, void_reason: reason, voided_at: new Date().toISOString() })
  });
}

// ═══════════════════════════════════════════════════════════════
//  SITE SETTINGS
// ═══════════════════════════════════════════════════════════════

async function dbGetSettings() {
  const rows = await sbFetch('settings?select=key,value');
  const obj = {};
  rows.forEach(r => {
    try { obj[r.key] = JSON.parse(r.value); }
    catch { obj[r.key] = r.value; }
  });
  return obj;
}

async function dbSaveSettings(settings) {
  const rows = Object.entries(settings).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value)
  }));
  return sbFetch('settings', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body:   JSON.stringify(rows)
  });
}

// ═══════════════════════════════════════════════════════════════
//  USERS
// ═══════════════════════════════════════════════════════════════

async function dbGetUsers() {
  const rows = await sbFetch('users?select=username,password,full_name,role&active=eq.true');
  return rows.map(r => ({
    username: r.username,
    password: r.password,
    name:     r.full_name || r.username,
    role:     r.role || 'cashier'
  }));
}

// ═══════════════════════════════════════════════════════════════
//  CONNECTION TEST
// ═══════════════════════════════════════════════════════════════

async function dbTest() {
  try {
    const rows = await sbFetch('products?select=sku&limit=1');
    return { ok: true, msg: 'Connected ✅' };
  } catch(e) {
    return { ok: false, msg: e.message };
  }
}
