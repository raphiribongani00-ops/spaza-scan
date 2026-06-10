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

    // Products table
    db.exec(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            barcode TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            price DECIMAL(10,2) NOT NULL,
            picture TEXT,
            merchant_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (merchant_id) REFERENCES merchants(id)
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

    // Ensure test merchant exists and is active with all required fields
    const testMerchant = db.prepare("SELECT * FROM merchants WHERE phone = '0821234568'").get();
    if (!testMerchant) {
        const testPassword = bcrypt.hashSync('123456', 10);
        db.prepare(`
            INSERT INTO merchants (
                shop_name, 
                phone, 
                email, 
                password, 
                shop_address, 
                owner_address, 
                banking_details, 
                status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
        `).run(
            'Test Spaza Shop', 
            '0821234568', 
            'test@merchant.com', 
            testPassword, 
            '123 Test Street, Cape Town',
            '456 Owner Address, Cape Town',
            'Bank: Test Bank, Acc: 123456789'
        );
        console.log('Test merchant created: Phone: 0821234568, Password: 123456');
    } else if (testMerchant.status !== 'active') {
        db.prepare("UPDATE merchants SET status = 'active' WHERE phone = '0821234568'").run();
        console.log('Test merchant activated');
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
    secret: 'spaza-scan-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 1000 * 60 * 60 * 24
    }
}));

// Multer configuration for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// ==================== FRONTEND ROUTES ====================

// Homepage
app.get('/', (req, res) => {
    res.render('index', { title: 'SpazaScan' });
});

// Customer routes
app.get('/customer-login', (req, res) => {
    res.render('login', { title: 'Customer Login' });
});

app.get('/customer-signup', (req, res) => {
    res.render('signup', { title: 'Customer Signup' });
});

app.get('/customer-dashboard', (req, res) => {
    if (!req.session.customerId) {
        return res.redirect('/customer-login');
    }
    res.render('dashboard', { title: 'Customer Dashboard' });
});

app.get('/order-history', (req, res) => {
    if (!req.session.customerId) {
        return res.redirect('/customer-login');
    }
    res.render('order-history', { title: 'Order History' });
});

// Merchant routes
app.get('/merchant-login', (req, res) => {
    res.render('merchant-login', { title: 'Merchant Login' });
});

app.get('/merchant-signup', (req, res) => {
    res.render('merchant-signup', { title: 'Merchant Signup' });
});

app.get('/merchant-dashboard', (req, res) => {
    if (!req.session.merchantId) {
        return res.redirect('/merchant-login');
    }
    
    const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(req.session.merchantId);
    const productCount = db.prepare('SELECT COUNT(*) as count FROM products WHERE merchant_id = ?').get(req.session.merchantId);
    const pendingOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE merchant_id = ? AND status = 'pending'").get(req.session.merchantId);
    const totalRevenue = db.prepare("SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE merchant_id = ? AND status != 'cancelled'").get(req.session.merchantId);
    
    res.render('merchant-dashboard', { 
        title: 'Merchant Dashboard',
        merchant: merchant,
        shop_name: merchant.shop_name,
        productCount: productCount.count,
        pendingOrders: pendingOrders.count,
        totalRevenue: totalRevenue.total
    });
});

app.get('/merchant-products', (req, res) => {
    if (!req.session.merchantId) {
        return res.redirect('/merchant-login');
    }
    
    const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(req.session.merchantId);
    res.render('merchant-products', { 
        title: 'Manage Products',
        shop_name: merchant.shop_name,
        merchantId: req.session.merchantId
    });
});

app.get('/merchant-product-edit', (req, res) => {
    if (!req.session.merchantId) {
        return res.redirect('/merchant-login');
    }
    
    const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(req.session.merchantId);
    res.render('merchant-product-edit', { 
        title: 'Edit Product',
        shop_name: merchant.shop_name,
        merchantId: req.session.merchantId,
        productId: req.query.id 
    });
});

app.get('/merchant-verify', (req, res) => {
    if (!req.session.merchantId) {
        return res.redirect('/merchant-login');
    }
    
    const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(req.session.merchantId);
    res.render('merchant-verify', { 
        title: 'Verify Orders',
        shop_name: merchant.shop_name,
        merchantId: req.session.merchantId
    });
});

