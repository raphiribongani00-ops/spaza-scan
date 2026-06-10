const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

const dbPath = path.join(__dirname, 'database', 'spaza.db');
console.log('Database path:', dbPath);

try {
    const db = new Database(dbPath);
    
    // Enable foreign keys temporarily
    db.pragma('foreign_keys = OFF');
    
    console.log('Connected to database');
    
    // Hash passwords
    const customerPassword = bcrypt.hashSync('123456', 10);
    const merchantPassword = bcrypt.hashSync('123456', 10);
    
    // Check existing data
    const existingCustomers = db.prepare("SELECT * FROM customers").all();
    const existingMerchants = db.prepare("SELECT * FROM merchants").all();
    const existingOrders = db.prepare("SELECT * FROM orders").all();
    const existingProducts = db.prepare("SELECT * FROM products").all();
    
    console.log('Existing customers:', existingCustomers.length);
    console.log('Existing merchants:', existingMerchants.length);
    console.log('Existing orders:', existingOrders.length);
    console.log('Existing products:', existingProducts.length);
    
    // Delete orders first (they reference customers and merchants)
    console.log('\nCleaning up existing data...');
    db.prepare("DELETE FROM orders").run();
    console.log('  - Deleted all orders');
    
    // Delete products (they reference merchants)
    db.prepare("DELETE FROM products").run();
    console.log('  - Deleted all products');
    
    // Now delete customers and merchants
    db.prepare("DELETE FROM customers").run();
    db.prepare("DELETE FROM merchants").run();
    console.log('  - Deleted all customers and merchants');
    
    // Create test customer
    console.log('\nCreating test customer...');
    const insertCustomer = db.prepare(`
        INSERT INTO customers (phone, email, password, created_at) 
        VALUES (?, ?, ?, datetime('now'))
    `);
    insertCustomer.run('0821234567', 'test@customer.com', customerPassword);
    console.log('✓ Test customer created:');
    console.log('  Phone: 0821234567');
    console.log('  Password: 123456');
    
    // Create test merchant with ALL required fields
    console.log('\nCreating test merchant...');
    const insertMerchant = db.prepare(`
        INSERT INTO merchants (
            shop_name, 
            phone, 
            email, 
            password, 
            shop_address, 
            owner_address,
            banking_details,
            status, 
            created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))
    `);
    insertMerchant.run(
        'Test Spaza Shop',
        '0821234568',
        'test@merchant.com',
        merchantPassword,
        '123 Test Street, Cape Town',
        '456 Owner Address, Cape Town',  // owner_address is required
        'Bank: Test Bank, Acc: 123456789', // banking_details
    );
    console.log('✓ Test merchant created:');
    console.log('  Phone: 0821234568');
    console.log('  Password: 123456');
    console.log('  Status: active');
    
    // Verify they were created
    const customer = db.prepare("SELECT * FROM customers WHERE phone = '0821234567'").get();
    const merchant = db.prepare("SELECT * FROM merchants WHERE phone = '0821234568'").get();
    
    console.log('\n=================================');
    console.log('Verification:');
    console.log('=================================');
    
    if (customer) {
        console.log('✓ Customer verified in database');
        console.log('  ID:', customer.id);
        console.log('  Phone:', customer.phone);
        console.log('  Email:', customer.email);
    } else {
        console.log('✗ Customer not found in database');
    }
    
    if (merchant) {
        console.log('✓ Merchant verified in database');
        console.log('  ID:', merchant.id);
        console.log('  Shop Name:', merchant.shop_name);
        console.log('  Phone:', merchant.phone);
        console.log('  Status:', merchant.status);
        console.log('  Owner Address:', merchant.owner_address);
    } else {
        console.log('✗ Merchant not found in database');
    }
    
    // Re-enable foreign keys
    db.pragma('foreign_keys = ON');
    
    console.log('\n=================================');
    console.log('✅ Test Accounts Created Successfully!');
    console.log('=================================');
    console.log('📱 Customer Login:');
    console.log('   Phone: 0821234567');
    console.log('   Password: 123456');
    console.log('\n🏪 Merchant Login:');
    console.log('   Phone: 0821234568');
    console.log('   Password: 123456');
    console.log('=================================');
    
    db.close();
    
} catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
}