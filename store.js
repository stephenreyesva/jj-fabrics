// ═══════════════════════════════════════════════════════════════
//  JJ Fabrics Store — store.js
//  Requires: db.js loaded first in store.html
// ═══════════════════════════════════════════════════════════════

const catEmoji = { 'Ladies Suiting':'👘', 'Gents Suiting':'👔', 'Accessories':'💎', 'Kids':'👦' };
let allProducts = [], activeFilter = '', _siteData = null, _dataLoaded = false;

// ── DOM helpers ──
const el      = id  => document.getElementById(id);
const setText = (id, val) => { const e=el(id); if(e) e.textContent=val; };
const setHtml = (id, val) => { const e=el(id); if(e) e.innerHTML=val; };
const setHref = (id, val) => { const e=el(id); if(e) e.href=val; };

function resolveImg(p) { return (p.img || p.image_url || '').trim(); }

// ── Default site data shown before DB loads ──
function getDefaultSite() {
  return {
    name:'JJ Fabrics', tagline:'Gents & Ladies Suiting Place',
    about:'JJ Fabrics is Attock City\'s premier House of Brands.',
    address:'Sher Bahadur Plaza, K-Block, Near Dr. Ibadat Hospital, Main Bazar, Attock City',
    phone:'923145777344', email:'jjfabrics@gmail.com',
    facebook:'https://www.facebook.com/share/r/17wrND2MNc/',
    instagram:'https://www.instagram.com/muhammadhamzajaved11961',
    tiktok:'https://www.tiktok.com/@hamzajaved04',
    youtube:'https://youtube.com/@jjfabric786',
    map:'https://maps.google.com/maps?q=Sher+Bahadur+Plaza+K+Block+Attock+City+Pakistan&output=embed',
    heroColor:'#0a0a0a', accentColor:'#D4A017', featured:[]
  };
}
const getSite = () => _siteData || getDefaultSite();

// ═══════════════════════════════════════════════════════════════
//  LOAD FROM SUPABASE
// ═══════════════════════════════════════════════════════════════
async function loadFromDB(isRetry) {
  try {
    const [products, settings] = await Promise.all([dbGetProducts(), dbGetSettings()]);
    _siteData   = Object.keys(settings).length ? settings : getDefaultSite();
    _dataLoaded = true;
    // Store fetches products without needing cost/minStock — just what the customer needs
    const prods = (products || []).filter(p => p.stock > 0);
    allProducts = prods;
    applySiteData();
    loadProducts();
  } catch(e) {
    console.warn('DB load failed:', e);
    if (!isRetry) setTimeout(() => loadFromDB(true), 4000);
  }
}

// ═══════════════════════════════════════════════════════════════
//  APPLY SITE DATA
// ═══════════════════════════════════════════════════════════════
function applySiteData() {
  const s = getSite();
  if (s.accentColor) {
    document.documentElement.style.setProperty('--accent', s.accentColor);
    document.documentElement.style.setProperty('--accent-dark', shadeColor(s.accentColor, -20));
    document.documentElement.style.setProperty('--accent-lt',   shadeColor(s.accentColor,  80));
  }
  document.documentElement.style.setProperty('--hero-section-bg', s.heroColor || '#0a0a0a');
  const name = s.name || 'JJ Fabrics';
  setText('nav-name', name); setText('footer-name', name);
  setText('footer-tagline', s.tagline || '');
  setText('footer-copy', `© ${new Date().getFullYear()} ${name}. All rights reserved.`);
  document.title = name;
  if (s.about) setText('about-text', s.about);

  const waNum  = (s.phone||'').replace(/\D/g,'');
  const waLink = waNum ? `https://wa.me/${waNum}?text=Hi! I'm interested in your products.` : '#';
  ['wa-btn','nav-whatsapp','mob-wa','link-wa','cta-wa','fs-wa'].forEach(id => setHref(id, waLink));
  ['link-fb','cta-fb','fs-fb'].forEach(id => setHref(id, s.facebook || '#'));
  ['link-ig','fs-ig'].forEach(id => setHref(id, s.instagram || '#'));
  ['link-tt','fs-tt'].forEach(id => setHref(id, s.tiktok || '#'));
  ['link-yt','fs-yt'].forEach(id => setHref(id, s.youtube || '#'));
  setHtml('contact-address', (s.address||'—') + '<br><a href="https://maps.app.goo.gl/FpTpXPsSP61XQrkf9" target="_blank" style="color:var(--accent-dark);font-size:12px;font-weight:700;">📍 Open in Google Maps →</a>');
  const phoneDisplay = s.phone ? s.phone.replace(/(\d{2})(\d{3})(\d{3})(\d{4})/, '+$1 $2 $3 $4') : '—';
  setText('contact-phone-link', phoneDisplay);
  setHref('contact-phone-link', `tel:+${waNum}`);
  setText('contact-email-link', s.email || '—');
  setHref('contact-email-link', s.email ? `mailto:${s.email}` : '#');
  if (s.map) setHtml('map-container', `<iframe src="${s.map}" allowfullscreen loading="lazy"></iframe>`);
}

function shadeColor(hex, amt) {
  try {
    let r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
    r=Math.min(255,Math.max(0,r+amt)); g=Math.min(255,Math.max(0,g+amt)); b=Math.min(255,Math.max(0,b+amt));
    return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
  } catch { return hex; }
}