app.get('/merchant-shop-qr', (req, res) => {
    if (!req.session.merchantId) {
        return res.redirect('/merchant-login');
    }
    
    const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(req.session.merchantId);
    res.render('merchant-shop-qr', { 
        title: 'Shop QR Code',
        shop_name: merchant.shop_name,
        merchantId: req.session.merchantId
    });
});

app.get('/merchant-analytics', (req, res) => {
    if (!req.session.merchantId) {
        return res.redirect('/merchant-login');
    }
    
    const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(req.session.merchantId);
    res.render('merchant-analytics', { 
        title: 'Analytics',
        shop_name: merchant.shop_name,
        merchantId: req.session.merchantId
    });
});

// Scanner route
app.get('/scanner', (req, res) => {
    res.render('scanner', { title: 'Scan Barcode' });
});

// ==================== FORM POST HANDLERS ====================

// Handle customer login form submission
app.post('/login', (req, res) => {
    const { phone, password } = req.body;
    
    console.log('Customer login attempt for phone:', phone);
    
    try {
        const customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
        
        if (!customer) {
            console.log('Customer not found:', phone);
            return res.send('<script>alert("Customer not found. Please sign up first."); window.location.href="/customer-login";</script>');
        }
        
        const validPassword = bcrypt.compareSync(password, customer.password);
        console.log('Password valid:', validPassword);
        
        if (!validPassword) {
            console.log('Invalid password for:', phone);
            return res.send('<script>alert("Invalid password. Please try again."); window.location.href="/customer-login";</script>');
        }
        
        req.session.customerId = customer.id;
        req.session.customerPhone = customer.phone;
        
        console.log('Customer login successful, redirecting to dashboard');
        res.redirect('/customer-dashboard');
    } catch (error) {
        console.error('Login error:', error);
        res.send('<script>alert("Login error: ' + error.message + '"); window.location.href="/customer-login";</script>');
    }
});

// Handle customer signup form submission
app.post('/signup', (req, res) => {
    const { phone, email, password } = req.body;
    
    console.log('Customer signup attempt for phone:', phone);
    
    try {
        const hashedPassword = bcrypt.hashSync(password, 10);
        const stmt = db.prepare('INSERT INTO customers (phone, email, password) VALUES (?, ?, ?)');
        stmt.run(phone, email, hashedPassword);
        console.log('Customer created successfully:', phone);
        res.send('<script>alert("Account created successfully! Please login."); window.location.href="/customer-login";</script>');
    } catch (error) {
        console.error('Signup error:', error);
        if (error.message.includes('UNIQUE')) {
            res.send('<script>alert("Phone number already registered"); window.location.href="/customer-signup";</script>');
        } else {
            res.send('<script>alert("Error creating account: ' + error.message + '"); window.location.href="/customer-signup";</script>');
        }
    }
});

// Handle merchant login form submission
app.post('/merchant-login', (req, res) => {
    const { phone, password } = req.body;
    
    console.log('Merchant login attempt for phone:', phone);
    
    try {
        const merchant = db.prepare('SELECT * FROM merchants WHERE phone = ?').get(phone);
        
        if (!merchant) {
            console.log('Merchant not found:', phone);
            return res.send('<script>alert("Merchant not found. Please sign up first."); window.location.href="/merchant-login";</script>');
        }
        
        const validPassword = bcrypt.compareSync(password, merchant.password);
        console.log('Password valid:', validPassword);
        console.log('Merchant status:', merchant.status);
        
        if (!validPassword) {
            console.log('Invalid password for:', phone);
            return res.send('<script>alert("Invalid password. Please try again."); window.location.href="/merchant-login";</script>');
        }
        
        if (merchant.status !== 'active') {
            console.log('Merchant not active. Status:', merchant.status);
            return res.send('<script>alert("Account pending approval. Please wait for admin approval."); window.location.href="/merchant-login";</script>');
        }
        
        req.session.merchantId = merchant.id;
        req.session.merchantName = merchant.shop_name;
        
        console.log('Merchant login successful, redirecting to dashboard');
        res.redirect('/merchant-dashboard');
    } catch (error) {
        console.error('Merchant login error:', error);
        res.send('<script>alert("Login error: ' + error.message + '"); window.location.href="/merchant-login";</script>');
    }
});

