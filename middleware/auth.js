const bcrypt = require('bcrypt');

// Admin authentication middleware
function requireAdmin(req, res, next) {
    console.log('Session check:', req.session); // Debug log
    if (!req.session || !req.session.adminId) {
        return res.status(401).json({ error: 'Admin access required. Please login first.' });
    }
    next();
}

// Admin login handler
async function adminLogin(req, res, db) {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }
    
    try {
        // Check if admins table exists first
        const tableCheck = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='admins'
        `).get();
        
        if (!tableCheck) {
            console.error('Admins table does not exist! Run migration first.');
            return res.status(500).json({ error: 'System not properly configured. Please contact support.' });
        }
        
        const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
        
        if (!admin) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const validPassword = await bcrypt.compare(password, admin.password_hash);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        req.session.adminId = admin.id;
        req.session.adminEmail = admin.email;
        req.session.adminRole = admin.role;
        
        res.json({ success: true, role: admin.role });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ error: 'Login failed. Please try again.' });
    }
}

function adminLogout(req, res) {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.json({ success: true });
    });
}

module.exports = { requireAdmin, adminLogin, adminLogout };