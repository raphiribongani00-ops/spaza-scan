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

    // Central Products table (platform-wide database)
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

    // Merchant Products table (merchant-specific with their prices)
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

    // Check if default admin exists
    const adminExists = db.prepare('SELECT COUNT(*) as count FROM admins WHERE email = ?').get('admin@spazapay.com');
    
    if (!adminExists || adminExists.count === 0) {
        const hashedPassword = bcrypt.hashSync('Admin@123', 10);
        db.prepare('INSERT INTO admins (email, password_hash, role) VALUES (?, ?, ?)')
          .run('admin@spazapay.com', hashedPassword, 'super_admin');
        console.log('Default admin created: admin@spazapay.com / Admin@123');
    }

    // Ensure test customer exists
    const testCustomer = db.prepare("SELECT * FROM customers WHERE phone = '0821234567'").get();
    if (!testCustomer) {
        const testPassword = bcrypt.hashSync('123456', 10);
        db.prepare("INSERT INTO customers (phone, email, password) VALUES (?, ?, ?)")
          .run('0821234567', 'test@customer.com', testPassword);
        console.log('Test customer created: Phone: 0821234567, Password: 123456');
    }

    // Ensure test merchant exists and is active
    const testMerchant = db.prepare("SELECT * FROM merchants WHERE phone = '0821234568'").get();
    if (!testMerchant) {
        const testPassword = bcrypt.hashSync('123456', 10);
        db.prepare(`
            INSERT INTO merchants (
                shop_name, phone, email, password, shop_address, owner_address, banking_details, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
        `).run(
            'Test Spaza Shop', '0821234568', 'test@merchant.com', testPassword,
            '123 Test Street, Cape Town', '456 Owner Address, Cape Town', 'Bank: Test Bank, Acc: 123456789'
        );
        console.log('Test merchant created: Phone: 0821234568, Password: 123456');
    } else if (testMerchant.status !== 'active') {
        db.prepare("UPDATE merchants SET status = 'active' WHERE phone = '0821234568'").run();
        console.log('Test merchant activated');
    }

    // Add sample central products
    const sampleProducts = [
        { barcode: '6001234567890', name: 'Premium White Bread', brand: 'Albany', category: 'Bread & Bakery', image: 'https://shoprite.co.za/Images/Products/6001234567890.jpg' },
        { barcode: '6009876543210', name: 'Fresh Milk 1L', brand: 'Clover', category: 'Dairy', image: '' },
        { barcode: '6001112223334', name: 'Coca-Cola 2L', brand: 'Coca-Cola', category: 'Drinks', image: '' },
        { barcode: '6005556667778', name: 'Simba Chips 100g', brand: 'Simba', category: 'Snacks', image: '' },
        { barcode: '6004445556667', name: 'Tastic Rice 1kg', brand: 'Tastic', category: 'Rice & Pasta', image: '' },
        { barcode: '6008889990001', name: 'Jungle Oats 1kg', brand: 'Jungle', category: 'Breakfast', image: '' },
        { barcode: '6002223334445', name: 'Knorrox Cubes', brand: 'Knorr', category: 'Cooking', image: '' },
        { barcode: '6007778889990', name: 'Sunlight Dish Liquid', brand: 'Sunlight', category: 'Household', image: '' }
    ];
    
    for (const product of sampleProducts) {
        const existing = db.prepare("SELECT * FROM central_products WHERE barcode = ?").get(product.barcode);
        if (!existing) {
            db.prepare(`INSERT INTO central_products (barcode, product_name, brand, category, default_image) VALUES (?, ?, ?, ?, ?)`)
              .run(product.barcode, product.name, product.brand, product.category, product.image);
            console.log(`Sample product added: ${product.name}`);
        }
    }

    console.log('Database initialized at:', dbPath);
}

initDatabase();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'spaza-scan-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 24
    }
}));

// Multer configuration for file uploads
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

// Customer routes
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

// Merchant routes
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
        req.session.customerPhone = customer.phone;
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
        req.session.merchantName = merchant.shop_name;
        res.redirect('/merchant-dashboard');
    } catch (error) { res.send('<script>alert("Login error"); window.location.href="/merchant-login";</script>'); }
});

