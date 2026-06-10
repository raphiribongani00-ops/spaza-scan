const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'spaza.db');
const db = new Database(dbPath);

// Read and execute init.sql
const initSQL = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
db.exec(initSQL);

console.log('Database initialized at:', dbPath);

module.exports = db;