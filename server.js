const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const QRCode = require('qrcode');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const fs = require('fs');

// Import admin modules
const { adminLogin, adminLogout, requireAdmin } = require('./middleware/auth');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure directories exist
const uploadDir = path.join(__dirname, 'uploads');
const dbDir = path.join(__dirname, 'database');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);

// Database setup
const dbPath = path.join(dbDir, 'spaza.db');
const db = new Database(dbPath);

// Make db available to routes
app.set('db', db);

// Set up EJS as view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Initialize database tables
function initDatabase() {
    // Customers table
    db.exec(`
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phone TEXT UNIQUE NOT NULL,
            email TEXT,
            password TEXT NOT NULL,
            saved_card TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Merchants table
    db.exec(`
        CREATE TABLE IF NOT EXISTS merchants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            shop_name TEXT NOT NULL,
            phone TEXT UNIQUE NOT NULL,
            email TEXT,
            password TEXT NOT NULL,
            shop_address TEXT,
            owner_address TEXT,
            owner_photo TEXT,
            banking_details TEXT,
            status TEXT DEFAULT 'pending',
            approved_by INTEGER,
            approved_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Central Products table
    db.exec(`
        CREATE TABLE IF NOT EXISTS central_products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            barcode TEXT UNIQUE NOT NULL,
            product_name TEXT NOT NULL,
            brand TEXT,
            category TEXT,
            default_image TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Merchant Products table
    db.exec(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            barcode TEXT NOT NULL,
            name TEXT NOT NULL,
            price DECIMAL(10,2) NOT NULL,
            picture TEXT,
            merchant_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (merchant_id) REFERENCES merchants(id),
            UNIQUE(barcode, merchant_id)
        )
    `);

    // Orders table
    db.exec(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            merchant_id INTEGER NOT NULL,
            items TEXT NOT NULL,
            total DECIMAL(10,2) NOT NULL,
            status TEXT DEFAULT 'pending',
            order_qr TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (customer_id) REFERENCES customers(id),
            FOREIGN KEY (merchant_id) REFERENCES merchants(id)
        )
    `);

    // Admins table
    db.exec(`
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'admin',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Force create admin account
    const hashedPassword = bcrypt.hashSync('Admin@123', 10);
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO admins (email, password_hash, role) 
        VALUES (?, ?, ?)
    `);
    stmt.run('admin@spazapay.com', hashedPassword, 'super_admin');
    console.log('Admin account ensured: admin@spazapay.com / Admin@123');

    // Ensure test customer exists
    const testCustomer = db.prepare("SELECT * FROM customers WHERE phone = '0821234567'").get();
    if (!testCustomer) {
        const testPassword = bcrypt.hashSync('123456', 10);
        db.prepare("INSERT INTO customers (phone, email, password) VALUES (?, ?, ?)")
          .run('0821234567', 'test@customer.com', testPassword);
        console.log('Test customer created');
    }

    // Ensure test merchant exists
    const testMerchant = db.prepare("SELECT * FROM merchants WHERE phone = '0821234568'").get();
    if (!testMerchant) {
        const testPassword = bcrypt.hashSync('123456', 10);
        db.prepare(`
            INSERT INTO merchants (shop_name, phone, email, password, shop_address, owner_address, banking_details, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
        `).run('Test Spaza Shop', '0821234568', 'test@merchant.com', testPassword,
            '123 Test Street', '456 Owner Address', 'Bank: Test Bank');
        console.log('Test merchant created');
    }

    // Sample central products
    const sampleProducts = [
        { barcode: '6001234567890', name: 'Premium White Bread', brand: 'Albany', category: 'Bread & Bakery' },
        { barcode: '6009876543210', name: 'Fresh Milk 1L', brand: 'Clover', category: 'Dairy' },
        { barcode: '6001112223334', name: 'Coca-Cola 2L', brand: 'Coca-Cola', category: 'Drinks' },
        { barcode: '6005556667778', name: 'Simba Chips 100g', brand: 'Simba', category: 'Snacks' }
    ];
    
    for (const product of sampleProducts) {
        const existing = db.prepare("SELECT * FROM central_products WHERE barcode = ?").get(product.barcode);
        if (!existing) {
            db.prepare(`INSERT INTO central_products (barcode, product_name, brand, category) VALUES (?, ?, ?, ?)`)
              .run(product.barcode, product.name, product.brand, product.category);
        }
    }

    console.log('Database initialized');
}

initDatabase();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Session configuration - FIXED for production
app.use(session({
    secret: process.env.SESSION_SECRET || 'spaza-scan-secret-key-change-in-production',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24,
        sameSite: 'lax'
    }
}));

// Multer configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, uploadDir); },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// ==================== FRONTEND ROUTES ====================

app.get('/', (req, res) => { res.render('index', { title: 'SpazaScan' }); });

app.get('/customer-login', (req, res) => { res.render('login', { title: 'Customer Login' }); });
app.get('/customer-signup', (req, res) => { res.render('signup', { title: 'Customer Signup' }); });
app.get('/customer-dashboard', (req, res) => {
    if (!req.session.customerId) return res.redirect('/customer-login');
    res.render('dashboard', { title: 'Customer Dashboard' });
});
app.get('/order-history', (req, res) => {
    if (!req.session.customerId) return res.redirect('/customer-login');
    res.render('order-history', { title: 'Order History' });
});

app.get('/merchant-login', (req, res) => { res.render('merchant-login', { title: 'Merchant Login' }); });
app.get('/merchant-signup', (req, res) => { res.render('merchant-signup', { title: 'Merchant Signup' }); });
app.get('/merchant-dashboard', (req, res) => {
    if (!req.session.merchantId) return res.redirect('/merchant-login');
    const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(req.session.merchantId);
    const productCount = db.prepare('SELECT COUNT(*) as count FROM products WHERE merchant_id = ?').get(req.session.merchantId);
    const pendingOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE merchant_id = ? AND status = 'pending'").get(req.session.merchantId);
    const totalRevenue = db.prepare("SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE merchant_id = ? AND status != 'cancelled'").get(req.session.merchantId);
    res.render('merchant-dashboard', { 
        title: 'Merchant Dashboard', merchant: merchant, shop_name: merchant.shop_name,
        productCount: productCount.count, pendingOrders: pendingOrders.count, totalRevenue: totalRevenue.total
    });
});
app.get('/merchant-products', (req, res) => {
    if (!req.session.merchantId) return res.redirect('/merchant-login');
    const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(req.session.merchantId);
    res.render('merchant-products', { title: 'Manage Products', shop_name: merchant.shop_name, merchantId: req.session.merchantId });
});
app.get('/merchant-product-edit', (req, res) => {
    if (!req.session.merchantId) return res.redirect('/merchant-login');
    const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(req.session.merchantId);
    res.render('merchant-product-edit', { title: 'Edit Product', shop_name: merchant.shop_name, merchantId: req.session.merchantId, productId: req.query.id });
});
app.get('/merchant-verify', (req, res) => {
    if (!req.session.merchantId) return res.redirect('/merchant-login');
    const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(req.session.merchantId);
    res.render('merchant-verify', { title: 'Verify Orders', shop_name: merchant.shop_name, merchantId: req.session.merchantId });
});
app.get('/merchant-shop-qr', (req, res) => {
    if (!req.session.merchantId) return res.redirect('/merchant-login');
    const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(req.session.merchantId);
    res.render('merchant-shop-qr', { title: 'Shop QR Code', shop_name: merchant.shop_name, merchantId: req.session.merchantId });
});
app.get('/merchant-analytics', (req, res) => {
    if (!req.session.merchantId) return res.redirect('/merchant-login');
    const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(req.session.merchantId);
    res.render('merchant-analytics', { title: 'Analytics', shop_name: merchant.shop_name, merchantId: req.session.merchantId });
});
app.get('/scanner', (req, res) => { res.render('scanner', { title: 'Scan Barcode' }); });

// ==================== FORM POST HANDLERS ====================

app.post('/login', (req, res) => {
    const { phone, password } = req.body;
    try {
        const customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
        if (!customer) return res.send('<script>alert("Customer not found"); window.location.href="/customer-login";</script>');
        if (!bcrypt.compareSync(password, customer.password)) return res.send('<script>alert("Invalid password"); window.location.href="/customer-login";</script>');
        req.session.customerId = customer.id;
        res.redirect('/customer-dashboard');
    } catch (error) { res.send('<script>alert("Login error"); window.location.href="/customer-login";</script>'); }
});

app.post('/signup', (req, res) => {
    const { phone, email, password } = req.body;
    try {
        const hashedPassword = bcrypt.hashSync(password, 10);
        db.prepare('INSERT INTO customers (phone, email, password) VALUES (?, ?, ?)').run(phone, email, hashedPassword);
        res.send('<script>alert("Account created! Please login."); window.location.href="/customer-login";</script>');
    } catch (error) {
        res.send('<script>alert("Phone already registered"); window.location.href="/customer-signup";</script>');
    }
});

app.post('/merchant-login', (req, res) => {
    const { phone, password } = req.body;
    try {
        const merchant = db.prepare('SELECT * FROM merchants WHERE phone = ?').get(phone);
        if (!merchant) return res.send('<script>alert("Merchant not found"); window.location.href="/merchant-login";</script>');
        if (!bcrypt.compareSync(password, merchant.password)) return res.send('<script>alert("Invalid password"); window.location.href="/merchant-login";</script>');
        if (merchant.status !== 'active') return res.send('<script>alert("Account pending approval"); window.location.href="/merchant-login";</script>');
        req.session.merchantId = merchant.id;
        res.redirect('/merchant-dashboard');
    } catch (error) { res.send('<script>alert("Login error"); window.location.href="/merchant-login";</script>'); }
});

app.post('/merchant-signup', (req, res) => {
    const { shop_name, phone, email, password, shop_address, owner_address, banking_details } = req.body;
    try {
        const hashedPassword = bcrypt.hashSync(password, 10);
        db.prepare(`INSERT INTO merchants (shop_name, phone, email, password, shop_address, owner_address, banking_details, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`)
          .run(shop_name, phone, email, hashedPassword, shop_address, owner_address, banking_details);
        res.send('<script>alert("Registration pending admin approval"); window.location.href="/merchant-login";</script>');
    } catch (error) { res.send('<script>alert("Phone already registered"); window.location.href="/merchant-signup";</script>'); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// ==================== ADMIN ROUTES ====================

// Simple admin login handler (using the imported requireAdmin)
app.post('/admin/login', (req, res) => {
    const { email, password } = req.body;
    const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
    if (!admin) {
        return res.send('<script>alert("Admin not found"); window.location.href="/admin/login";</script>');
    }
    if (!bcrypt.compareSync(password, admin.password_hash)) {
        return res.send('<script>alert("Invalid password"); window.location.href="/admin/login";</script>');
    }
    req.session.adminId = admin.id;
    req.session.adminEmail = admin.email;
    res.redirect('/admin/dashboard');
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// Serve admin pages
app.get('/admin/login', (req, res) => { res.sendFile(path.join(__dirname, 'public/admin/login.html')); });
app.get('/admin/dashboard', requireAdmin, (req, res) => { res.sendFile(path.join(__dirname, 'public/admin/dashboard.html')); });
app.get('/admin/products', requireAdmin, (req, res) => { res.sendFile(path.join(__dirname, 'public/admin/products.html')); });

// Use admin routes from routes/admin.js
app.use('/admin/api', adminRoutes);

// ==================== CENTRAL PRODUCTS API ====================

app.get('/api/admin/central-products', requireAdmin, (req, res) => {
    const { search } = req.query;
    let query = 'SELECT * FROM central_products';
    let params = [];
    if (search) {
        query += ' WHERE product_name LIKE ? OR barcode LIKE ? OR brand LIKE ?';
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    query += ' ORDER BY product_name ASC';
    const products = db.prepare(query).all(...params);
    res.json(products);
});

app.post('/api/admin/central-products', requireAdmin, (req, res) => {
    const { barcode, product_name, brand, category, default_image } = req.body;
    try {
        db.prepare(`INSERT INTO central_products (barcode, product_name, brand, category, default_image) VALUES (?, ?, ?, ?, ?)`)
          .run(barcode, product_name, brand, category, default_image || '');
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message.includes('UNIQUE') ? 'Barcode already exists' : error.message });
    }
});

app.delete('/api/admin/central-products/:id', requireAdmin, (req, res) => {
    db.prepare('DELETE FROM central_products WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

app.get('/api/product/lookup/:barcode', (req, res) => {
    const barcode = req.params.barcode;
    const product = db.prepare('SELECT * FROM central_products WHERE barcode = ?').get(barcode);
    if (product) {
        res.json({ found: true, ...product });
    } else {
        res.json({ found: false });
    }
});

// ==================== API ROUTES ====================

app.post('/api/merchant/products', upload.single('picture'), (req, res) => {
    if (!req.session.merchantId) return res.status(401).json({ error: 'Not logged in' });
    const { barcode, name, price } = req.body;
    const picture = req.file ? `/uploads/${req.file.filename}` : null;
    try {
        db.prepare('INSERT INTO products (barcode, name, price, picture, merchant_id) VALUES (?, ?, ?, ?, ?)')
          .run(barcode, name, price, picture, req.session.merchantId);
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.get('/api/merchant/products', (req, res) => {
    if (!req.session.merchantId) return res.status(401).json({ error: 'Not logged in' });
    const products = db.prepare('SELECT * FROM products WHERE merchant_id = ? ORDER BY created_at DESC').all(req.session.merchantId);
    for (const product of products) {
        const central = db.prepare('SELECT default_image FROM central_products WHERE barcode = ?').get(product.barcode);
        if (central) product.central_image = central.default_image;
    }
    res.json(products);
});

app.delete('/api/merchant/products/:id', (req, res) => {
    if (!req.session.merchantId) return res.status(401).json({ error: 'Not logged in' });
    db.prepare('DELETE FROM products WHERE id = ? AND merchant_id = ?').run(req.params.id, req.session.merchantId);
    res.json({ success: true });
});

app.get('/api/merchant/shop-qr', (req, res) => {
    if (!req.session.merchantId) return res.status(401).json({ error: 'Not logged in' });
    const merchant = db.prepare('SELECT id, shop_name FROM merchants WHERE id = ?').get(req.session.merchantId);
    QRCode.toDataURL(JSON.stringify({ type: 'shop', merchantId: merchant.id, shopName: merchant.shop_name }), (err, url) => {
        res.json({ qrCode: url });
    });
});

app.get('/api/merchant/orders', (req, res) => {
    if (!req.session.merchantId) return res.status(401).json({ error: 'Not logged in' });
    const orders = db.prepare(`SELECT o.*, c.phone as customer_phone FROM orders o JOIN customers c ON o.customer_id = c.id WHERE o.merchant_id = ? ORDER BY o.created_at DESC`).all(req.session.merchantId);
    orders.forEach(order => order.items = JSON.parse(order.items));
    res.json(orders);
});

app.put('/api/merchant/orders/:id/release', (req, res) => {
    if (!req.session.merchantId) return res.status(401).json({ error: 'Not logged in' });
    db.prepare("UPDATE orders SET status = 'completed' WHERE id = ? AND merchant_id = ?").run(req.params.id, req.session.merchantId);
    res.json({ success: true });
});

app.post('/api/orders', (req, res) => {
    if (!req.session.customerId) return res.status(401).json({ error: 'Not logged in' });
    const { merchantId, items, total } = req.body;
    QRCode.toDataURL(JSON.stringify({ type: 'order', merchantId, customerId: req.session.customerId }), (err, orderQr) => {
        const result = db.prepare(`INSERT INTO orders (customer_id, merchant_id, items, total, status, order_qr) VALUES (?, ?, ?, ?, 'pending', ?)`).run(req.session.customerId, merchantId, JSON.stringify(items), total, orderQr);
        res.json({ success: true, orderId: result.lastInsertRowid, orderQr });
    });
});

app.get('/api/customer/orders', (req, res) => {
    if (!req.session.customerId) return res.status(401).json({ error: 'Not logged in' });
    const orders = db.prepare(`SELECT o.*, m.shop_name FROM orders o JOIN merchants m ON o.merchant_id = m.id WHERE o.customer_id = ? ORDER BY o.created_at DESC`).all(req.session.customerId);
    orders.forEach(order => order.items = JSON.parse(order.items));
    res.json(orders);
});

app.get('/api/product/barcode/:barcode', (req, res) => {
    const product = db.prepare('SELECT * FROM products WHERE barcode = ?').get(req.params.barcode);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const central = db.prepare('SELECT default_image FROM central_products WHERE barcode = ?').get(product.barcode);
    if (central) product.central_image = central.default_image;
    res.json(product);
});

// Debug route
app.get('/debug-check', (req, res) => {
    const customers = db.prepare("SELECT id, phone, email FROM customers").all();
    const merchants = db.prepare("SELECT id, shop_name, phone, status FROM merchants").all();
    const admins = db.prepare("SELECT id, email, role FROM admins").all();
    res.json({ customers, merchants, admins });
});

// ==================== SERVER START ====================
app.listen(PORT, () => {
    console.log(`\n=================================`);
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`\nTest Accounts:`);
    console.log(`  Admin:    admin@spazapay.com / Admin@123`);
    console.log(`  Customer: 0821234567 / 123456`);
    console.log(`  Merchant: 0821234568 / 123456`);
    console.log(`=================================\n`);
});