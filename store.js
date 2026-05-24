// ═══════════════════════════════════════
//  GOOGLE SHEETS API CONFIG
// ═══════════════════════════════════════
// Normalize category names from POS/Sheets to store's expected values
function normCat(c) {
  c = (c || '').trim();
  if (c === 'Ladies Suits' || c === 'Ladies Suit' || c === 'Ladies Suiting') return 'Ladies Suiting';
  if (c === 'Gents Wear' || c === 'Gents Suiting' || c === 'Gents Suit') return 'Gents Suiting';
  if (c === 'Kids' || c === 'Kids Wear') return 'Kids';
  if (c === 'Accessories' || c === 'Accessory') return 'Accessories';
  return c;
}

const API_URL = 'https://script.google.com/macros/s/AKfycbzIyZ1-ov6XyOK5CCmwQ9bEoBYeQcxqYIEynk57uA_RQtKwI-FNHmbEy4yN0Nxt8Bt-4w/exec';

// In-memory store (replaces localStorage)
let _cachedProducts = null;
let _cachedSite = null;
let _dataLoaded = false;

const catEmoji = {"Ladies Suits":'👘',"Gents Wear":'👔','Accessories':'💎','Kids':'👦'};
let allProducts = [], activeFilter = '';

// ═══════════════════════════════════════
//  JSONP HELPER (fixes CORS with Apps Script)
// ═══════════════════════════════════════
function jsonpFetch(action) {
  return new Promise((resolve, reject) => {
    const cbName = '_jjcb_' + action + '_' + Date.now();
    const script = document.createElement('script');
    const timeout = setTimeout(() => {
      delete window[cbName];
      script.remove();
      reject(new Error('Timeout: ' + action));
    }, 12000); // increased to 12s for slow connections
    window[cbName] = function(data) {
      clearTimeout(timeout);
      delete window[cbName];
      script.remove();
      // Accept both {success:true, data:[...]} and bare arrays/objects
      if (data && data.success) resolve(data.data);
      else if (Array.isArray(data) && data.length) resolve(data);
      else if (data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length) resolve(data);
      else reject(new Error('Empty response: ' + action));
    };
    script.src = `${API_URL}?action=${action}&callback=${cbName}&_t=${Date.now()}`;
    script.onerror = () => { clearTimeout(timeout); delete window[cbName]; script.remove(); reject(new Error('Script load failed')); };
    document.head.appendChild(script);
  });
}

