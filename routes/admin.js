const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');

// Dashboard stats
router.get('/stats', requireAdmin, (req, res) => {
    const db = req.app.get('db');
    
    try {
        // Total merchants
        const totalMerchants = db.prepare('SELECT COUNT(*) as count FROM merchants').get();
        
        // Total customers
        const totalCustomers = db.prepare('SELECT COUNT(*) as count FROM customers').get();
        
        // Total orders
        const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get();
        
        // Total revenue (all-time) - FIXED: use single quotes for string
        const totalRevenue = db.prepare("SELECT SUM(total) as total FROM orders WHERE status != 'cancelled'").get();
        
        // This month's revenue - FIXED: use single quotes for string
        const monthlyRevenue = db.prepare(`
            SELECT SUM(total) as total FROM orders 
            WHERE status != 'cancelled' 
            AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
        `).get();
        
        // New merchants this month
        const newMerchants = db.prepare(`
            SELECT COUNT(*) as count FROM merchants 
            WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
        `).get();
        
        // New customers this month
        const newCustomers = db.prepare(`
            SELECT COUNT(*) as count FROM customers 
            WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
        `).get();
        
        // Orders by status
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
        res.status(500).json({ error: 'Failed to load stats: ' + error.message });
    }
});

// Weekly merchant growth (last 12 weeks)
router.get('/merchant-growth', requireAdmin, (req, res) => {
    const db = req.app.get('db');
    
    try {
        const growth = db.prepare(`
            SELECT 
                strftime('%Y-W%W', created_at) as week,
                COUNT(*) as count,
                MIN(date(created_at)) as week_start
            FROM merchants
            WHERE created_at >= date('now', '-12 weeks')
            GROUP BY strftime('%Y-W%W', created_at)
            ORDER BY week_start ASC
        `).all();
        
        res.json(growth);
    } catch (error) {
        console.error('Merchant growth error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Platform revenue trend (last 30 days)
router.get('/revenue-trend', requireAdmin, (req, res) => {
    const db = req.app.get('db');
    
    try {
        const revenue = db.prepare(`
            SELECT 
                date(created_at) as day,
                COUNT(*) as order_count,
                SUM(total) as revenue
            FROM orders
            WHERE created_at >= date('now', '-30 days')
            AND status != 'cancelled'
            GROUP BY date(created_at)
            ORDER BY day ASC
        `).all();
        
        res.json(revenue);
    } catch (error) {
        console.error('Revenue trend error:', error);
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

// Low activity merchants (no products added)
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

// All merchants (with filters)
router.get('/merchants', requireAdmin, (req, res) => {
    const db = req.app.get('db');
    const { status, search } = req.query;
    
    try {
        let query = `
            SELECT 
                m.*,
                COUNT(DISTINCT p.id) as product_count,
                COUNT(DISTINCT o.id) as order_count,
                COALESCE(SUM(o.total), 0) as total_revenue
            FROM merchants m
            LEFT JOIN products p ON m.id = p.merchant_id
            LEFT JOIN orders o ON m.id = o.merchant_id AND o.status != 'cancelled'
        `;
        
        const params = [];
        
        if (status && status !== 'all') {
            query += ` WHERE m.status = ?`;
            params.push(status);
        }
        
        if (search) {
            query += params.length ? ` AND` : ` WHERE`;
            query += ` (m.shop_name LIKE ? OR m.phone LIKE ? OR m.email LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        
        query += ` GROUP BY m.id ORDER BY m.created_at DESC`;
        
        const merchants = db.prepare(query).all(...params);
        res.json(merchants);
    } catch (error) {
        console.error('All merchants error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Export all merchants to CSV
router.get('/export-merchants', requireAdmin, (req, res) => {
    const db = req.app.get('db');
    
    try {
        const merchants = db.prepare(`
            SELECT 
                m.id,
                m.shop_name,
                m.phone,
                m.email,
                m.shop_address,
                m.created_at,
                m.status,
                COUNT(DISTINCT p.id) as product_count,
                COUNT(DISTINCT o.id) as order_count,
                COALESCE(SUM(o.total), 0) as total_revenue
            FROM merchants m
            LEFT JOIN products p ON m.id = p.merchant_id
            LEFT JOIN orders o ON m.id = o.merchant_id AND o.status != 'cancelled'
            GROUP BY m.id
            ORDER BY m.created_at DESC
        `).all();
        
        // Create CSV
        const headers = ['ID', 'Shop Name', 'Phone', 'Email', 'Address', 'Signup Date', 'Status', 'Products', 'Orders', 'Total Revenue'];
        const rows = merchants.map(m => [
            m.id,
            `"${m.shop_name}"`, // Wrap in quotes to handle commas
            m.phone,
            m.email || '',
            `"${m.shop_address || ''}"`,
            m.created_at,
            m.status,
            m.product_count,
            m.order_count,
            m.total_revenue
        ]);
        
        const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=merchants_export.csv');
        res.send(csv);
    } catch (error) {
        console.error('Export merchants error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Export all orders (platform-wide)
router.get('/export-orders', requireAdmin, (req, res) => {
    const db = req.app.get('db');
    const { start_date, end_date } = req.query;
    
    try {
        let query = `
            SELECT 
                o.id,
                o.created_at as order_date,
                o.customer_id,
                c.phone as customer_phone,
                m.shop_name as merchant_name,
                o.items,
                o.total,
                o.status
            FROM orders o
            LEFT JOIN customers c ON o.customer_id = c.id
            LEFT JOIN merchants m ON o.merchant_id = m.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (start_date) {
            query += ` AND date(o.created_at) >= ?`;
            params.push(start_date);
        }
        
        if (end_date) {
            query += ` AND date(o.created_at) <= ?`;
            params.push(end_date);
        }
        
        query += ` ORDER BY o.created_at DESC`;
        
        const orders = db.prepare(query).all(...params);
        
        const headers = ['Order ID', 'Date', 'Customer ID', 'Customer Phone', 'Merchant', 'Items', 'Total', 'Status'];
        const rows = orders.map(o => [
            o.id,
            o.order_date,
            o.customer_id,
            o.customer_phone || 'N/A',
            `"${o.merchant_name || 'N/A'}"`,
            `"${o.items}"`,
            o.total,
            o.status
        ]);
        
        const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=platform_orders_export.csv');
        res.send(csv);
    } catch (error) {
        console.error('Export orders error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update merchant status (approve/suspend)
router.put('/merchants/:id/status', requireAdmin, (req, res) => {
    const db = req.app.get('db');
    const { status } = req.body;
    const merchantId = req.params.id;
    
    try {
        const update = db.prepare(`
            UPDATE merchants SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        
        update.run(status, req.session.adminId, merchantId);
        
        res.json({ success: true, status });
    } catch (error) {
        console.error('Update merchant status error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add a test endpoint to verify admin is working
router.get('/test', requireAdmin, (req, res) => {
    res.json({ 
        success: true, 
        message: 'Admin routes are working!',
        adminId: req.session.adminId,
        adminEmail: req.session.adminEmail
    });
});

module.exports = router;