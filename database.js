// Add admins table
const createAdminsTable = db.prepare(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

createAdminsTable.run();

// Insert default admin (change password immediately after first login)
const defaultAdmin = db.prepare(`
  INSERT OR IGNORE INTO admins (email, password_hash) 
  VALUES (?, ?)
`);
// Password: Admin@123 (hash this properly - using bcrypt recommended)
defaultAdmin.run('admin@spazapay.com', '$2b$10$YourHashedPasswordHere');

// Add admin_id to merchants table to track who approved them (optional)
db.prepare(`ALTER TABLE merchants ADD COLUMN approved_by INTEGER`).run();
db.prepare(`ALTER TABLE merchants ADD COLUMN approved_at DATETIME`).run();
db.prepare(`ALTER TABLE merchants ADD COLUMN status TEXT DEFAULT 'pending'`).run();