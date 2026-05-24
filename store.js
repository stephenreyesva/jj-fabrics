// ============================================================
//  JJ Fabrics Store — Display Logic
//  Backend: Supabase (via db.js)
// ============================================================

const catEmoji = { 'Ladies Suiting': '👘', 'Gents Suiting': '👔', 'Accessories': '💎', 'Kids': '👦' };

let allProducts  = [];
let activeFilter = '';
let _siteSettings = null;

// ── NULL-SAFE DOM HELPERS ──────────────────────────────────
function el(id)          { return document.getElementById(id); }
function setText(id, val) { const e = el(id); if (e) e.textContent = val; }
function setHtml(id, val) { const e = el(id); if (e) e.innerHTML   = val; }
function setHref(id, val) { const e = el(id); if (e) e.href        = val; }

// ── SHADE COLOR HELPER ────────────────────────────────────
function shadeColor(hex, amt) {
  try {
    let r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    r = Math.min(255,Math.max(0,r+amt)); g = Math.min(255,Math.max(0,g+amt)); b = Math.min(255,Math.max(0,b+amt));
    return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
  } catch { return hex; }
}

// ── LOADER ────────────────────────────────────────────────
function hideLoader() {
  const loader = el('page-loader');
  if (!loader) return;
  loader.style.opacity = '0';
  setTimeout(() => loader.style.display = 'none', 500);
}
// Safety net: force-hide loader after 3s no matter what
setTimeout(() => hideLoader(), 3000);

// ── APPLY SITE SETTINGS ───────────────────────────────────
function applySiteData(s) {
  if (!s) return;
  _siteSettings = s;

  if (s.accent_color) {
    document.documentElement.style.setProperty('--accent', s.accent_color);
    document.documentElement.style.setProperty('--accent-dark', shadeColor(s.accent_color, -20));
    document.documentElement.style.setProperty('--accent-lt',   shadeColor(s.accent_color,  80));
  }
  if (s.hero_color) document.documentElement.style.setProperty('--hero-section-bg', s.hero_color);

  const name = s.name || 'JJ Fabrics';
  setText('nav-name',       name);
  setText('footer-name',    name);
  setText('footer-tagline', s.tagline || '');
  setText('footer-copy',    `© ${new Date().getFullYear()} ${name}. All rights reserved.`);
  document.title = name;

  if (s.about) setText('about-text', s.about);

  // WhatsApp
  const waNum  = (s.phone || '').replace(/\D/g, '');
  const waLink = waNum ? `https://wa.me/${waNum}?text=Hi! I'm interested in your products.` : '#';
  ['wa-btn','nav-whatsapp','mob-wa','link-wa','cta-wa','fs-wa'].forEach(id => setHref(id, waLink));

  // Social links
  if (s.facebook)  ['link-fb','cta-fb','fs-fb'].forEach(id => setHref(id, s.facebook));
  if (s.instagram) ['link-ig','fs-ig'].forEach(id => setHref(id, s.instagram));
  if (s.tiktok)    ['link-tt','fs-tt'].forEach(id => setHref(id, s.tiktok));
  if (s.youtube)   ['link-yt','fs-yt'].forEach(id => setHref(id, s.youtube));

  // Contact info
  const phoneDisplay = waNum ? waNum.replace(/(\d{2})(\d{3})(\d{3})(\d{4})/, '+$1 $2 $3 $4') : '—';
  setHtml('contact-address',
    (s.address || '—') + (s.map_url
      ? `<br><a href="${s.map_url}" target="_blank" style="color:var(--accent-dark);font-size:12px;font-weight:700;">📍 Open in Google Maps →</a>`
      : ''));
  setText('contact-phone-link', phoneDisplay);
  setHref('contact-phone-link', waNum ? `tel:+${waNum}` : '#');
  setText('contact-email-link', s.email || '—');
  setHref('contact-email-link', s.email ? `mailto:${s.email}` : '#');

  // Embedded map
  if (s.map) setHtml('map-container', `<iframe src="${s.map}" allowfullscreen loading="lazy"></iframe>`);
}

// ── LOAD PRODUCTS ─────────────────────────────────────────
function loadProducts() {
  // Update category counts
  setText('stat-products', allProducts.length + '+');
  setText('cnt-all',   allProducts.length + ' items');
  setText('cnt-women', allProducts.filter(p => p.category === 'Ladies Suiting').length + ' items');
  setText('cnt-men',   allProducts.filter(p => p.category === 'Gents Suiting').length + ' items');
  setText('cnt-acc',   allProducts.filter(p => p.category === 'Accessories').length + ' items');

  // Hero cards
  const heroWithImg = allProducts.filter(p => p.img && p.img.length > 4);
  const heroItems   = (heroWithImg.length ? heroWithImg : allProducts).slice(0, 3);
  ['hc1', 'hc2', 'hc3'].forEach((hcId, idx) => {
    const p = heroItems[idx]; if (!p) return;
    const emoji = catEmoji[p.category] || '🛍️';
    const hc    = el(hcId); if (!hc) return;
    hc.innerHTML = p.img
      ? `<img src="${p.img}" style="width:100%;height:100%;object-fit:cover;"
           onerror="this.style.display='none';this.parentNode.insertAdjacentText('beforeend','${emoji}')">`
      : emoji;
    setText(hcId + '-name',  p.name);
    setText(hcId + '-price', 'Rs. ' + Number(p.price).toLocaleString());
  });

  renderProducts();
}