async function loadAllData() {
  async function fetchAction(action) {
    // Try regular fetch first
    try {
      const res = await fetch(`${API_URL}?action=${action}&_t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.success && data.data) return data.data;
        if (Array.isArray(data) && data.length) return data;
      }
    } catch(_) {}
    // JSONP fallback (handles CORS restrictions)
    return jsonpFetch(action).catch(() => null);
  }
  const [products, site] = await Promise.all([
    fetchAction('getProducts'),
    fetchAction('getSiteSettings')
  ]);
  if (Array.isArray(products) && products.length) {
    // Normalize Sheets column names (SKU → sku, Name → name, Price → price etc.)
    const sheetsProds = products.map(p => ({
      sku      : p.sku      || p.SKU      || '',
      name     : p.name     || p.Name     || '',
      brand    : p.brand    || p.Brand    || '',
      category : normCat(p.category || p.Category || ''),
      size     : p.size     || p.Size     || '',
      price    : Number(p.price  || p.Price)  || 0,
      cost     : Number(p.cost   || p.Cost)   || 0,
      stock    : Number(p.stock  || p.Stock)  || 0,
      minStock : Number(p.minStock || p.MinStock) || 0,
      desc     : p.desc || p.Description || '',
      img      : p.img  || p.ImageURL    || '',
      active   : String(p.active || p.Active || 'TRUE').toUpperCase() === 'TRUE'
    })).filter(p => p.sku);

    _cachedProducts = sheetsProds;
  } else {
    _cachedProducts = []; // Sheets unreachable — show empty until retry
  }
  _cachedSite = (site && typeof site === 'object' && !Array.isArray(site))
                ? site : getDefaultSite();
  _dataLoaded = true;
}

const getData = () => _cachedProducts || [];
const getSite = () => _cachedSite     || getDefaultSite();

// ═══════════════════════════════════════
//  FALLBACK DEFAULTS (shown while loading
//  or if Google Sheets is unreachable)
// ═══════════════════════════════════════
function getDefaultProducts() { return []; } // No hardcoded products — all from Sheets

function getDefaultSite() {
  return {
    name:'JJ Fabrics', tagline:'Gents & Ladies Suiting Place',
    about:'JJ Fabrics is Attock City\'s premier House of Brands, we curate timeless pieces that celebrate your unique style — blending elegance, comfort, and affordability.',
    address:'Sher Bahadur Plaza, K-Block, Near Dr. Ibadat Hospital, Main Bazar, Attock City',
    phone:'923145777344', email:'jjfabrics@gmail.com',
    facebook:'https://www.facebook.com/share/r/17wrND2MNc/',
    instagram:'https://www.instagram.com/muhammadhamzajaved11961?igsh=MXNrdWhwZ2FhMGw1Mw==',
    tiktok:'https://www.tiktok.com/@hamzajaved04?_r=1&_t=ZS-96YCJS7LU6X',
    youtube:'https://youtube.com/@jjfabric786?si=HoEYFCJVncSEmGBm',
    map:'https://maps.google.com/maps?q=Sher+Bahadur+Plaza+K+Block+Attock+City+Pakistan&output=embed',
    emoji:'🧵', heroColor:'#0a0a0a', accentColor:'#D4A017',
    featured:[], publishedAt: null
  };
}

// Legacy stub — no longer needed but keeps any stray calls safe
function seedPublicDefaults() {}

// ═══════════════════════════════════════
//  IMAGE RESOLVER
//  When Sheets products have no img URL, fall back to local p1.jpeg–p7.jpeg
// ═══════════════════════════════════════


function resolveImg(p) {
  const imgVal = (p.img || p.ImageURL || '').trim();
  if (imgVal) return imgVal;
  return '';
}

// ═══════════════════════════════════════
//  NULL-SAFE DOM HELPER
//  Prevents "Cannot set textContent of null" crashes
// ═══════════════════════════════════════
function el(id) { return document.getElementById(id); }
function setText(id, val) { const e = el(id); if (e) e.textContent = val; }
function setHtml(id, val) { const e = el(id); if (e) e.innerHTML   = val; }
function setHref(id, val) { const e = el(id); if (e) e.href        = val; }

// ═══════════════════════════════════════
//  APPLY SITE DATA
// ═══════════════════════════════════════
function applySiteData() {
  const s = getSite();
  // Accent colors
  if (s.accentColor) {
    document.documentElement.style.setProperty('--accent', s.accentColor);
    document.documentElement.style.setProperty('--accent-dark', shadeColor(s.accentColor, -20));
    document.documentElement.style.setProperty('--accent-lt', shadeColor(s.accentColor, 80));
  }
  const heroColor = s.heroColor || '#1C1C14';
  document.documentElement.style.setProperty('--hero-section-bg', heroColor);

  const name = s.name || 'JJ Fabrics';
  setText('nav-name',       name);
  setText('footer-name',    name);
  setText('footer-tagline', s.tagline || '');
  setText('footer-copy',    `© ${new Date().getFullYear()} ${name}. All rights reserved.`);
  document.title = name;

  if (s.about)   setText('about-text', s.about);
  if (s.tagline) setHtml('hero-headline', s.tagline.includes(' ')
    ? s.tagline.split(' ').map((w,i)=>i===Math.floor(s.tagline.split(' ').length/2)?`<em>${w}</em>`:w).join(' ')
    : `Dress to<br><em>Express</em>`);

  // WhatsApp
  const waNum  = (s.phone||'').replace(/\D/g,'');
  const waLink = waNum ? `https://wa.me/${waNum}?text=Hi! I'm interested in your products.` : '#';
  ['wa-btn','nav-whatsapp','mob-wa','link-wa','cta-wa','fs-wa'].forEach(id => setHref(id, waLink));

  // Social links
  const fbLink = s.facebook || 'https://www.facebook.com/share/r/17wrND2MNc/';
  ['link-fb','cta-fb','fs-fb'].forEach(id => setHref(id, fbLink));

  const igLink = s.instagram || 'https://www.instagram.com/muhammadhamzajaved11961?igsh=MXNrdWhwZ2FhMGw1Mw==';
  ['link-ig','fs-ig'].forEach(id => setHref(id, igLink));

  const ttLink = s.tiktok || 'https://www.tiktok.com/@hamzajaved04?_r=1&_t=ZS-96YCJS7LU6X';
  ['link-tt','fs-tt'].forEach(id => setHref(id, ttLink));

  const ytLink = s.youtube || 'https://youtube.com/@jjfabric786?si=HoEYFCJVncSEmGBm';
  ['link-yt','fs-yt'].forEach(id => setHref(id, ytLink));

  // Contact
  setHtml('contact-address', (s.address || '—') + '<br><a href="https://maps.app.goo.gl/FpTpXPsSP61XQrkf9" target="_blank" style="color:var(--accent-dark);font-size:12px;font-weight:700;">📍 Open in Google Maps →</a>');
  const phoneDisplay = s.phone ? s.phone.replace(/(\d{2})(\d{3})(\d{3})(\d{4})/, '+$1 $2 $3 $4') : '—';
  setText('contact-phone-link', phoneDisplay);
  setHref('contact-phone-link', `tel:+${waNum}`);
  setText('contact-email-link', s.email || '—');
  setHref('contact-email-link', s.email ? `mailto:${s.email}` : '#');

  // Map
  if (s.map) setHtml('map-container', `<iframe src="${s.map}" allowfullscreen loading="lazy"></iframe>`);
}

function shadeColor(hex, amt) {
  try {
    let r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    r = Math.min(255,Math.max(0,r+amt)); g = Math.min(255,Math.max(0,g+amt)); b = Math.min(255,Math.max(0,b+amt));
    return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
  } catch { return hex; }
}

// ═══════════════════════════════════════
//  LOAD PRODUCTS
// ═══════════════════════════════════════
function loadProducts() {
  const s      = getSite();
  const prods  = getData();
  const featured = s.featured && s.featured.length ? s.featured : null;
  allProducts  = prods.filter(p => p.stock > 0 && (!featured || featured.includes(p.sku)));
  if (!allProducts.length) allProducts = prods.filter(p => p.stock > 0);

  // Counts
  setText('stat-products', prods.length + '+');
  setText('cnt-all',    allProducts.length + ' items');
  setText('cnt-women',  allProducts.filter(p=>p.category==='Ladies Suiting').length + ' items');
  setText('cnt-men',    allProducts.filter(p=>p.category==='Gents Suiting').length + ' items');
  setText('cnt-acc',    allProducts.filter(p=>p.category==='Accessories').length + ' items');

  // Hero cards — show the 3 newest products (most recently added)
  const heroWithImg = allProducts.filter(p => resolveImg(p));
  const heroItems   = (heroWithImg.length ? heroWithImg : allProducts).slice(0, 3);
  ['hc1','hc2','hc3'].forEach((hcId, idx) => {
    const p = heroItems[idx]; if (!p) return;
    const e  = catEmoji[p.category] || '🛍️';
    const hc = el(hcId); if (!hc) return;
    const img = resolveImg(p);
    hc.innerHTML = img
      ? '<img src="' + img + '" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display=\'none\';this.parentNode.insertAdjacentText(\'beforeend\',\''+e+'\')">'
      : e;
    setText(hcId + '-name',  p.name);
    setText(hcId + '-price', 'Rs. ' + Number(p.price).toLocaleString())
  });

    renderProducts();
}

function filterCat(cat) {
  activeFilter = cat;
  document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('active'));
  const idx = ['', "Ladies Suits", "Gents Wear", 'Accessories'].indexOf(cat);
  if (idx >= 0) document.querySelectorAll('.cat-card')[idx]?.classList.add('active');
  renderProducts();
}

function filterBrandNav(cat, el) {
  // Update active state on brands nav items
  document.querySelectorAll('.brands-nav-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');
  // Apply the category filter
  activeFilter = cat === 'all' ? '' : cat;
  renderProducts();
  // Smooth scroll to collections section
  document.getElementById('collections')?.scrollIntoView({ behavior: 'smooth' });
}


function renderProducts() {
  const filtered = activeFilter ? allProducts.filter(p => p.category === activeFilter) : allProducts;
  const liveTag = _dataLoaded ? ' <span style="font-size:10px;background:#d4f7de;color:#166534;padding:2px 7px;border-radius:20px;font-weight:600;vertical-align:middle;">● LIVE</span>' : '';
  document.getElementById('products-count').innerHTML = filtered.length + ' product' + (filtered.length !== 1 ? 's' : '') + ' shown' + liveTag;
  const s = getSite();
  const waNum = (s.phone||'').replace(/\D/g,'');
  const grid = document.getElementById('product-grid');
  if (!filtered.length) {
    const isFiltered = activeFilter !== '';
    grid.innerHTML = `<div class="no-products" style="grid-column:1/-1;">
      <span class="np-icon">${isFiltered ? '🔍' : '🛍️'}</span>
      <p>${isFiltered ? 'No products in this category yet.' : 'Products loading… if this persists, please refresh the page.'}</p>
    </div>`;
    return;
  }
  grid.innerHTML = filtered.map((p, i) => {
    const emoji = catEmoji[p.category] || '🛍️';
    const waMsg = encodeURIComponent(`Hi! I'm interested in: ${p.name} (Rs. ${Number(p.price).toLocaleString()}). Is it available?`);
    const waHref = waNum ? `https://wa.me/${waNum}?text=${waMsg}` : '#';
    const isNew = i < 3;
    const fallbackHtml = `<span style="font-size:64px">${emoji}</span>`;
    const resolvedImg = resolveImg(p);
    const imgHtml = resolvedImg
      ? `<img src="${resolvedImg}" alt="${p.name}" loading="lazy" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentNode.innerHTML=this.dataset.fb" data-fb="${fallbackHtml.replace(/"/g,'&quot;')}">`
      : fallbackHtml;
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

// ═══════════════════════════════════════
//  QR CODE DOWNLOAD
// ═══════════════════════════════════════
function downloadQR() {
  const url = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=20&color=1c1c14&bgcolor=ffffff&data=https://stephenreyesva.github.io/jj-fabrics/';
  const a = document.createElement('a');
  a.href = url;
  a.download = 'jj-fabrics-qr.png';
  a.target = '_blank';
  a.click();
}

// ═══════════════════════════════════════
//  NAV SCROLL
// ═══════════════════════════════════════
window.addEventListener('scroll', () => {
  document.getElementById('navbar').classList.toggle('scrolled', window.scrollY > 40);
  document.getElementById('back-top').classList.toggle('visible', window.scrollY > 300);
});

// ═══════════════════════════════════════
//  MOBILE MENU
// ═══════════════════════════════════════
function toggleMobile() {
  document.getElementById('mobile-menu').classList.toggle('open');
}

// ═══════════════════════════════════════
//  REVEAL ON SCROLL
// ═══════════════════════════════════════
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

// ═══════════════════════════════════════
//  INIT
// ═══════════════════════════════════════
function hideLoader() {
  const loader = document.getElementById('page-loader');
  if (!loader) return;
  loader.style.opacity = '0';
  setTimeout(() => loader.style.display = 'none', 500);
}

// ── Show content immediately on DOMContentLoaded — never wait for images/fonts ──
document.addEventListener('DOMContentLoaded', () => {
  _cachedSite = getDefaultSite();
  applySiteData();
  loadProducts(); // shows empty state while Sheets loads
  hideLoader();

  // ── Fetch live data from Google Sheets — retry once if empty ──
  async function fetchAndRender(isRetry) {
    try {
      await loadAllData();
      applySiteData();
      loadProducts();
      if (!_cachedProducts.length && !isRetry) {
        // Sheets returned empty — wait 3s and try once more
        setTimeout(() => fetchAndRender(true), 3000);
      }
    } catch(e) {
      if (!isRetry) setTimeout(() => fetchAndRender(true), 4000);
    }
  }
  fetchAndRender(false);
});

// ── Absolute safety net: if loader somehow still visible after 2s, force-hide it ──
setTimeout(() => hideLoader(), 2000);