// ============================================================
//  JJ Fabrics — Supabase Database Layer
//  Shared by pos.html and store.html
// ============================================================

const SUPABASE_URL = 'https://qkinurfvnhpywfvzwgpi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFraW51cmZ2bmhweXdmdnp3Z3BpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1OTMyNjQsImV4cCI6MjA5NTE2OTI2NH0.8ZVj7grTG_dmyNs-m89uumr9WhGgpvSzsenLpXe0Kec';

const HEADERS = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Prefer': 'return=representation'
};

// ── PRODUCTS ──────────────────────────────────────────────

async function dbGetProducts() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/products?order=created_at.desc`, {
    headers: HEADERS
  });
  if (!res.ok) throw new Error('Failed to fetch products');
  return res.json();
}

async function dbSaveProduct(product) {
  // Build payload — only include img2-5 if the columns exist in Supabase.
  // If you get PGRST204 errors, run this SQL in Supabase SQL editor:
  //   ALTER TABLE products ADD COLUMN IF NOT EXISTS img2 text DEFAULT '';
  //   ALTER TABLE products ADD COLUMN IF NOT EXISTS img3 text DEFAULT '';
  //   ALTER TABLE products ADD COLUMN IF NOT EXISTS img4 text DEFAULT '';
  //   ALTER TABLE products ADD COLUMN IF NOT EXISTS img5 text DEFAULT '';
  //   ALTER TABLE products ADD COLUMN IF NOT EXISTS cost numeric DEFAULT 0;
  //   ALTER TABLE products ADD COLUMN IF NOT EXISTS min_stock integer DEFAULT 5;
  const payload = {
    sku:         product.sku,
    name:        product.name,
    category:    product.category,
    price:       Number(product.price),
    stock:       Number(product.stock),
    img:         product.img || '',
    description: product.description || '',
    is_new:      product.is_new || false,
    sale_price:  product.sale_price || null,
    updated_at:  new Date().toISOString()
  };
  // Only add extra image fields if they have a value — avoids PGRST204 if columns missing
  if (product.img2  !== undefined) payload.img2  = product.img2  || '';
  if (product.img3  !== undefined) payload.img3  = product.img3  || '';
  if (product.img4  !== undefined) payload.img4  = product.img4  || '';
  if (product.img5  !== undefined) payload.img5  = product.img5  || '';
  if (product.cost  !== undefined) payload.cost  = Number(product.cost) || 0;
  if (product.min_stock !== undefined) payload.min_stock = Number(product.min_stock) || 5;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/products?on_conflict=sku`, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(payload)
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
    `${SUPABASE_URL}/rest/v1/users?username=eq.${encodeURIComponent(username)}&password=eq.${encodeURIComponent(password)}&select=*`,
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

async function dbSaveSettings(entries) {
  // entries = [{key, value}, ...] — upsert each row by key
  const res = await fetch(`${SUPABASE_URL}/rest/v1/settings?on_conflict=key`, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(entries)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Settings save failed: ' + err);
  }
  return res.json();
}

// ── GET ALL USERS (for Settings > User Accounts panel) ────

async function dbGetAllUsers() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?select=*&order=role.asc`,
    { headers: HEADERS }
  );
  if (!res.ok) throw new Error('Failed to fetch users');
  return res.json();
}

// ── DELETE SALE (owner/developer only) ────────────────────

async function dbDeleteSale(txnNum) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/sales?sale_ref=eq.${encodeURIComponent(txnNum)}`,
    { method: 'DELETE', headers: HEADERS }
  );
  if (!res.ok) throw new Error('Delete failed: ' + await res.text());
}
