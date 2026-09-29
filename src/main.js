import { stores } from './data/stores.js';
import { categories, menuItems } from './data/menu.js';

const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
const Lenis = window.Lenis;

if (gsap && ScrollTrigger) {
  gsap.registerPlugin(ScrollTrigger);
}

/* ==========================================================================
   1. Lenis Smooth Scroll Setup
   ========================================================================== */
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.innerWidth < 768);

let lenis = null;
// Enable Lenis only on desktop to let mobile devices use native 120Hz momentum scroll without lag
if (Lenis && !isTouchDevice) {
  lenis = new Lenis({
    duration: 1.2,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    touchMultiplier: 1.5,
    infinite: false,
  });

  if (gsap && ScrollTrigger) {
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => {
      lenis.raf(time * 1000);
    });
    gsap.ticker.lagSmoothing(0);
  } else {
    function raf(time) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);
  }
}

window.scrollToSection = function(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (lenis) {
    lenis.scrollTo(el, { offset: -60 });
  } else {
    el.scrollIntoView({ behavior: 'smooth' });
  }
};

/* ==========================================================================
   2. State Management
   ========================================================================== */
let activeStoreId = 'jakarta';
let activeCategory = 'all';
let modalItem = null;
let modalQty = 1;

/* ==========================================================================
   3. Apple-Style Canvas Image Sequence Engine (Optimized & Responsive)
   ========================================================================== */
function initCanvasImageSequence() {
  const canvas = document.getElementById('scrolly-canvas');
  const scrollySection = document.getElementById('scrolly-section');
  if (!canvas || !scrollySection) return;
  const ctx = canvas.getContext('2d');

  const FRAME_COUNT = 955;
  // Subsample frames: mobile step 8 (~120 frames, ~12MB) to prevent RAM/GPU choke; desktop step 3 (~318 frames)
  const step = isTouchDevice ? 8 : 3;
  const frameNumbers = [];
  for (let i = 1; i <= FRAME_COUNT; i += step) {
    frameNumbers.push(i);
  }
  if (frameNumbers[frameNumbers.length - 1] !== FRAME_COUNT) {
    frameNumbers.push(FRAME_COUNT);
  }

  const images = new Array(frameNumbers.length);
  let currentFrameIndex = 0;

  // Generate frame URL: ./assets/frames/frame_001.jpg -> frame_955.jpg
  const getFrameUrl = (frameNum) => `./assets/frames/frame_${String(frameNum).padStart(3, '0')}.jpg`;

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const clientW = document.documentElement.clientWidth || window.innerWidth;
    const clientH = window.innerHeight;
    canvas.width = Math.round(clientW * dpr);
    canvas.height = Math.round(clientH * dpr);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    renderFrame(currentFrameIndex);
  }

  window.addEventListener('resize', resizeCanvas);

  function renderFrame(index) {
    let img = images[index];
    // Fallback to nearest loaded frame if current frame is still caching
    if (!img || !img.complete) {
      for (let offset = 1; offset <= 20; offset++) {
        if (images[index - offset] && images[index - offset].complete) {
          img = images[index - offset];
          break;
        }
        if (images[index + offset] && images[index + offset].complete) {
          img = images[index + offset];
          break;
        }
      }
    }
    if (!img || !img.complete || img.naturalWidth === 0) return;

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const imgWidth = img.naturalWidth || 1920;
    const imgHeight = img.naturalHeight || 1080;

    const isPortrait = canvasWidth / canvasHeight < 1.15;

    let drawW, drawH, shiftX, shiftY;

    if (isPortrait) {
      // Mobile Portrait: Tampilkan 100% video utuh tanpa terpotong (Jennifer, Oven & Keluarga terlihat utuh)
      ctx.fillStyle = '#FD5F29';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      const ratio = canvasWidth / imgWidth;
      drawW = canvasWidth;
      drawH = imgHeight * ratio;
      shiftX = 0;
      // Vertically centered in the viewport
      shiftY = (canvasHeight - drawH) / 2;
    } else {
      // Desktop / Landscape: Fullscreen Cinematic Cover
      const hRatio = canvasWidth / imgWidth;
      const vRatio = canvasHeight / imgHeight;
      const ratio = Math.max(hRatio, vRatio);

      drawW = imgWidth * ratio;
      drawH = imgHeight * ratio;
      shiftX = (canvasWidth - drawW) / 2;
      shiftY = (canvasHeight - drawH) / 2;
    }

    ctx.drawImage(img, 0, 0, imgWidth, imgHeight, shiftX, shiftY, drawW, drawH);
  }

  // Preload frame 1 immediately for instant first paint
  const firstImg = new Image();
  firstImg.src = getFrameUrl(frameNumbers[0]);
  firstImg.onload = () => {
    images[0] = firstImg;
    resizeCanvas();
    renderFrame(0);
  };
  images[0] = firstImg;

  // Progressively load remaining frames in small batches so browser thread stays fluid
  let currentLoadIdx = 1;
  function loadNextBatch() {
    const batchSize = isTouchDevice ? 6 : 12;
    const end = Math.min(frameNumbers.length, currentLoadIdx + batchSize);
    for (let i = currentLoadIdx; i < end; i++) {
      const img = new Image();
      img.src = getFrameUrl(frameNumbers[i]);
      images[i] = img;
    }
    currentLoadIdx = end;
    if (currentLoadIdx < frameNumbers.length) {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(loadNextBatch);
      } else {
        setTimeout(loadNextBatch, 30);
      }
    }
  }

  if ('requestIdleCallback' in window) {
    requestIdleCallback(loadNextBatch);
  } else {
    setTimeout(loadNextBatch, 60);
  }

  // GSAP ScrollTrigger Scrubbing on Canvas
  if (ScrollTrigger) {
    ScrollTrigger.create({
      trigger: scrollySection,
      start: 'top top',
      end: 'bottom bottom',
      scrub: isTouchDevice ? true : 0.1, // Instant 1:1 on touch, slight smooth on desktop
      onUpdate: (self) => {
        const frameIdx = Math.min(
          frameNumbers.length - 1,
          Math.max(0, Math.floor(self.progress * (frameNumbers.length - 1)))
        );
        currentFrameIndex = frameIdx;
        renderFrame(frameIdx);
        updateZoomOverlays(self.progress);
      }
    });
  } else {
    window.addEventListener('scroll', () => {
      const rect = scrollySection.getBoundingClientRect();
      const scrollDist = -rect.top;
      const totalDist = rect.height - window.innerHeight;
      const progress = Math.max(0, Math.min(1, scrollDist / totalDist));
      const frameIdx = Math.min(
        frameNumbers.length - 1,
        Math.max(0, Math.floor(progress * (frameNumbers.length - 1)))
      );
      currentFrameIndex = frameIdx;
      renderFrame(frameIdx);
      updateZoomOverlays(progress);
    }, { passive: true });
  }

  initSceneSpy();
}