// ═══════════════════════════════════════════════════════════════
//  LOAD & RENDER PRODUCTS
// ═══════════════════════════════════════════════════════════════
function loadProducts() {
  const s = getSite();
  const featured = s.featured && s.featured.length ? s.featured : null;
  let prods = allProducts.length ? allProducts : [];
  if (featured) {
    const feat = prods.filter(p => featured.includes(p.sku));
    if (feat.length) prods = feat;
  }

  setText('stat-products', (prods.length || '0') + '+');
  setText('cnt-all',    prods.length + ' items');
  setText('cnt-women',  prods.filter(p=>p.category==='Ladies Suiting').length + ' items');
  setText('cnt-men',    prods.filter(p=>p.category==='Gents Suiting').length + ' items');
  setText('cnt-acc',    prods.filter(p=>p.category==='Accessories').length + ' items');

  // Hero cards — first 3 products with images
  const heroWithImg = prods.filter(p => resolveImg(p));
  const heroItems   = (heroWithImg.length ? heroWithImg : prods).slice(0, 3);
  ['hc1','hc2','hc3'].forEach((hcId, idx) => {
    const p = heroItems[idx]; if (!p) return;
    const e  = catEmoji[p.category] || '🛍️';
    const hc = el(hcId); if (!hc) return;
    const img = resolveImg(p);
    hc.innerHTML = img
      ? `<img src="${img}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none';this.parentNode.insertAdjacentText('beforeend','${e}')">`
      : e;
    setText(hcId + '-name',  p.name);
    setText(hcId + '-price', 'Rs. ' + Number(p.price).toLocaleString());
  });

  allProducts = prods;
  renderProducts();
}

function filterCat(cat) {
  activeFilter = cat;
  document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('active'));
  renderProducts();
}

function renderProducts() {
  const filtered = activeFilter ? allProducts.filter(p => p.category === activeFilter) : allProducts;
  const liveTag  = _dataLoaded ? ' <span style="font-size:10px;background:#d4f7de;color:#166534;padding:2px 7px;border-radius:20px;font-weight:600;vertical-align:middle;">● LIVE</span>' : '';
  document.getElementById('products-count').innerHTML = filtered.length + ' product' + (filtered.length!==1?'s':'') + ' shown' + liveTag;
  const s     = getSite();
  const waNum = (s.phone||'').replace(/\D/g,'');
  const grid  = el('product-grid');

  if (!filtered.length) {
    grid.innerHTML = `<div class="no-products" style="grid-column:1/-1;">
      <span class="np-icon">${activeFilter ? '🔍' : '🛍️'}</span>
      <p>${activeFilter ? 'No products in this category yet.' : _dataLoaded ? 'No products available.' : 'Loading products…'}</p>
    </div>`;
    return;
  }

  grid.innerHTML = filtered.map((p, i) => {
    const emoji = catEmoji[p.category] || '🛍️';
    const waMsg = encodeURIComponent(`Hi! I'm interested in: ${p.name} (Rs. ${Number(p.price).toLocaleString()}). Is it available?`);
    const waHref = waNum ? `https://wa.me/${waNum}?text=${waMsg}` : '#';
    const isNew  = i < 3;
    const img    = resolveImg(p);
    const fallback = `<span style="font-size:64px">${emoji}</span>`;
    const imgHtml  = img
      ? `<img src="${img}" alt="${p.name}" loading="lazy" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentNode.innerHTML=this.dataset.fb" data-fb="${fallback.replace(/"/g,'&quot;')}">`
      : fallback;
    return `<div class="product-card" style="animation-delay:${i*0.06}s">
      ${isNew ? '<div class="pc-badge">New</div>' : ''}
      <div class="pc-image">${imgHtml}</div>
      <div class="pc-body">
        <div class="pc-category">${p.category}</div>
        <div class="pc-name">${p.name}</div>
        <div class="pc-size">Size: ${p.size}</div>
        ${p.desc ? `<div style="font-size:11px;color:var(--gray-400);margin-bottom:10px;line-height:1.4;">${p.desc}</div>` : ''}
        <div class="pc-footer">
          <div class="pc-price">Rs. ${Number(p.price).toLocaleString()}</div>
          <a class="pc-action" href="${waHref}" target="_blank">Order →</a>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════════════════════════════
window.addEventListener('scroll', () => {
  el('navbar').classList.toggle('scrolled', window.scrollY > 40);
  el('back-top').classList.toggle('visible', window.scrollY > 300);
});
function toggleMobile() { el('mobile-menu').classList.toggle('open'); }

const observer = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(e => observer.observe(e));

function downloadQR() {
  const a = document.createElement('a');
  a.href = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=20&data=https://stephenreyesva.github.io/jj-fabrics/';
  a.download = 'jj-fabrics-qr.png'; a.target = '_blank'; a.click();
}

function hideLoader() {
  const loader = el('page-loader'); if (!loader) return;
  loader.style.opacity = '0';
  setTimeout(() => loader.style.display = 'none', 500);
}

// ═══════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Show site defaults immediately (no flash of unstyled content)
  applySiteData();
  hideLoader();
  // Then load live data from Supabase
  loadFromDB(false);
});
setTimeout(() => hideLoader(), 2000);
