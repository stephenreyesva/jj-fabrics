// ============================================================
//  JJ Fabrics Store — Display Logic
//  Backend: Supabase (via db.js)
// ============================================================

const catEmoji = { 'Ladies Suiting': '👘', 'Gents Suiting': '👔', 'Accessories': '💎', 'Kids': '👦' };

let allProducts   = [];
let activeFilter  = '';
let _siteSettings = null;

// Hardcoded defaults — shown immediately and used as fallback
// Keys match the Supabase settings table exactly (key column values).
const DEFAULT_SETTINGS = {
  store_name:   'JJ Fabrics',
  tagline:      'Gents & Ladies Suiting Place',
  about:        'JJ Fabrics is Attock City\'s premier House of Brands, we curate timeless pieces that celebrate your unique style — blending elegance, comfort, and affordability.',
  address:      'Sher Bahadur Plaza, K-Block, Near Dr. Ibadat Hospital, Main Bazar, Attock City',
  whatsapp:     '923145777344',
  phone:        '923145777344',
  email:        'jjfabrics@gmail.com',
  facebook:     'https://www.facebook.com/jjfabrics',
  instagram:    'https://www.instagram.com/jjfabrics',
  tiktok:       'https://www.tiktok.com/@hamzajaved04?_r=1&_t=ZS-96YCJS7LU6X',
  youtube:      'https://youtube.com/@jjfabric786?si=HoEYFCJVncSEmGBm',
  map_embed:    'https://maps.google.com/maps?q=Sher+Bahadur+Plaza+K+Block+Attock+City+Pakistan&output=embed',
  maps_url:     'https://maps.app.goo.gl/FpTpXPsSP61XQrkf9',
  accent_color: '#D4A017',
  hero_color:   '#1C1C14',
};

// ── NULL-SAFE DOM HELPERS ──────────────────────────────────
function el(id)           { return document.getElementById(id); }
function setText(id, val) { const e = el(id); if (e) e.textContent = val; }
function setHtml(id, val) { const e = el(id); if (e) e.innerHTML   = val; }
function setHref(id, val) { const e = el(id); if (e) e.href        = val; }

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
setTimeout(() => hideLoader(), 3000); // safety net

// ── APPLY SITE SETTINGS ───────────────────────────────────
// Supabase settings table stores rows as {key, value} pairs.
// dbGetSettings() converts them to a flat object, e.g. { phone: '923...', facebook: 'https://...' }
// Keys used here must match exactly what is stored in the settings table.
function applySiteData(s) {
  if (!s || !Object.keys(s).length) return;
  _siteSettings = s;

  // Colors — keys: accent_color, hero_color
  // Colors — Supabase keys: accent_color, hero_color
  const accent = s.accent_color;
  if (accent) {
    document.documentElement.style.setProperty('--accent',      accent);
    document.documentElement.style.setProperty('--accent-dark', shadeColor(accent, -20));
    document.documentElement.style.setProperty('--accent-lt',   shadeColor(accent,  80));
  }
  if (s.hero_color) {
    try {
      const hex = s.hero_color.replace('#','');
      const r=parseInt(hex.slice(0,2),16), g=parseInt(hex.slice(2,4),16), b=parseInt(hex.slice(4,6),16);
      const brightness = (r*299 + g*587 + b*114) / 1000;
      // Only apply if dark enough for the hero section; light colors break the white text
      const heroBg = brightness > 140 ? '#1C1C14' : s.hero_color;
      const textColor = brightness > 140 ? '#FFFFFF' : '#FFFFFF';
      const textMuted = 'rgba(255,255,255,0.7)';
      document.documentElement.style.setProperty('--hero-section-bg', heroBg);
      document.documentElement.style.setProperty('--hero-text', textColor);
      document.documentElement.style.setProperty('--hero-text-muted', textMuted);
    } catch(e){
      document.documentElement.style.setProperty('--hero-section-bg', '#1C1C14');
    }
  }

  // Supabase key: store_name
  const name = s.store_name || 'JJ Fabrics';
  setText('nav-name',       name);
  setText('footer-name',    name);
  setText('footer-tagline', s.tagline || '');
  setText('footer-copy',    `© ${new Date().getFullYear()} ${name}. All rights reserved.`);
  document.title = name;

  if (s.about) setText('about-text', s.about);

  // WhatsApp — Supabase key: whatsapp (fallback: phone)
  const waNum  = (s.whatsapp || s.phone || '').replace(/\D/g, '');
  const waLink = waNum ? `https://wa.me/${waNum}?text=Hi! I'm interested in your products.` : '#';
  ['wa-btn','nav-whatsapp','mob-wa','link-wa','cta-wa','fs-wa'].forEach(id => setHref(id, waLink));

  // Social — Supabase keys: facebook, instagram, tiktok, youtube
  if (s.facebook)  ['link-fb','cta-fb','fs-fb'].forEach(id => setHref(id, s.facebook));
  if (s.instagram) ['link-ig','fs-ig'].forEach(id => setHref(id, s.instagram));
  if (s.tiktok)    ['link-tt','fs-tt'].forEach(id => setHref(id, s.tiktok));
  if (s.youtube)   ['link-yt','fs-yt'].forEach(id => setHref(id, s.youtube));

  // Contact
  const phoneDisplay = waNum ? waNum.replace(/(\d{2})(\d{3})(\d{3})(\d{4})/, '+$1 $2 $3 $4') : '—';
  // Supabase key: maps_url (direct link for "Open in Google Maps")
  const mapUrl = s.maps_url || 'https://maps.app.goo.gl/FpTpXPsSP61XQrkf9';
  setHtml('contact-address',
    (s.address || '—') +
    `<br><a href="${mapUrl}" target="_blank" style="color:var(--accent-dark);font-size:12px;font-weight:700;">📍 Open in Google Maps →</a>`
  );
  setText('contact-phone-link', phoneDisplay);
  setHref('contact-phone-link', waNum ? `tel:+${waNum}` : '#');
  setText('contact-email-link', s.email || '—');
  setHref('contact-email-link', s.email ? `mailto:${s.email}` : '#');

  // Supabase key: map_embed (Google Maps iframe embed URL ending in &output=embed)
  const mapEmbed = s.map_embed;
  if (mapEmbed) setHtml('map-container', `<iframe src="${mapEmbed}" width="100%" height="100%" style="border:0;" allowfullscreen loading="lazy"></iframe>`);
}

