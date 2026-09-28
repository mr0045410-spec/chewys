import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data', 'menu.json');
const ORDERS_FILE = path.join(__dirname, 'data', 'orders.json');
const INGREDIENTS_FILE = path.join(__dirname, 'data', 'ingredients.json');
const UPLOADS_DIR = path.join(__dirname, 'assets', 'uploads');
const ADMIN_PIN = '1234'; // Default PIN Kasir / Owner

// Ensure directories exist
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const mimeTypes = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
};

// Helper: Local WIB (Asia/Jakarta, UTC+7) Date Helpers
function getJakartaDate(d = new Date()) {
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  return new Date(utc + (7 * 3600000));
}

function getJakartaDateKey(d = new Date()) {
  const jkt = getJakartaDate(d);
  const y = jkt.getFullYear();
  const m = String(jkt.getMonth() + 1).padStart(2, '0');
  const day = String(jkt.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function getJakartaDateStr(d = new Date()) {
  const jkt = getJakartaDate(d);
  const y = jkt.getFullYear();
  const m = String(jkt.getMonth() + 1).padStart(2, '0');
  const day = String(jkt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatJakartaDateTime(d = new Date()) {
  const jkt = getJakartaDate(d);
  const day = String(jkt.getDate()).padStart(2, '0');
  const month = String(jkt.getMonth() + 1).padStart(2, '0');
  const year = jkt.getFullYear();
  const hours = String(jkt.getHours()).padStart(2, '0');
  const mins = String(jkt.getMinutes()).padStart(2, '0');
  const secs = String(jkt.getSeconds()).padStart(2, '0');
  return {
    date: `${day}/${month}/${year}`,
    time: `${hours}:${mins}:${secs}`
  };
}

// Helper: Read JSON Data
function readMenuData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error reading menu.json:', err);
  }
  return { categories: [], menuItems: [] };
}

// Helper: Write JSON Data
function writeMenuData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error writing menu.json:', err);
    return false;
  }
}