// Handle merchant signup form submission
app.post('/merchant-signup', (req, res) => {
    const { shop_name, phone, email, password, shop_address, owner_address, banking_details } = req.body;
    
    console.log('Merchant signup attempt for phone:', phone);
    
    try {
        const hashedPassword = bcrypt.hashSync(password, 10);
        const stmt = db.prepare(`
            INSERT INTO merchants (shop_name, phone, email, password, shop_address, owner_address, banking_details, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
        `);
        stmt.run(shop_name, phone, email, hashedPassword, shop_address, owner_address, banking_details);
        console.log('Merchant created successfully:', phone);
        res.send('<script>alert("Registration successful! Your account is pending admin approval."); window.location.href="/merchant-login";</script>');
    } catch (error) {
        console.error('Merchant signup error:', error);
        if (error.message.includes('UNIQUE')) {
            res.send('<script>alert("Phone number already registered"); window.location.href="/merchant-signup";</script>');
        } else {
            res.send('<script>alert("Error creating account: ' + error.message + '"); window.location.href="/merchant-signup";</script>');
        }
    }
});

// Handle logout
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// ==================== ADMIN ROUTES ====================
app.post('/admin/login', (req, res) => adminLogin(req, res, db));
app.post('/admin/logout', adminLogout);
app.use('/admin', adminRoutes);

// Serve admin pages
app.get('/admin/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/admin/login.html'));
});

app.get('/admin/dashboard', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public/admin/dashboard.html'));
});

// ==================== API ROUTES ====================

