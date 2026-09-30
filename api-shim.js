/* ============================================================================
 * api-shim.js — Client-side API layer for Chewy's POS (Vercel static hosting)
 *
 * Masalah yang diperbaiki:
 *   Backend server.js menyimpan data ke file JSON di disk (data/menu.json,
 *   data/orders.json, data/ingredients.json). Di Vercel (serverless) filesystem
 *   bersifat ephemeral: setiap tulisan hilang begitu request selesai, sehingga:
 *     - transaksi checkout tidak pernah tersimpan (nomor struk duplikat),
 *     - tambah/edit/hapus menu tidak berpengaruh,
 *     - perubahan stok selalu kembali seperti semula.
 *
 * Solusi: file ini MENGGANTIKAN semua panggilan fetch('/api/*') dengan
 * implementasi lokal berbasis localStorage. Bentuk request & response dibuat
 * PERSIS seperti server.js, jadi kode halaman (pos.html, owner.html,
 * admin.html) tidak perlu diubah sama sekali — cukup sertakan file ini:
 *
 *     <script src="api-shim.js"></script>
 *
 * di dalam <head>, SEBELUM script halaman lainnya.
 *
 * Data awal (seed) diambil dari file statis /data/menu.json, /data/orders.json,
 * /data/ingredients.json SEKALI saja, lalu disimpan di localStorage. Setelah
 * itu semua baca/tulis 100% lokal dan permanen di browser/perangkat ini.
 *
 * Catatan: data tersimpan per-browser/perangkat (tidak sinkron antar HP).
 * ========================================================================== */