app.post('/merchant-signup', (req, res) => {
    const { shop_name, phone, email, password, shop_address, owner_address, banking_details } = req.body;
    try {
        const hashedPassword = bcrypt.hashSync(password, 10);
        db.prepare(`INSERT INTO merchants (shop_name, phone, email, password, shop_address, owner_address, banking_details, status) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`)
          .run(shop_name, phone, email, hashedPassword, shop_address, owner_address, banking_details);
        res.send('<script>alert("Registration pending admin approval"); window.location.href="/merchant-login";</script>');
    } catch (error) { res.send('<script>alert("Phone already registered"); window.location.href="/merchant-signup";</script>'); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// ==================== ADMIN ROUTES ====================
app.post('/admin/login', (req, res) => adminLogin(req, res, db));
app.post('/admin/logout', adminLogout);
app.use('/admin', adminRoutes);
app.get('/admin/login', (req, res) => { res.sendFile(path.join(__dirname, 'public/admin/login.html')); });
app.get('/admin/dashboard', requireAdmin, (req, res) => { res.sendFile(path.join(__dirname, 'public/admin/dashboard.html')); });
app.get('/admin/products', requireAdmin, (req, res) => { res.sendFile(path.join(__dirname, 'public/admin/products.html')); });

// ==================== CENTRAL PRODUCTS API (Admin) ====================

app.get('/api/admin/central-products', (req, res) => {
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

app.post('/api/admin/central-products', (req, res) => {
    const { barcode, product_name, brand, category, default_image } = req.body;
    try {
        db.prepare(`INSERT INTO central_products (barcode, product_name, brand, category, default_image) VALUES (?, ?, ?, ?, ?)`)
          .run(barcode, product_name, brand, category, default_image || '');
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message.includes('UNIQUE') ? 'Barcode already exists' : error.message });
    }
});

app.delete('/api/admin/central-products/:id', (req, res) => {
    db.prepare('DELETE FROM central_products WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// Look up product by barcode from central database
app.get('/api/product/lookup/:barcode', (req, res) => {
    const barcode = req.params.barcode;
    const product = db.prepare('SELECT * FROM central_products WHERE barcode = ?').get(barcode);
    if (product) {
        res.json({ found: true, barcode: product.barcode, product_name: product.product_name, brand: product.brand, category: product.category, default_image: product.default_image });
    } else {
        res.json({ found: false, message: 'Product not found in database' });
    }
});

// ==================== API ROUTES ====================

// Customer API
app.post('/api/customer/signup', (req, res) => {
    const { phone, email, password } = req.body;
    try {
        const hashedPassword = bcrypt.hashSync(password, 10);
        db.prepare('INSERT INTO customers (phone, email, password) VALUES (?, ?, ?)').run(phone, email, hashedPassword);
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/customer/login', (req, res) => {
    const { phone, password } = req.body;
    const customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
    if (!customer || !bcrypt.compareSync(password, customer.password)) return res.status(401).json({ error: 'Invalid credentials' });
    req.session.customerId = customer.id;
    res.json({ success: true });
});

app.post('/api/customer/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/api/customer/me', (req, res) => {
    if (!req.session.customerId) return res.status(401).json({ error: 'Not logged in' });
    res.json(db.prepare('SELECT id, phone, email FROM customers WHERE id = ?').get(req.session.customerId));
});

// Merchant API
app.post('/api/merchant/signup', (req, res) => {
    const { shop_name, phone, email, password, shop_address, owner_address, banking_details } = req.body;
    try {
        const hashedPassword = bcrypt.hashSync(password, 10);
        db.prepare(`INSERT INTO merchants (shop_name, phone, email, password, shop_address, owner_address, banking_details, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`)
          .run(shop_name, phone, email, hashedPassword, shop_address, owner_address, banking_details);
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/merchant/login', (req, res) => {
    const { phone, password } = req.body;
    const merchant = db.prepare('SELECT * FROM merchants WHERE phone = ?').get(phone);
    if (!merchant || !bcrypt.compareSync(password, merchant.password)) return res.status(401).json({ error: 'Invalid credentials' });
    if (merchant.status !== 'active') return res.status(401).json({ error: 'Account pending approval' });
    req.session.merchantId = merchant.id;
    res.json({ success: true, merchant: { id: merchant.id, shop_name: merchant.shop_name } });
});

app.post('/api/merchant/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/api/merchant/me', (req, res) => {
    if (!req.session.merchantId) return res.status(401).json({ error: 'Not logged in' });
    res.json(db.prepare('SELECT id, shop_name, phone, email, status FROM merchants WHERE id = ?').get(req.session.merchantId));
});

// Product API (Merchant adds product with their price)
app.post('/api/merchant/products', upload.single('picture'), (req, res) => {
    if (!req.session.merchantId) return res.status(401).json({ error: 'Not logged in' });
    const { barcode, name, price } = req.body;
    const picture = req.file ? `/uploads/${req.file.filename}` : null;
    try {
        db.prepare('INSERT INTO products (barcode, name, price, picture, merchant_id) VALUES (?, ?, ?, ?, ?)')
          .run(barcode, name, price, picture, req.session.merchantId);
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message.includes('UNIQUE') ? 'Product already exists for this merchant' : error.message });
    }
});

app.get('/api/merchant/products', (req, res) => {
    if (!req.session.merchantId) return res.status(401).json({ error: 'Not logged in' });
    const products = db.prepare('SELECT * FROM products WHERE merchant_id = ? ORDER BY created_at DESC').all(req.session.merchantId);
    // Fetch central product images for each product
    for (const product of products) {
        const central = db.prepare('SELECT default_image FROM central_products WHERE barcode = ?').get(product.barcode);
        if (central && central.default_image) {
            product.central_image = central.default_image;
        }
    }
    res.json(products);
});

app.put('/api/merchant/products/:id', upload.single('picture'), (req, res) => {
    if (!req.session.merchantId) return res.status(401).json({ error: 'Not logged in' });
    const { barcode, name, price } = req.body;
    const productId = req.params.id;
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND merchant_id = ?').get(productId, req.session.merchantId);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    let picture = product.picture;
    if (req.file) {
        picture = `/uploads/${req.file.filename}`;
        if (product.picture && fs.existsSync(path.join(__dirname, product.picture))) fs.unlinkSync(path.join(__dirname, product.picture));
    }
    db.prepare('UPDATE products SET barcode = ?, name = ?, price = ?, picture = ? WHERE id = ?').run(barcode, name, price, picture, productId);
    res.json({ success: true });
});

app.delete('/api/merchant/products/:id', (req, res) => {
    if (!req.session.merchantId) return res.status(401).json({ error: 'Not logged in' });
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND merchant_id = ?').get(req.params.id, req.session.merchantId);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (product.picture && fs.existsSync(path.join(__dirname, product.picture))) fs.unlinkSync(path.join(__dirname, product.picture));
    db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// Shop and Order API
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

app.get('/api/merchant/analytics', (req, res) => {
    if (!req.session.merchantId) return res.status(401).json({ error: 'Not logged in' });
    const merchantId = req.session.merchantId;
    const totalRevenue = db.prepare("SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE merchant_id = ? AND status != 'cancelled'").get(merchantId);
    const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders WHERE merchant_id = ?').get(merchantId);
    const todaySales = db.prepare(`SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE merchant_id = ? AND date(created_at) = date('now') AND status != 'cancelled'`).get(merchantId);
    const topProducts = db.prepare(`SELECT p.name, p.picture, COUNT(*) as times_ordered, SUM(o.total) as revenue FROM orders o CROSS JOIN json_each(o.items) as item JOIN products p ON p.id = json_extract(item.value, '$.id') WHERE o.merchant_id = ? AND o.status != 'cancelled' GROUP BY p.id ORDER BY revenue DESC LIMIT 5`).all(merchantId);
    const recentOrders = db.prepare(`SELECT o.*, c.phone as customer_phone FROM orders o JOIN customers c ON o.customer_id = c.id WHERE o.merchant_id = ? ORDER BY o.created_at DESC LIMIT 10`).all(merchantId);
    recentOrders.forEach(order => order.items = JSON.parse(order.items));
    res.json({ totalRevenue: totalRevenue.total, totalOrders: totalOrders.count, todaySales: todaySales.total, topProducts, recentOrders });
});

// Customer shopping API
app.get('/api/shop/:merchantId/products', (req, res) => {
    const merchant = db.prepare('SELECT id, shop_name FROM merchants WHERE id = ? AND status = "active"').get(req.params.merchantId);
    if (!merchant) return res.status(404).json({ error: 'Shop not found' });
    const products = db.prepare('SELECT * FROM products WHERE merchant_id = ? ORDER BY name').all(req.params.merchantId);
    // Add central product images
    for (const product of products) {
        const central = db.prepare('SELECT default_image FROM central_products WHERE barcode = ?').get(product.barcode);
        if (central && central.default_image) {
            product.central_image = central.default_image;
        }
    }
    res.json({ merchant, products });
});

app.get('/api/product/barcode/:barcode', (req, res) => {
    if (!req.session.customerId) return res.status(401).json({ error: 'Not logged in' });
    const product = db.prepare('SELECT * FROM products WHERE barcode = ? AND merchant_id IN (SELECT id FROM merchants WHERE status = "active")').get(req.params.barcode);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    // Add central product image
    const central = db.prepare('SELECT default_image FROM central_products WHERE barcode = ?').get(product.barcode);
    if (central && central.default_image) {
        product.central_image = central.default_image;
    }
    res.json(product);
});

app.post('/api/orders', (req, res) => {
    if (!req.session.customerId) return res.status(401).json({ error: 'Not logged in' });
    const { merchantId, items, total } = req.body;
    QRCode.toDataURL(JSON.stringify({ type: 'order', merchantId, customerId: req.session.customerId, timestamp: Date.now() }), (err, orderQr) => {
        if (err) return res.status(500).json({ error: 'Failed to generate QR code' });
        const result = db.prepare(`INSERT INTO orders (customer_id, merchant_id, items, total, status, order_qr) VALUES (?, ?, ?, ?, 'pending', ?)`).run(req.session.customerId, merchantId, JSON.stringify(items), total, orderQr);
        res.json({ success: true, orderId: result.lastInsertRowid, orderQr });
    });
});

app.get('/api/customer/orders', (req, res) => {
    if (!req.session.customerId) return res.status(401).json({ error: 'Not logged in' });
    const orders = db.prepare(`SELECT o.*, m.shop_name as merchant_name FROM orders o JOIN merchants m ON o.merchant_id = m.id WHERE o.customer_id = ? ORDER BY o.created_at DESC`).all(req.session.customerId);
    orders.forEach(order => order.items = JSON.parse(order.items));
    res.json(orders);
});

app.get('/api/orders/:id/status', (req, res) => {
    const order = db.prepare('SELECT status, order_qr FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ status: order.status, orderQr: order.order_qr });
});

// Debug route
app.get('/debug-check', (req, res) => {
    res.json({ customers: db.prepare("SELECT id, phone, email FROM customers").all(), merchants: db.prepare("SELECT id, shop_name, phone, status FROM merchants").all() });
});

// ==================== SERVER START ====================
app.listen(PORT, () => {
    console.log(`\n=================================`);
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`\nAccess URLs:`);
    console.log(`  Homepage:       http://localhost:${PORT}/`);
    console.log(`  Customer Login: http://localhost:${PORT}/customer-login`);
    console.log(`  Merchant Login: http://localhost:${PORT}/merchant-login`);
    console.log(`  Admin Login:    http://localhost:${PORT}/admin/login`);
    console.log(`  Admin Products: http://localhost:${PORT}/admin/products`);
    console.log(`\nTest Accounts:`);
    console.log(`  Customer: Phone: 0821234567, Password: 123456`);
    console.log(`  Merchant: Phone: 0821234568, Password: 123456`);
    console.log(`  Admin:    Email: admin@spazapay.com, Password: Admin@123`);
    console.log(`=================================\n`);
});