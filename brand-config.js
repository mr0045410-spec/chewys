/* ============================================================================
 * brand-config.js — SATU FILE untuk rebranding seluruh aplikasi POS.
 *
 * Cara pakai: cukup ganti nilai-nilai di bawah ini, lalu simpan.
 * Halaman Kasir (pos.html), Owner (owner.html), dan Admin (admin.html)
 * otomatis mengikuti — TIDAK perlu edit file lain.
 *
 * Contoh: jual aplikasi ini ke "Kopi Senja" ->
 *   name: "Kopi Senja", logo: "./assets/logo-kopi-senja.png",
 *   slug: "kopisenja", orderPrefix: "KSJ", primaryColor: "#1F6F4A", ...
 * ========================================================================== */
(function () {
  'use strict';

  var BRAND = {
    // --- Identitas ---
    name: "Chewy's",                        // nama pendek (alt logo, dsb)
    nameUpper: "CHEWY'S",                   // versi kapital
    fullName: "Chewy's Dessert & Coffee",   // dipakai di <title> tiap halaman
    receiptName: "CHEWY'S DESSERT",          // header struk cetak & WA
    tagline: "Fresh Bomboloni & Artisanal Brookies", // sub-header struk
    address: "Jl. Senopati No. 45, Jakarta Selatan",  // alamat di struk
    phone: "0812-3456-7890",                // no WA/telp di struk
    instagram: "@chewys.dessert",            // IG di struk & pesan WA
    logo: "./assets/logo-chewys-orange.png", // path logo (favicon + header + fallback)

    // --- Teknis / penamaan file ---
    slug: "chewys",        // dipakai di nama file export & QRIS mock
    orderPrefix: "CWY",    // prefix nomor struk, mis. CWY-20261001-0001

    // --- Warna brand (dipakai tailwind.config tiap halaman) ---
    primaryColor: "#FE6134",       // 'bakery-orange'
    primaryColorHover: "#e34e23",  // 'bakery-orange-hover'
    creamColor: "#F7F6E2",         // 'bakery-cream'
    darkColor: "#2D1406",          // 'chocolate-dark'

    // --- Judul halaman (<title>) ---
    pageTitles: {
      pos: "Kasir POS",
      owner: "Owner Dashboard",
      admin: "Admin Dashboard"
    },

    // --- Label-label khusus ---
    qrisLabel: "Scan QRIS Chewy's Dessert", // label di modal bayar QRIS
    insightLabel: "INSIGHT BISNIS CHEWY'S", // header kartu insight owner
    portalName: "Chewy's Owner Portal",     // tanda tangan pesan WA laporan
    adminHeading: "Admin Chewy's",           // judul kartu login admin
    receiptThanks: "Terima kasih! Have a Sweet Day \uD83C\uDF69\u2728" // footer pesan WA struk
  };

  window.BRAND = BRAND;

  /* Terapkan branding ke elemen statis HTML. Dijalankan otomatis;
   * kegagalan di sini TIDAK boleh merusak aplikasi. */
  function applyBranding() {
    try {
      // <title data-brand-page="pos|owner|admin">
      var titleEl = document.querySelector('title[data-brand-page]');
      if (titleEl) {
        var page = titleEl.getAttribute('data-brand-page');
        var label = (BRAND.pageTitles && BRAND.pageTitles[page]) || page;
        document.title = label + ' \u00B7 ' + BRAND.fullName;
      }
      // Favicon
      var fav = document.querySelector('link[rel="icon"]');
      if (fav && BRAND.logo) fav.href = BRAND.logo;
      // Logo <img data-brand-logo>
      var logos = document.querySelectorAll('img[data-brand-logo]');
      for (var i = 0; i < logos.length; i++) {
        if (BRAND.logo) logos[i].src = BRAND.logo;
        logos[i].alt = BRAND.name;
      }
      // Teks <... data-brand-text="namaField">
      var texts = document.querySelectorAll('[data-brand-text]');
      for (var j = 0; j < texts.length; j++) {
        var key = texts[j].getAttribute('data-brand-text');
        if (BRAND[key] !== undefined && BRAND[key] !== null) texts[j].textContent = BRAND[key];
      }
      // QRIS mock <img data-brand-qris>
      var qrisImgs = document.querySelectorAll('img[data-brand-qris]');
      for (var k = 0; k < qrisImgs.length; k++) {
        qrisImgs[k].src = 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data='
          + encodeURIComponent(String(BRAND.slug).toUpperCase() + '-QRIS-MOCK');
        qrisImgs[k].alt = 'QRIS ' + BRAND.name;
      }
      // Link download Excel <a data-brand-excel>
      var excels = document.querySelectorAll('a[data-brand-excel]');
      for (var m = 0; m < excels.length; m++) {
        excels[m].setAttribute('download', 'laporan-penjualan-' + BRAND.slug + '.xlsx');
      }
    } catch (e) { /* branding gagal -> biarkan tampilan default, app tetap jalan */ }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyBranding);
    else applyBranding();
  }

  // Diekspos agar gampang dites / rebrand dinamis dari console: applyBranding()
  window.applyBranding = applyBranding;
})();