// Helper: Read Orders Data
function readOrdersData() {
  try {
    if (fs.existsSync(ORDERS_FILE)) {
      const raw = fs.readFileSync(ORDERS_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error reading orders.json:', err);
  }
  return { orders: [] };
}

// Helper: Write Orders Data
function writeOrdersData(data) {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error writing orders.json:', err);
    return false;
  }
}

// Helper: Read Ingredients Data
function readIngredientsData() {
  try {
    if (fs.existsSync(INGREDIENTS_FILE)) {
      const raw = fs.readFileSync(INGREDIENTS_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error reading ingredients.json:', err);
  }
  return { ingredients: [], recipes: {} };
}

// Helper: Write Ingredients Data
function writeIngredientsData(data) {
  try {
    fs.writeFileSync(INGREDIENTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error writing ingredients.json:', err);
    return false;
  }
}

// Helper: Save Base64 Image to assets/uploads/
function saveBase64Image(dataUrl, baseName = 'item') {
  try {
    const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return null;

    const mime = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');
    let ext = '.jpg';
    if (mime === 'image/png') ext = '.png';
    else if (mime === 'image/webp') ext = '.webp';
    else if (mime === 'image/gif') ext = '.gif';

    const cleanBase = baseName.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 30);
    const fileName = `${cleanBase}-${Date.now()}${ext}`;
    const targetPath = path.join(UPLOADS_DIR, fileName);

    fs.writeFileSync(targetPath, buffer);
    return `./assets/uploads/${fileName}`;
  } catch (err) {
    console.error('Error saving image:', err);
    return null;
  }
}

// Helper: Read POST/PUT JSON body
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      // Guard against huge payload > 25MB
      if (body.length > 25 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const urlParts = req.url.split('?');
  const reqPath = urlParts[0];

  // =========================================================================
  // API ROUTING
  // =========================================================================
  if (reqPath.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json; charset=UTF-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-PIN');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. GET /api/menu
    if (req.method === 'GET' && reqPath === '/api/menu') {
      const data = readMenuData();
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data }));
      return;
    }

    // 2. POST /api/admin/login (Verify PIN)
    if (req.method === 'POST' && reqPath === '/api/admin/login') {
      const body = await parseRequestBody(req);
      if (body.pin === ADMIN_PIN) {
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'Login successful' }));
      } else {
        res.writeHead(401);
        res.end(JSON.stringify({ success: false, message: 'PIN salah!' }));
      }
      return;
    }

    // 3. POST /api/menu/toggle-stock (Fast 1-click toggle Tersedia / Sold Out)
    if (req.method === 'POST' && reqPath === '/api/menu/toggle-stock') {
      const body = await parseRequestBody(req);
      const data = readMenuData();
      const item = data.menuItems.find(m => m.id === body.id);
      if (item) {
        item.inStock = typeof body.inStock === 'boolean' ? body.inStock : !item.inStock;
        if (item.inStock && (!item.stockQty || item.stockQty <= 0)) {
          item.stockQty = 20; // default 20 if toggled back to available
        } else if (!item.inStock) {
          item.stockQty = 0;
        }
        writeMenuData(data);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, item }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, message: 'Item tidak ditemukan' }));
      }
      return;
    }

    // 3b. POST /api/menu/update-stock (Adjust stock count directly)
    if (req.method === 'POST' && reqPath === '/api/menu/update-stock') {
      const body = await parseRequestBody(req);
      const data = readMenuData();
      const item = data.menuItems.find(m => m.id === body.id);
      if (item) {
        if (typeof body.stockQty === 'number') {
          item.stockQty = Math.max(0, Math.floor(body.stockQty));
        } else if (typeof body.delta === 'number') {
          item.stockQty = Math.max(0, Math.floor((item.stockQty || 0) + body.delta));
        }
        item.inStock = item.stockQty > 0;
        writeMenuData(data);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, item }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, message: 'Item tidak ditemukan' }));
      }
      return;
    }

    // 4. POST /api/menu (Create New Menu Item + Image Upload)
    if (req.method === 'POST' && reqPath === '/api/menu') {
      const body = await parseRequestBody(req);
      if (!body.name || !body.price) {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, message: 'Nama dan harga wajib diisi' }));
        return;
      }

      const data = readMenuData();
      let imageUrl = body.image || 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=700&q=80';

      // If user uploaded a new image file as base64
      if (body.imageBase64) {
        const saved = saveBase64Image(body.imageBase64, body.name);
        if (saved) imageUrl = saved;
      }

      const id = body.id || (body.name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Math.floor(Math.random() * 1000));
      const newItem = {
        id,
        name: body.name,
        category: body.category || 'bomboloni',
        tag: body.tag || 'New Special',
        description: body.description || '',
        price: body.price.startsWith('Rp') ? body.price : `Rp ${Number(body.price.replace(/[^0-9]/g, '')).toLocaleString('id-ID')}`,
        bundleInfo: body.bundleInfo || '',
        safeForShipping: Boolean(body.safeForShipping),
        stockQty: typeof body.stockQty === 'number' ? Math.max(0, Math.floor(body.stockQty)) : (body.inStock !== false ? 25 : 0),
        inStock: (typeof body.stockQty === 'number' ? body.stockQty > 0 : body.inStock !== false),
        image: imageUrl,
        highlightTexture: body.highlightTexture || 'Freshly baked daily'
      };

      data.menuItems.unshift(newItem); // put at front
      writeMenuData(data);

      res.writeHead(201);
      res.end(JSON.stringify({ success: true, item: newItem }));
      return;
    }

    // 5. PUT /api/menu (Update existing Menu Item)
    if (req.method === 'PUT' && reqPath === '/api/menu') {
      const body = await parseRequestBody(req);
      const data = readMenuData();
      const idx = data.menuItems.findIndex(m => m.id === body.id);

      if (idx !== -1) {
        let imageUrl = body.image || data.menuItems[idx].image;
        if (body.imageBase64) {
          const saved = saveBase64Image(body.imageBase64, body.name || data.menuItems[idx].name);
          if (saved) imageUrl = saved;
        }

        const newStockQty = body.stockQty !== undefined 
          ? Math.max(0, Math.floor(Number(body.stockQty) || 0)) 
          : (data.menuItems[idx].stockQty !== undefined ? data.menuItems[idx].stockQty : 25);
        
        const newInStock = body.stockQty !== undefined 
          ? newStockQty > 0 
          : (body.inStock !== undefined ? Boolean(body.inStock) : data.menuItems[idx].inStock);

        data.menuItems[idx] = {
          ...data.menuItems[idx],
          name: body.name || data.menuItems[idx].name,
          category: body.category || data.menuItems[idx].category,
          tag: body.tag !== undefined ? body.tag : data.menuItems[idx].tag,
          description: body.description !== undefined ? body.description : data.menuItems[idx].description,
          price: body.price ? (body.price.startsWith('Rp') ? body.price : `Rp ${Number(body.price.replace(/[^0-9]/g, '')).toLocaleString('id-ID')}`) : data.menuItems[idx].price,
          bundleInfo: body.bundleInfo !== undefined ? body.bundleInfo : data.menuItems[idx].bundleInfo,
          safeForShipping: body.safeForShipping !== undefined ? Boolean(body.safeForShipping) : data.menuItems[idx].safeForShipping,
          stockQty: newStockQty,
          inStock: newInStock,
          image: imageUrl,
          highlightTexture: body.highlightTexture !== undefined ? body.highlightTexture : data.menuItems[idx].highlightTexture
        };

        writeMenuData(data);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, item: data.menuItems[idx] }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, message: 'Item tidak ditemukan' }));
      }
      return;
    }

    // 6. DELETE /api/menu (Delete item)
    if (req.method === 'DELETE' && reqPath === '/api/menu') {
      const body = await parseRequestBody(req);
      const data = readMenuData();
      const beforeLen = data.menuItems.length;
      data.menuItems = data.menuItems.filter(m => m.id !== body.id);

      if (data.menuItems.length < beforeLen) {
        writeMenuData(data);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'Menu berhasil dihapus' }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, message: 'Item tidak ditemukan' }));
      }
      return;
    }

    // 7. GET /api/pos/orders (List all orders)
    if (req.method === 'GET' && reqPath === '/api/pos/orders') {
      const ordersData = readOrdersData();
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, orders: ordersData.orders || [] }));
      return;
    }

    // 8. POST /api/pos/checkout (Process order & generate receipt)
    if (req.method === 'POST' && reqPath === '/api/pos/checkout') {
      const body = await parseRequestBody(req);
      if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, message: 'Pesanan kosong / tidak valid' }));
        return;
      }

      const ordersData = readOrdersData();
      const todayStr = getJakartaDateKey();
      const todayOrdersCount = (ordersData.orders || []).filter(o => o.id && o.id.includes(todayStr)).length;
      const orderSeq = String(todayOrdersCount + 1).padStart(4, '0');
      const orderId = `CWY-${todayStr}-${orderSeq}`;

      const newOrder = {
        id: orderId,
        createdAt: new Date().toISOString(),
        orderType: body.orderType || 'dine-in', // dine-in, takeaway, delivery
        tableOrCustomer: body.tableOrCustomer || (body.orderType === 'dine-in' ? 'Meja -' : 'Pelanggan Walk-in'),
        items: body.items,
        subtotal: Number(body.subtotal) || 0,
        discount: Number(body.discount) || 0,
        tax: Number(body.tax) || 0,
        total: Number(body.total) || 0,
        paymentMethod: body.paymentMethod || 'cash', // cash, qris, edc
        cashPaid: Number(body.cashPaid) || Number(body.total) || 0,
        cashChange: Number(body.cashChange) || 0,
        paymentReference: body.paymentReference || '',
        cashier: body.cashier || 'Kasir 1',
        status: 'completed'
      };

      if (!ordersData.orders) ordersData.orders = [];
      ordersData.orders.unshift(newOrder); // newest first
      writeOrdersData(ordersData);

      // AUTO DEDUCT INVENTORY FROM menu.json
      const menuData = readMenuData();
      let inventoryChanged = false;

      (body.items || []).forEach(orderItem => {
        const menuItem = menuData.menuItems.find(m => m.id === orderItem.id);
        if (menuItem) {
          const currentStock = typeof menuItem.stockQty === 'number' ? menuItem.stockQty : 25;
          const qtyBought = Number(orderItem.qty) || 1;
          const newStock = Math.max(0, currentStock - qtyBought);
          menuItem.stockQty = newStock;
          if (newStock === 0) {
            menuItem.inStock = false;
          }
          inventoryChanged = true;
        }
      });

      if (inventoryChanged) {
        writeMenuData(menuData);
      }

      // AUTO DEDUCT RAW MATERIALS (INGREDIENTS) VIA RECIPES
      const ingredientsData = readIngredientsData();
      let ingredientsChanged = false;
      if (!Array.isArray(ingredientsData.stockLogs)) ingredientsData.stockLogs = [];

      if (ingredientsData.recipes && Array.isArray(ingredientsData.ingredients)) {
        (body.items || []).forEach(orderItem => {
          const qtyBought = Number(orderItem.qty) || 1;
          const recipe = ingredientsData.recipes[orderItem.id];
          if (Array.isArray(recipe)) {
            recipe.forEach(rec => {
              const ing = ingredientsData.ingredients.find(i => i.id === rec.ingredientId);
              if (ing) {
                const deduction = (Number(rec.amount) || 0) * qtyBought;
                ing.currentStock = Math.max(0, Math.round((ing.currentStock - deduction) * 1000) / 1000);
                ingredientsChanged = true;

                // Log movement
                ingredientsData.stockLogs.unshift({
                  id: 'log-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                  timestamp: new Date().toISOString(),
                  ingredientId: ing.id,
                  ingredientName: ing.name,
                  type: 'OUT_SALE',
                  changeQty: -deduction,
                  balanceQty: ing.currentStock,
                  unit: ing.unit,
                  reference: `POS ${orderId}`,
                  note: `${orderItem.name || orderItem.id} x${qtyBought}`
                });
              }
            });
          }
        });
        if (ingredientsChanged) {
          if (ingredientsData.stockLogs.length > 500) ingredientsData.stockLogs.length = 500;
          writeIngredientsData(ingredientsData);
        }
      }

      res.writeHead(201);
      res.end(JSON.stringify({ success: true, order: newOrder }));
      return;
    }

    // 9. GET /api/pos/summary (Laporan Harian Kasir ala Moka)
    if (req.method === 'GET' && reqPath === '/api/pos/summary') {
      const ordersData = readOrdersData();
      const allOrders = ordersData.orders || [];
      
      const todayDate = getJakartaDateStr();
      const todayOrders = allOrders.filter(o => o.createdAt && getJakartaDateStr(new Date(o.createdAt)) === todayDate);

      const totalRevenueToday = todayOrders.reduce((sum, o) => sum + (o.total || 0), 0);
      const totalOrdersToday = todayOrders.length;
      
      const paymentBreakdown = {
        cash: { count: 0, total: 0 },
        qris: { count: 0, total: 0 },
        edc: { count: 0, total: 0 }
      };

      const itemSales = {};

      todayOrders.forEach(o => {
        const pm = (o.paymentMethod || 'cash').toLowerCase();
        if (paymentBreakdown[pm]) {
          paymentBreakdown[pm].count += 1;
          paymentBreakdown[pm].total += (o.total || 0);
        }
        if (Array.isArray(o.items)) {
          o.items.forEach(it => {
            const key = it.name || it.id;
            if (!itemSales[key]) {
              itemSales[key] = { name: it.name, qty: 0, total: 0 };
            }
            itemSales[key].qty += (it.qty || 1);
            itemSales[key].total += ((it.price || 0) * (it.qty || 1));
          });
        }
      });

      const topItems = Object.values(itemSales).sort((a, b) => b.qty - a.qty).slice(0, 5);

      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        summary: {
          todayDate,
          totalRevenueToday,
          totalOrdersToday,
          paymentBreakdown,
          topItems,
          recentOrders: todayOrders.slice(0, 15)
        }
      }));
      return;
    }

    // 10. GET /api/owner/analytics (Executive Analytics & Profits)
    if (req.method === 'GET' && reqPath === '/api/owner/analytics') {
      const ordersData = readOrdersData();
      const menuData = readMenuData();
      const allOrders = ordersData.orders || [];

      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const range = urlObj.searchParams.get('range') || '7d';

      const now = new Date();
      let startDate = new Date(0);

      if (range === 'today') {
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (range === '7d') {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (range === '30d') {
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      const filteredOrders = allOrders.filter(o => {
        if (!o.createdAt) return false;
        return new Date(o.createdAt) >= startDate;
      });

      const itemCostMap = {};
      const itemCategoryMap = {};
      (menuData.menuItems || []).forEach(m => {
        const p = Number(String(m.price || 0).replace(/[^0-9]/g, '')) || 0;
        itemCostMap[m.id] = typeof m.costPrice === 'number' ? m.costPrice : Math.round(p * 0.38);
        itemCategoryMap[m.id] = m.category || 'other';
      });

      let totalRevenue = 0;
      let totalCost = 0;
      let totalItemsSold = 0;

      const paymentStats = {
        cash: { count: 0, total: 0 },
        qris: { count: 0, total: 0 },
        edc: { count: 0, total: 0 }
      };

      const dateTrendMap = {};
      const hourMap = {};
      for (let h = 8; h <= 22; h++) {
        const hh = String(h).padStart(2, '0') + ':00';
        hourMap[hh] = { hour: hh, count: 0, revenue: 0 };
      }

      const categoryMap = {
        bomboloni: { name: 'Bomboloni', qty: 0, revenue: 0 },
        brownies: { name: 'Brownies & Brookies', qty: 0, revenue: 0 },
        cookies: { name: 'Cookies', qty: 0, revenue: 0 },
        beverages: { name: 'Drinks & Coffee', qty: 0, revenue: 0 },
        other: { name: 'Lainnya', qty: 0, revenue: 0 }
      };

      const itemPerformanceMap = {};

      filteredOrders.forEach(o => {
        const orderDate = new Date(o.createdAt);
        const dateKey = orderDate.toISOString().slice(0, 10);
        const hourKey = String(orderDate.getHours()).padStart(2, '0') + ':00';

        const orderTotal = Number(o.total) || 0;
        totalRevenue += orderTotal;

        const pm = (o.paymentMethod || 'cash').toLowerCase();
        if (paymentStats[pm]) {
          paymentStats[pm].count += 1;
          paymentStats[pm].total += orderTotal;
        }

        if (hourMap[hourKey]) {
          hourMap[hourKey].count += 1;
          hourMap[hourKey].revenue += orderTotal;
        }

        if (!dateTrendMap[dateKey]) {
          dateTrendMap[dateKey] = { date: dateKey, revenue: 0, cost: 0, profit: 0, orders: 0 };
        }
        dateTrendMap[dateKey].revenue += orderTotal;
        dateTrendMap[dateKey].orders += 1;

        let orderCost = 0;
        (o.items || []).forEach(it => {
          const qty = Number(it.qty) || 1;
          const price = Number(it.price) || 0;
          const cost = (itemCostMap[it.id] !== undefined ? itemCostMap[it.id] : Math.round(price * 0.38)) * qty;
          const rev = price * qty;
          const profit = rev - cost;
          
          orderCost += cost;
          totalItemsSold += qty;

          const cat = itemCategoryMap[it.id] || 'other';
          if (!categoryMap[cat]) categoryMap[cat] = { name: cat, qty: 0, revenue: 0 };
          categoryMap[cat].qty += qty;
          categoryMap[cat].revenue += rev;

          const itemKey = it.name || it.id;
          if (!itemPerformanceMap[itemKey]) {
            itemPerformanceMap[itemKey] = {
              id: it.id,
              name: it.name,
              category: cat,
              qty: 0,
              revenue: 0,
              cost: 0,
              profit: 0,
              unitPrice: price,
              unitCost: itemCostMap[it.id] || Math.round(price * 0.38)
            };
          }
          itemPerformanceMap[itemKey].qty += qty;
          itemPerformanceMap[itemKey].revenue += rev;
          itemPerformanceMap[itemKey].cost += cost;
          itemPerformanceMap[itemKey].profit += profit;
        });

        totalCost += orderCost;
        dateTrendMap[dateKey].cost += orderCost;
        dateTrendMap[dateKey].profit += (orderTotal - orderCost);
      });

      const totalProfit = totalRevenue - totalCost;
      const profitMarginPercent = totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0;
      const avgOrderValue = filteredOrders.length > 0 ? Math.round(totalRevenue / filteredOrders.length) : 0;

      const timeline = Object.values(dateTrendMap).sort((a, b) => a.date.localeCompare(b.date));
      const peakHours = Object.values(hourMap);
      const categoryBreakdown = Object.values(categoryMap).filter(c => c.qty > 0 || c.revenue > 0);
      const menuProfitability = Object.values(itemPerformanceMap).map(it => ({
        ...it,
        marginPercent: it.revenue > 0 ? Math.round((it.profit / it.revenue) * 100) : 0
      })).sort((a, b) => b.profit - a.profit);

      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        analytics: {
          range,
          totalRevenue,
          totalCost,
          totalProfit,
          profitMarginPercent,
          totalOrders: filteredOrders.length,
          avgOrderValue,
          totalItemsSold,
          paymentStats,
          timeline,
          peakHours,
          categoryBreakdown,
          menuProfitability,
          recentOrders: filteredOrders.slice(0, 20)
        }
      }));
      return;
    }

    // 11. POST /api/owner/set-cost (Update Modal Bahan / HPP Per Menu)
    if (req.method === 'POST' && reqPath === '/api/owner/set-cost') {
      const body = await parseRequestBody(req);
      const menuData = readMenuData();
      const item = menuData.menuItems.find(m => m.id === body.id);
      if (item) {
        item.costPrice = Math.max(0, Math.floor(Number(body.costPrice) || 0));
        writeMenuData(menuData);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, item }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, message: 'Item tidak ditemukan' }));
      }
      return;
    }

    // 12. GET /api/owner/export-csv (Download Laporan CSV Semicolon Delimited untuk Excel Indonesia)
    if (req.method === 'GET' && reqPath === '/api/owner/export-csv') {
      const ordersData = readOrdersData();
      const allOrders = ordersData.orders || [];

      let csv = '\uFEFF'; // UTF-8 BOM
      csv += 'sep=;\n';   // Tells Microsoft Excel explicitly to use semicolon delimiter
      csv += 'ID Pesanan;Tanggal;Waktu;Kasir;Tipe Pesanan;Meja / Pelanggan;Menu Dipesan;Subtotal (Rp);Diskon (Rp);Total Bayar (Rp);Metode Bayar;Status\n';

      allOrders.forEach(o => {
        const d = o.createdAt ? new Date(o.createdAt) : new Date();
        const dt = formatJakartaDateTime(d);
        // Use " + " instead of semicolon so cells are not accidentally split
        const itemsList = (o.items || []).map(i => `${i.name} (${i.qty}x)`).join(' + ');
        
        const row = [
          `"${o.id || ''}"`,
          `"${dt.date}"`,
          `"${dt.time}"`,
          `"${o.cashier || 'Kasir 1'}"`,
          `"${(o.orderType || '').toUpperCase()}"`,
          `"${(o.tableOrCustomer || '').replace(/"/g, '""')}"`,
          `"${itemsList.replace(/"/g, '""')}"`,
          o.subtotal || 0,
          o.discount || 0,
          o.total || 0,
          `"${(o.paymentMethod || '').toUpperCase()}"`,
          `"${(o.status || 'completed').toUpperCase()}"`
        ];
        csv += row.join(';') + '\n';
      });

      res.setHeader('Content-Type', 'text/csv; charset=UTF-8');
      res.setHeader('Content-Disposition', 'attachment; filename="laporan-penjualan-chewys.csv"');
      res.writeHead(200);
      res.end(csv);
      return;
    }

    // 13. GET /api/owner/export-excel (Generate & stream genuine .xlsx workbook)
    if (req.method === 'GET' && reqPath === '/api/owner/export-excel') {
      try {
        execSync('python export_excel.py', { cwd: __dirname });
        const xlsxPath = path.join(__dirname, 'laporan-penjualan-chewys.xlsx');
        if (fs.existsSync(xlsxPath)) {
          const fileBuffer = fs.readFileSync(xlsxPath);
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', 'attachment; filename="laporan-penjualan-chewys.xlsx"');
          res.writeHead(200);
          res.end(fileBuffer);
          return;
        }
      } catch (err) {
        console.error('Error generating xlsx:', err);
      }
      res.writeHead(500);
      res.end('Gagal membuat file Excel');
      return;
    }

    // 14. GET /api/owner/ingredients (Get all ingredients, recipes, and status)
    if (req.method === 'GET' && reqPath === '/api/owner/ingredients') {
      const ingData = readIngredientsData();
      let totalValuation = 0;
      let lowStockCount = 0;
      let outOfStockCount = 0;

      const ingredients = (ingData.ingredients || []).map(item => {
        const stock = Number(item.currentStock) || 0;
        const minAlert = Number(item.minStockAlert) || 0;
        const cost = Number(item.costPerUnit) || 0;
        const valuation = Math.round(stock * cost);
        totalValuation += valuation;

        let status = 'safe';
        if (stock <= 0) {
          status = 'out_of_stock';
          outOfStockCount++;
        } else if (stock <= minAlert) {
          status = 'low';
          lowStockCount++;
        }

        return {
          ...item,
          currentStock: stock,
          minStockAlert: minAlert,
          costPerUnit: cost,
          valuation,
          status
        };
      });

      const wasteLogs = Array.isArray(ingData.wasteLogs) ? ingData.wasteLogs : [];
      const stockLogs = Array.isArray(ingData.stockLogs) ? ingData.stockLogs : [];
      const totalWasteLoss = wasteLogs.reduce((acc, w) => acc + (Number(w.totalLoss) || 0), 0);

      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        ingredients,
        recipes: ingData.recipes || {},
        wasteLogs: wasteLogs.slice(0, 150),
        stockLogs: stockLogs.slice(0, 200),
        summary: {
          totalItems: ingredients.length,
          lowStockCount,
          outOfStockCount,
          totalValuation,
          totalWasteLoss
        }
      }));
      return;
    }

    // 15. POST /api/owner/ingredients/restock (Restock belanja bahan)
    if (req.method === 'POST' && reqPath === '/api/owner/ingredients/restock') {
      const body = await parseRequestBody(req);
      const ingData = readIngredientsData();
      const ing = (ingData.ingredients || []).find(i => i.id === body.id);
      if (ing) {
        const addQty = Number(body.addStock) || 0;
        ing.currentStock = Math.round(((Number(ing.currentStock) || 0) + addQty) * 1000) / 1000;
        if (body.costPerUnit && Number(body.costPerUnit) > 0) {
          ing.costPerUnit = Number(body.costPerUnit);
        }
        if (body.supplier) {
          ing.supplier = body.supplier;
        }
        const dt = formatJakartaDateTime();
        ing.lastRestock = `${dt.date} ${dt.time}`;

        // Log movement
        if (!Array.isArray(ingData.stockLogs)) ingData.stockLogs = [];
        ingData.stockLogs.unshift({
          id: 'log-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          timestamp: new Date().toISOString(),
          ingredientId: ing.id,
          ingredientName: ing.name,
          type: 'IN_RESTOCK',
          changeQty: addQty,
          balanceQty: ing.currentStock,
          unit: ing.unit,
          reference: 'Restock Gudang',
          note: `Supplier: ${body.supplier || ing.supplier || '-'}`
        });
        if (ingData.stockLogs.length > 500) ingData.stockLogs.length = 500;

        writeIngredientsData(ingData);

        res.writeHead(200);
        res.end(JSON.stringify({ success: true, ingredient: ing }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, message: 'Bahan baku tidak ditemukan' }));
      }
      return;
    }

    // 15b. POST /api/owner/ingredients/waste (Catat bahan rusak / waste / spoilage)
    if (req.method === 'POST' && reqPath === '/api/owner/ingredients/waste') {
      const body = await parseRequestBody(req);
      const { ingredientId, qty, reason, note, reportedBy } = body;
      const amount = Number(qty) || 0;

      if (!ingredientId || amount <= 0) {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, message: 'Bahan dan jumlah terbuang wajib diisi valid' }));
        return;
      }

      const ingData = readIngredientsData();
      const ing = (ingData.ingredients || []).find(i => i.id === ingredientId);

      if (!ing) {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, message: 'Bahan baku tidak ditemukan' }));
        return;
      }

      // Deduct stock
      ing.currentStock = Math.max(0, Math.round(((Number(ing.currentStock) || 0) - amount) * 1000) / 1000);

      // Record waste log
      if (!Array.isArray(ingData.wasteLogs)) ingData.wasteLogs = [];
      const totalLoss = Math.round(amount * (Number(ing.costPerUnit) || 0));
      const wasteEntry = {
        id: 'wst-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        timestamp: new Date().toISOString(),
        ingredientId: ing.id,
        ingredientName: ing.name,
        qty: amount,
        unit: ing.unit,
        costPerUnit: ing.costPerUnit,
        totalLoss: totalLoss,
        reason: reason || 'Lainnya',
        note: note || '',
        reportedBy: reportedBy || 'Owner / Dapur'
      };
      ingData.wasteLogs.unshift(wasteEntry);
      if (ingData.wasteLogs.length > 300) ingData.wasteLogs.length = 300;

      // Also record in stockLogs
      if (!Array.isArray(ingData.stockLogs)) ingData.stockLogs = [];
      ingData.stockLogs.unshift({
        id: 'log-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        timestamp: new Date().toISOString(),
        ingredientId: ing.id,
        ingredientName: ing.name,
        type: 'OUT_WASTE',
        changeQty: -amount,
        balanceQty: ing.currentStock,
        unit: ing.unit,
        reference: `Waste (${reason || 'Rusak'})`,
        note: note ? `${note} (Rugi: Rp ${totalLoss.toLocaleString('id-ID')})` : `Rugi: Rp ${totalLoss.toLocaleString('id-ID')}`
      });
      if (ingData.stockLogs.length > 500) ingData.stockLogs.length = 500;

      writeIngredientsData(ingData);

      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        message: `Bahan rusak dicatat. Stok berkurang ${amount} ${ing.unit}`,
        waste: wasteEntry,
        newStock: ing.currentStock
      }));
      return;
    }

    // 15c. POST /api/owner/ingredients/waste/delete (Hapus catatan waste)
    if (req.method === 'POST' && reqPath === '/api/owner/ingredients/waste/delete') {
      const body = await parseRequestBody(req);
      const { id } = body;
      const ingData = readIngredientsData();
      if (!Array.isArray(ingData.wasteLogs)) ingData.wasteLogs = [];

      const initialLen = ingData.wasteLogs.length;
      ingData.wasteLogs = ingData.wasteLogs.filter(w => w.id !== id);

      if (ingData.wasteLogs.length < initialLen) {
        writeIngredientsData(ingData);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'Catatan waste berhasil dihapus' }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, message: 'Catatan waste tidak ditemukan' }));
      }
      return;
    }

    // 16. POST /api/owner/ingredients/update (Edit detail bahan)
    if (req.method === 'POST' && reqPath === '/api/owner/ingredients/update') {
      const body = await parseRequestBody(req);
      const ingData = readIngredientsData();
      const ing = (ingData.ingredients || []).find(i => i.id === body.id);
      if (ing) {
        if (body.name) ing.name = body.name;
        if (body.category) ing.category = body.category;
        if (body.unit) ing.unit = body.unit;
        if (body.currentStock !== undefined) ing.currentStock = Number(body.currentStock);
        if (body.minStockAlert !== undefined) ing.minStockAlert = Number(body.minStockAlert);
        if (body.costPerUnit !== undefined) ing.costPerUnit = Number(body.costPerUnit);
        if (body.supplier !== undefined) ing.supplier = body.supplier;

        writeIngredientsData(ingData);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, ingredient: ing }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, message: 'Bahan baku tidak ditemukan' }));
      }
      return;
    }

    // 17. POST /api/owner/ingredients/add (Tambah bahan baku baru)
    if (req.method === 'POST' && reqPath === '/api/owner/ingredients/add') {
      const body = await parseRequestBody(req);
      if (!body.name || !body.unit) {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, message: 'Nama bahan dan satuan wajib diisi' }));
        return;
      }
      const ingData = readIngredientsData();
      if (!Array.isArray(ingData.ingredients)) ingData.ingredients = [];

      const newId = 'ing-' + Date.now().toString(36);
      const newIng = {
        id: newId,
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

      res.writeHead(201);
      res.end(JSON.stringify({ success: true, ingredient: newIng }));
      return;
    }

    // 18. POST /api/owner/ingredients/delete (Hapus bahan baku)
    if (req.method === 'POST' && reqPath === '/api/owner/ingredients/delete') {
      const body = await parseRequestBody(req);
      const ingData = readIngredientsData();
      const initialLen = ingData.ingredients.length;
      ingData.ingredients = (ingData.ingredients || []).filter(i => i.id !== body.id);

      if (ingData.ingredients.length < initialLen) {
        writeIngredientsData(ingData);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'Bahan baku berhasil dihapus' }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, message: 'Bahan baku tidak ditemukan' }));
      }
      return;
    }

    // 19. POST /api/owner/recipes/update (Simpan / buat menu + racik resep BOM)
    if (req.method === 'POST' && reqPath === '/api/owner/recipes/update') {
      const body = await parseRequestBody(req);
      let { menuId, name, category, price, image, items, isNew } = body;

      if (!name) {
        res.writeHead(400);
        res.end(JSON.stringify({ success: false, message: 'Nama menu wajib diisi' }));
        return;
      }

      if (!menuId || isNew) {
        menuId = 'menu-' + Date.now().toString(36);
      }

      const ingData = readIngredientsData();
      if (!ingData.recipes) ingData.recipes = {};

      const ingMap = {};
      (ingData.ingredients || []).forEach(i => { ingMap[i.id] = i; });

      // Clean & validate items
      const cleanItems = [];
      let calculatedCost = 0;

      if (Array.isArray(items)) {
        items.forEach(it => {
          const ing = ingMap[it.ingredientId];
          const amount = Number(it.amount) || 0;
          if (ing && amount > 0) {
            cleanItems.push({
              ingredientId: it.ingredientId,
              amount,
              unit: ing.unit
            });
            calculatedCost += (amount * (Number(ing.costPerUnit) || 0));
          }
        });
      }

      ingData.recipes[menuId] = cleanItems;
      writeIngredientsData(ingData);

      // Create or Update in menu.json
      const menuData = readMenuData();
      if (!Array.isArray(menuData.menuItems)) menuData.menuItems = [];

      let menuItem = menuData.menuItems.find(m => m.id === menuId);
      const formattedPrice = price ? (String(price).startsWith('Rp') ? price : `Rp ${Number(String(price).replace(/[^0-9]/g, '')).toLocaleString('id-ID')}`) : 'Rp 25.000';

      if (!menuItem) {
        // Create new menu item
        menuItem = {
          id: menuId,
          name: name,
          category: category || 'bomboloni',
          tag: 'Menu Baru',
          description: 'Kreasi dessert terbaru dari dapur Chewy\'s.',
          price: formattedPrice,
          bundleInfo: '',
          safeForShipping: true,
          stockQty: 25,
          inStock: true,
          image: image || 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=700&q=80',
          highlightTexture: 'Freshly baked daily',
          costPrice: Math.round(calculatedCost)
        };
        menuData.menuItems.unshift(menuItem);
      } else {
        // Update existing menu item
        menuItem.name = name;
        if (category) menuItem.category = category;
        if (price) menuItem.price = formattedPrice;
        if (image) menuItem.image = image;
        menuItem.costPrice = Math.round(calculatedCost);
      }

      writeMenuData(menuData);

      res.writeHead(200);
      res.end(JSON.stringify({
        success: true,
        menuItem,
        recipe: cleanItems,
        calculatedHpp: Math.round(calculatedCost),
        message: 'Menu dan resep berhasil disimpan'
      }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Endpoint API tidak ditemukan' }));
    return;
  }

  // =========================================================================
  // STATIC FILE SERVING
  // =========================================================================
  let localPath = reqPath;
  if (localPath === '/' || localPath === '') localPath = '/index.html';

  const filePath = path.join(__dirname, localPath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.stat(filePath, (err, stats) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    // Support HTTP Range requests for video scrubbing (206 Partial Content)
    const range = req.headers.range;
    if (range && (ext === '.mp4' || ext === '.webm')) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
      const chunksize = (end - start) + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stats.size,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n🍩 Chewy's Dessert Web Server, Admin & POS is LIVE!`);
  console.log(`👉 Customer Site : http://localhost:${PORT}`);
  console.log(`🔑 Admin Panel   : http://localhost:${PORT}/admin.html (PIN: ${ADMIN_PIN})`);
  console.log(`💻 Kasir POS     : http://localhost:${PORT}/pos.html`);
  console.log(`👑 Owner Portal  : http://localhost:${PORT}/owner.html\n`);
});