// ── FILTER HANDLERS ───────────────────────────────────────
function filterCat(cat) {
  activeFilter = cat;
  document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('active'));
  const idx = ['', 'Ladies Suiting', 'Gents Suiting', 'Accessories'].indexOf(cat);
  if (idx >= 0) document.querySelectorAll('.cat-card')[idx]?.classList.add('active');
  renderProducts();
}

function filterBrandNav(cat, elem) {
  document.querySelectorAll('.brands-nav-item').forEach(i => i.classList.remove('active'));
  if (elem) elem.classList.add('active');
  activeFilter = cat === 'all' ? '' : cat;
  renderProducts();
  el('collections')?.scrollIntoView({ behavior: 'smooth' });
}

// ── RENDER PRODUCTS ───────────────────────────────────────
function renderProducts() {
  const filtered = activeFilter
    ? allProducts.filter(p => p.category === activeFilter)
    : allProducts;

  const liveTag = '<span style="font-size:10px;background:#d4f7de;color:#166534;padding:2px 7px;border-radius:20px;font-weight:600;vertical-align:middle;">● LIVE</span>';
  const countEl = el('products-count');
  if (countEl) countEl.innerHTML = filtered.length + ' product' + (filtered.length !== 1 ? 's' : '') + ' shown ' + liveTag;

  const s     = _siteSettings || {};
  const waNum = (s.phone || '').replace(/\D/g, '');
  const grid  = el('product-grid');
  if (!grid) return;

  if (!filtered.length) {
    grid.innerHTML = `<div class="no-products" style="grid-column:1/-1;">
      <span class="np-icon">${activeFilter ? '🔍' : '🛍️'}</span>
      <p>${activeFilter ? 'No products in this category yet.' : 'Products loading… if this persists, please refresh the page.'}</p>
    </div>`;
    return;
  }

  grid.innerHTML = filtered.map((p, i) => {
    const emoji   = catEmoji[p.category] || '🛍️';
    const waMsg   = encodeURIComponent(`Hi! I'm interested in: ${p.name} (Rs. ${Number(p.price).toLocaleString()}). Is it available?`);
    const waHref  = waNum ? `https://wa.me/${waNum}?text=${waMsg}` : '#';
    const isNew   = i < 3;
    const fallback = `<span style="font-size:64px">${emoji}</span>`;
    const imgHtml = p.img
      ? `<img src="${p.img}" alt="${p.name}" loading="lazy" style="width:100%;height:100%;object-fit:cover;"
             onerror="this.parentNode.innerHTML=this.dataset.fb" data-fb="${fallback.replace(/"/g,'&quot;')}">`
      : fallback;
    return `<div class="product-card" style="animation-delay:${i*0.06}s">
      ${isNew ? '<div class="pc-badge">New</div>' : ''}
      <div class="pc-image">${imgHtml}</div>
      <div class="pc-body">
        <div class="pc-category">${p.category}</div>
        <div class="pc-name">${p.name}</div>
        <div class="pc-size">SKU: ${p.sku}</div>
        ${p.description ? `<div style="font-size:11px;color:var(--gray-400);margin-bottom:10px;line-height:1.4;">${p.description}</div>` : ''}
        <div class="pc-footer">
          <div class="pc-price">Rs. ${Number(p.price).toLocaleString()}</div>
          <a class="pc-action" href="${waHref}" target="_blank">Order →</a>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── NAV SCROLL ────────────────────────────────────────────
window.addEventListener('scroll', () => {
  el('navbar')?.classList.toggle('scrolled', window.scrollY > 40);
  el('back-top')?.classList.toggle('visible', window.scrollY > 300);
});

// ── MOBILE MENU ───────────────────────────────────────────
function toggleMobile() {
  el('mobile-menu')?.classList.toggle('open');
}

// ── REVEAL ON SCROLL ──────────────────────────────────────
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

// ── QR CODE DOWNLOAD ──────────────────────────────────────
function downloadQR() {
  const a = document.createElement('a');
  a.href = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=20&color=1c1c14&bgcolor=ffffff&data=' + encodeURIComponent(location.href);
  a.download = 'jj-fabrics-qr.png';
  a.target = '_blank';
  a.click();
}

// ── INIT ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Show the page immediately with defaults — never block on network
  loadProducts();
  hideLoader();

  // 2. Fetch live data from Supabase
  try {
    const [products, settings] = await Promise.all([
      dbGetProducts(),
      dbGetSettings()
    ]);

    // Only in-stock products shown on store
    allProducts = products.filter(p => p.stock > 0);

    applySiteData(settings);
    loadProducts();
  } catch(e) {
    console.warn('Supabase load error:', e);
    // Page already visible with empty state — no crash
  }
});
