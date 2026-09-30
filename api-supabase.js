/* ============================================================================
 * api-supabase.js — Client-side API layer untuk Chewy's POS (VERSI DATABASE)
 *
 * PENGGANTI api-shim.js. Cara pakai: ganti
 *     <script src="api-shim.js"></script>
 * menjadi
 *     <script src="api-shim.js"></script>  ->  <script src="api-supabase.js"></script>
 * di pos.html, owner.html, admin.html. Kode halaman TIDAK perlu diubah.
 *
 * Semua panggilan fetch('/api/*') diterjemahkan menjadi query ke Supabase
 * (PostgREST). Bentuk request & response SAMA PERSIS seperti server.js lama,
 * jadi frontend tidak tahu bedanya.
 *
 * Keunggulan vs api-shim.js (localStorage):
 *  - Data sinkron antar perangkat (banyak kasir + dapur + owner real-time)
 *  - Nomor struk atomic — tidak duplikat walau 2 kasir checkout bersamaan
 *  - Data aman di cloud + ada backup otomatis Supabase
 *
 * Syarat: tabel sudah dibuat via supabase-schema.sql di SQL Editor.
 * ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* KONFIGURASI — ganti dengan milikmu bila project berbeda             */
  /* ------------------------------------------------------------------ */
  var SUPABASE_URL = 'https://kubnzmwizfivgnlcspvm.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1Ym56bXdpemZpdmdubGNzcHZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3Njc5NTQsImV4cCI6MjEwNjM0Mzk1NH0.xi-te3kGO-WfWCDuoTF2M-mC7dKBhjvJOGjKQ2KPncQ';

  var nativeFetch = window.fetch.bind(window);
  var API = SUPABASE_URL + '/rest/v1';
  var ADMIN_PIN = '1234';

  /* ------------------------------------------------------------------ */
  /* Supabase REST client mungil                                         */
  /* ------------------------------------------------------------------ */
  function sb(path, opts) {
    opts = opts || {};
    var url = API + path;
    var headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    };
    if (opts.prefer) headers['Prefer'] = opts.prefer;
    return nativeFetch(url, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
        if (!res.ok) {
          var msg = (data && (data.message || data.hint)) || ('Supabase error ' + res.status);
          throw new Error(msg);
        }
        return data;
      });
    });
  }
  function sel(table, query) { return sb('/' + table + (query ? '?' + query : '')); }
  function ins(table, rows) {
    return sb('/' + table, { method: 'POST', body: rows, prefer: 'return=representation' });
  }
  function upd(table, query, patch) {
    return sb('/' + table + '?' + query, { method: 'PATCH', body: patch, prefer: 'return=representation' });
  }
  function del(table, query) {
    return sb('/' + table + '?' + query, { method: 'DELETE', prefer: 'return=representation' });
  }
  function rpc(fn, args) { return sb('/rpc/' + fn, { method: 'POST', body: args }); }

  /* ------------------------------------------------------------------ */
  /* Helper tanggal WIB (replika server.js)                              */
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
  // Awal hari ini (00:00 WIB) dalam ISO UTC — untuk filter query Supabase
  function jakartaDayStartUTCISO() {
    var j = getJakartaDate(new Date());
    var midnightWib = new Date(j.getFullYear(), j.getMonth(), j.getDate(), 0, 0, 0);
    return new Date(midnightWib.getTime() - 7 * 3600000).toISOString();
  }
  function parsePriceToNumber(p) {
    return Number(String(p === undefined || p === null ? 0 : p).replace(/[^0-9]/g, '')) || 0;
  }
  function formatRp(n) { return 'Rp ' + Number(n).toLocaleString('id-ID'); }
  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ------------------------------------------------------------------ */
  /* Mapper: baris DB (snake_case) <-> objek frontend (camelCase)         */
  /* ------------------------------------------------------------------ */
  var DEFAULT_MENU_IMG = 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=700&q=80';
  var SEED_CATEGORIES = [
    { id: 'all', name: 'All Sweets' },
    { id: 'bomboloni', name: 'Signature Bomboloni' },
    { id: 'brownies', name: 'Brownies & Brookies' },
    { id: 'cookies', name: 'Chewy Cookies' },
    { id: 'beverages', name: 'Drinks & Coffee' }
  ];

  function rowToMenuItem(r) {
    return {
      id: r.id, name: r.name, category: r.category, tag: r.tag || '',
      description: r.description || '', price: r.price,
      bundleInfo: r.bundle_info || '', safeForShipping: !!r.safe_for_shipping,
      stockQty: r.stock_qty, inStock: !!r.in_stock, image: r.image,
      highlightTexture: r.highlight_texture || '', costPrice: r.cost_price
    };
  }
  function menuItemToRow(m) {
    return {
      id: m.id, name: m.name, category: m.category, tag: m.tag || '',
      description: m.description || '', price: m.price,
      price_value: parsePriceToNumber(m.price),
      cost_price: m.costPrice !== undefined ? m.costPrice : 0,
      stock_qty: m.stockQty, in_stock: !!m.inStock, image: m.image,
      highlight_texture: m.highlightTexture || '', bundle_info: m.bundleInfo || '',
      safe_for_shipping: !!m.safeForShipping, updated_at: new Date().toISOString()
    };
  }
  function rowToOrder(r) {
    return {
      id: r.id, createdAt: r.created_at, orderType: r.order_type,
      tableOrCustomer: r.table_or_customer, items: r.items,
      subtotal: r.subtotal, discount: r.discount, tax: r.tax, total: r.total,
      paymentMethod: r.payment_method, cashPaid: r.cash_paid,
      cashChange: r.cash_change, paymentReference: r.payment_reference || '',
      cashier: r.cashier, status: r.status
    };
  }
  function orderToRow(o) {
    return {
      id: o.id, order_type: o.orderType, table_or_customer: o.tableOrCustomer,
      items: o.items, subtotal: o.subtotal, discount: o.discount, tax: o.tax,
      total: o.total, payment_method: o.paymentMethod, cash_paid: o.cashPaid,
      cash_change: o.cashChange, payment_reference: o.paymentReference || '',
      cashier: o.cashier, status: o.status
    };
  }
  function rowToIngredient(r) {
    var stock = Number(r.current_stock) || 0;
    var minAlert = Number(r.min_stock_alert) || 0;
    var cost = Number(r.cost_per_unit) || 0;
    var status = 'safe';
    if (stock <= 0) status = 'out_of_stock';
    else if (stock <= minAlert) status = 'low';
    return {
      id: r.id, name: r.name, category: r.category, unit: r.unit,
      currentStock: stock, minStockAlert: minAlert, costPerUnit: cost,
      supplier: r.supplier, lastRestock: r.last_restock || '',
      valuation: Math.round(stock * cost), status: status
    };
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
  function ok(d) { return json(d, 200); }
  function created(d) { return json(d, 201); }
  function bad(d) { return json(d, 400); }
  function notFound(d) { return json(d, 404); }
  function unauthorized(d) { return json(d, 401); }
  function serverError(e) {
    console.error('[api-supabase]', e);
    return json({ success: false, message: 'Kesalahan server: ' + (e.message || e) }, 500);
  }

  /* ================================================================== */
  /* Route handlers                                                       */
  /* ================================================================== */
  var routes = {};

  // 1. GET /api/menu
  routes['GET /api/menu'] = function () {
    return sel('menu_items', 'select=*&order=sort_order.asc,created_at.asc').then(function (rows) {
      return ok({ success: true, data: { categories: SEED_CATEGORIES, menuItems: rows.map(rowToMenuItem) } });
    }).catch(serverError);
  };

  // 2. POST /api/admin/login
  routes['POST /api/admin/login'] = function (body) {
    if (body.pin === ADMIN_PIN) return Promise.resolve(ok({ success: true, message: 'Login successful' }));
    return Promise.resolve(unauthorized({ success: false, message: 'PIN salah!' }));
  };

  // 3. POST /api/menu/toggle-stock
  routes['POST /api/menu/toggle-stock'] = function (body) {
    return sel('menu_items', 'select=*&id=eq.' + encodeURIComponent(body.id)).then(function (rows) {
      if (!rows.length) return notFound({ success: false, message: 'Item tidak ditemukan' });
      var r = rows[0];
      var inStock = typeof body.inStock === 'boolean' ? body.inStock : !r.in_stock;
      var stockQty = inStock ? (r.stock_qty > 0 ? r.stock_qty : 20) : 0;
      return upd('menu_items', 'id=eq.' + encodeURIComponent(body.id),
        { in_stock: inStock, stock_qty: stockQty, updated_at: new Date().toISOString() })
        .then(function (u) { return ok({ success: true, item: rowToMenuItem(u[0]) }); });
    }).catch(serverError);
  };

  // 3b. POST /api/menu/update-stock
  routes['POST /api/menu/update-stock'] = function (body) {
    return sel('menu_items', 'select=*&id=eq.' + encodeURIComponent(body.id)).then(function (rows) {
      if (!rows.length) return notFound({ success: false, message: 'Item tidak ditemukan' });
      var r = rows[0];
      var stockQty = r.stock_qty;
      if (typeof body.stockQty === 'number') stockQty = Math.max(0, Math.floor(body.stockQty));
      else if (typeof body.delta === 'number') stockQty = Math.max(0, Math.floor(stockQty + body.delta));
      return upd('menu_items', 'id=eq.' + encodeURIComponent(body.id),
        { stock_qty: stockQty, in_stock: stockQty > 0, updated_at: new Date().toISOString() })
        .then(function (u) { return ok({ success: true, item: rowToMenuItem(u[0]) }); });
    }).catch(serverError);
  };

  // 4. POST /api/menu (create)
  routes['POST /api/menu'] = function (body) {
    if (!body.name || !body.price) {
      return Promise.resolve(bad({ success: false, message: 'Nama dan harga wajib diisi' }));
    }
    var stockQty = typeof body.stockQty === 'number' ? Math.max(0, Math.floor(body.stockQty)) : (body.inStock !== false ? 25 : 0);
    var item = {
      id: body.id || (String(body.name).toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Math.floor(Math.random() * 1000)),
      name: body.name,
      category: body.category || 'bomboloni',
      tag: body.tag || 'New Special',
      description: body.description || '',
      price: String(body.price).startsWith('Rp') ? body.price : formatRp(String(body.price).replace(/[^0-9]/g, '')),
      bundleInfo: body.bundleInfo || '',
      safeForShipping: Boolean(body.safeForShipping),
      stockQty: stockQty,
      inStock: (typeof body.stockQty === 'number' ? stockQty > 0 : body.inStock !== false),
      image: body.imageBase64 || body.image || DEFAULT_MENU_IMG,
      highlightTexture: body.highlightTexture || 'Freshly baked daily'
    };
    return ins('menu_items', [menuItemToRow(item)]).then(function (rows) {
      return created({ success: true, item: rowToMenuItem(rows[0]) });
    }).catch(serverError);
  };

  // 5. PUT /api/menu (update)
  routes['PUT /api/menu'] = function (body) {
    return sel('menu_items', 'select=*&id=eq.' + encodeURIComponent(body.id)).then(function (rows) {
      if (!rows.length) return notFound({ success: false, message: 'Item tidak ditemukan' });
      var cur = rowToMenuItem(rows[0]);
      var newStockQty = body.stockQty !== undefined
        ? Math.max(0, Math.floor(Number(body.stockQty) || 0)) : cur.stockQty;
      var newInStock = body.stockQty !== undefined
        ? newStockQty > 0
        : (body.inStock !== undefined ? Boolean(body.inStock) : cur.inStock);
      var patch = {
        name: body.name || cur.name,
        category: body.category || cur.category,
        tag: body.tag !== undefined ? body.tag : cur.tag,
        description: body.description !== undefined ? body.description : cur.description,
        price: body.price
          ? (String(body.price).startsWith('Rp') ? body.price : formatRp(String(body.price).replace(/[^0-9]/g, '')))
          : cur.price,
        price_value: body.price ? parsePriceToNumber(body.price) : parsePriceToNumber(cur.price),
        bundle_info: body.bundleInfo !== undefined ? body.bundleInfo : cur.bundleInfo,
        safe_for_shipping: body.safeForShipping !== undefined ? Boolean(body.safeForShipping) : cur.safeForShipping,
        stock_qty: newStockQty,
        in_stock: newInStock,
        image: body.imageBase64 || body.image || cur.image,
        highlight_texture: body.highlightTexture !== undefined ? body.highlightTexture : cur.highlightTexture,
        updated_at: new Date().toISOString()
      };
      return upd('menu_items', 'id=eq.' + encodeURIComponent(body.id), patch)
        .then(function (u) { return ok({ success: true, item: rowToMenuItem(u[0]) }); });
    }).catch(serverError);
  };

  // 6. DELETE /api/menu
  routes['DELETE /api/menu'] = function (body) {
    return del('menu_items', 'id=eq.' + encodeURIComponent(body.id)).then(function (rows) {
      if (rows && rows.length) return ok({ success: true, message: 'Menu berhasil dihapus' });
      return notFound({ success: false, message: 'Item tidak ditemukan' });
    }).catch(serverError);
  };

  // 7. GET /api/pos/orders
  routes['GET /api/pos/orders'] = function () {
    return sel('orders', 'select=*&order=created_at.desc&limit=500').then(function (rows) {
      return ok({ success: true, orders: rows.map(rowToOrder) });
    }).catch(serverError);
  };

  // 8. POST /api/pos/checkout
  routes['POST /api/pos/checkout'] = function (body) {
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return Promise.resolve(bad({ success: false, message: 'Pesanan kosong / tidak valid' }));
    }
    var todayStr = getJakartaDateKey();
    // Nomor struk atomic via Postgres function (anti-duplikat antar kasir)
    return rpc('next_order_seq', { p_date_key: todayStr }).then(function (seqRaw) {
      var seq = Array.isArray(seqRaw) ? seqRaw[0] : seqRaw;
      var orderId = 'CWY-' + todayStr + '-' + String(seq).padStart(4, '0');
      var newOrder = {
        id: orderId,
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
      return ins('orders', [orderToRow(newOrder)]).then(function () {
        // Kurangi stok menu
        var ids = body.items.map(function (i) { return i.id; });
        return sel('menu_items', 'select=id,stock_qty&id=in.(' + ids.map(encodeURIComponent).join(',') + ')')
          .then(function (menuRows) {
            var stockMap = {};
            menuRows.forEach(function (m) { stockMap[m.id] = m.stock_qty; });
            var updates = body.items.map(function (orderItem) {
              var cur = typeof stockMap[orderItem.id] === 'number' ? stockMap[orderItem.id] : 25;
              var ns = Math.max(0, cur - (Number(orderItem.qty) || 1));
              return upd('menu_items', 'id=eq.' + encodeURIComponent(orderItem.id),
                { stock_qty: ns, in_stock: ns > 0, updated_at: new Date().toISOString() });
            });
            return Promise.all(updates);
          })
          .then(function () {
            // Kurangi bahan baku via resep + stock log
            return sel('recipes', 'select=menu_id,items&menu_id=in.(' + ids.map(encodeURIComponent).join(',') + ')');
          })
          .then(function (recipeRows) {
            var recipeMap = {};
            recipeRows.forEach(function (r) { recipeMap[r.menu_id] = r.items || []; });
            var needIds = {};
            body.items.forEach(function (oi) {
              (recipeMap[oi.id] || []).forEach(function (rec) { needIds[rec.ingredientId] = true; });
            });
            var ingIds = Object.keys(needIds);
            if (!ingIds.length) return null;
            return sel('ingredients', 'select=*&id=in.(' + ingIds.map(encodeURIComponent).join(',') + ')')
              .then(function (ingRows) {
                var ingMap = {};
                ingRows.forEach(function (g) { ingMap[g.id] = g; });
                var ops = [];
                var logs = [];
                body.items.forEach(function (orderItem) {
                  var qtyBought = Number(orderItem.qty) || 1;
                  (recipeMap[orderItem.id] || []).forEach(function (rec) {
                    var ing = ingMap[rec.ingredientId];
                    if (!ing) return;
                    var deduction = (Number(rec.amount) || 0) * qtyBought;
                    var nb = Math.max(0, Math.round((Number(ing.current_stock) - deduction) * 1000) / 1000);
                    ing.current_stock = nb; // untuk item berikutnya yg pakai bahan sama
                    ops.push(upd('ingredients', 'id=eq.' + encodeURIComponent(ing.id), { current_stock: nb }));
                    logs.push({
                      id: uid('log'), ingredient_id: ing.id, ingredient_name: ing.name,
                      type: 'OUT_SALE', change_qty: -deduction, balance_qty: nb,
                      unit: ing.unit, reference: 'POS ' + orderId,
                      note: (orderItem.name || orderItem.id) + ' x' + qtyBought
                    });
                  });
                });
                return Promise.all(ops).then(function () {
                  return logs.length ? ins('stock_logs', logs) : null;
                });
              });
          })
          .then(function () {
            return sel('orders', 'select=*&id=eq.' + encodeURIComponent(orderId));
          })
          .then(function (rows) {
            return created({ success: true, order: rowToOrder(rows[0]) });
          });
      });
    }).catch(serverError);
  };

  // 9. GET /api/pos/summary
  routes['GET /api/pos/summary'] = function () {
    var todayDate = getJakartaDateStr();
    return sel('orders', 'select=*&created_at=gte.' + encodeURIComponent(jakartaDayStartUTCISO()) + '&order=created_at.desc')
      .then(function (rows) {
        var todayOrders = rows.map(rowToOrder).filter(function (o) {
          return o.createdAt && getJakartaDateStr(new Date(o.createdAt)) === todayDate;
        });
        var totalRevenueToday = todayOrders.reduce(function (s, o) { return s + (o.total || 0); }, 0);
        var paymentBreakdown = {
          cash: { count: 0, total: 0 }, qris: { count: 0, total: 0 }, edc: { count: 0, total: 0 }
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
            todayDate: todayDate, totalRevenueToday: totalRevenueToday,
            totalOrdersToday: todayOrders.length, paymentBreakdown: paymentBreakdown,
            topItems: topItems, recentOrders: todayOrders.slice(0, 15)
          }
        });
      }).catch(serverError);
  };

  // 10. GET /api/owner/analytics
  routes['GET /api/owner/analytics'] = function (body, query) {
    var range = (query && query.range) || '7d';
    var now = new Date();
    var startISO;
    if (range === 'today') {
      startISO = jakartaDayStartUTCISO();
    } else if (range === '7d') {
      startISO = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
    } else if (range === '30d') {
      startISO = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
    } else {
      startISO = new Date(0).toISOString();
    }
    return Promise.all([
      sel('orders', 'select=*&created_at=gte.' + encodeURIComponent(startISO) + '&order=created_at.desc&limit=2000'),
      sel('menu_items', 'select=id,price_value,cost_price,category')
    ]).then(function (res) {
      var allOrders = res[0].map(rowToOrder);
      var startDate = new Date(startISO);
      var filteredOrders = allOrders.filter(function (o) {
        return o.createdAt && new Date(o.createdAt) >= startDate;
      });

      var itemCostMap = {}, itemCategoryMap = {};
      res[1].forEach(function (m) {
        itemCostMap[m.id] = typeof m.cost_price === 'number' ? m.cost_price : Math.round((m.price_value || 0) * 0.38);
        itemCategoryMap[m.id] = m.category || 'other';
      });

      var totalRevenue = 0, totalCost = 0, totalItemsSold = 0;
      var paymentStats = {
        cash: { count: 0, total: 0 }, qris: { count: 0, total: 0 }, edc: { count: 0, total: 0 }
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
          var cost = unitCost * qty, rev = price * qty;
          orderCost += cost; totalItemsSold += qty;
          var cat = itemCategoryMap[it.id] || 'other';
          if (!categoryMap[cat]) categoryMap[cat] = { name: cat, qty: 0, revenue: 0 };
          categoryMap[cat].qty += qty; categoryMap[cat].revenue += rev;
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
      return ok({
        success: true,
        analytics: {
          range: range, totalRevenue: totalRevenue, totalCost: totalCost, totalProfit: totalProfit,
          profitMarginPercent: totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0,
          totalOrders: filteredOrders.length,
          avgOrderValue: filteredOrders.length > 0 ? Math.round(totalRevenue / filteredOrders.length) : 0,
          totalItemsSold: totalItemsSold, paymentStats: paymentStats,
          timeline: Object.keys(dateTrendMap).map(function (k) { return dateTrendMap[k]; })
            .sort(function (a, b) { return a.date < b.date ? -1 : 1; }),
          peakHours: Object.keys(hourMap).map(function (k) { return hourMap[k]; }),
          categoryBreakdown: Object.keys(categoryMap).map(function (k) { return categoryMap[k]; })
            .filter(function (c) { return c.qty > 0 || c.revenue > 0; }),
          menuProfitability: Object.keys(itemPerformanceMap).map(function (k) {
            var it = itemPerformanceMap[k];
            it.marginPercent = it.revenue > 0 ? Math.round((it.profit / it.revenue) * 100) : 0;
            return it;
          }).sort(function (a, b) { return b.profit - a.profit; }),
          recentOrders: filteredOrders.slice(0, 20)
        }
      });
    }).catch(serverError);
  };

  // 11. POST /api/owner/set-cost
  routes['POST /api/owner/set-cost'] = function (body) {
    return upd('menu_items', 'id=eq.' + encodeURIComponent(body.id),
      { cost_price: Math.max(0, Math.floor(Number(body.costPrice) || 0)), updated_at: new Date().toISOString() })
      .then(function (rows) {
        if (!rows.length) return notFound({ success: false, message: 'Item tidak ditemukan' });
        return ok({ success: true, item: rowToMenuItem(rows[0]) });
      }).catch(serverError);
  };

  // 14. GET /api/owner/ingredients
  routes['GET /api/owner/ingredients'] = function () {
    return Promise.all([
      sel('ingredients', 'select=*&order=name.asc'),
      sel('recipes', 'select=menu_id,items'),
      sel('waste_logs', 'select=*&order=created_at.desc&limit=150'),
      sel('stock_logs', 'select=*&order=created_at.desc&limit=200')
    ]).then(function (res) {
      var ingredients = res[0].map(rowToIngredient);
      var recipes = {};
      res[1].forEach(function (r) { recipes[r.menu_id] = r.items || []; });
      var wasteRows = res[2].map(function (w) {
        return {
          id: w.id, timestamp: w.created_at, ingredientId: w.ingredient_id,
          ingredientName: w.ingredient_name, qty: Number(w.qty), unit: w.unit,
          costPerUnit: Number(w.cost_per_unit), totalLoss: w.total_loss,
          reason: w.reason, note: w.note, reportedBy: w.reported_by
        };
      });
      var stockRows = res[3].map(function (s) {
        return {
          id: s.id, timestamp: s.created_at, ingredientId: s.ingredient_id,
          ingredientName: s.ingredient_name, type: s.type, changeQty: Number(s.change_qty),
          balanceQty: Number(s.balance_qty), unit: s.unit, reference: s.reference, note: s.note
        };
      });
      var totalValuation = ingredients.reduce(function (a, i) { return a + i.valuation; }, 0);
      var totalWasteLoss = wasteRows.reduce(function (a, w) { return a + (Number(w.totalLoss) || 0); }, 0);
      return ok({
        success: true, ingredients: ingredients, recipes: recipes,
        wasteLogs: wasteRows, stockLogs: stockRows,
        summary: {
          totalItems: ingredients.length,
          lowStockCount: ingredients.filter(function (i) { return i.status === 'low'; }).length,
          outOfStockCount: ingredients.filter(function (i) { return i.status === 'out_of_stock'; }).length,
          totalValuation: totalValuation, totalWasteLoss: totalWasteLoss
        }
      });
    }).catch(serverError);
  };

  // 15. POST /api/owner/ingredients/restock
  routes['POST /api/owner/ingredients/restock'] = function (body) {
    return sel('ingredients', 'select=*&id=eq.' + encodeURIComponent(body.id)).then(function (rows) {
      if (!rows.length) return notFound({ success: false, message: 'Bahan baku tidak ditemukan' });
      var r = rows[0];
      var addQty = Number(body.addStock) || 0;
      var nb = Math.round(((Number(r.current_stock) || 0) + addQty) * 1000) / 1000;
      var patch = { current_stock: nb };
      if (body.costPerUnit && Number(body.costPerUnit) > 0) patch.cost_per_unit = Number(body.costPerUnit);
      if (body.supplier) patch.supplier = body.supplier;
      var dt = formatJakartaDateTime();
      patch.last_restock = dt.date + ' ' + dt.time;
      return upd('ingredients', 'id=eq.' + encodeURIComponent(body.id), patch).then(function (u) {
        var log = {
          id: uid('log'), ingredient_id: r.id, ingredient_name: r.name,
          type: 'IN_RESTOCK', change_qty: addQty, balance_qty: nb, unit: r.unit,
          reference: 'Restock Gudang', note: 'Supplier: ' + (body.supplier || r.supplier || '-')
        };
        return ins('stock_logs', [log]).then(function () {
          return ok({ success: true, ingredient: rowToIngredient(u[0]) });
        });
      });
    }).catch(serverError);
  };

  // 15b. POST /api/owner/ingredients/waste
  routes['POST /api/owner/ingredients/waste'] = function (body) {
    var amount = Number(body.qty) || 0;
    if (!body.ingredientId || amount <= 0) {
      return Promise.resolve(bad({ success: false, message: 'Bahan dan jumlah terbuang wajib diisi valid' }));
    }
    return sel('ingredients', 'select=*&id=eq.' + encodeURIComponent(body.ingredientId)).then(function (rows) {
      if (!rows.length) return notFound({ success: false, message: 'Bahan baku tidak ditemukan' });
      var r = rows[0];
      var nb = Math.max(0, Math.round(((Number(r.current_stock) || 0) - amount) * 1000) / 1000);
      var totalLoss = Math.round(amount * (Number(r.cost_per_unit) || 0));
      var wasteEntry = {
        id: uid('wst'), ingredient_id: r.id, ingredient_name: r.name,
        qty: amount, unit: r.unit, cost_per_unit: Number(r.cost_per_unit) || 0,
        total_loss: totalLoss, reason: body.reason || 'Lainnya',
        note: body.note || '', reported_by: body.reportedBy || 'Owner / Dapur'
      };
      return upd('ingredients', 'id=eq.' + encodeURIComponent(r.id), { current_stock: nb })
        .then(function () { return ins('waste_logs', [wasteEntry]); })
        .then(function () {
          return ins('stock_logs', [{
            id: uid('log'), ingredient_id: r.id, ingredient_name: r.name,
            type: 'OUT_WASTE', change_qty: -amount, balance_qty: nb, unit: r.unit,
            reference: 'Waste (' + (body.reason || 'Rusak') + ')',
            note: ((body.note ? body.note + ' ' : '') + '(Rugi: Rp ' + totalLoss.toLocaleString('id-ID') + ')')
          }]);
        })
        .then(function () {
          return ok({
            success: true,
            message: 'Bahan rusak dicatat. Stok berkurang ' + amount + ' ' + r.unit,
            waste: {
              id: wasteEntry.id, timestamp: new Date().toISOString(), ingredientId: r.id,
              ingredientName: r.name, qty: amount, unit: r.unit,
              costPerUnit: wasteEntry.cost_per_unit, totalLoss: totalLoss,
              reason: wasteEntry.reason, note: wasteEntry.note, reportedBy: wasteEntry.reported_by
            },
            newStock: nb
          });
        });
    }).catch(serverError);
  };

  // 15c. POST /api/owner/ingredients/waste/delete
  routes['POST /api/owner/ingredients/waste/delete'] = function (body) {
    return del('waste_logs', 'id=eq.' + encodeURIComponent(body.id)).then(function (rows) {
      if (rows && rows.length) return ok({ success: true, message: 'Catatan waste berhasil dihapus' });
      return notFound({ success: false, message: 'Catatan waste tidak ditemukan' });
    }).catch(serverError);
  };

  // 16. POST /api/owner/ingredients/update
  routes['POST /api/owner/ingredients/update'] = function (body) {
    var patch = {};
    if (body.name) patch.name = body.name;
    if (body.category) patch.category = body.category;
    if (body.unit) patch.unit = body.unit;
    if (body.currentStock !== undefined) patch.current_stock = Number(body.currentStock);
    if (body.minStockAlert !== undefined) patch.min_stock_alert = Number(body.minStockAlert);
    if (body.costPerUnit !== undefined) patch.cost_per_unit = Number(body.costPerUnit);
    if (body.supplier !== undefined) patch.supplier = body.supplier;
    return upd('ingredients', 'id=eq.' + encodeURIComponent(body.id), patch).then(function (rows) {
      if (!rows.length) return notFound({ success: false, message: 'Bahan baku tidak ditemukan' });
      return ok({ success: true, ingredient: rowToIngredient(rows[0]) });
    }).catch(serverError);
  };

  // 17. POST /api/owner/ingredients/add
  routes['POST /api/owner/ingredients/add'] = function (body) {
    if (!body.name || !body.unit) {
      return Promise.resolve(bad({ success: false, message: 'Nama bahan dan satuan wajib diisi' }));
    }
    return ins('ingredients', [{
      id: uid('ing'), name: body.name, category: body.category || 'Tepung & Bahan Pokok',
      unit: body.unit, current_stock: Number(body.currentStock) || 0,
      min_stock_alert: Number(body.minStockAlert) || 1,
      cost_per_unit: Number(body.costPerUnit) || 0, supplier: body.supplier || '-'
    }]).then(function (rows) {
      return created({ success: true, ingredient: rowToIngredient(rows[0]) });
    }).catch(serverError);
  };

  // 18. POST /api/owner/ingredients/delete
  routes['POST /api/owner/ingredients/delete'] = function (body) {
    return del('ingredients', 'id=eq.' + encodeURIComponent(body.id)).then(function (rows) {
      if (rows && rows.length) return ok({ success: true, message: 'Bahan baku berhasil dihapus' });
      return notFound({ success: false, message: 'Bahan baku tidak ditemukan' });
    }).catch(serverError);
  };

  // 19. POST /api/owner/recipes/update
  routes['POST /api/owner/recipes/update'] = function (body) {
    if (!body.name) return Promise.resolve(bad({ success: false, message: 'Nama menu wajib diisi' }));
    var menuId = (body.menuId && !body.isNew) ? body.menuId : uid('menu');
    return sel('ingredients', 'select=id,unit,cost_per_unit').then(function (ingRows) {
      var ingMap = {};
      ingRows.forEach(function (i) { ingMap[i.id] = i; });
      var cleanItems = [];
      var calculatedCost = 0;
      (Array.isArray(body.items) ? body.items : []).forEach(function (it) {
        var ing = ingMap[it.ingredientId];
        var amount = Number(it.amount) || 0;
        if (ing && amount > 0) {
          cleanItems.push({ ingredientId: it.ingredientId, amount: amount, unit: ing.unit });
          calculatedCost += amount * (Number(ing.cost_per_unit) || 0);
        }
      });
      // 1. Pastikan MENU ada dulu (FK recipes -> menu_items),
      //    baru simpan resep. Urutan kebalik = FK violation.
      var formattedPrice = body.price
        ? (String(body.price).startsWith('Rp') ? body.price : formatRp(String(body.price).replace(/[^0-9]/g, '')))
        : 'Rp 25.000';
      var costP = Math.round(calculatedCost);
      return sel('menu_items', 'select=*&id=eq.' + encodeURIComponent(menuId)).then(function (mrows) {
        var menuOp;
        if (!mrows.length) {
          var item = {
            id: menuId, name: body.name, category: body.category || 'bomboloni',
            tag: 'Menu Baru', description: "Kreasi dessert terbaru dari dapur Chewy's.",
            price: formattedPrice, bundleInfo: '', safeForShipping: true,
            stockQty: 25, inStock: true,
            image: body.image || DEFAULT_MENU_IMG,
            highlightTexture: 'Freshly baked daily', costPrice: costP
          };
          menuOp = ins('menu_items', [menuItemToRow(item)]).then(function (nr) { return nr[0]; });
        } else {
          var patch = {
            name: body.name,
            cost_price: costP, updated_at: new Date().toISOString()
          };
          if (body.category) patch.category = body.category;
          if (body.price) { patch.price = formattedPrice; patch.price_value = parsePriceToNumber(body.price); }
          if (body.image) patch.image = body.image;
          menuOp = upd('menu_items', 'id=eq.' + encodeURIComponent(menuId), patch)
            .then(function (ur) { return ur[0]; });
        }
        return menuOp;
      }).then(function (menuRow) {
        // 2. Baru upsert resep
        return sel('recipes', 'select=menu_id&menu_id=eq.' + encodeURIComponent(menuId)).then(function (ex) {
          var op = ex.length
            ? upd('recipes', 'menu_id=eq.' + encodeURIComponent(menuId), { items: cleanItems })
            : ins('recipes', [{ menu_id: menuId, items: cleanItems }]);
          return op.then(function () {
            return { menuItem: rowToMenuItem(menuRow), recipe: cleanItems, calculatedHpp: costP };
          });
        });
      });
    }).then(function (r) {
      return ok({
        success: true, menuItem: r.menuItem, recipe: r.recipe,
        calculatedHpp: r.calculatedHpp, message: 'Menu dan resep berhasil disimpan'
      });
    }).catch(serverError);
  };

  /* ================================================================== */
  /* Export CSV / Excel                                                  */
  /* ================================================================== */
  function fetchAllOrders() {
    return sel('orders', 'select=*&order=created_at.desc&limit=2000').then(function (rows) {
      return rows.map(rowToOrder);
    });
  }

  function buildExportCSV(allOrders) {
    var header = ['ID Pesanan', 'Tanggal', 'Waktu', 'Kasir', 'Tipe', 'Meja/Pelanggan',
      'Items', 'Subtotal', 'Diskon', 'Total', 'Metode Bayar', 'Status'];
    var lines = [header.join(';')];
    allOrders.forEach(function (o) {
      var d = o.createdAt ? new Date(o.createdAt) : new Date();
      var dt = formatJakartaDateTime(d);
      var itemsStr = (o.items || []).map(function (i) {
        return (i.name || i.id) + ' x' + (i.qty || 1);
      }).join(' + ');
      lines.push([
        o.id || '', dt.date, dt.time, o.cashier || 'Kasir 1',
        (o.orderType || '').toUpperCase(), o.tableOrCustomer || '',
        '"' + itemsStr.replace(/"/g, '""') + '"',
        o.subtotal || 0, o.discount || 0, o.total || 0,
        (o.paymentMethod || '').toUpperCase(), (o.status || 'completed').toUpperCase()
      ].join(';'));
    });
    return '\ufeff' + lines.join('\n'); // BOM agar Excel baca UTF-8 dengan benar
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
    Promise.all([
      fetchAllOrders(),
      loadScriptOnce('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js')
    ]).then(function (res) {
      var allOrders = res[0];
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
          'Menu Dipesan': (o.items || []).map(function (i) { return (i.name || i.id) + ' (' + (i.qty || 1) + 'x)'; }).join(' + '),
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
      fetchAllOrders().then(function (allOrders) {
        downloadBlob('laporan-penjualan-chewys.csv', buildExportCSV(allOrders), 'text/csv;charset=UTF-8');
      });
    });
  }

  // Tangkap klik pada link export (anchor biasa, bukan fetch)
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href^="/api/owner/export-"]') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (href === '/api/owner/export-csv') {
      e.preventDefault();
      fetchAllOrders().then(function (allOrders) {
        downloadBlob('laporan-penjualan-chewys.csv', buildExportCSV(allOrders), 'text/csv;charset=UTF-8');
      });
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
      return nativeFetch(input, init); // bukan API → teruskan asli (termasuk ke Supabase)
    }

    var method = (init && init.method ? init.method : (input && input.method ? input.method : 'GET')).toUpperCase();
    var key = method + ' ' + url.pathname;
    var handler = routes[key];

    if (!handler) {
      return Promise.resolve(json({ error: 'Endpoint API tidak ditemukan' }, 404));
    }
    var body = parseBody(init || (typeof input !== 'string' ? input : null));
    var query = {};
    url.searchParams.forEach(function (v, k) { query[k] = v; });
    try {
      return handler(body, query) || ok({ success: true });
    } catch (err) {
      console.error('[api-supabase] handler error:', err);
      return json({ success: false, message: 'Terjadi kesalahan: ' + err.message }, 500);
    }
  };

  console.log('%c[api-supabase] aktif — /api/* dilayani dari Supabase', 'color:#16a34a;font-weight:bold');
})();
