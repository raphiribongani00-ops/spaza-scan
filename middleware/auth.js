const bcrypt = require('bcrypt');

// Admin authentication middleware
function requireAdmin(req, res, next) {
    if (!req.session || !req.session.adminId) {
        return res.status(401).json({ error: 'Admin access required. Please login first.' });
    }
    next();
}

// Admin login handler
async function adminLogin(req, res, db) {
    const { email, password } = req.body;
    
    try {
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
        res.status(500).json({ error: 'Login failed' });
    }
}

function adminLogout(req, res) {
    req.session.destroy();
    res.json({ success: true });
}

module.exports = { requireAdmin, adminLogin, adminLogout };