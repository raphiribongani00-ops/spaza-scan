const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');

// Dashboard stats
router.get('/stats', requireAdmin, (req, res) => {
    const db = req.app.get('db');
    
    try {
        const totalMerchants = db.prepare('SELECT COUNT(*) as count FROM merchants').get();
        const totalCustomers = db.prepare('SELECT COUNT(*) as count FROM customers').get();
        const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get();
        const totalRevenue = db.prepare("SELECT SUM(total) as total FROM orders WHERE status != 'cancelled'").get();
        const monthlyRevenue = db.prepare(`
            SELECT SUM(total) as total FROM orders 
            WHERE status != 'cancelled' 
            AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
        `).get();
        const newMerchants = db.prepare(`
            SELECT COUNT(*) as count FROM merchants 
            WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
        `).get();
        const newCustomers = db.prepare(`
            SELECT COUNT(*) as count FROM customers 
            WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
        `).get();
        const ordersByStatus = db.prepare(`
            SELECT status, COUNT(*) as count FROM orders GROUP BY status
        `).all();
        
        res.json({
            totalMerchants: totalMerchants.count,
            totalCustomers: totalCustomers.count,
            totalOrders: totalOrders.count,
            totalRevenue: totalRevenue.total || 0,
            monthlyRevenue: monthlyRevenue.total || 0,
            newMerchants: newMerchants.count,
            newCustomers: newCustomers.count,
            ordersByStatus
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Top merchants by revenue
router.get('/top-merchants', requireAdmin, (req, res) => {
    const db = req.app.get('db');
    const limit = req.query.limit || 10;
    
    try {
        const merchants = db.prepare(`
            SELECT 
                m.id,
                m.shop_name,
                m.phone,
                m.email,
                COUNT(o.id) as total_orders,
                COALESCE(SUM(o.total), 0) as total_revenue,
                MAX(o.created_at) as last_order_date
            FROM merchants m
            LEFT JOIN orders o ON m.id = o.merchant_id AND o.status != 'cancelled'
            GROUP BY m.id
            ORDER BY total_revenue DESC
            LIMIT ?
        `).all(limit);
        
        res.json(merchants);
    } catch (error) {
        console.error('Top merchants error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Inactive merchants
router.get('/inactive-merchants', requireAdmin, (req, res) => {
    const db = req.app.get('db');
    
    try {
        const inactive = db.prepare(`
            SELECT 
                m.id,
                m.shop_name,
                m.phone,
                m.email,
                m.created_at,
                COUNT(p.id) as product_count,
                MAX(p.created_at) as last_product_added
            FROM merchants m
            LEFT JOIN products p ON m.id = p.merchant_id
            GROUP BY m.id
            HAVING product_count = 0 OR last_product_added < date('now', '-30 days')
            ORDER BY m.created_at DESC
        `).all();
        
        res.json(inactive);
    } catch (error) {
        console.error('Inactive merchants error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Export merchants to CSV
router.get('/export-merchants', requireAdmin, (req, res) => {
    const db = req.app.get('db');
    
    try {
        const merchants = db.prepare(`
            SELECT id, shop_name, phone, email, created_at, status
            FROM merchants ORDER BY created_at DESC
        `).all();
        
        const headers = ['ID', 'Shop Name', 'Phone', 'Email', 'Signup Date', 'Status'];
        const rows = merchants.map(m => [
            m.id,
            `"${m.shop_name}"`,
            m.phone,
            m.email || '',
            m.created_at,
            m.status
        ]);
        
        const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=merchants_export.csv');
        res.send(csv);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Export orders to CSV
router.get('/export-orders', requireAdmin, (req, res) => {
    const db = req.app.get('db');
    
    try {
        const orders = db.prepare(`
            SELECT o.id, o.created_at, o.customer_id, c.phone, m.shop_name, o.total, o.status
            FROM orders o
            LEFT JOIN customers c ON o.customer_id = c.id
            LEFT JOIN merchants m ON o.merchant_id = m.id
            ORDER BY o.created_at DESC
        `).all();
        
        const headers = ['Order ID', 'Date', 'Customer ID', 'Customer Phone', 'Merchant', 'Total', 'Status'];
        const rows = orders.map(o => [
            o.id,
            o.created_at,
            o.customer_id,
            o.phone || 'N/A',
            `"${o.shop_name || 'N/A'}"`,
            o.total,
            o.status
        ]);
        
        const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=orders_export.csv');
        res.send(csv);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Test endpoint
router.get('/test', requireAdmin, (req, res) => {
    res.json({ success: true, message: 'Admin routes working!' });
});

module.exports = router;