(function () {
  'use strict';

  var nativeFetch = window.fetch.bind(window);

  /* ------------------------------------------------------------------ */
  /* Storage layer                                                       */
  /* ------------------------------------------------------------------ */
  var LS_MENU = 'chewys_db_v1_menu';
  var LS_ORDERS = 'chewys_db_v1_orders';
  var LS_ING = 'chewys_db_v1_ingredients';
  var LS_SEEDED = 'chewys_db_v1_seeded';

  function lsGet(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) {
      console.warn('[api-shim] localStorage penuh / gagal tulis:', e);
      return false;
    }
  }

  function readMenuData() {
    return lsGet(LS_MENU) || { categories: [], menuItems: [] };
  }
  function writeMenuData(d) { lsSet(LS_MENU, d); }
  function readOrdersData() {
    return lsGet(LS_ORDERS) || { orders: [] };
  }
  function writeOrdersData(d) { lsSet(LS_ORDERS, d); }
  function readIngredientsData() {
    return lsGet(LS_ING) || { ingredients: [], recipes: {}, wasteLogs: [], stockLogs: [] };
  }
  function writeIngredientsData(d) { lsSet(LS_ING, d); }

  /* ------------------------------------------------------------------ */
  /* Jakarta (WIB, UTC+7) date helpers — replika persis server.js         */
  /* ------------------------------------------------------------------ */
  function getJakartaDate(d) {
    d = d || new Date();
    var utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    return new Date(utc + (7 * 3600000));
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function getJakartaDateKey(d) {
    var j = getJakartaDate(d);
    return j.getFullYear() + pad2(j.getMonth() + 1) + pad2(j.getDate());
  }
  function getJakartaDateStr(d) {
    var j = getJakartaDate(d);
    return j.getFullYear() + '-' + pad2(j.getMonth() + 1) + '-' + pad2(j.getDate());
  }
  function formatJakartaDateTime(d) {
    var j = getJakartaDate(d);
    return {
      date: pad2(j.getDate()) + '/' + pad2(j.getMonth() + 1) + '/' + j.getFullYear(),
      time: pad2(j.getHours()) + ':' + pad2(j.getMinutes()) + ':' + pad2(j.getSeconds())
    };
  }
  function parsePriceToNumber(p) {
    return Number(String(p === undefined || p === null ? 0 : p).replace(/[^0-9]/g, '')) || 0;
  }
  function formatRp(n) {
    return 'Rp ' + Number(n).toLocaleString('id-ID');
  }
  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ------------------------------------------------------------------ */
  /* Seed: ambil dari /data/*.json sekali saja                           */
  /* ------------------------------------------------------------------ */
  var seedPromise = null;
  function ensureSeeded() {
    if (lsGet(LS_SEEDED)) return Promise.resolve();
    if (seedPromise) return seedPromise;
    seedPromise = (function () {
      function getJSON(url, fallback) {
        return nativeFetch(url).then(function (r) {
          if (!r.ok) throw new Error('seed fetch gagal: ' + url);
          return r.json();
        }).catch(function () { return fallback; });
      }
      return Promise.all([
        getJSON('data/menu.json', { categories: [], menuItems: [] }),
        getJSON('data/orders.json', { orders: [] }),
        getJSON('data/ingredients.json', { ingredients: [], recipes: {}, wasteLogs: [], stockLogs: [] })
      ]).then(function (res) {
        if (!lsGet(LS_MENU)) writeMenuData(res[0]);
        if (!lsGet(LS_ORDERS)) writeOrdersData(res[1]);
        if (!lsGet(LS_ING)) writeIngredientsData(res[2]);
        lsSet(LS_SEEDED, true);
      });
    })();
    return seedPromise;
  }

  /* ------------------------------------------------------------------ */
  /* Response helper                                                     */
  /* ------------------------------------------------------------------ */
  function json(data, status) {
    return new Response(JSON.stringify(data), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  function ok(data) { return json(data, 200); }
  function created(data) { return json(data, 201); }
  function bad(data) { return json(data, 400); }
  function notFound(data) { return json(data, 404); }
  function unauthorized(data) { return json(data, 401); }

  /* ================================================================== */
  /* Route handlers — logika disalin persis dari server.js               */
  /* ================================================================== */
  var ADMIN_PIN = '1234';
  var DEFAULT_MENU_IMG = 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=700&q=80';

  var routes = {};

  // 1. GET /api/menu
  routes['GET /api/menu'] = function () {
    return ok({ success: true, data: readMenuData() });
  };

  // 2. POST /api/admin/login
  routes['POST /api/admin/login'] = function (body) {
    if (body.pin === ADMIN_PIN) return ok({ success: true, message: 'Login successful' });
    return unauthorized({ success: false, message: 'PIN salah!' });
  };

  // 3. POST /api/menu/toggle-stock
  routes['POST /api/menu/toggle-stock'] = function (body) {
    var data = readMenuData();
    var item = data.menuItems.find(function (m) { return m.id === body.id; });
    if (!item) return notFound({ success: false, message: 'Item tidak ditemukan' });
    item.inStock = typeof body.inStock === 'boolean' ? body.inStock : !item.inStock;
    if (item.inStock && (!item.stockQty || item.stockQty <= 0)) {
      item.stockQty = 20;
    } else if (!item.inStock) {
      item.stockQty = 0;
    }
    writeMenuData(data);
    return ok({ success: true, item: item });
  };

  // 3b. POST /api/menu/update-stock
  routes['POST /api/menu/update-stock'] = function (body) {
    var data = readMenuData();
    var item = data.menuItems.find(function (m) { return m.id === body.id; });
    if (!item) return notFound({ success: false, message: 'Item tidak ditemukan' });
    if (typeof body.stockQty === 'number') {
      item.stockQty = Math.max(0, Math.floor(body.stockQty));
    } else if (typeof body.delta === 'number') {
      item.stockQty = Math.max(0, Math.floor((item.stockQty || 0) + body.delta));
    }
    item.inStock = item.stockQty > 0;
    writeMenuData(data);
    return ok({ success: true, item: item });
  };

  // 4. POST /api/menu (create)
  routes['POST /api/menu'] = function (body) {
    if (!body.name || !body.price) {
      return bad({ success: false, message: 'Nama dan harga wajib diisi' });
    }
    var data = readMenuData();
    var imageUrl = body.image || DEFAULT_MENU_IMG;
    if (body.imageBase64) {
      // Simpan sebagai data URL langsung (localStorage); fallback ke default bila gagal
      try {
        var test = { x: body.imageBase64 };
        JSON.stringify(test);
        imageUrl = body.imageBase64;
      } catch (e) { imageUrl = DEFAULT_MENU_IMG; }
    }
    var id = body.id || (String(body.name).toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Math.floor(Math.random() * 1000));
    var stockQty = typeof body.stockQty === 'number' ? Math.max(0, Math.floor(body.stockQty)) : (body.inStock !== false ? 25 : 0);
    var newItem = {
      id: id,
      name: body.name,
      category: body.category || 'bomboloni',
      tag: body.tag || 'New Special',
      description: body.description || '',
      price: String(body.price).startsWith('Rp') ? body.price : formatRp(String(body.price).replace(/[^0-9]/g, '')),
      bundleInfo: body.bundleInfo || '',
      safeForShipping: Boolean(body.safeForShipping),
      stockQty: stockQty,
      inStock: (typeof body.stockQty === 'number' ? stockQty > 0 : body.inStock !== false),
      image: imageUrl,
      highlightTexture: body.highlightTexture || 'Freshly baked daily'
    };
    data.menuItems.unshift(newItem);
    if (!writeMenuData(data) && body.imageBase64) {
      // Kuota localStorage penuh karena gambar — simpan ulang tanpa gambar
      newItem.image = DEFAULT_MENU_IMG;
      data.menuItems[0] = newItem;
      writeMenuData(data);
    }
    return created({ success: true, item: newItem });
  };

  // 5. PUT /api/menu (update)
  routes['PUT /api/menu'] = function (body) {
    var data = readMenuData();
    var idx = data.menuItems.findIndex(function (m) { return m.id === body.id; });
    if (idx === -1) return notFound({ success: false, message: 'Item tidak ditemukan' });
    var cur = data.menuItems[idx];
    var imageUrl = body.image || cur.image;
    if (body.imageBase64) imageUrl = body.imageBase64;

    var newStockQty = body.stockQty !== undefined
      ? Math.max(0, Math.floor(Number(body.stockQty) || 0))
      : (cur.stockQty !== undefined ? cur.stockQty : 25);
    var newInStock = body.stockQty !== undefined
      ? newStockQty > 0
      : (body.inStock !== undefined ? Boolean(body.inStock) : cur.inStock);

    data.menuItems[idx] = Object.assign({}, cur, {
      name: body.name || cur.name,
      category: body.category || cur.category,
      tag: body.tag !== undefined ? body.tag : cur.tag,
      description: body.description !== undefined ? body.description : cur.description,
      price: body.price ? (String(body.price).startsWith('Rp') ? body.price : formatRp(String(body.price).replace(/[^0-9]/g, ''))) : cur.price,
      bundleInfo: body.bundleInfo !== undefined ? body.bundleInfo : cur.bundleInfo,
      safeForShipping: body.safeForShipping !== undefined ? Boolean(body.safeForShipping) : cur.safeForShipping,
      stockQty: newStockQty,
      inStock: newInStock,
      image: imageUrl,
      highlightTexture: body.highlightTexture !== undefined ? body.highlightTexture : cur.highlightTexture
    });
    writeMenuData(data);
    return ok({ success: true, item: data.menuItems[idx] });
  };

  // 6. DELETE /api/menu
  routes['DELETE /api/menu'] = function (body) {
    var data = readMenuData();
    var before = data.menuItems.length;
    data.menuItems = data.menuItems.filter(function (m) { return m.id !== body.id; });
    if (data.menuItems.length < before) {
      writeMenuData(data);
      return ok({ success: true, message: 'Menu berhasil dihapus' });
    }
    return notFound({ success: false, message: 'Item tidak ditemukan' });
  };

  // 7. GET /api/pos/orders
  routes['GET /api/pos/orders'] = function () {
    var ordersData = readOrdersData();
    return ok({ success: true, orders: ordersData.orders || [] });
  };

  // 8. POST /api/pos/checkout
  routes['POST /api/pos/checkout'] = function (body) {
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return bad({ success: false, message: 'Pesanan kosong / tidak valid' });
    }
    var ordersData = readOrdersData();
    var todayStr = getJakartaDateKey();
    var todayOrdersCount = (ordersData.orders || []).filter(function (o) {
      return o.id && o.id.indexOf(todayStr) !== -1;
    }).length;
    var orderSeq = String(todayOrdersCount + 1).padStart(4, '0');
    var orderId = 'CWY-' + todayStr + '-' + orderSeq;

    var newOrder = {
      id: orderId,
      createdAt: new Date().toISOString(),
      orderType: body.orderType || 'dine-in',
      tableOrCustomer: body.tableOrCustomer || (body.orderType === 'dine-in' ? 'Meja -' : 'Pelanggan Walk-in'),
      items: body.items,
      subtotal: Number(body.subtotal) || 0,
      discount: Number(body.discount) || 0,
      tax: Number(body.tax) || 0,
      total: Number(body.total) || 0,
      paymentMethod: body.paymentMethod || 'cash',
      cashPaid: Number(body.cashPaid) || Number(body.total) || 0,
      cashChange: Number(body.cashChange) || 0,
      paymentReference: body.paymentReference || '',
      cashier: body.cashier || 'Kasir 1',
      status: 'completed'
    };

    if (!ordersData.orders) ordersData.orders = [];
    ordersData.orders.unshift(newOrder);
    writeOrdersData(ordersData);

    // Kurangi stok menu
    var menuData = readMenuData();
    (body.items || []).forEach(function (orderItem) {
      var menuItem = menuData.menuItems.find(function (m) { return m.id === orderItem.id; });
      if (menuItem) {
        var currentStock = typeof menuItem.stockQty === 'number' ? menuItem.stockQty : 25;
        var newStock = Math.max(0, currentStock - (Number(orderItem.qty) || 1));
        menuItem.stockQty = newStock;
        if (newStock === 0) menuItem.inStock = false;
      }
    });
    writeMenuData(menuData);

    // Kurangi bahan baku via resep + catat stock log
    var ingData = readIngredientsData();
    if (!Array.isArray(ingData.stockLogs)) ingData.stockLogs = [];
    var changed = false;
    if (ingData.recipes && Array.isArray(ingData.ingredients)) {
      (body.items || []).forEach(function (orderItem) {
        var qtyBought = Number(orderItem.qty) || 1;
        var recipe = ingData.recipes[orderItem.id];
        if (Array.isArray(recipe)) {
          recipe.forEach(function (rec) {
            var ing = ingData.ingredients.find(function (i) { return i.id === rec.ingredientId; });
            if (ing) {
              var deduction = (Number(rec.amount) || 0) * qtyBought;
              ing.currentStock = Math.max(0, Math.round((ing.currentStock - deduction) * 1000) / 1000);
              changed = true;
              ingData.stockLogs.unshift({
                id: uid('log'),
                timestamp: new Date().toISOString(),
                ingredientId: ing.id,
                ingredientName: ing.name,
                type: 'OUT_SALE',
                changeQty: -deduction,
                balanceQty: ing.currentStock,
                unit: ing.unit,
                reference: 'POS ' + orderId,
                note: (orderItem.name || orderItem.id) + ' x' + qtyBought
              });
            }
          });
        }
      });
      if (changed) {
        if (ingData.stockLogs.length > 500) ingData.stockLogs.length = 500;
        writeIngredientsData(ingData);
      }
    }

    return created({ success: true, order: newOrder });
  };

  // 9. GET /api/pos/summary
  routes['GET /api/pos/summary'] = function () {
    var allOrders = readOrdersData().orders || [];
    var todayDate = getJakartaDateStr();
    var todayOrders = allOrders.filter(function (o) {
      return o.createdAt && getJakartaDateStr(new Date(o.createdAt)) === todayDate;
    });
    var totalRevenueToday = todayOrders.reduce(function (s, o) { return s + (o.total || 0); }, 0);
    var paymentBreakdown = {
      cash: { count: 0, total: 0 },
      qris: { count: 0, total: 0 },
      edc: { count: 0, total: 0 }
    };
    var itemSales = {};
    todayOrders.forEach(function (o) {
      var pm = (o.paymentMethod || 'cash').toLowerCase();
      if (paymentBreakdown[pm]) {
        paymentBreakdown[pm].count += 1;
        paymentBreakdown[pm].total += (o.total || 0);
      }
      (o.items || []).forEach(function (it) {
        var key = it.name || it.id;
        if (!itemSales[key]) itemSales[key] = { name: it.name, qty: 0, total: 0 };
        itemSales[key].qty += (it.qty || 1);
        itemSales[key].total += ((it.price || 0) * (it.qty || 1));
      });
    });
    var topItems = Object.keys(itemSales).map(function (k) { return itemSales[k]; })
      .sort(function (a, b) { return b.qty - a.qty; }).slice(0, 5);
    return ok({
      success: true,
      summary: {
        todayDate: todayDate,
        totalRevenueToday: totalRevenueToday,
        totalOrdersToday: todayOrders.length,
        paymentBreakdown: paymentBreakdown,
        topItems: topItems,
        recentOrders: todayOrders.slice(0, 15)
      }
    });
  };

  // 10. GET /api/owner/analytics
  routes['GET /api/owner/analytics'] = function (body, query) {
    var allOrders = readOrdersData().orders || [];
    var menuData = readMenuData();
    var range = (query && query.range) || '7d';

    var now = new Date();
    var startDate = new Date(0);
    if (range === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (range === '7d') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (range === '30d') {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    var filteredOrders = allOrders.filter(function (o) {
      return o.createdAt && new Date(o.createdAt) >= startDate;
    });

    var itemCostMap = {};
    var itemCategoryMap = {};
    (menuData.menuItems || []).forEach(function (m) {
      var p = parsePriceToNumber(m.price);
      itemCostMap[m.id] = typeof m.costPrice === 'number' ? m.costPrice : Math.round(p * 0.38);
      itemCategoryMap[m.id] = m.category || 'other';
    });

    var totalRevenue = 0, totalCost = 0, totalItemsSold = 0;
    var paymentStats = {
      cash: { count: 0, total: 0 },
      qris: { count: 0, total: 0 },
      edc: { count: 0, total: 0 }
    };
    var dateTrendMap = {};
    var hourMap = {};
    for (var h = 8; h <= 22; h++) {
      var hh = pad2(h) + ':00';
      hourMap[hh] = { hour: hh, count: 0, revenue: 0 };
    }
    var categoryMap = {
      bomboloni: { name: 'Bomboloni', qty: 0, revenue: 0 },
      brownies: { name: 'Brownies & Brookies', qty: 0, revenue: 0 },
      cookies: { name: 'Cookies', qty: 0, revenue: 0 },
      beverages: { name: 'Drinks & Coffee', qty: 0, revenue: 0 },
      other: { name: 'Lainnya', qty: 0, revenue: 0 }
    };
    var itemPerformanceMap = {};

    filteredOrders.forEach(function (o) {
      var orderDate = new Date(o.createdAt);
      var dateKey = orderDate.toISOString().slice(0, 10);
      var hourKey = pad2(orderDate.getHours()) + ':00';
      var orderTotal = Number(o.total) || 0;
      totalRevenue += orderTotal;

      var pm = (o.paymentMethod || 'cash').toLowerCase();
      if (paymentStats[pm]) { paymentStats[pm].count += 1; paymentStats[pm].total += orderTotal; }
      if (hourMap[hourKey]) { hourMap[hourKey].count += 1; hourMap[hourKey].revenue += orderTotal; }
      if (!dateTrendMap[dateKey]) dateTrendMap[dateKey] = { date: dateKey, revenue: 0, cost: 0, profit: 0, orders: 0 };
      dateTrendMap[dateKey].revenue += orderTotal;
      dateTrendMap[dateKey].orders += 1;

      var orderCost = 0;
      (o.items || []).forEach(function (it) {
        var qty = Number(it.qty) || 1;
        var price = Number(it.price) || 0;
        var unitCost = itemCostMap[it.id] !== undefined ? itemCostMap[it.id] : Math.round(price * 0.38);
        var cost = unitCost * qty;
        var rev = price * qty;
        orderCost += cost;
        totalItemsSold += qty;
        var cat = itemCategoryMap[it.id] || 'other';
        if (!categoryMap[cat]) categoryMap[cat] = { name: cat, qty: 0, revenue: 0 };
        categoryMap[cat].qty += qty;
        categoryMap[cat].revenue += rev;
        var itemKey = it.name || it.id;
        if (!itemPerformanceMap[itemKey]) {
          itemPerformanceMap[itemKey] = {
            id: it.id, name: it.name, category: cat, qty: 0, revenue: 0,
            cost: 0, profit: 0, unitPrice: price, unitCost: unitCost
          };
        }
        var perf = itemPerformanceMap[itemKey];
        perf.qty += qty; perf.revenue += rev; perf.cost += cost; perf.profit += (rev - cost);
      });
      totalCost += orderCost;
      dateTrendMap[dateKey].cost += orderCost;
      dateTrendMap[dateKey].profit += (orderTotal - orderCost);
    });

    var totalProfit = totalRevenue - totalCost;
    var timeline = Object.keys(dateTrendMap).map(function (k) { return dateTrendMap[k]; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var peakHours = Object.keys(hourMap).map(function (k) { return hourMap[k]; });
    var categoryBreakdown = Object.keys(categoryMap).map(function (k) { return categoryMap[k]; })
      .filter(function (c) { return c.qty > 0 || c.revenue > 0; });
    var menuProfitability = Object.keys(itemPerformanceMap).map(function (k) {
      var it = itemPerformanceMap[k];
      it.marginPercent = it.revenue > 0 ? Math.round((it.profit / it.revenue) * 100) : 0;
      return it;
    }).sort(function (a, b) { return b.profit - a.profit; });

    return ok({
      success: true,
      analytics: {
        range: range,
        totalRevenue: totalRevenue,
        totalCost: totalCost,
        totalProfit: totalProfit,
        profitMarginPercent: totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0,
        totalOrders: filteredOrders.length,
        avgOrderValue: filteredOrders.length > 0 ? Math.round(totalRevenue / filteredOrders.length) : 0,
        totalItemsSold: totalItemsSold,
        paymentStats: paymentStats,
        timeline: timeline,
        peakHours: peakHours,
        categoryBreakdown: categoryBreakdown,
        menuProfitability: menuProfitability,
        recentOrders: filteredOrders.slice(0, 20)
      }
    });
  };

  // 11. POST /api/owner/set-cost
  routes['POST /api/owner/set-cost'] = function (body) {
    var menuData = readMenuData();
    var item = menuData.menuItems.find(function (m) { return m.id === body.id; });
    if (!item) return notFound({ success: false, message: 'Item tidak ditemukan' });
    item.costPrice = Math.max(0, Math.floor(Number(body.costPrice) || 0));
    writeMenuData(menuData);
    return ok({ success: true, item: item });
  };

  // 14. GET /api/owner/ingredients
  routes['GET /api/owner/ingredients'] = function () {
    var ingData = readIngredientsData();
    var totalValuation = 0, lowStockCount = 0, outOfStockCount = 0;
    var ingredients = (ingData.ingredients || []).map(function (item) {
      var stock = Number(item.currentStock) || 0;
      var minAlert = Number(item.minStockAlert) || 0;
      var cost = Number(item.costPerUnit) || 0;
      var valuation = Math.round(stock * cost);
      totalValuation += valuation;
      var status = 'safe';
      if (stock <= 0) { status = 'out_of_stock'; outOfStockCount++; }
      else if (stock <= minAlert) { status = 'low'; lowStockCount++; }
      return Object.assign({}, item, {
        currentStock: stock, minStockAlert: minAlert, costPerUnit: cost,
        valuation: valuation, status: status
      });
    });
    var wasteLogs = Array.isArray(ingData.wasteLogs) ? ingData.wasteLogs : [];
    var stockLogs = Array.isArray(ingData.stockLogs) ? ingData.stockLogs : [];
    var totalWasteLoss = wasteLogs.reduce(function (a, w) { return a + (Number(w.totalLoss) || 0); }, 0);
    return ok({
      success: true,
      ingredients: ingredients,
      recipes: ingData.recipes || {},
      wasteLogs: wasteLogs.slice(0, 150),
      stockLogs: stockLogs.slice(0, 200),
      summary: {
        totalItems: ingredients.length,
        lowStockCount: lowStockCount,
        outOfStockCount: outOfStockCount,
        totalValuation: totalValuation,
        totalWasteLoss: totalWasteLoss
      }
    });
  };

  // 15. POST /api/owner/ingredients/restock
  routes['POST /api/owner/ingredients/restock'] = function (body) {
    var ingData = readIngredientsData();
    var ing = (ingData.ingredients || []).find(function (i) { return i.id === body.id; });
    if (!ing) return notFound({ success: false, message: 'Bahan baku tidak ditemukan' });
    var addQty = Number(body.addStock) || 0;
    ing.currentStock = Math.round(((Number(ing.currentStock) || 0) + addQty) * 1000) / 1000;
    if (body.costPerUnit && Number(body.costPerUnit) > 0) ing.costPerUnit = Number(body.costPerUnit);
    if (body.supplier) ing.supplier = body.supplier;
    var dt = formatJakartaDateTime();
    ing.lastRestock = dt.date + ' ' + dt.time;
    if (!Array.isArray(ingData.stockLogs)) ingData.stockLogs = [];
    ingData.stockLogs.unshift({
      id: uid('log'), timestamp: new Date().toISOString(),
      ingredientId: ing.id, ingredientName: ing.name, type: 'IN_RESTOCK',
      changeQty: addQty, balanceQty: ing.currentStock, unit: ing.unit,
      reference: 'Restock Gudang', note: 'Supplier: ' + (body.supplier || ing.supplier || '-')
    });
    if (ingData.stockLogs.length > 500) ingData.stockLogs.length = 500;
    writeIngredientsData(ingData);
    return ok({ success: true, ingredient: ing });
  };

  // 15b. POST /api/owner/ingredients/waste
  routes['POST /api/owner/ingredients/waste'] = function (body) {
    var ingredientId = body.ingredientId, qty = body.qty, reason = body.reason,
        note = body.note, reportedBy = body.reportedBy;
    var amount = Number(qty) || 0;
    if (!ingredientId || amount <= 0) {
      return bad({ success: false, message: 'Bahan dan jumlah terbuang wajib diisi valid' });
    }
    var ingData = readIngredientsData();
    var ing = (ingData.ingredients || []).find(function (i) { return i.id === ingredientId; });
    if (!ing) return notFound({ success: false, message: 'Bahan baku tidak ditemukan' });
    ing.currentStock = Math.max(0, Math.round(((Number(ing.currentStock) || 0) - amount) * 1000) / 1000);
    if (!Array.isArray(ingData.wasteLogs)) ingData.wasteLogs = [];
    var totalLoss = Math.round(amount * (Number(ing.costPerUnit) || 0));
    var wasteEntry = {
      id: uid('wst'), timestamp: new Date().toISOString(),
      ingredientId: ing.id, ingredientName: ing.name,
      qty: amount, unit: ing.unit, costPerUnit: ing.costPerUnit, totalLoss: totalLoss,
      reason: reason || 'Lainnya', note: note || '', reportedBy: reportedBy || 'Owner / Dapur'
    };
    ingData.wasteLogs.unshift(wasteEntry);
    if (ingData.wasteLogs.length > 300) ingData.wasteLogs.length = 300;
    if (!Array.isArray(ingData.stockLogs)) ingData.stockLogs = [];
    ingData.stockLogs.unshift({
      id: uid('log'), timestamp: new Date().toISOString(),
      ingredientId: ing.id, ingredientName: ing.name, type: 'OUT_WASTE',
      changeQty: -amount, balanceQty: ing.currentStock, unit: ing.unit,
      reference: 'Waste (' + (reason || 'Rusak') + ')',
      note: (note ? note + ' ' : '') + '(Rugi: Rp ' + totalLoss.toLocaleString('id-ID') + ')'
    });
    if (ingData.stockLogs.length > 500) ingData.stockLogs.length = 500;
    writeIngredientsData(ingData);
    return ok({
      success: true,
      message: 'Bahan rusak dicatat. Stok berkurang ' + amount + ' ' + ing.unit,
      waste: wasteEntry, newStock: ing.currentStock
    });
  };

  // 15c. POST /api/owner/ingredients/waste/delete
  routes['POST /api/owner/ingredients/waste/delete'] = function (body) {
    var ingData = readIngredientsData();
    if (!Array.isArray(ingData.wasteLogs)) ingData.wasteLogs = [];
    var before = ingData.wasteLogs.length;
    ingData.wasteLogs = ingData.wasteLogs.filter(function (w) { return w.id !== body.id; });
    if (ingData.wasteLogs.length < before) {
      writeIngredientsData(ingData);
      return ok({ success: true, message: 'Catatan waste berhasil dihapus' });
    }
    return notFound({ success: false, message: 'Catatan waste tidak ditemukan' });
  };

  // 16. POST /api/owner/ingredients/update
  routes['POST /api/owner/ingredients/update'] = function (body) {
    var ingData = readIngredientsData();
    var ing = (ingData.ingredients || []).find(function (i) { return i.id === body.id; });
    if (!ing) return notFound({ success: false, message: 'Bahan baku tidak ditemukan' });
    if (body.name) ing.name = body.name;
    if (body.category) ing.category = body.category;
    if (body.unit) ing.unit = body.unit;
    if (body.currentStock !== undefined) ing.currentStock = Number(body.currentStock);
    if (body.minStockAlert !== undefined) ing.minStockAlert = Number(body.minStockAlert);
    if (body.costPerUnit !== undefined) ing.costPerUnit = Number(body.costPerUnit);
    if (body.supplier !== undefined) ing.supplier = body.supplier;
    writeIngredientsData(ingData);
    return ok({ success: true, ingredient: ing });
  };

  // 17. POST /api/owner/ingredients/add
  routes['POST /api/owner/ingredients/add'] = function (body) {
    if (!body.name || !body.unit) {
      return bad({ success: false, message: 'Nama bahan dan satuan wajib diisi' });
    }
    var ingData = readIngredientsData();
    if (!Array.isArray(ingData.ingredients)) ingData.ingredients = [];
    var newIng = {
      id: uid('ing'),
      name: body.name,
      category: body.category || 'Tepung & Bahan Pokok',
      unit: body.unit,
      currentStock: Number(body.currentStock) || 0,
      minStockAlert: Number(body.minStockAlert) || 1,
      costPerUnit: Number(body.costPerUnit) || 0,
      supplier: body.supplier || '-'
    };
    ingData.ingredients.push(newIng);
    writeIngredientsData(ingData);
    return created({ success: true, ingredient: newIng });
  };

  // 18. POST /api/owner/ingredients/delete
  routes['POST /api/owner/ingredients/delete'] = function (body) {
    var ingData = readIngredientsData();
    var before = (ingData.ingredients || []).length;
    ingData.ingredients = (ingData.ingredients || []).filter(function (i) { return i.id !== body.id; });
    if (ingData.ingredients.length < before) {
      writeIngredientsData(ingData);
      return ok({ success: true, message: 'Bahan baku berhasil dihapus' });
    }
    return notFound({ success: false, message: 'Bahan baku tidak ditemukan' });
  };

  // 19. POST /api/owner/recipes/update
  routes['POST /api/owner/recipes/update'] = function (body) {
    var menuId = body.menuId, name = body.name, category = body.category,
        price = body.price, image = body.image, items = body.items, isNew = body.isNew;
    if (!name) return bad({ success: false, message: 'Nama menu wajib diisi' });
    if (!menuId || isNew) menuId = uid('menu');

    var ingData = readIngredientsData();
    if (!ingData.recipes) ingData.recipes = {};
    var ingMap = {};
    (ingData.ingredients || []).forEach(function (i) { ingMap[i.id] = i; });

    var cleanItems = [];
    var calculatedCost = 0;
    if (Array.isArray(items)) {
      items.forEach(function (it) {
        var ing = ingMap[it.ingredientId];
        var amount = Number(it.amount) || 0;
        if (ing && amount > 0) {
          cleanItems.push({ ingredientId: it.ingredientId, amount: amount, unit: ing.unit });
          calculatedCost += (amount * (Number(ing.costPerUnit) || 0));
        }
      });
    }
    ingData.recipes[menuId] = cleanItems;
    writeIngredientsData(ingData);

    var menuData = readMenuData();
    if (!Array.isArray(menuData.menuItems)) menuData.menuItems = [];
    var menuItem = menuData.menuItems.find(function (m) { return m.id === menuId; });
    var formattedPrice = price
      ? (String(price).startsWith('Rp') ? price : formatRp(String(price).replace(/[^0-9]/g, '')))
      : 'Rp 25.000';
    if (!menuItem) {
      menuItem = {
        id: menuId, name: name, category: category || 'bomboloni', tag: 'Menu Baru',
        description: "Kreasi dessert terbaru dari dapur Chewy's.",
        price: formattedPrice, bundleInfo: '', safeForShipping: true,
        stockQty: 25, inStock: true,
        image: image || DEFAULT_MENU_IMG,
        highlightTexture: 'Freshly baked daily',
        costPrice: Math.round(calculatedCost)
      };
      menuData.menuItems.unshift(menuItem);
    } else {
      menuItem.name = name;
      if (category) menuItem.category = category;
      if (price) menuItem.price = formattedPrice;
      if (image) menuItem.image = image;
      menuItem.costPrice = Math.round(calculatedCost);
    }
    writeMenuData(menuData);

    return ok({
      success: true,
      menuItem: menuItem,
      recipe: cleanItems,
      calculatedHpp: Math.round(calculatedCost),
      message: 'Menu dan resep berhasil disimpan'
    });
  };

  /* ================================================================== */
  /* Export CSV — replika persis format server.js                        */
  /* ================================================================== */
  function buildExportCSV() {
    var allOrders = readOrdersData().orders || [];
    var csv = '﻿'; // UTF-8 BOM
    csv += 'sep=;\n';
    csv += 'ID Pesanan;Tanggal;Waktu;Kasir;Tipe Pesanan;Meja / Pelanggan;Menu Dipesan;Subtotal (Rp);Diskon (Rp);Total Bayar (Rp);Metode Bayar;Status\n';
    allOrders.forEach(function (o) {
      var d = o.createdAt ? new Date(o.createdAt) : new Date();
      var dt = formatJakartaDateTime(d);
      var itemsList = (o.items || []).map(function (i) {
        return i.name + ' (' + i.qty + 'x)';
      }).join(' + ');
      function q(s) { return '"' + String(s === undefined || s === null ? '' : s).replace(/"/g, '""') + '"'; }
      csv += [
        q(o.id), q(dt.date), q(dt.time), q(o.cashier || 'Kasir 1'),
        q((o.orderType || '').toUpperCase()), q(o.tableOrCustomer || ''),
        q(itemsList), o.subtotal || 0, o.discount || 0, o.total || 0,
        q((o.paymentMethod || '').toUpperCase()), q((o.status || 'completed').toUpperCase())
      ].join(';') + '\n';
    });
    return csv;
  }

  function downloadBlob(filename, content, mime) {
    var blob = new Blob([content], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  function loadScriptOnce(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) return resolve();
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('gagal memuat ' + src)); };
      document.head.appendChild(s);
    });
  }

  function handleExportExcelClick(e) {
    e.preventDefault();
    var allOrders = readOrdersData().orders || [];
    loadScriptOnce('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js').then(function () {
      /* global XLSX */
      var rows = allOrders.map(function (o) {
        var d = o.createdAt ? new Date(o.createdAt) : new Date();
        var dt = formatJakartaDateTime(d);
        return {
          'ID Pesanan': o.id || '',
          'Tanggal': dt.date,
          'Waktu': dt.time,
          'Kasir': o.cashier || 'Kasir 1',
          'Tipe Pesanan': (o.orderType || '').toUpperCase(),
          'Meja / Pelanggan': o.tableOrCustomer || '',
          'Menu Dipesan': (o.items || []).map(function (i) { return i.name + ' (' + i.qty + 'x)'; }).join(' + '),
          'Subtotal (Rp)': o.subtotal || 0,
          'Diskon (Rp)': o.discount || 0,
          'Total Bayar (Rp)': o.total || 0,
          'Metode Bayar': (o.paymentMethod || '').toUpperCase(),
          'Status': (o.status || 'completed').toUpperCase()
        };
      });
      var wb = XLSX.utils.book_new();
      var ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Keterangan': 'Belum ada data penjualan' }]);
      ws['!cols'] = [
        { wch: 20 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 14 },
        { wch: 20 }, { wch: 45 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 12 }
      ];
      XLSX.utils.book_append_sheet(wb, ws, 'Penjualan');
      XLSX.writeFile(wb, 'laporan-penjualan-chewys.xlsx');
    }).catch(function () {
      // Offline / CDN gagal: fallback ke CSV
      downloadBlob('laporan-penjualan-chewys.csv', buildExportCSV(), 'text/csv;charset=UTF-8');
    });
  }

  // Tangkap klik pada link export (anchor biasa, bukan fetch)
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href^="/api/owner/export-"]') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (href === '/api/owner/export-csv') {
      e.preventDefault();
      downloadBlob('laporan-penjualan-chewys.csv', buildExportCSV(), 'text/csv;charset=UTF-8');
    } else if (href === '/api/owner/export-excel') {
      handleExportExcelClick(e);
    }
  }, true);

  /* ================================================================== */
  /* Fetch interceptor                                                   */
  /* ================================================================== */
  function parseBody(init) {
    if (!init || init.body === undefined || init.body === null) return {};
    if (typeof init.body === 'string') {
      try { return JSON.parse(init.body); } catch (e) { return {}; }
    }
    if (typeof init.body === 'object') return init.body;
    return {};
  }

  window.fetch = function (input, init) {
    var urlStr = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    var url;
    try { url = new URL(urlStr, window.location.href); }
    catch (e) { return nativeFetch(input, init); }

    if (!url.pathname.startsWith('/api/')) {
      return nativeFetch(input, init); // bukan API → teruskan asli
    }

    var method = (init && init.method ? init.method : (input && input.method ? input.method : 'GET')).toUpperCase();
    var key = method + ' ' + url.pathname;
    var handler = routes[key];

    return ensureSeeded().then(function () {
      if (!handler) {
        return json({ error: 'Endpoint API tidak ditemukan' }, 404);
      }
      var body = parseBody(init || (typeof input !== 'string' ? input : null));
      var query = {};
      url.searchParams.forEach(function (v, k) { query[k] = v; });
      try {
        return handler(body, query) || ok({ success: true });
      } catch (err) {
        console.error('[api-shim] handler error:', err);
        return json({ success: false, message: 'Terjadi kesalahan: ' + err.message }, 500);
      }
    });
  };

  // Panaskan seed di background agar request pertama cepat
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { ensureSeeded(); });
  } else {
    ensureSeeded();
  }

  console.log('%c[api-shim] aktif — /api/* dilayani dari localStorage', 'color:#16a34a;font-weight:bold');
})();
