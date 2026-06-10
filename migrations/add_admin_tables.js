const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

// Connect to your existing database
const dbPath = path.join(__dirname, '..', 'database', 'spaza.db');
const db = new Database(dbPath);

console.log('Running admin tables migration...');

try {
    // Create admins table
    db.exec(`
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'admin',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✓ admins table created');

    // Add columns to merchants table (if they don't exist)
    try {
        db.exec(`ALTER TABLE merchants ADD COLUMN approved_by INTEGER`);
        console.log('✓ added approved_by column');
    } catch (e) {
        console.log('• approved_by column already exists');
    }
    
    try {
        db.exec(`ALTER TABLE merchants ADD COLUMN approved_at DATETIME`);
        console.log('✓ added approved_at column');
    } catch (e) {
        console.log('• approved_at column already exists');
    }
    
    try {
        db.exec(`ALTER TABLE merchants ADD COLUMN status TEXT DEFAULT 'pending'`);
        console.log('✓ added status column');
    } catch (e) {
        console.log('• status column already exists');
    }

    // Check if default admin exists
    const adminExists = db.prepare(`SELECT COUNT(*) as count FROM admins WHERE email = ?`).get('admin@spazapay.com');
    
    if (adminExists.count === 0) {
        // Hash the default password: Admin@123
        const hashedPassword = bcrypt.hashSync('Admin@123', 10);
        
        // Insert default admin
        db.prepare(`
            INSERT INTO admins (email, password_hash, role) 
            VALUES (?, ?, ?)
        `).run('admin@spazapay.com', hashedPassword, 'super_admin');
        
        console.log('✓ Default admin created: admin@spazapay.com / Admin@123');
    } else {
        console.log('• Default admin already exists');
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('You can now login at: http://localhost:3000/admin/login');
    console.log('Default credentials: admin@spazapay.com / Admin@123');
    
} catch (error) {
    console.error('❌ Migration failed:', error.message);
} finally {
    db.close();
}