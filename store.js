// ============================================================
//  JJ Fabrics Store — Display Logic
//  Backend: Supabase (via db.js)
// ============================================================

let allProducts  = [];
let activeFilter = '';

window.addEventListener('DOMContentLoaded', async () => {
  await loadStoreProducts();
});

async function loadStoreProducts() {
  try {
    allProducts = await dbGetProducts();
    renderStore();
    updateCounts();
    updateStatCounter();
    renderHeroCards();
  } catch(e) {
    document.getElementById('product-grid').innerHTML =
      '<div class="loading-state">Unable to load products. Please check your connection and refresh.</div>';
  } finally {
    // FIX 3: Always hide the loader after load attempt
    const loader = document.getElementById('page-loader');
    if (loader) {
      loader.style.opacity = '0';
      setTimeout(() => loader.style.display = 'none', 500);
    }
  }
}

// FIX 6: renamed to filterCat to match HTML onclick="filterCat(...)"
function filterCat(cat) {
  activeFilter = cat;
  // Update active state on category cards
  document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('active'));
  event && event.currentTarget && event.currentTarget.classList.add('active');
  renderStore();
}

// Keep filterStore for the filter-btn bar (if used elsewhere)
function filterStore(cat, btn) {
  activeFilter = cat;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderStore();
}

function renderStore() {
  // FIX 1: correct element ID — HTML uses "product-grid", not "store-grid"
  const grid = document.getElementById('product-grid');
  const list = activeFilter === '' || activeFilter === 'all'
    ? allProducts
    : allProducts.filter(p => p.category === activeFilter);

  // Update visible count label
  const countEl = document.getElementById('products-count');
  if (countEl) countEl.textContent = list.length + ' product' + (list.length !== 1 ? 's' : '');

  if (!list.length) {
    grid.innerHTML = '<div class="empty-store"><span>🧵</span>No products in this category yet.</div>';
    return;
  }

  grid.innerHTML = list.map((p, i) => {
    const isNew    = i < 3;
    const lowStock = p.stock > 0 && p.stock <= 5;
    return `<div class="store-card">
      <img src="${p.img || ''}" alt="${p.name}"
           onerror="this.style.background='#222';this.style.minHeight='260px';this.removeAttribute('src')"/>
      <div class="card-body">
        <div>
          <span class="card-badge">${p.category}</span>
          ${isNew ? '<span class="card-badge card-new-badge">NEW</span>' : ''}
        </div>
        <div class="card-name">${p.name}</div>
        <div class="card-sku">${p.sku}</div>
        <div class="card-footer">
          <span class="card-price">Rs. ${Number(p.price).toLocaleString()}</span>
          <span class="card-stock ${lowStock ? 'low' : ''}">
            ${p.stock <= 0 ? 'Out of stock' : lowStock ? 'Only ' + p.stock + ' left' : 'In stock'}
          </span>
        </div>
      </div>
    </div>`;
  }).join('');
}

// FIX 4 & 5: update stat counter and category counts
function updateStatCounter() {
  const el = document.getElementById('stat-products');
  if (el) el.textContent = allProducts.length + '+';
}

function updateCounts() {
  const all   = allProducts.length;
  const women = allProducts.filter(p => p.category === 'Ladies Suiting').length;
  const men   = allProducts.filter(p => p.category === 'Gents Suiting').length;
  const acc   = allProducts.filter(p => p.category === 'Accessories').length;

  const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n + ' item' + (n !== 1 ? 's' : ''); };
  set('cnt-all',   all);
  set('cnt-women', women);
  set('cnt-men',   men);
  set('cnt-acc',   acc);
}

// FIX 2: renderHeroCards — populate the existing hc1/hc2/hc3 elements in the HTML
function renderHeroCards() {
  const withImg = allProducts.filter(p => p.img && p.img.length > 4);
  const cards   = withImg.slice(0, 3);

  cards.forEach((p, i) => {
    const n = i + 1;
    const imgEl   = document.getElementById('hc' + n);
    const nameEl  = document.getElementById('hc' + n + '-name');
    const priceEl = document.getElementById('hc' + n + '-price');

    if (imgEl) {
      imgEl.innerHTML = `<img src="${p.img}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;"
        onerror="this.parentElement.innerHTML='👗'"/>`;
    }
    if (nameEl)  nameEl.textContent  = p.name;
    if (priceEl) priceEl.textContent = 'Rs. ' + Number(p.price).toLocaleString();
  });
}
