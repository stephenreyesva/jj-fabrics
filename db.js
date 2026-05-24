// ============================================================
//  JJ Fabrics — Supabase Database Layer
//  Shared by pos.html and store.html
// ============================================================

const SUPABASE_URL = 'https://qkinurfvnhpywfvzwgpi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_DJDFFhc7nCm-vQsksDgRJg_mWvN3fYg';

const HEADERS = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Prefer': 'return=representation'
};

// ── PRODUCTS ──────────────────────────────────────────────

async function dbGetProducts() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/products?order=created_at.asc`, {
    headers: HEADERS
  });
  if (!res.ok) throw new Error('Failed to fetch products');
  return res.json();
}

async function dbSaveProduct(product) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/products?on_conflict=sku`, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      sku:         product.sku,
      name:        product.name,
      category:    product.category,
      price:       Number(product.price),
      stock:       Number(product.stock),
      img:         product.img || '',
      description: product.description || '',
      updated_at:  new Date().toISOString()
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Save failed: ' + err);
  }
  return res.json();
}

async function dbDeleteProduct(sku) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/products?sku=eq.${encodeURIComponent(sku)}`, {
    method: 'DELETE',
    headers: HEADERS
  });
  if (!res.ok) throw new Error('Delete failed');
}

async function dbUpdateStock(sku, newStock) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/products?sku=eq.${encodeURIComponent(sku)}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ stock: newStock, updated_at: new Date().toISOString() })
  });
  if (!res.ok) throw new Error('Stock update failed');
}

// ── SALES ─────────────────────────────────────────────────

async function dbSaveSale(sale) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sales`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      sale_ref:       sale.ref,
      items:          sale.items,
      subtotal:       Number(sale.subtotal),
      discount:       Number(sale.discount || 0),
      total:          Number(sale.total),
      payment_method: sale.paymentMethod || 'cash',
      cashier:        sale.cashier || ''
    })
  });
  if (!res.ok) throw new Error('Sale save failed');
  return res.json();
}

async function dbGetSales() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sales?order=created_at.desc`, {
    headers: HEADERS
  });
  if (!res.ok) throw new Error('Failed to fetch sales');
  return res.json();
}

// ── USERS ─────────────────────────────────────────────────

async function dbLogin(username, password) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?username=eq.${encodeURIComponent(username)}&password=eq.${encodeURIComponent(password)}&select=id,username,role`,
    { headers: HEADERS }
  );
  if (!res.ok) throw new Error('Login failed');
  const rows = await res.json();
  return rows.length > 0 ? rows[0] : null;
}

// ── SETTINGS ──────────────────────────────────────────────

async function dbGetSettings() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/settings`, { headers: HEADERS });
  if (!res.ok) return {};
  const rows = await res.json();
  const out = {};
  rows.forEach(r => out[r.key] = r.value);
  return out;
}