// ── LOAD & RENDER PRODUCTS ────────────────────────────────
function loadProducts() {
  const s     = _siteSettings || {};
  const waNum = (s.phone || '').replace(/\D/g, '');

  // Sort: newest first
  allProducts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // Category counts
  const newCount = allProducts.filter(p => p.is_new === true || p.is_new === 'true').length;
  setText('stat-products', allProducts.length + '+');
  setText('cnt-all',   allProducts.length + ' items');
  setText('cnt-new',   newCount + ' items');
  setText('cnt-women', allProducts.filter(p => p.category === 'Ladies Suiting').length + ' items');
  setText('cnt-men',   allProducts.filter(p => p.category === 'Gents Suiting').length  + ' items');
  setText('cnt-acc',   allProducts.filter(p => p.category === 'Accessories').length    + ' items');

  // Hero cards — top 3 products with images
  // Hero: prefer is_new items with images, fallback to any with images
  const newWithImg = allProducts.filter(p => p.is_new && p.img && p.img.trim().length > 4);
  const anyWithImg = allProducts.filter(p => p.img && p.img.trim().length > 4);
  const heroPool   = newWithImg.length ? newWithImg : anyWithImg.length ? anyWithImg : allProducts;
  const heroItems  = heroPool.slice(0, 3);
  ['hc1','hc2','hc3'].forEach((hcId, idx) => {
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

function filterCat(cat) {
  activeFilter = cat;
  document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('active'));
  const idx = ['', '__new__', 'Ladies Suiting', 'Gents Suiting', 'Accessories'].indexOf(cat);
  if (idx >= 0) document.querySelectorAll('.cat-card')[idx]?.classList.add('active');
  renderProducts();
}

function filterBrandNav(cat, elem) {
  document.querySelectorAll('.brands-nav-item').forEach(i => i.classList.remove('active'));
  if (elem) elem.classList.add('active');
  activeFilter = (cat === 'all' || !cat) ? '' : cat;
  renderProducts();
  el('collections')?.scrollIntoView({ behavior: 'smooth' });
}

function renderProducts() {
  const filtered = activeFilter === '__new__'
    ? allProducts.filter(p => p.is_new === true || p.is_new === 'true')
    : activeFilter
      ? allProducts.filter(p => p.category === activeFilter)
      : allProducts;

  const liveTag = allProducts.length > 0
    ? ' <span style="font-size:10px;background:#d4f7de;color:#166534;padding:2px 7px;border-radius:20px;font-weight:600;vertical-align:middle;">● LIVE</span>'
    : '';
  const countEl = el('products-count');
  if (countEl) countEl.innerHTML = filtered.length + ' product' + (filtered.length !== 1 ? 's' : '') + ' shown' + liveTag;

  const s     = _siteSettings || {};
  const waNum = (s.phone || '').replace(/\D/g, '');
  const grid  = el('product-grid');
  if (!grid) return;

  if (!filtered.length) {
    grid.innerHTML = `<div class="no-products" style="grid-column:1/-1;text-align:center;padding:60px 20px;">
      <span style="font-size:56px">${activeFilter ? '🔍' : '🛍️'}</span>
      <p style="margin-top:16px;color:var(--gray-400);">${activeFilter ? 'No products in this category yet.' : 'Products loading… if this persists, please refresh the page.'}</p>
    </div>`;
    return;
  }

  grid.innerHTML = filtered.map((p, i) => {
    const emoji    = catEmoji[p.category] || '🛍️';
    const waMsg    = encodeURIComponent(`Hi! I'm interested in: ${p.name} (Rs. ${Number(p.price).toLocaleString()}). Is it available?`);
    const waHref   = waNum ? `https://wa.me/${waNum}?text=${waMsg}` : '#';
    const isNew    = p.is_new === true || p.is_new === 'true';
    const isSale   = p.sale_price && Number(p.sale_price) > 0 && Number(p.sale_price) < Number(p.price);
    const discPct  = isSale ? Math.round((1 - Number(p.sale_price)/Number(p.price))*100) : 0;
    const fallback = `<span style="font-size:64px">${emoji}</span>`;
    const imgHtml  = (p.img && p.img.trim())
      ? `<img src="${p.img}" alt="${p.name}" loading="lazy" style="width:100%;height:100%;object-fit:cover;"
             onerror="this.parentNode.innerHTML=this.dataset.fb" data-fb="${fallback.replace(/"/g,'&quot;')}">`
      : fallback;
    const stock = Number(p.stock);
    const lowStock = stock > 0 && stock <= 5;
    return `<div class="product-card" style="animation-delay:${i*0.06}s">
      ${isNew ? '<div class="pc-badge-new">NEW</div>' : ''}
      ${isSale ? `<div class="pc-badge-sale" style="${isNew?'top:64px;':''}">-${discPct}%</div>` : ''}
      <div class="pc-image">${imgHtml}</div>
      <div class="pc-body">
        <div class="pc-category">${p.category || ''}</div>
        <div class="pc-name">${p.name}</div>
        ${p.sku ? `<div class="pc-size" style="font-size:11px;color:var(--gray-400);">SKU: ${p.sku}</div>` : ''}
        ${p.description ? `<div style="font-size:11px;color:var(--gray-400);margin-bottom:10px;line-height:1.4;">${p.description}</div>` : ''}
        <div class="pc-footer">
          <div>
            ${isSale
              ? `<div class="pc-price" style="color:#e01f1f;">Rs. ${Number(p.sale_price).toLocaleString()} <span style="font-size:11px;color:var(--gray-400);text-decoration:line-through;font-weight:400;">Rs. ${Number(p.price).toLocaleString()}</span></div>`
              : `<div class="pc-price">Rs. ${Number(p.price).toLocaleString()}</div>`
            }
            ${lowStock ? `<div style="font-size:10px;color:#b45309;font-weight:600;">Only ${stock} left</div>` : ''}
          </div>
          <a class="pc-action" href="${waHref}" target="_blank">Order →</a>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── NAV SCROLL ────────────────────────────────────────────
// Registered inside DOMContentLoaded so element references are safe

// ── MOBILE MENU ───────────────────────────────────────────
function toggleMobile() {
  el('mobile-menu')?.classList.toggle('open');
}

// ── REVEAL ON SCROLL ──────────────────────────────────────
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.12 });

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
  // Observe all .reveal elements for scroll animations
  document.querySelectorAll('.reveal').forEach(e => revealObserver.observe(e));

  // Scroll: navbar shadow + back-to-top button
  window.addEventListener('scroll', () => {
    el('navbar')?.classList.toggle('scrolled', window.scrollY > 40);
    el('back-top')?.classList.toggle('visible', window.scrollY > 300);
  });

  // 1. Apply defaults immediately — page is fully visible right away
  applySiteData(DEFAULT_SETTINGS);
  hideLoader();
  loadProducts(); // renders empty state while Supabase loads

  try {
    // 2. Fetch products and settings from Supabase in parallel
    const [rawProducts, liveSettings] = await Promise.all([
      dbGetProducts(),
      dbGetSettings().catch(() => ({}))
    ]);

    // 3. Merge: live settings override defaults (only non-empty values win)
    const merged = { ...DEFAULT_SETTINGS };
    Object.entries(liveSettings).forEach(([k, v]) => {
      if (v && String(v).trim()) merged[k] = v;
    });

    // 4. Filter to in-stock only; cast stock to Number to handle string values from DB
    allProducts = (rawProducts || []).filter(p => Number(p.stock) > 0);

    applySiteData(merged);
    loadProducts(); // re-render with live data

  } catch(e) {
    console.error('Store load error:', e);
    // Page already visible with defaults — graceful degradation
  }
});