function updateZoomOverlays(progress) {
  const f1 = document.getElementById('frame-text-1');
  const f2 = document.getElementById('frame-text-2');
  const f3 = document.getElementById('frame-text-3');
  const progressBar = document.getElementById('scrolly-progress-bar');
  const diveHint = document.getElementById('dive-into-menu-hint');

  if (progressBar) {
    progressBar.style.width = `${progress * 100}%`;
  }

  function setOverlay(el, show, scaleUp = false) {
    if (!el) return;
    if (show) {
      el.classList.remove('opacity-0', 'pointer-events-none');
      el.classList.add('opacity-100', 'pointer-events-auto');
      if (scaleUp) {
        el.style.transform = 'scale(1.08) translateY(-10px)';
      } else {
        el.style.transform = 'scale(1) translateY(0px)';
      }
    } else {
      el.classList.remove('opacity-100', 'pointer-events-auto');
      el.classList.add('opacity-0', 'pointer-events-none');
      el.style.transform = 'scale(0.9) translateY(20px)';
    }
  }

  setOverlay(f1, progress >= 0 && progress < 0.32);
  setOverlay(f2, progress >= 0.32 && progress < 0.68, true);
  setOverlay(f3, progress >= 0.68 && progress < 0.94);

  if (diveHint) {
    if (progress >= 0.88) {
      diveHint.classList.remove('opacity-0', 'pointer-events-none');
      diveHint.classList.add('opacity-100', 'pointer-events-auto');
    } else {
      diveHint.classList.add('opacity-0', 'pointer-events-none');
      diveHint.classList.remove('opacity-100', 'pointer-events-auto');
    }
  }
}

/* ==========================================================================
   4. Scene Spy & Floating Navigator
   ========================================================================== */
