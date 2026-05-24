// ============================================================
//  JJ Fabrics Store — Display Logic
// ============================================================

let allProducts = [];
let activeFilter = 'all';

window.addEventListener('DOMContentLoaded', async () => {
  await loadStoreProducts();
});

async function loadStoreProducts() {
  try {
    allProducts = await dbGetProducts();
    renderStore();
    renderHeroCards();
  } catch(e) {
    document.getElementById('store-grid').innerHTML =
      '<div class="loading-state">Unable to load products. Please refresh the page.</div>';
  }
}

function filterStore(cat, btn) {
  activeFilter = cat;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderStore();
}

function renderStore() {
  const grid = document.getElementById('store-grid');
  const list = activeFilter === 'all'
    ? allProducts
    : allProducts.filter(p => p.category === activeFilter);

  if (!list.length) {
    grid.innerHTML = '<div class="empty-store"><span>🧵</span>No products in this category yet.</div>';
    return;
  }

  grid.innerHTML = list.map((p, i) => {
    const isNew = i < 3;
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

function renderHeroCards() {
  const withImg = allProducts.filter(p => p.img && p.img.length > 4);
  const cards = withImg.slice(0, 3);
  const el = document.getElementById('hero-cards');
  if (!cards.length) { el.style.display = 'none'; return; }
  el.innerHTML = cards.map(p => `
    <div class="hero-card">
      <img src="${p.img}" alt="${p.name}" onerror="this.parentElement.style.display='none'"/>
      <div class="hero-card-info">
        <div class="hero-card-new">NEW</div>
        <div class="hc-name">${p.name}</div>
        <div class="hc-price">Rs. ${Number(p.price).toLocaleString()}</div>
      </div>
    </div>`).join('');
}
