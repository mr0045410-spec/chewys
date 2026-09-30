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
  /* Kompatibilitas skema: kolom orders.shift_id mungkin belum ada di DB */
  /* (skema di-apply terpisah via Supabase SQL Editor). Probe sekali     */
  /* saat dibutuhkan, hasil di-cache — checkout lama tetap jalan.        */
  /* ------------------------------------------------------------------ */
  var _hasShiftId = null;
  function ordersHasShiftId() {
    if (_hasShiftId !== null) return Promise.resolve(_hasShiftId);
    return sel('orders', 'select=shift_id&limit=1').then(function () {
      _hasShiftId = true;
      return true;
    }).catch(function (e) {
      // Error lain (mis. jaringan) -> anggap kolom ada, biar error aslinya muncul.
      _hasShiftId = !/shift_id/i.test(String((e && e.message) || ''));
      return _hasShiftId;
    });
  }

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
  /* Hash PIN pegawai (djb2 ganda + salt).                               */
  /* Proteksi OPERASIONAL agar PIN tidak tersimpan plaintext di DB —    */
  /* BUKAN keamanan bank-grade (RLS masih anon_all, kunci anon ada di    */
  /* frontend). Jangan pakai untuk data sensitif di luar kasir.         */
  /* ------------------------------------------------------------------ */
  function hashPin(pin) {
    var s = 'chewys-pin::' + String(pin === undefined || pin === null ? '' : pin);
    var h1 = 5381, h2 = 52711, i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      h1 = ((h1 * 33) ^ c) >>> 0;
      h2 = ((h2 * 33) ^ c) >>> 0;
    }
    return ('0000000' + h1.toString(16)).slice(-8) + ('0000000' + h2.toString(16)).slice(-8);
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
      cashier: r.cashier, status: r.status, shiftId: r.shift_id || null
    };
  }
  function orderToRow(o) {
    return {
      id: o.id, order_type: o.orderType, table_or_customer: o.tableOrCustomer,
      items: o.items, subtotal: o.subtotal, discount: o.discount, tax: o.tax,
      total: o.total, payment_method: o.paymentMethod, cash_paid: o.cashPaid,
      cash_change: o.cashChange, payment_reference: o.paymentReference || '',
      cashier: o.cashier, status: o.status, shift_id: o.shiftId || null
    };
  }
  function rowToEmployee(r) {
    // pin_hash SENGAJA tidak disertakan — tidak boleh bocor ke frontend
    return {
      id: r.id, name: r.name, role: r.role || 'kasir',
      active: r.active !== false, createdAt: r.created_at
    };
  }
  function rowToShift(r) {
    return {
      id: r.id, employeeId: r.employee_id, employeeName: r.employee_name || '',
      openedAt: r.opened_at, closedAt: r.closed_at || null,
      openingCash: Number(r.opening_cash) || 0,
      expectedCash: (r.expected_cash === null || r.expected_cash === undefined) ? null : Number(r.expected_cash),
      closingCash: (r.closing_cash === null || r.closing_cash === undefined) ? null : Number(r.closing_cash),
      difference: (r.difference === null || r.difference === undefined) ? null : Number(r.difference),
      cashSales: Number(r.cash_sales) || 0,
      status: r.status || 'open', notes: r.notes || ''
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
        shiftId: body.shiftId || null,
        status: 'completed'
      };
      // Jika checkout dari shift aktif: pakai nama pegawai shift sebagai kasir.
      // Tanpa shiftId, perilaku lama dipertahankan (body.cashier || 'Kasir 1').
      var shiftNameLookup = newOrder.shiftId
        ? sel('shifts', 'select=employee_name,status&id=eq.' + encodeURIComponent(newOrder.shiftId))
          .then(function (sr) {
            if (sr.length && sr[0].status === 'open' && sr[0].employee_name) {
              newOrder.cashier = sr[0].employee_name;
            }
          })
          .catch(function () { /* shift tidak valid -> pakai cashier dari body */ })
        : Promise.resolve();
      return shiftNameLookup.then(function () {
        var row = orderToRow(newOrder);
        // Kolom shift_id mungkin belum ada (skema belum di-apply) -> strip agar
        // checkout lama tetap jalan; fitur shift butuh skema baru.
        return ordersHasShiftId().then(function (has) {
          if (!has) delete row.shift_id;
          return ins('orders', [row]);
        });
      }).then(function () {
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
            var orderRow = rows[0];
            // Jurnal otomatis penjualan + HPP (non-fatal: gagal jurnal tidak menggagalkan checkout)
            return autoJournalSale(orderRow, body.items).then(function () {
              return created({ success: true, order: rowToOrder(orderRow) });
            });
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
          // Jurnal otomatis restock: Dr Persediaan / Cr Kas (non-fatal)
          var restockCost = Math.round(addQty * (Number(patch.cost_per_unit) || Number(r.cost_per_unit) || 0));
          return autoJournalRestock(log.id, restockCost, r.name).then(function () {
            return ok({ success: true, ingredient: rowToIngredient(u[0]) });
          });
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
          // Jurnal otomatis waste: Dr Beban Waste & Susut / Cr Persediaan (non-fatal)
          return autoJournalWaste(wasteEntry.id, totalLoss, r.name).then(function () {
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
  /* Pegawai & Shift Kasir                                               */
  /* ================================================================== */

  // 20. GET /api/owner/employees — daftar pegawai (tanpa pin_hash)
  routes['GET /api/owner/employees'] = function () {
    return sel('employees', 'select=id,name,role,active,created_at&order=created_at.asc').then(function (rows) {
      return ok({ success: true, employees: rows.map(rowToEmployee) });
    }).catch(serverError);
  };

  // 21. POST /api/owner/employees/upsert — tambah / edit pegawai
  //     body: { id?, name, pin?, role? } — pin hanya wajib saat tambah baru;
  //     saat edit, pin boleh dikosongkan = tidak diubah.
  routes['POST /api/owner/employees/upsert'] = function (body) {
    var name = String(body.name || '').trim();
    if (!name) return Promise.resolve(bad({ success: false, message: 'Nama pegawai wajib diisi' }));
    var role = body.role === 'owner' ? 'owner' : 'kasir';
    var pin = body.pin === undefined || body.pin === null ? '' : String(body.pin).trim();
    if (body.id) {
      return sel('employees', 'select=id&id=eq.' + encodeURIComponent(body.id)).then(function (er) {
        if (!er.length) return notFound({ success: false, message: 'Pegawai tidak ditemukan' });
        var patch = { name: name, role: role };
        if (pin !== '') {
          if (pin.length < 4) return bad({ success: false, message: 'PIN minimal 4 digit' });
          patch.pin_hash = hashPin(pin);
        }
        return upd('employees', 'id=eq.' + encodeURIComponent(body.id), patch).then(function (u) {
          return ok({ success: true, employee: rowToEmployee(u[0]) });
        });
      }).catch(serverError);
    }
    if (pin.length < 4) return Promise.resolve(bad({ success: false, message: 'PIN baru minimal 4 digit' }));
    return ins('employees', [{
      id: uid('emp'), name: name, pin_hash: hashPin(pin), role: role, active: true
    }]).then(function (rows) {
      return created({ success: true, employee: rowToEmployee(rows[0]) });
    }).catch(serverError);
  };

  // 22. POST /api/owner/employees/set-active — aktif/nonaktif pegawai
  routes['POST /api/owner/employees/set-active'] = function (body) {
    if (!body.id) return Promise.resolve(bad({ success: false, message: 'ID pegawai wajib diisi' }));
    return upd('employees', 'id=eq.' + encodeURIComponent(body.id), { active: body.active !== false })
      .then(function (u) {
        if (!u.length) return notFound({ success: false, message: 'Pegawai tidak ditemukan' });
        return ok({ success: true, employee: rowToEmployee(u[0]) });
      }).catch(serverError);
  };

  // 23. POST /api/shift/open — buka shift (verifikasi PIN pegawai)
  //     body: { employee_id, pin, opening_cash }
  routes['POST /api/shift/open'] = function (body) {
    if (!body.employee_id || body.pin === undefined || body.pin === null) {
      return Promise.resolve(bad({ success: false, message: 'Pegawai dan PIN wajib diisi' }));
    }
    return sel('employees', 'select=id,name,pin_hash,active&id=eq.' + encodeURIComponent(body.employee_id))
      .then(function (er) {
        if (!er.length || !er[0].active) {
          return unauthorized({ success: false, message: 'Pegawai tidak ditemukan atau nonaktif' });
        }
        if (hashPin(String(body.pin)) !== er[0].pin_hash) {
          return unauthorized({ success: false, message: 'PIN salah!' });
        }
        return sel('shifts', 'select=id&status=eq.open&limit=1').then(function (openRows) {
          if (openRows.length) {
            return bad({ success: false, message: 'Masih ada shift yang terbuka. Tutup dulu sebelum buka shift baru.' });
          }
          var opening = Math.max(0, Math.floor(Number(body.opening_cash) || 0));
          return ins('shifts', [{
            id: uid('shift'), employee_id: er[0].id, employee_name: er[0].name,
            opening_cash: opening, status: 'open'
          }]).then(function (rows) {
            return created({ success: true, shift: rowToShift(rows[0]) });
          });
        });
      }).catch(serverError);
  };

  // 24. POST /api/shift/close — tutup shift + opname kas
  //     body: { shift_id, closing_cash, notes? }
  //     expected = opening_cash + penjualan tunai (orders cash di rentang shift)
  //     difference = closing_cash - expected
  routes['POST /api/shift/close'] = function (body) {
    if (!body.shift_id) return Promise.resolve(bad({ success: false, message: 'ID shift wajib diisi' }));
    return sel('shifts', 'select=*&id=eq.' + encodeURIComponent(body.shift_id)).then(function (rows) {
      if (!rows.length) return notFound({ success: false, message: 'Shift tidak ditemukan' });
      var s = rows[0];
      if (s.status !== 'open') return bad({ success: false, message: 'Shift ini sudah ditutup' });
      var closedAt = new Date().toISOString();
      var q = 'select=total&payment_method=eq.cash&status=eq.completed'
        + '&created_at=gte.' + encodeURIComponent(s.opened_at)
        + '&created_at=lte.' + encodeURIComponent(closedAt)
        + '&limit=5000';
      return sel('orders', q).then(function (orders) {
        var cashSales = orders.reduce(function (a, o) { return a + (Number(o.total) || 0); }, 0);
        var expected = (Number(s.opening_cash) || 0) + cashSales;
        var closing = Math.max(0, Math.floor(Number(body.closing_cash) || 0));
        var patch = {
          closed_at: closedAt, expected_cash: expected, closing_cash: closing,
          difference: closing - expected, cash_sales: cashSales,
          status: 'closed', notes: String(body.notes || '')
        };
        return upd('shifts', 'id=eq.' + encodeURIComponent(s.id), patch).then(function (u) {
          return ok({ success: true, shift: rowToShift(u[0]) });
        });
      });
    }).catch(serverError);
  };

  // 25. GET /api/shift/current — shift yg sedang terbuka (atau null)
  routes['GET /api/shift/current'] = function () {
    return sel('shifts', 'select=*&status=eq.open&order=opened_at.desc&limit=1').then(function (rows) {
      return ok({ success: true, shift: rows.length ? rowToShift(rows[0]) : null });
    }).catch(serverError);
  };

  // 26. GET /api/owner/shifts — riwayat shift (?limit=, default 50, maks 200)
  routes['GET /api/owner/shifts'] = function (body, query) {
    var limit = parseInt((query && query.limit) || '50', 10);
    if (!(limit > 0)) limit = 50;
    limit = Math.min(200, limit);
    return sel('shifts', 'select=*&order=opened_at.desc&limit=' + limit).then(function (rows) {
      return ok({ success: true, shifts: rows.map(rowToShift) });
    }).catch(serverError);
  };


  /* ================================================================== */
  /* Akuntansi & Purchase Order                                           */
  /* ================================================================== */

  // Probe skema akuntansi (cache), pola sama seperti ordersHasShiftId().
  var _hasAccounting = null;
  function accountingReady() {
    if (_hasAccounting !== null) return Promise.resolve(_hasAccounting);
    return sel('accounts', 'select=code&limit=1').then(function () {
      _hasAccounting = true;
      return true;
    }).catch(function (e) {
      _hasAccounting = !/accounts/i.test(String((e && e.message) || ''));
      return _hasAccounting;
    });
  }
  // Semua route akuntansi/PO lewat sini dulu: skema belum di-apply -> 503 + instruksi.
  function needAccounting() {
    return accountingReady().then(function (ready) {
      if (ready) return null;
      return json({
        success: false, needsSchema: true,
        message: 'Skema akuntansi belum di-apply. Buka Supabase SQL Editor → paste SELURUH supabase-schema.sql → Run, lalu coba lagi.'
      }, 503);
    });
  }

  function rowToAccount(r) {
    return { code: r.code, name: r.name, type: r.type || 'aset', normal: r.normal || 'debit', active: r.active !== false };
  }
  function rowToSupplier(r) {
    return { id: r.id, name: r.name, phone: r.phone || '', address: r.address || '', active: r.active !== false, createdAt: r.created_at };
  }
  function rowToPO(r) {
    return {
      id: r.id, supplierId: r.supplier_id, status: r.status || 'draft',
      subtotal: Number(r.subtotal) || 0, notes: r.notes || '',
      createdBy: r.created_by || '', createdAt: r.created_at,
      receivedAt: r.received_at || null, items: [], supplierName: r.supplier_name || ''
    };
  }
  function rowToPOItem(r) {
    return {
      id: r.id, poId: r.po_id, ingredientId: r.ingredient_id,
      ingredientName: r.ingredient_name || '', qty: Number(r.qty) || 0,
      unit: r.unit || '', unitPrice: Number(r.unit_price) || 0,
      subtotal: Number(r.subtotal) || 0
    };
  }
  function journalEntryWithLines(e, lines) {
    return {
      id: e.id, entryDate: e.entry_date, description: e.description || '',
      refType: e.ref_type || 'manual', refId: e.ref_id || null,
      createdBy: e.created_by || '',
      lines: (lines || []).map(function (l) {
        return { id: l.id, accountCode: l.account_code, debit: Number(l.debit) || 0, kredit: Number(l.kredit) || 0 };
      })
    };
  }

  // Tulis satu jurnal (entry + lines). ID dibuat di client agar insert bisa paralel.
  function postJournalEntry(opts) {
    var entryId = uid('je');
    var entry = {
      id: entryId,
      entry_date: opts.entry_date || new Date().toISOString(),
      description: String(opts.description || ''),
      ref_type: opts.ref_type || 'manual',
      ref_id: opts.ref_id || null,
      created_by: String(opts.created_by || '')
    };
    var lines = (opts.lines || []).map(function (l) {
      return {
        id: uid('jl'), entry_id: entryId,
        account_code: l.account_code,
        debit: Math.max(0, Math.round(Number(l.debit) || 0)),
        kredit: Math.max(0, Math.round(Number(l.kredit) || 0))
      };
    });
    return ins('journal_entries', [entry]).then(function () {
      return ins('journal_lines', lines);
    }).then(function () { return entryId; });
  }

  // Bungkus non-fatal untuk hook otomatis: gagal jurnal tidak menggagalkan transaksi utama.
  function tryJournal(opts) {
    return accountingReady().then(function (ready) {
      if (!ready) return null;
      return postJournalEntry(opts);
    }).catch(function (e) {
      console.error('[api-supabase] jurnal otomatis gagal:', e && e.message);
      return null;
    });
  }

  // Validasi jurnal manual: akun ada & aktif, debit == kredit, min 2 baris.
  function validateJournalLines(lines, accounts) {
    if (!Array.isArray(lines) || lines.length < 2) {
      return { ok: false, message: 'Jurnal manual minimal 2 baris' };
    }
    var accMap = {};
    accounts.forEach(function (a) { accMap[a.code] = a; });
    var td = 0, tk = 0;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i] || {};
      var acc = accMap[l.account_code];
      if (!acc) return { ok: false, message: 'Akun tidak dikenal: ' + (l.account_code || '(kosong)') };
      if (acc.active === false) return { ok: false, message: 'Akun nonaktif: ' + l.account_code };
      var d = Math.round(Number(l.debit) || 0), k = Math.round(Number(l.kredit) || 0);
      if (d < 0 || k < 0) return { ok: false, message: 'Nominal baris ' + (i + 1) + ' tidak boleh negatif' };
      if (d > 0 && k > 0) return { ok: false, message: 'Baris ' + (i + 1) + ': pilih debit ATAU kredit, tidak boleh dua-duanya' };
      if (d === 0 && k === 0) return { ok: false, message: 'Baris ' + (i + 1) + ' nominalnya nol' };
      td += d; tk += k;
    }
    if (td === 0) return { ok: false, message: 'Total jurnal tidak boleh nol' };
    if (td !== tk) return { ok: false, message: 'Tidak balance: total debit Rp ' + td.toLocaleString('id-ID') + ' \u2260 total kredit Rp ' + tk.toLocaleString('id-ID') };
    return { ok: true };
  }

  // Ambil journal_lines untuk sekumpulan entry id (dipecah per 100 agar in-list tidak kepanjangan).
  function fetchJournalLinesForEntries(entryIds) {
    if (!entryIds.length) return Promise.resolve([]);
    var batches = [];
    for (var i = 0; i < entryIds.length; i += 100) batches.push(entryIds.slice(i, i + 100));
    return Promise.all(batches.map(function (b) {
      return sel('journal_lines', 'select=*&entry_id=in.(' + b.map(encodeURIComponent).join(',') + ')&limit=5000');
    })).then(function (groups) {
      var all = [];
      groups.forEach(function (g) { all = all.concat(g); });
      return all;
    });
  }

  // --- Jurnal otomatis: penjualan (2 jurnal: kas/piutang vs pendapatan, HPP vs persediaan) ---
  function autoJournalSale(orderRow, items) {
    return accountingReady().then(function (ready) {
      if (!ready) return null;
      var total = Math.round(Number(orderRow.total) || 0);
      var pm = String(orderRow.payment_method || 'cash').toLowerCase();
      var cashCode = pm === 'cash' ? '1100' : '1120'; // tunai -> Kas, QRIS/EDC -> Kas Bank
      var entryDate = orderRow.created_at || new Date().toISOString();
      var ids = (items || []).map(function (i) { return i.id; }).filter(Boolean);
      var costLookup = ids.length
        ? sel('menu_items', 'select=id,cost_price&id=in.(' + ids.map(encodeURIComponent).join(',') + ')')
        : Promise.resolve([]);
      return costLookup.then(function (menuRows) {
        var costMap = {};
        menuRows.forEach(function (m) { costMap[m.id] = Number(m.cost_price) || 0; });
        var hpp = 0;
        (items || []).forEach(function (it) { hpp += (Number(it.qty) || 1) * (costMap[it.id] || 0); });
        hpp = Math.round(hpp);
        return postJournalEntry({
          entry_date: entryDate, description: 'Penjualan ' + orderRow.id,
          ref_type: 'sale', ref_id: orderRow.id,
          lines: [
            { account_code: cashCode, debit: total, kredit: 0 },
            { account_code: '4100', debit: 0, kredit: total }
          ]
        }).then(function () {
          return postJournalEntry({
            entry_date: entryDate, description: 'HPP ' + orderRow.id,
            ref_type: 'sale', ref_id: orderRow.id + ':hpp',
            lines: [
              { account_code: '5100', debit: hpp, kredit: 0 },
              { account_code: '1200', debit: 0, kredit: hpp }
            ]
          });
        });
      });
    }).catch(function (e) {
      console.error('[api-supabase] jurnal otomatis sale gagal:', e && e.message);
      return null;
    });
  }

  // --- Jurnal otomatis: waste -> Dr Beban Waste / Cr Persediaan ---
  function autoJournalWaste(wasteId, totalLoss, ingName) {
    var amt = Math.round(Number(totalLoss) || 0);
    return tryJournal({
      description: 'Waste ' + (ingName || ''),
      ref_type: 'waste', ref_id: wasteId,
      lines: [
        { account_code: '5400', debit: amt, kredit: 0 },
        { account_code: '1200', debit: 0, kredit: amt }
      ]
    });
  }

  // --- Jurnal otomatis: restock -> Dr Persediaan / Cr Kas ---
  function autoJournalRestock(logId, amount, ingName) {
    var amt = Math.round(Number(amount) || 0);
    return tryJournal({
      description: 'Restock ' + (ingName || ''),
      ref_type: 'restock', ref_id: logId,
      lines: [
        { account_code: '1200', debit: amt, kredit: 0 },
        { account_code: '1100', debit: 0, kredit: amt }
      ]
    });
  }

  // 27. GET /api/owner/accounts — daftar CoA
  routes['GET /api/owner/accounts'] = function () {
    return needAccounting().then(function (blocked) {
      if (blocked) return blocked;
      return sel('accounts', 'select=*&order=code.asc').then(function (rows) {
        return ok({ success: true, accounts: rows.map(rowToAccount) });
      });
    }).catch(serverError);
  };

  // 28. POST /api/owner/accounts/upsert — tambah / edit akun. body: {code, name, type, normal}
  routes['POST /api/owner/accounts/upsert'] = function (body) {
    return needAccounting().then(function (blocked) {
      if (blocked) return blocked;
      var code = String(body.code || '').trim();
      var name = String(body.name || '').trim();
      var type = String(body.type || '').toLowerCase();
      var normal = String(body.normal || '').toLowerCase();
      var TYPES = ['aset', 'kewajiban', 'ekuitas', 'pendapatan', 'beban'];
      if (!/^[0-9]{2,6}$/.test(code)) return bad({ success: false, message: 'Kode akun wajib 2-6 digit angka (mis. 1100)' });
      if (!name) return bad({ success: false, message: 'Nama akun wajib diisi' });
      if (TYPES.indexOf(type) < 0) return bad({ success: false, message: 'Tipe akun tidak valid: ' + (body.type || '') });
      if (normal !== 'debit' && normal !== 'kredit') return bad({ success: false, message: 'Saldo normal harus debit atau kredit' });
      return sel('accounts', 'select=code&code=eq.' + encodeURIComponent(code)).then(function (ex) {
        var data = { name: name, type: type, normal: normal };
        var op = ex.length
          ? upd('accounts', 'code=eq.' + encodeURIComponent(code), data)
          : ins('accounts', [Object.assign({ code: code, active: true }, data)]);
        return op.then(function (rows) {
          return ok({ success: true, account: rowToAccount(rows[0]) });
        });
      });
    }).catch(serverError);
  };

  // 29. POST /api/owner/accounts/set-active — {code, active}
  routes['POST /api/owner/accounts/set-active'] = function (body) {
    return needAccounting().then(function (blocked) {
      if (blocked) return blocked;
      if (!body.code) return bad({ success: false, message: 'Kode akun wajib diisi' });
      return upd('accounts', 'code=eq.' + encodeURIComponent(body.code), { active: body.active !== false })
        .then(function (u) {
          if (!u.length) return notFound({ success: false, message: 'Akun tidak ditemukan' });
          return ok({ success: true, account: rowToAccount(u[0]) });
        });
    }).catch(serverError);
  };

  // 30. POST /api/owner/journal/manual — {entry_date?, description, lines:[{account_code,debit,kredit}], created_by?}
  routes['POST /api/owner/journal/manual'] = function (body) {
    return needAccounting().then(function (blocked) {
      if (blocked) return blocked;
      var desc = String(body.description || '').trim();
      if (!desc) return bad({ success: false, message: 'Keterangan jurnal wajib diisi' });
      return sel('accounts', 'select=*').then(function (accRows) {
        var v = validateJournalLines(body.lines, accRows.map(rowToAccount));
        if (!v.ok) return bad({ success: false, message: v.message });
        return postJournalEntry({
          entry_date: body.entry_date || new Date().toISOString(),
          description: desc, ref_type: 'manual', ref_id: null,
          created_by: String(body.created_by || ''),
          lines: body.lines
        }).then(function (entryId) {
          return sel('journal_entries', 'select=*&id=eq.' + encodeURIComponent(entryId)).then(function (er) {
            return sel('journal_lines', 'select=*&entry_id=eq.' + encodeURIComponent(entryId)).then(function (lr) {
              return created({ success: true, entry: journalEntryWithLines(er[0], lr) });
            });
          });
        });
      });
    }).catch(serverError);
  };

  // 31. GET /api/owner/journal — ?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=
  routes['GET /api/owner/journal'] = function (body, query) {
    return needAccounting().then(function (blocked) {
      if (blocked) return blocked;
      query = query || {};
      var limit = Math.min(500, Math.max(1, parseInt(query.limit || '100', 10) || 100));
      var q = 'select=*&order=entry_date.desc&limit=' + limit;
      if (query.from) q += '&entry_date=gte.' + encodeURIComponent(query.from + 'T00:00:00+07:00');
      if (query.to) q += '&entry_date=lte.' + encodeURIComponent(query.to + 'T23:59:59+07:00');
      return sel('journal_entries', q).then(function (entries) {
        var ids = entries.map(function (e) { return e.id; });
        if (!ids.length) return ok({ success: true, entries: [] });
        return fetchJournalLinesForEntries(ids).then(function (lines) {
          var lineMap = {};
          lines.forEach(function (l) { (lineMap[l.entry_id] = lineMap[l.entry_id] || []).push(l); });
          return ok({ success: true, entries: entries.map(function (e) { return journalEntryWithLines(e, lineMap[e.id] || []); }) });
        });
      });
    }).catch(serverError);
  };

  // 32. GET /api/owner/reports/profit-loss — ?from&to (YYYY-MM-DD)
  //     Dihitung dari jurnal: pendapatan (4100 dkk), beban (5100=HPP, 5200-5400).
  routes['GET /api/owner/reports/profit-loss'] = function (body, query) {
    return needAccounting().then(function (blocked) {
      if (blocked) return blocked;
      query = query || {};
      var q = 'select=id&order=entry_date.desc&limit=10000';
      if (query.from) q += '&entry_date=gte.' + encodeURIComponent(query.from + 'T00:00:00+07:00');
      if (query.to) q += '&entry_date=lte.' + encodeURIComponent(query.to + 'T23:59:59+07:00');
      return sel('journal_entries', q).then(function (entries) {
        var ids = entries.map(function (e) { return e.id; });
        return sel('accounts', 'select=*').then(function (accRows) {
          var accMap = {};
          accRows.forEach(function (a) { accMap[a.code] = rowToAccount(a); });
          var aggregate = function (lines) {
            var revenue = 0, cogs = 0, expenses = {};
            lines.forEach(function (l) {
              var acc = accMap[l.account_code];
              if (!acc) return;
              var d = Number(l.debit) || 0, k = Number(l.kredit) || 0;
              if (acc.type === 'pendapatan') revenue += (k - d);
              else if (acc.type === 'beban') {
                var amt = d - k;
                if (l.account_code === '5100') cogs += amt;
                else {
                  expenses[l.account_code] = expenses[l.account_code] || { name: acc.name, amount: 0 };
                  expenses[l.account_code].amount += amt;
                }
              }
            });
            var totalExpenses = Object.keys(expenses).reduce(function (s, c) { return s + expenses[c].amount; }, 0);
            var grossProfit = revenue - cogs;
            return {
              revenue: revenue, cogs: cogs, grossProfit: grossProfit,
              expenses: expenses, totalExpenses: totalExpenses,
              netProfit: grossProfit - totalExpenses
            };
          };
          if (!ids.length) {
            return ok({ success: true, from: query.from || null, to: query.to || null, profitLoss: aggregate([]) });
          }
          return fetchJournalLinesForEntries(ids).then(function (lines) {
            return ok({ success: true, from: query.from || null, to: query.to || null, profitLoss: aggregate(lines) });
          });
        });
      });
    }).catch(serverError);
  };

  // 33. GET /api/owner/reports/balance-sheet — ?as_of=YYYY-MM-DD
  //     Aset = akun tipe aset, Kewajiban, Ekuitas + Laba ditahan (dari P&L kumulatif).
  routes['GET /api/owner/reports/balance-sheet'] = function (body, query) {
    return needAccounting().then(function (blocked) {
      if (blocked) return blocked;
      query = query || {};
      var asOf = query.as_of || getJakartaDateStr();
      var q = 'select=id&entry_date=lte.' + encodeURIComponent(asOf + 'T23:59:59+07:00') + '&order=entry_date.asc&limit=20000';
      return sel('journal_entries', q).then(function (entries) {
        var ids = entries.map(function (e) { return e.id; });
        return sel('accounts', 'select=*&order=code.asc').then(function (accRows) {
          var accounts = accRows.map(rowToAccount);
          var accMap = {};
          accounts.forEach(function (a) { accMap[a.code] = a; });
          var build = function (lines) {
            var bal = {};
            var totalD = 0, totalK = 0, revenue = 0, totalBeban = 0;
            lines.forEach(function (l) {
              var d = Number(l.debit) || 0, k = Number(l.kredit) || 0;
              totalD += d; totalK += k;
              var acc = accMap[l.account_code];
              if (!acc) return;
              var net = acc.normal === 'debit' ? (d - k) : (k - d);
              bal[l.account_code] = (bal[l.account_code] || 0) + net;
              if (acc.type === 'pendapatan') revenue += (k - d);
              else if (acc.type === 'beban') totalBeban += (d - k);
            });
            var retained = Math.round(revenue - totalBeban);
            var assets = [], liabilities = [], equity = [];
            accounts.forEach(function (a) {
              var row = { code: a.code, name: a.name, balance: Math.round(bal[a.code] || 0) };
              if (a.type === 'aset') assets.push(row);
              else if (a.type === 'kewajiban') liabilities.push(row);
              else if (a.type === 'ekuitas') equity.push(row);
            });
            var sum = function (arr) { return arr.reduce(function (s, r) { return s + r.balance; }, 0); };
            var tA = sum(assets), tL = sum(liabilities), tE = sum(equity);
            return ok({
              success: true, asOf: asOf,
              assets: { accounts: assets, total: tA },
              liabilities: { accounts: liabilities, total: tL },
              equity: { accounts: equity, retainedEarnings: retained, total: tE + retained },
              balanced: totalD === totalK,
              totalDebit: totalD, totalKredit: totalK,
              check: tA - (tL + tE + retained) // harus 0 bila balance
            });
          };
          if (!ids.length) return build([]);
          return fetchJournalLinesForEntries(ids).then(build);
        });
      });
    }).catch(serverError);
  };

  // 34. POST /api/owner/journal/backfill — buat jurnal utk order/waste/restock lama yg belum punya.
  //     Idempotent: ref_type+ref_id yg sudah ada dilewati.
  routes['POST /api/owner/journal/backfill'] = function (body) {
    return needAccounting().then(function (blocked) {
      if (blocked) return blocked;
      return sel('journal_entries', 'select=ref_type,ref_id&limit=20000').then(function (existing) {
        var seen = {};
        existing.forEach(function (e) { if (e.ref_id) seen[e.ref_type + '|' + e.ref_id] = true; });
        var created = 0;
        var jobs = []; // fungsi lazy -> dijalankan sekuensial
        var stepOrders = sel('orders', 'select=id,total,payment_method,created_at,items&limit=2000').then(function (orders) {
          var missing = orders.filter(function (o) { return !seen['sale|' + o.id]; });
          if (!missing.length) return null;
          var menuIds = {};
          missing.forEach(function (o) { (o.items || []).forEach(function (it) { if (it.id) menuIds[it.id] = true; }); });
          var ids = Object.keys(menuIds);
          var costP = ids.length
            ? sel('menu_items', 'select=id,cost_price&id=in.(' + ids.map(encodeURIComponent).join(',') + ')')
            : Promise.resolve([]);
          return costP.then(function (menuRows) {
            var costMap = {};
            menuRows.forEach(function (m) { costMap[m.id] = Number(m.cost_price) || 0; });
            missing.forEach(function (o) {
              var total = Math.round(Number(o.total) || 0);
              var pm = String(o.payment_method || 'cash').toLowerCase();
              var cashCode = pm === 'cash' ? '1100' : '1120';
              var hpp = 0;
              (o.items || []).forEach(function (it) { hpp += (Number(it.qty) || 1) * (costMap[it.id] || 0); });
              hpp = Math.round(hpp);
              var ed = o.created_at || new Date().toISOString();
              jobs.push(function () {
                created += 2;
                return postJournalEntry({
                  entry_date: ed, description: 'Penjualan ' + o.id + ' (backfill)',
                  ref_type: 'sale', ref_id: o.id,
                  lines: [{ account_code: cashCode, debit: total, kredit: 0 }, { account_code: '4100', debit: 0, kredit: total }]
                }).then(function () {
                  return postJournalEntry({
                    entry_date: ed, description: 'HPP ' + o.id + ' (backfill)',
                    ref_type: 'sale', ref_id: o.id + ':hpp',
                    lines: [{ account_code: '5100', debit: hpp, kredit: 0 }, { account_code: '1200', debit: 0, kredit: hpp }]
                  });
                });
              });
            });
          });
        });
        var stepWaste = stepOrders.then(function () {
          return sel('waste_logs', 'select=id,ingredient_name,total_loss,created_at&limit=2000');
        }).then(function (wl) {
          wl.filter(function (w) { return !seen['waste|' + w.id]; }).forEach(function (w) {
            var amt = Math.round(Number(w.total_loss) || 0);
            jobs.push(function () {
              created++;
              return postJournalEntry({
                entry_date: w.created_at || new Date().toISOString(),
                description: 'Waste ' + (w.ingredient_name || '') + ' (backfill)',
                ref_type: 'waste', ref_id: w.id,
                lines: [{ account_code: '5400', debit: amt, kredit: 0 }, { account_code: '1200', debit: 0, kredit: amt }]
              });
            });
          });
        });
        var stepRestock = stepWaste.then(function () {
          return sel('stock_logs', 'select=id,ingredient_id,ingredient_name,change_qty,created_at&type=eq.IN_RESTOCK&limit=2000');
        }).then(function (logs) {
          var missing = logs.filter(function (l) { return !seen['restock|' + l.id]; });
          if (!missing.length) return null;
          var ingIds = {};
          missing.forEach(function (l) { if (l.ingredient_id) ingIds[l.ingredient_id] = true; });
          var keys = Object.keys(ingIds);
          var costP = keys.length
            ? sel('ingredients', 'select=id,cost_per_unit&id=in.(' + keys.map(encodeURIComponent).join(',') + ')')
            : Promise.resolve([]);
          return costP.then(function (ingRows) {
            var costMap = {};
            ingRows.forEach(function (g) { costMap[g.id] = Number(g.cost_per_unit) || 0; });
            missing.forEach(function (l) {
              var amt = Math.round((Number(l.change_qty) || 0) * (costMap[l.ingredient_id] || 0));
              jobs.push(function () {
                created++;
                return postJournalEntry({
                  entry_date: l.created_at || new Date().toISOString(),
                  description: 'Restock ' + (l.ingredient_name || '') + ' (backfill, estimasi)',
                  ref_type: 'restock', ref_id: l.id,
                  lines: [{ account_code: '1200', debit: amt, kredit: 0 }, { account_code: '1100', debit: 0, kredit: amt }]
                });
              });
            });
          });
        });
        return stepRestock.then(function () {
          return jobs.reduce(function (p, fn) { return p.then(fn); }, Promise.resolve());
        }).then(function () {
          return ok({ success: true, created: created, message: created ? created + ' jurnal backfill dibuat' : 'Semua transaksi sudah punya jurnal — tidak ada yang dibuat' });
        });
      });
    }).catch(serverError);
  };

  // 35. GET /api/owner/suppliers — daftar supplier
  routes['GET /api/owner/suppliers'] = function () {
    return needAccounting().then(function (blocked) {
      if (blocked) return blocked;
      return sel('suppliers', 'select=*&order=name.asc').then(function (rows) {
        return ok({ success: true, suppliers: rows.map(rowToSupplier) });
      });
    }).catch(serverError);
  };

  // 36. POST /api/owner/suppliers/upsert — {id?, name, phone?, address?}
  routes['POST /api/owner/suppliers/upsert'] = function (body) {
    return needAccounting().then(function (blocked) {
      if (blocked) return blocked;
      var name = String(body.name || '').trim();
      if (!name) return bad({ success: false, message: 'Nama supplier wajib diisi' });
      var data = { name: name, phone: String(body.phone || ''), address: String(body.address || '') };
      if (body.id) {
        return upd('suppliers', 'id=eq.' + encodeURIComponent(body.id), data).then(function (u) {
          if (!u.length) return notFound({ success: false, message: 'Supplier tidak ditemukan' });
          return ok({ success: true, supplier: rowToSupplier(u[0]) });
        });
      }
      return ins('suppliers', [Object.assign({ id: uid('sup'), active: true }, data)]).then(function (rows) {
        return created({ success: true, supplier: rowToSupplier(rows[0]) });
      });
    }).catch(serverError);
  };

  // 37. POST /api/owner/suppliers/set-active — {id, active}
  routes['POST /api/owner/suppliers/set-active'] = function (body) {
    return needAccounting().then(function (blocked) {
      if (blocked) return blocked;
      if (!body.id) return bad({ success: false, message: 'ID supplier wajib diisi' });
      return upd('suppliers', 'id=eq.' + encodeURIComponent(body.id), { active: body.active !== false })
        .then(function (u) {
          if (!u.length) return notFound({ success: false, message: 'Supplier tidak ditemukan' });
          return ok({ success: true, supplier: rowToSupplier(u[0]) });
        });
    }).catch(serverError);
  };

  // 38. GET /api/owner/purchase-orders — ?status&limit, atau ?id= untuk detail + items
  routes['GET /api/owner/purchase-orders'] = function (body, query) {
    return needAccounting().then(function (blocked) {
      if (blocked) return blocked;
      query = query || {};
      if (query.id) {
        return sel('purchase_orders', 'select=*&id=eq.' + encodeURIComponent(query.id)).then(function (pr) {
          if (!pr.length) return notFound({ success: false, message: 'PO tidak ditemukan' });
          var po = rowToPO(pr[0]);
          return sel('purchase_order_items', 'select=*&po_id=eq.' + encodeURIComponent(po.id)).then(function (ir) {
            po.items = ir.map(rowToPOItem);
            return sel('suppliers', 'select=id,name&id=eq.' + encodeURIComponent(po.supplierId));
          }).then(function (sr) {
            po.supplierName = sr.length ? sr[0].name : '';
            return ok({ success: true, po: po });
          });
        });
      }
      var q = 'select=*&order=created_at.desc&limit=' + Math.min(200, Math.max(1, parseInt(query.limit || '50', 10) || 50));
      if (query.status) q += '&status=eq.' + encodeURIComponent(query.status);
      return sel('purchase_orders', q).then(function (rows) {
        return sel('suppliers', 'select=id,name').then(function (sr) {
          var nameMap = {};
          sr.forEach(function (s) { nameMap[s.id] = s.name; });
          var pos = rows.map(rowToPO);
          pos.forEach(function (p) { p.supplierName = nameMap[p.supplierId] || ''; });
          return ok({ success: true, purchaseOrders: pos });
        });
      });
    }).catch(serverError);
  };

  // 39. POST /api/owner/purchase-orders/create — {supplier_id, items:[{ingredient_id, qty, unit_price}], notes?, created_by?}
  //     Nomor PO atomic via next_po_seq (counter terpisah, tidak pakai order_counters).
  routes['POST /api/owner/purchase-orders/create'] = function (body) {
    return needAccounting().then(function (blocked) {
      if (blocked) return blocked;
      if (!body.supplier_id) return bad({ success: false, message: 'Supplier wajib dipilih' });
      var items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return bad({ success: false, message: 'PO minimal 1 item' });
      return sel('suppliers', 'select=id,name,active&id=eq.' + encodeURIComponent(body.supplier_id)).then(function (sr) {
        if (!sr.length) return notFound({ success: false, message: 'Supplier tidak ditemukan' });
        if (!sr[0].active) return bad({ success: false, message: 'Supplier nonaktif' });
        var supplierName = sr[0].name;
        var ingIds = items.map(function (it) { return it && it.ingredient_id; }).filter(Boolean);
        if (!ingIds.length) return bad({ success: false, message: 'Item PO tidak valid' });
        return sel('ingredients', 'select=id,name,unit&id=in.(' + ingIds.map(encodeURIComponent).join(',') + ')').then(function (ingRows) {
          var ingMap = {};
          ingRows.forEach(function (g) { ingMap[g.id] = g; });
          var poItems = [], subtotal = 0;
          for (var i = 0; i < items.length; i++) {
            var it = items[i] || {};
            var ing = ingMap[it.ingredient_id];
            if (!ing) return bad({ success: false, message: 'Bahan tidak dikenal: ' + (it.ingredient_id || '') });
            var qty = Number(it.qty) || 0;
            var price = Math.round(Number(it.unit_price) || 0);
            if (!(qty > 0)) return bad({ success: false, message: 'Qty "' + ing.name + '" harus lebih dari 0' });
            if (price < 0) return bad({ success: false, message: 'Harga "' + ing.name + '" tidak valid' });
            var st = Math.round(qty * price);
            subtotal += st;
            poItems.push({
              id: uid('poi'), ingredient_id: ing.id, ingredient_name: ing.name,
              qty: qty, unit: ing.unit, unit_price: price, subtotal: st
            });
          }
          var dateKey = getJakartaDateKey();
          return rpc('next_po_seq', { p_date_key: dateKey }).then(function (seqRaw) {
            var seq = Array.isArray(seqRaw) ? seqRaw[0] : seqRaw;
            var poId = 'PO-' + dateKey + '-' + String(seq).padStart(4, '0');
            poItems.forEach(function (pi) { pi.po_id = poId; });
            var poRow = {
              id: poId, supplier_id: body.supplier_id, status: 'draft',
              subtotal: subtotal, notes: String(body.notes || ''), created_by: String(body.created_by || '')
            };
            return ins('purchase_orders', [poRow]).then(function () {
              return ins('purchase_order_items', poItems);
            }).then(function () {
              var out = rowToPO(poRow);
              out.items = poItems.map(rowToPOItem);
              out.supplierName = supplierName;
              return created({ success: true, po: out });
            });
          });
        });
      });
    }).catch(serverError);
  };

  // 40. POST /api/owner/purchase-orders/send — {id}: draft -> sent
  routes['POST /api/owner/purchase-orders/send'] = function (body) {
    return needAccounting().then(function (blocked) {
      if (blocked) return blocked;
      if (!body.id) return bad({ success: false, message: 'ID PO wajib diisi' });
      return sel('purchase_orders', 'select=*&id=eq.' + encodeURIComponent(body.id)).then(function (pr) {
        if (!pr.length) return notFound({ success: false, message: 'PO tidak ditemukan' });
        if (pr[0].status !== 'draft') return bad({ success: false, message: 'Hanya PO draft yang bisa dikirim' });
        return upd('purchase_orders', 'id=eq.' + encodeURIComponent(body.id), { status: 'sent' }).then(function (u) {
          return ok({ success: true, po: rowToPO(u[0]) });
        });
      });
    }).catch(serverError);
  };

  // 41. POST /api/owner/purchase-orders/receive — {id, paid: 'cash'|'credit' atau true|false (dari UI)}
  //     sent -> received: tambah stok bahan, stock_logs IN_PURCHASE,
  //     jurnal Dr 1200 / Cr 1100 (tunai) atau Cr 2100 (kredit).
  routes['POST /api/owner/purchase-orders/receive'] = function (body) {
    return needAccounting().then(function (blocked) {
      if (blocked) return blocked;
      if (!body.id) return bad({ success: false, message: 'ID PO wajib diisi' });
      var paid = (body.paid === 'credit' || body.paid === false) ? 'credit' : 'cash';
      return sel('purchase_orders', 'select=*&id=eq.' + encodeURIComponent(body.id)).then(function (pr) {
        if (!pr.length) return notFound({ success: false, message: 'PO tidak ditemukan' });
        var po = pr[0];
        if (po.status !== 'sent') return bad({ success: false, message: 'Hanya PO berstatus "dikirim" yang bisa diterima' });
        return sel('purchase_order_items', 'select=*&po_id=eq.' + encodeURIComponent(po.id)).then(function (items) {
          if (!items.length) return bad({ success: false, message: 'PO tidak punya item' });
          var ingIds = items.map(function (it) { return it.ingredient_id; });
          return sel('ingredients', 'select=*&id=in.(' + ingIds.map(encodeURIComponent).join(',') + ')').then(function (ingRows) {
            var ingMap = {};
            ingRows.forEach(function (g) { ingMap[g.id] = g; });
            var ops = [], logs = [];
            var nowIso = new Date().toISOString();
            var dt = formatJakartaDateTime();
            items.forEach(function (it) {
              var ing = ingMap[it.ingredient_id];
              if (!ing) return;
              var nb = Math.round(((Number(ing.current_stock) || 0) + (Number(it.qty) || 0)) * 1000) / 1000;
              ing.current_stock = nb;
              var patch = { current_stock: nb, last_restock: dt.date + ' ' + dt.time };
              if (Number(it.unit_price) > 0) patch.cost_per_unit = Number(it.unit_price);
              ops.push(upd('ingredients', 'id=eq.' + encodeURIComponent(ing.id), patch));
              logs.push({
                id: uid('log'), ingredient_id: ing.id, ingredient_name: ing.name,
                type: 'IN_PURCHASE', change_qty: Number(it.qty) || 0, balance_qty: nb,
                unit: ing.unit, reference: 'PO ' + po.id,
                note: 'Terima PO ' + po.id + ' @Rp ' + (Number(it.unit_price) || 0).toLocaleString('id-ID')
              });
            });
            var total = Number(po.subtotal) || 0;
            return Promise.all(ops).then(function () {
              return logs.length ? ins('stock_logs', logs) : null;
            }).then(function () {
              return tryJournal({
                description: 'Terima PO ' + po.id + (paid === 'credit' ? ' (kredit)' : ' (tunai)'),
                ref_type: 'po_receive', ref_id: po.id,
                lines: [
                  { account_code: '1200', debit: total, kredit: 0 },
                  { account_code: paid === 'credit' ? '2100' : '1100', debit: 0, kredit: total }
                ]
              });
            }).then(function () {
              return upd('purchase_orders', 'id=eq.' + encodeURIComponent(po.id), { status: 'received', received_at: nowIso });
            }).then(function (u) {
              var out = rowToPO(u[0]);
              out.items = items.map(rowToPOItem);
              return ok({ success: true, po: out });
            });
          });
        });
      });
    }).catch(serverError);
  };

  // 42. POST /api/owner/purchase-orders/cancel — {id}: hanya draft/sent
  routes['POST /api/owner/purchase-orders/cancel'] = function (body) {
    return needAccounting().then(function (blocked) {
      if (blocked) return blocked;
      if (!body.id) return bad({ success: false, message: 'ID PO wajib diisi' });
      return sel('purchase_orders', 'select=status&id=eq.' + encodeURIComponent(body.id)).then(function (pr) {
        if (!pr.length) return notFound({ success: false, message: 'PO tidak ditemukan' });
        if (pr[0].status !== 'draft' && pr[0].status !== 'sent') {
          return bad({ success: false, message: 'PO yang sudah diterima tidak bisa dibatalkan' });
        }
        return upd('purchase_orders', 'id=eq.' + encodeURIComponent(body.id), { status: 'cancelled' }).then(function (u) {
          return ok({ success: true, po: rowToPO(u[0]) });
        });
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