function initSceneSpy() {
  const sceneIds = ['scrolly-section', 'menu', 'outlets', 'story'];
  const dots = document.querySelectorAll('.scene-nav-dot');

  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY + window.innerHeight / 2;
    let currentActive = 'scrolly-section';

    sceneIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const top = el.offsetTop;
        const height = el.offsetHeight;
        if (scrollY >= top && scrollY < top + height) {
          currentActive = id;
        }
      }
    });

    dots.forEach(dot => {
      const target = dot.getAttribute('data-target');
      if (target === currentActive) {
        dot.className = 'scene-nav-dot active flex items-center gap-2 group text-bakery-orange font-bold text-xs font-mono';
        dot.querySelector('.dot-indicator').className = 'dot-indicator w-3 h-3 rounded-full bg-bakery-orange ring-4 ring-bakery-orange/40 shadow-md transition-all';
      } else {
        dot.className = 'scene-nav-dot flex items-center gap-2 group text-stone-400 font-medium text-xs font-mono hover:text-stone-800';
        dot.querySelector('.dot-indicator').className = 'dot-indicator w-2 h-2 rounded-full bg-stone-300 group-hover:bg-bakery-orange transition-all';
      }
    });
  });
}

/* ==========================================================================
   5. Multi-Location Switcher (Bali vs Jakarta)
   ========================================================================== */