// Customer API
app.post('/api/customer/signup', (req, res) => {
    const { phone, email, password } = req.body;
    
    try {
        const hashedPassword = bcrypt.hashSync(password, 10);
        const stmt = db.prepare('INSERT INTO customers (phone, email, password) VALUES (?, ?, ?)');
        stmt.run(phone, email, hashedPassword);
        res.json({ success: true, message: 'Account created successfully' });
    } catch (error) {
        if (error.message.includes('UNIQUE')) {
            res.status(400).json({ error: 'Phone number already registered' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

app.post('/api/customer/login', (req, res) => {
    const { phone, password } = req.body;
    
    const customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
    
    if (!customer) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const validPassword = bcrypt.compareSync(password, customer.password);
    
    if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    req.session.customerId = customer.id;
    req.session.customerPhone = customer.phone;
    
    res.json({ success: true, customer: { id: customer.id, phone: customer.phone, email: customer.email } });
});

app.post('/api/customer/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/customer/me', (req, res) => {
    if (!req.session.customerId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const customer = db.prepare('SELECT id, phone, email, saved_card FROM customers WHERE id = ?').get(req.session.customerId);
    res.json(customer);
});

// Merchant API
app.post('/api/merchant/signup', (req, res) => {
    const { shop_name, phone, email, password, shop_address, owner_address, banking_details } = req.body;
    
    try {
        const hashedPassword = bcrypt.hashSync(password, 10);
        const stmt = db.prepare(`
            INSERT INTO merchants (shop_name, phone, email, password, shop_address, owner_address, banking_details, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
        `);
        stmt.run(shop_name, phone, email, hashedPassword, shop_address, owner_address, banking_details);
        res.json({ success: true, message: 'Merchant account created, pending approval' });
    } catch (error) {
        if (error.message.includes('UNIQUE')) {
            res.status(400).json({ error: 'Phone number already registered' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

app.post('/api/merchant/login', (req, res) => {
    const { phone, password } = req.body;
    
    const merchant = db.prepare('SELECT * FROM merchants WHERE phone = ?').get(phone);
    
    if (!merchant) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const validPassword = bcrypt.compareSync(password, merchant.password);
    
    if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    if (merchant.status !== 'active') {
        return res.status(401).json({ error: 'Account pending approval or suspended' });
    }
    
    req.session.merchantId = merchant.id;
    req.session.merchantName = merchant.shop_name;
    
    res.json({ success: true, merchant: { id: merchant.id, shop_name: merchant.shop_name, phone: merchant.phone } });
});

app.post('/api/merchant/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/merchant/me', (req, res) => {
    if (!req.session.merchantId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const merchant = db.prepare('SELECT id, shop_name, phone, email, shop_address, owner_address, banking_details, status FROM merchants WHERE id = ?').get(req.session.merchantId);
    res.json(merchant);
});

// Product API
app.post('/api/merchant/products', upload.single('picture'), (req, res) => {
    if (!req.session.merchantId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { barcode, name, price } = req.body;
    const picture = req.file ? `/uploads/${req.file.filename}` : null;
    
    try {
        const stmt = db.prepare('INSERT INTO products (barcode, name, price, picture, merchant_id) VALUES (?, ?, ?, ?, ?)');
        stmt.run(barcode, name, price, picture, req.session.merchantId);
        res.json({ success: true, message: 'Product added successfully' });
    } catch (error) {
        if (error.message.includes('UNIQUE')) {
            res.status(400).json({ error: 'Product with this barcode already exists' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

app.get('/api/merchant/products', (req, res) => {
    if (!req.session.merchantId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const products = db.prepare('SELECT * FROM products WHERE merchant_id = ? ORDER BY created_at DESC').all(req.session.merchantId);
    res.json(products);
});

app.put('/api/merchant/products/:id', upload.single('picture'), (req, res) => {
    if (!req.session.merchantId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { barcode, name, price } = req.body;
    const productId = req.params.id;
    
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND merchant_id = ?').get(productId, req.session.merchantId);
    if (!product) {
        return res.status(404).json({ error: 'Product not found' });
    }
    
    let picture = product.picture;
    if (req.file) {
        picture = `/uploads/${req.file.filename}`;
        if (product.picture) {
            const oldPath = path.join(__dirname, product.picture);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
    }
    
    const stmt = db.prepare('UPDATE products SET barcode = ?, name = ?, price = ?, picture = ? WHERE id = ?');
    stmt.run(barcode, name, price, picture, productId);
    res.json({ success: true, message: 'Product updated successfully' });
});

app.delete('/api/merchant/products/:id', (req, res) => {
    if (!req.session.merchantId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const productId = req.params.id;
    
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND merchant_id = ?').get(productId, req.session.merchantId);
    if (!product) {
        return res.status(404).json({ error: 'Product not found' });
    }
    
    if (product.picture) {
        const oldPath = path.join(__dirname, product.picture);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    
    const stmt = db.prepare('DELETE FROM products WHERE id = ?');
    stmt.run(productId);
    res.json({ success: true, message: 'Product deleted successfully' });
});

// Shop and Order API
app.get('/api/merchant/shop-qr', (req, res) => {
    if (!req.session.merchantId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const merchant = db.prepare('SELECT id, shop_name FROM merchants WHERE id = ?').get(req.session.merchantId);
    const qrData = JSON.stringify({
        type: 'shop',
        merchantId: merchant.id,
        shopName: merchant.shop_name
    });
    
    QRCode.toDataURL(qrData, (err, url) => {
        if (err) {
            res.status(500).json({ error: 'Failed to generate QR code' });
        } else {
            res.json({ qrCode: url });
        }
    });
});

app.get('/api/merchant/orders', (req, res) => {
    if (!req.session.merchantId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const orders = db.prepare(`
        SELECT o.*, c.phone as customer_phone 
        FROM orders o
        JOIN customers c ON o.customer_id = c.id
        WHERE o.merchant_id = ? 
        ORDER BY o.created_at DESC
    `).all(req.session.merchantId);
    
    orders.forEach(order => {
        order.items = JSON.parse(order.items);
    });
    
    res.json(orders);
});

app.put('/api/merchant/orders/:id/release', (req, res) => {
    if (!req.session.merchantId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const orderId = req.params.id;
    
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND merchant_id = ?').get(orderId, req.session.merchantId);
    if (!order) {
        return res.status(404).json({ error: 'Order not found' });
    }
    
    const stmt = db.prepare("UPDATE orders SET status = 'completed' WHERE id = ?");
    stmt.run(orderId);
    res.json({ success: true, message: 'Order marked as completed' });
});

app.get('/api/merchant/analytics', (req, res) => {
    if (!req.session.merchantId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const merchantId = req.session.merchantId;
    
    const totalRevenue = db.prepare("SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE merchant_id = ? AND status != 'cancelled'").get(merchantId);
    const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders WHERE merchant_id = ?').get(merchantId);
    const todaySales = db.prepare(`
        SELECT COALESCE(SUM(total), 0) as total 
        FROM orders 
        WHERE merchant_id = ? 
        AND date(created_at) = date('now')
        AND status != 'cancelled'
    `).get(merchantId);
    
    const topProducts = db.prepare(`
        SELECT 
            p.name,
            p.picture,
            COUNT(*) as times_ordered,
            SUM(o.total) as revenue
        FROM orders o
        CROSS JOIN json_each(o.items) as item
        JOIN products p ON p.id = json_extract(item.value, '$.id')
        WHERE o.merchant_id = ? AND o.status != 'cancelled'
        GROUP BY p.id
        ORDER BY revenue DESC
        LIMIT 5
    `).all(merchantId);
    
    const dailySales = db.prepare(`
        SELECT 
            date(created_at) as day,
            COALESCE(SUM(total), 0) as total
        FROM orders
        WHERE merchant_id = ? 
        AND status != 'cancelled'
        AND created_at >= date('now', '-7 days')
        GROUP BY date(created_at)
        ORDER BY day DESC
    `).all(merchantId);
    
    const recentOrders = db.prepare(`
        SELECT o.*, c.phone as customer_phone
        FROM orders o
        JOIN customers c ON o.customer_id = c.id
        WHERE o.merchant_id = ?
        ORDER BY o.created_at DESC
        LIMIT 10
    `).all(merchantId);
    
    recentOrders.forEach(order => {
        order.items = JSON.parse(order.items);
    });
    
    res.json({
        totalRevenue: totalRevenue.total,
        totalOrders: totalOrders.count,
        todaySales: todaySales.total,
        topProducts,
        dailySales,
        recentOrders
    });
});

// Customer shopping API
app.get('/api/shop/:merchantId/products', (req, res) => {
    const merchantId = req.params.merchantId;
    
    const merchant = db.prepare('SELECT id, shop_name FROM merchants WHERE id = ? AND status = "active"').get(merchantId);
    if (!merchant) {
        return res.status(404).json({ error: 'Shop not found' });
    }
    
    const products = db.prepare('SELECT * FROM products WHERE merchant_id = ? ORDER BY name').all(merchantId);
    res.json({ merchant, products });
});

app.get('/api/product/barcode/:barcode', (req, res) => {
    const barcode = req.params.barcode;
    
    const product = db.prepare('SELECT * FROM products WHERE barcode = ?').get(barcode);
    if (!product) {
        return res.status(404).json({ error: 'Product not found' });
    }
    
    res.json(product);
});

app.post('/api/orders', (req, res) => {
    if (!req.session.customerId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const { merchantId, items, total } = req.body;
    
    const orderData = JSON.stringify({
        type: 'order',
        merchantId,
        customerId: req.session.customerId,
        timestamp: Date.now()
    });
    
    QRCode.toDataURL(orderData, (err, orderQr) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to generate QR code' });
        }
        
        const stmt = db.prepare(`
            INSERT INTO orders (customer_id, merchant_id, items, total, status, order_qr) 
            VALUES (?, ?, ?, ?, 'pending', ?)
        `);
        
        const result = stmt.run(req.session.customerId, merchantId, JSON.stringify(items), total, orderQr);
        
        res.json({ 
            success: true, 
            orderId: result.lastInsertRowid,
            orderQr
        });
    });
});

app.get('/api/customer/orders', (req, res) => {
    if (!req.session.customerId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    
    const orders = db.prepare(`
        SELECT o.*, m.shop_name as merchant_name
        FROM orders o
        JOIN merchants m ON o.merchant_id = m.id
        WHERE o.customer_id = ? 
        ORDER BY o.created_at DESC
    `).all(req.session.customerId);
    
    orders.forEach(order => {
        order.items = JSON.parse(order.items);
    });
    
    res.json(orders);
});

app.get('/api/orders/:id/status', (req, res) => {
    const orderId = req.params.id;
    
    const order = db.prepare('SELECT status, order_qr FROM orders WHERE id = ?').get(orderId);
    if (!order) {
        return res.status(404).json({ error: 'Order not found' });
    }
    
    res.json({ status: order.status, orderQr: order.order_qr });
});

// Debug route - check database contents
app.get('/debug-check', (req, res) => {
    const customers = db.prepare("SELECT id, phone, email FROM customers").all();
    const merchants = db.prepare("SELECT id, shop_name, phone, status FROM merchants").all();
    
    res.json({
        customers: customers,
        merchants: merchants,
        session: req.session
    });
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
    console.log(`\nTest Accounts:`);
    console.log(`  Customer: Phone: 0821234567, Password: 123456`);
    console.log(`  Merchant: Phone: 0821234568, Password: 123456`);
    console.log(`  Admin:    Email: admin@spazapay.com, Password: Admin@123`);
    console.log(`=================================\n`);
});