function renderStoreInfo() {
  const store = stores.find(s => s.id === activeStoreId) || stores[0];
  const container = document.getElementById('store-display-card');
  if (!container) return;

  container.innerHTML = `
    <div class="relative overflow-hidden rounded-2xl sm:rounded-3xl bg-white border-2 border-orange-100 shadow-xl p-5 sm:p-10 transition-all duration-500">
      <div class="flex flex-wrap items-center justify-between gap-3 sm:gap-4 mb-5 sm:mb-6">
        <div class="flex items-center gap-2 sm:gap-3">
          <span class="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-1 sm:py-1.5 rounded-full text-[11px] sm:text-xs font-bold ${store.isNew ? 'bg-bakery-orange text-white' : 'bg-[#2D1406] text-white'} tracking-wider uppercase shadow-sm">
            <i data-lucide="${store.isNew ? 'flame' : 'sparkles'}" class="w-3.5 h-3.5"></i>
            ${store.status}
          </span>
          <span class="inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full border border-emerald-200">
            <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            ${store.statusText}
          </span>
        </div>
        <div class="text-[11px] sm:text-xs font-mono text-stone-500 flex items-center gap-1.5">
          <i data-lucide="clock" class="w-3.5 h-3.5 text-bakery-orange"></i>
          <span>${store.hours}</span>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-center">
        <!-- Photo on mobile first or side -->
        <div class="lg:col-span-5 order-1 lg:order-2">
          <div class="relative rounded-2xl overflow-hidden shadow-lg aspect-[16/10] sm:aspect-[4/3] group border border-stone-200">
            <img src="${store.image}" alt="${store.name}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700">
            <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-4 sm:p-5">
              <p class="text-white text-xs sm:text-sm font-medium italic">
                "${store.tagline}"
              </p>
            </div>
          </div>
        </div>

        <div class="lg:col-span-7 space-y-4 sm:space-y-5 order-2 lg:order-1">
          <h3 class="text-2xl sm:text-4xl font-extrabold text-[#2D1406] tracking-tight leading-tight">
            ${store.name}
          </h3>
          <p class="text-stone-600 text-xs sm:text-base leading-relaxed">
            ${store.address}
          </p>
          <div class="inline-flex items-center gap-2 text-xs font-mono text-bakery-orange bg-orange-50 px-3.5 py-2 rounded-xl border border-orange-200">
            <i data-lucide="map-pin" class="w-4 h-4 text-bakery-orange shrink-0"></i>
            <span>Patokan: ${store.landmark}</span>
          </div>

          <div class="pt-2 sm:pt-4 flex flex-col sm:flex-row flex-wrap gap-2 sm:gap-3">
            <a href="${store.gmapsUrl}" target="_blank" rel="noopener noreferrer" 
               class="inline-flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-full bg-[#2D1406] text-white text-xs sm:text-sm font-semibold hover:bg-black transition-all hover:scale-[1.02] shadow-md w-full sm:w-auto">
              <i data-lucide="map-pin" class="w-4 h-4 text-bakery-orange"></i>
              <span>Petunjuk Google Maps</span>
              <i data-lucide="external-link" class="w-3.5 h-3.5 opacity-60"></i>
            </a>

            <a href="${store.gofoodUrl}" target="_blank" rel="noopener noreferrer"
               class="inline-flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-full bg-emerald-600 text-white text-xs sm:text-sm font-semibold hover:bg-emerald-700 transition-all hover:scale-[1.02] shadow-md w-full sm:w-auto">
              <i data-lucide="shopping-bag" class="w-4 h-4"></i>
              <span>Order di GoFood</span>
              <i data-lucide="external-link" class="w-3.5 h-3.5 opacity-60"></i>
            </a>

            <a href="https://api.whatsapp.com/send?phone=6282266288312&text=${encodeURIComponent(`Halo Chewy's Dessert! Saya mau tanya ketersediaan stok di outlet ${store.name}.`)}" target="_blank" rel="noopener noreferrer"
               class="inline-flex items-center justify-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-full bg-orange-50 text-[#2D1406] border border-orange-200 text-xs sm:text-sm font-semibold hover:bg-orange-100 transition-all w-full sm:w-auto">
              <i data-lucide="phone" class="w-4 h-4 text-bakery-orange"></i>
              <span>WhatsApp Outlet</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  `;

  document.querySelectorAll('.store-pill-btn').forEach(btn => {
    const id = btn.getAttribute('data-store-id');
    if (id === activeStoreId) {
      btn.className = 'store-pill-btn px-5 py-2.5 rounded-full text-xs sm:text-sm font-bold bg-bakery-orange text-white shadow-lg shadow-bakery-orange/40 transition-all duration-300 scale-105 flex items-center gap-2';
    } else {
      btn.className = 'store-pill-btn px-5 py-2.5 rounded-full text-xs sm:text-sm font-semibold bg-white text-stone-600 hover:bg-orange-50 hover:text-bakery-orange transition-all duration-300 flex items-center gap-2 border border-orange-200';
    }
  });

  refreshIcons();
}

function initStoreSwitcher() {
  document.querySelectorAll('.store-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeStoreId = btn.getAttribute('data-store-id');
      renderStoreInfo();
    });
  });
  renderStoreInfo();
}

/* ==========================================================================
   6. Interactive Menu Rendering & Category Filter (Dynamic API)
   ========================================================================== */
let activeMenuItems = [...menuItems];

async function initMenu() {
  const filterContainer = document.getElementById('menu-category-filters');
  const menuGrid = document.getElementById('menu-items-grid');
  if (!filterContainer || !menuGrid) return;

  // Fetch dynamic menu from API (with fallback)
  try {
    const resp = await fetch('/api/menu');
    const res = await resp.json();
    if (res.success && res.data && res.data.menuItems) {
      activeMenuItems = res.data.menuItems;
    }
  } catch (e) {
    console.warn('Using offline menuItems fallback');
  }

  filterContainer.innerHTML = categories.map(cat => `
    <button data-category="${cat.id}" class="category-btn px-4 py-2 rounded-full text-xs sm:text-sm font-medium transition-all duration-300 ${cat.id === activeCategory ? 'bg-bakery-orange text-white shadow-md shadow-bakery-orange/30 font-bold' : 'bg-white text-stone-600 hover:bg-orange-50 hover:text-bakery-orange border border-orange-200'}">
      ${cat.name}
    </button>
  `).join('');

  filterContainer.querySelectorAll('.category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategory = btn.getAttribute('data-category');
      
      filterContainer.querySelectorAll('.category-btn').forEach(b => {
        const cat = b.getAttribute('data-category');
        if (cat === activeCategory) {
          b.className = 'category-btn px-4 py-2 rounded-full text-xs sm:text-sm font-bold bg-bakery-orange text-white shadow-md shadow-bakery-orange/30';
        } else {
          b.className = 'category-btn px-4 py-2 rounded-full text-xs sm:text-sm font-medium bg-white text-stone-600 hover:bg-orange-50 hover:text-bakery-orange border border-orange-200';
        }
      });

      renderFilteredMenu();
    });
  });

  renderFilteredMenu();
}

function renderFilteredMenu() {
  const menuGrid = document.getElementById('menu-items-grid');
  if (!menuGrid) return;

  const items = activeCategory === 'all' 
    ? activeMenuItems 
    : activeMenuItems.filter(item => item.category === activeCategory);

  menuGrid.innerHTML = items.map(item => {
    const isAvailable = item.inStock !== false && (item.stockQty === undefined || item.stockQty > 0);
    return `
    <div class="chewys-box-card group relative flex flex-col justify-between rounded-2xl sm:rounded-3xl overflow-hidden shadow-md p-4 sm:p-5 text-[#2D1406] ${!isAvailable ? 'opacity-85 bg-stone-50/50' : ''}">
      <div>
        <div onclick="window.openQuickView('${item.id}')" class="relative aspect-[4/3] rounded-xl sm:rounded-2xl overflow-hidden mb-3.5 sm:mb-4 bg-stone-100 cursor-pointer">
          <img src="${item.image}" alt="${item.name}" loading="lazy" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ${!isAvailable ? 'filter grayscale opacity-75' : ''}">
          
          <div class="absolute top-2.5 left-2.5 sm:top-3 sm:left-3 flex flex-col gap-1 sm:gap-1.5">
            <span class="inline-block px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-full text-[9px] sm:text-xs font-bold tracking-wide uppercase bg-bakery-orange text-white shadow-md">
              ${item.tag || 'Special'}
            </span>
            ${item.safeForShipping ? `
              <span class="inline-flex items-center gap-1 px-2 sm:px-2.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-semibold bg-emerald-600 text-white shadow-sm">
                <i data-lucide="truck" class="w-2.5 h-2.5 sm:w-3 sm:h-3"></i> Kirim Aman
              </span>
            ` : ''}
          </div>

          <div class="absolute top-2.5 right-2.5 sm:top-3 sm:right-3">
            ${!isAvailable ? `
              <span class="px-2.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-mono font-bold bg-rose-600 text-white shadow-sm animate-pulse">
                SOLD OUT
              </span>
            ` : (item.stockQty !== undefined && item.stockQty <= 5 && item.stockQty > 0 ? `
              <span class="px-2.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-mono font-bold bg-amber-500 text-white shadow-sm">
                Sisa ${item.stockQty} Porsi!
              </span>
            ` : '')}
          </div>

          <button onclick="event.stopPropagation(); window.openQuickView('${item.id}')" class="absolute bottom-2.5 right-2.5 sm:bottom-3 sm:right-3 w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-white/95 text-bakery-orange shadow-lg flex items-center justify-center hover:bg-bakery-orange hover:text-white transition-all transform sm:opacity-0 sm:group-hover:opacity-100 scale-100">
            <i data-lucide="eye" class="w-4 h-4 sm:w-5 sm:h-5"></i>
          </button>
        </div>

        <div class="space-y-1 sm:space-y-1.5">
          <div class="flex items-start justify-between gap-2">
            <h4 onclick="window.openQuickView('${item.id}')" class="text-base sm:text-xl font-bold text-[#2D1406] group-hover:text-bakery-orange transition-colors cursor-pointer leading-snug">
              ${item.name}
            </h4>
            <span class="font-mono text-xs sm:text-base font-extrabold text-bakery-orange whitespace-nowrap pt-0.5">
              ${item.price}
            </span>
          </div>

          <p class="text-[11px] sm:text-xs text-stone-500 line-clamp-2 leading-relaxed">
            ${item.description}
          </p>
        </div>
      </div>

      <div class="mt-3.5 sm:mt-4 pt-2.5 sm:pt-3 border-t border-orange-100">
        <div class="text-[10px] sm:text-[11px] font-mono text-stone-500 mb-2.5 sm:mb-3 flex items-center gap-1">
          <span class="w-1.5 h-1.5 rounded-full ${isAvailable ? 'bg-bakery-orange' : 'bg-stone-400'} inline-block shrink-0"></span>
          <span class="truncate">${item.highlightTexture || 'Freshly baked'}</span>
        </div>

        ${isAvailable ? `
          <button onclick="window.openQuickView('${item.id}')" class="w-full py-2 sm:py-2.5 px-3 sm:px-4 rounded-xl bg-orange-50 text-bakery-orange border border-orange-200 text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 sm:gap-2 hover:bg-bakery-orange hover:text-white hover:border-transparent transition-all shadow-sm active:scale-95">
            <i data-lucide="shopping-bag" class="w-3.5 h-3.5 sm:w-4 sm:h-4"></i>
            <span>Pesan Menu Ini</span>
          </button>
        ` : `
          <button disabled class="w-full py-2 sm:py-2.5 px-3 sm:px-4 rounded-xl bg-stone-100 text-stone-400 border border-stone-200 text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 sm:gap-2 cursor-not-allowed">
            <i data-lucide="slash" class="w-3.5 h-3.5 sm:w-4 sm:h-4"></i>
            <span>Stok Habis (Sold Out)</span>
          </button>
        `}
      </div>
    </div>
    `;
  }).join('');

  refreshIcons();
}

/* ==========================================================================
   7. Quick View & Order Modal
   ========================================================================== */
window.openQuickView = function(itemId) {
  modalItem = activeMenuItems.find(i => i.id === itemId);
  if (!modalItem) return;
  modalQty = 1;

  const modal = document.getElementById('order-modal');
  if (!modal) return;

  document.getElementById('modal-img').src = modalItem.image;
  document.getElementById('modal-title').textContent = modalItem.name;
  document.getElementById('modal-tag').textContent = modalItem.tag || 'Special';
  document.getElementById('modal-price').textContent = modalItem.price;
  document.getElementById('modal-desc').textContent = modalItem.description || '';
  document.getElementById('modal-texture').textContent = modalItem.highlightTexture || 'Freshly baked';
  document.getElementById('modal-bundle').textContent = modalItem.bundleInfo || '';
  document.getElementById('modal-qty-display').textContent = modalQty;
  document.getElementById('modal-qty-display').textContent = modalQty;

  const shippingBadge = document.getElementById('modal-shipping-badge');
  if (shippingBadge) {
    if (modalItem.safeForShipping) {
      shippingBadge.classList.remove('hidden');
      shippingBadge.classList.add('inline-flex');
    } else {
      shippingBadge.classList.add('hidden');
      shippingBadge.classList.remove('inline-flex');
    }
  }

  updateModalOrderLinks();
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  refreshIcons();
};

window.closeQuickView = function() {
  const modal = document.getElementById('order-modal');
  if (modal) {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }
};

window.changeModalQty = function(delta) {
  modalQty = Math.max(1, modalQty + delta);
  const qtyEl = document.getElementById('modal-qty-display');
  if (qtyEl) qtyEl.textContent = modalQty;
  updateModalOrderLinks();
};

function updateModalOrderLinks() {
  if (!modalItem) return;
  const store = stores.find(s => s.id === activeStoreId) || stores[0];
  const waBtn = document.getElementById('modal-wa-btn');
  const gofoodBtn = document.getElementById('modal-gofood-btn');
  const isAvailable = modalItem.inStock !== false;

  if (isAvailable) {
    const text = `Halo Chewy's Dessert! Saya mau pesan ${modalQty}x ${modalItem.name} (${modalItem.price}) untuk outlet ${store.name}. Mohon info ketersediaan stok dan pembayarannya. Terima kasih!`;
    if (waBtn) {
      waBtn.href = `https://api.whatsapp.com/send?phone=6282266288312&text=${encodeURIComponent(text)}`;
      waBtn.className = "w-full py-3 px-4 rounded-full bg-bakery-orange text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 hover:bg-bakery-orange-hover transition-all shadow-md shadow-bakery-orange/40";
      waBtn.innerHTML = '<i data-lucide="phone" class="w-4 h-4"></i><span>Pesan via WhatsApp</span>';
    }
  } else {
    const text = `Halo Chewy's Dessert! Mau tanya, untuk menu ${modalItem.name} di outlet ${store.name} kira-kira kapan ready/restock lagi ya? Terima kasih!`;
    if (waBtn) {
      waBtn.href = `https://api.whatsapp.com/send?phone=6282266288312&text=${encodeURIComponent(text)}`;
      waBtn.className = "w-full py-3 px-4 rounded-full bg-stone-700 text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 hover:bg-stone-800 transition-all shadow-md";
      waBtn.innerHTML = '<i data-lucide="bell" class="w-4 h-4"></i><span>Tanya Jadwal Restock via WA</span>';
    }
  }

  if (gofoodBtn) {
    gofoodBtn.href = store.gofoodUrl;
  }
}

function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

/* ==========================================================================
   8. Initialize Application
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  initCanvasImageSequence();
  initStoreSwitcher();
  initMenu();
  refreshIcons();

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.closeQuickView();
  });
  const modalBackdrop = document.getElementById('modal-backdrop');
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', window.closeQuickView);
  }
});
