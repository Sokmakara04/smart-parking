const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const initSqlJs = require("sql.js");
const bcrypt = require("bcryptjs");

const isVercel = process.env.VERCEL === "1" || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
const bundledDbPath = path.resolve(__dirname, "..", "database", "smart_parking.sqlite");
const dbFilePath = isVercel ? path.join(os.tmpdir(), "smart_parking.sqlite") : bundledDbPath;

const localWasmPath = path.resolve(__dirname, "..", "database", "sql-wasm.wasm");
const nmWasmPath = path.resolve(__dirname, "..", "node_modules", "sql.js", "dist", "sql-wasm.wasm");
const wasmPath = fs.existsSync(localWasmPath) ? localWasmPath : nmWasmPath;

let dbInstance = null;
let saveTimeout = null;

const persistDatabase = () => {
    if (!dbInstance) return;
    try {
        const dir = path.dirname(dbFilePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const data = dbInstance.export();
        fs.writeFileSync(dbFilePath, Buffer.from(data));
    } catch (err) {
        console.error("Failed to persist SQLite database:", err.message);
    }
};

const schedulePersist = () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(persistDatabase, 150);
};

const getSqliteDb = async () => {
    if (dbInstance) {
        return dbInstance;
    }

    const SQL = await initSqlJs({
        locateFile: (file) => (file.endsWith(".wasm") ? wasmPath : file)
    });

    let fileBuffer = null;
    if (fs.existsSync(dbFilePath)) {
        try {
            fileBuffer = fs.readFileSync(dbFilePath);
        } catch (err) {
            console.warn("Could not read SQLite file from", dbFilePath, err.message);
        }
    } else if (isVercel && fs.existsSync(bundledDbPath)) {
        try {
            const dir = path.dirname(dbFilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fileBuffer = fs.readFileSync(bundledDbPath);
            fs.writeFileSync(dbFilePath, fileBuffer);
        } catch (err) {
            console.warn("Could not copy bundled SQLite database to temp dir:", err.message);
        }
    }

    dbInstance = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();

    // Custom SQL functions
    dbInstance.create_function("NOW", () => {
        return new Date().toISOString().slice(0, 19).replace("T", " ");
    });

    return dbInstance;
};

const initializeSqliteDatabase = async () => {
    const db = await getSqliteDb();

    // Enable foreign keys
    db.run("PRAGMA foreign_keys = ON;");

    // Core tables
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            phone TEXT,
            username TEXT UNIQUE,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'customer',
            status TEXT NOT NULL DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS customers (
            customer_id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            phone TEXT,
            address TEXT,
            vehicle_info TEXT,
            status TEXT NOT NULL DEFAULT 'Active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS staff (
            staff_id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            phone TEXT,
            position TEXT,
            username TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS parking_slots (
            slot_id INTEGER PRIMARY KEY AUTOINCREMENT,
            slot_number TEXT NOT NULL UNIQUE,
            floor TEXT NOT NULL DEFAULT 'Ground Floor',
            vehicle_type TEXT NOT NULL DEFAULT 'Car',
            status TEXT NOT NULL DEFAULT 'Available',
            price REAL NOT NULL DEFAULT 0.00,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS contracts (
            contract_id TEXT NOT NULL PRIMARY KEY,
            customer_id INTEGER NOT NULL,
            slot_id INTEGER NOT NULL,
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            monthly_price REAL NOT NULL DEFAULT 0.00,
            status TEXT NOT NULL DEFAULT 'Active',
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS payments (
            payment_id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER,
            contract_id TEXT,
            amount REAL NOT NULL,
            payment_method TEXT NOT NULL DEFAULT 'Cash',
            payment_status TEXT NOT NULL DEFAULT 'Paid',
            payment_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            reference TEXT,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS settings (
            setting_id INTEGER PRIMARY KEY AUTOINCREMENT,
            setting_group TEXT NOT NULL DEFAULT 'System',
            setting_key TEXT NOT NULL,
            setting_value TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(setting_group, setting_key)
        );

        CREATE TABLE IF NOT EXISTS parking_records (
            record_id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_name TEXT,
            plate_number TEXT,
            customer_id INTEGER,
            vip_card_id INTEGER,
            store_id TEXT,
            card_id TEXT,
            slot_number TEXT,
            check_in DATETIME NOT NULL,
            check_out DATETIME,
            status TEXT NOT NULL DEFAULT 'Active',
            amount REAL DEFAULT 0.00,
            payment_status TEXT NOT NULL DEFAULT 'Paid',
            payment_method TEXT NOT NULL DEFAULT 'Cash',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS support_tickets (
            ticket_id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_code TEXT NOT NULL UNIQUE,
            customer_name TEXT DEFAULT 'Walk-in Customer',
            issue TEXT NOT NULL,
            agent_name TEXT DEFAULT 'Auto Assigned',
            status TEXT NOT NULL DEFAULT 'Open',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS vip_cards (
            vip_card_id INTEGER PRIMARY KEY AUTOINCREMENT,
            store_id TEXT NOT NULL UNIQUE,
            card_id TEXT NOT NULL UNIQUE,
            customer_id INTEGER,
            guest_name TEXT NOT NULL,
            vehicle_info TEXT,
            status TEXT NOT NULL DEFAULT 'Active',
            parking_access TEXT NOT NULL DEFAULT 'ALLOWED',
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Seed default settings
    const defaultSettings = [
        ["Parking Rates", "Hourly Rate", "$2.00"],
        ["Parking Rates", "Daily Max", "$12.00"],
        ["Parking Rates", "Monthly Pass", "$85.00"],
        ["Parking Rates", "Lost Ticket", "$10.00"],
        ["System", "Currency", "USD"],
        ["System", "Time Zone", "GMT+7"]
    ];
    for (const [group, key, value] of defaultSettings) {
        db.run(
            `INSERT OR IGNORE INTO settings (setting_group, setting_key, setting_value) VALUES (?, ?, ?)`,
            [group, key, value]
        );
    }

    // Seed default slots
    const defaultSlots = [
        ["A-01", "Ground Floor", "Car", "Available", 2.00],
        ["A-02", "Ground Floor", "Car", "Available", 2.00],
        ["A-03", "Ground Floor", "Car", "Reserved", 2.00],
        ["B-01", "1st Floor", "Car", "Available", 2.00],
        ["B-02", "1st Floor", "Car", "Available", 2.00],
        ["C-01", "2nd Floor", "VIP", "Available", 0.00]
    ];
    for (const [num, floor, type, status, price] of defaultSlots) {
        db.run(
            `INSERT OR IGNORE INTO parking_slots (slot_number, floor, vehicle_type, status, price) VALUES (?, ?, ?, ?, ?)`,
            [num, floor, type, status, price]
        );
    }

    // Seed default admin user
    const defaultAdminEmail = "admin@smartparking.com";
    const defaultAdminPassword = "Password123!";
    const defaultAdminHash = bcrypt.hashSync(defaultAdminPassword, 10);
    const existingAdmins = executeSelect(
        db,
        "SELECT user_id FROM users WHERE email = ? OR username = ? LIMIT 1",
        [defaultAdminEmail, "admin"]
    );
    if (!existingAdmins.length) {
        db.run(
            `INSERT INTO users (full_name, email, phone, username, password, role, status) VALUES (?, ?, ?, ?, ?, ?, 'active')`,
            ["System Administrator", defaultAdminEmail, "+855 12 345 678", "admin", defaultAdminHash, "admin"]
        );
    }

    // Seed initial sample staff, customers, and records if empty
    const staffCount = executeSelect(db, "SELECT COUNT(*) as count FROM staff")[0]?.count || 0;
    if (staffCount === 0) {
        const staffHash = bcrypt.hashSync("Staff123!", 10);
        db.run(`INSERT INTO staff (full_name, email, phone, position, username, password, status) VALUES (?, ?, ?, ?, ?, ?, 'Active')`,
            ["Sok Dara", "dara@smartparking.com", "+855 12 111 222", "Attendant", "dara", staffHash]);
        db.run(`INSERT INTO staff (full_name, email, phone, position, username, password, status) VALUES (?, ?, ?, ?, ?, ?, 'Active')`,
            ["Chan Vichea", "vichea@smartparking.com", "+855 12 333 444", "Supervisor", "vichea", staffHash]);
    }

    const customerCount = executeSelect(db, "SELECT COUNT(*) as count FROM customers")[0]?.count || 0;
    if (customerCount === 0) {
        db.run(`INSERT INTO customers (full_name, email, phone, address, vehicle_info, status) VALUES (?, ?, ?, ?, ?, ?)`,
            ["John Doe", "john@example.com", "+855 99 888 777", "Phnom Penh", "2B-1234 (Camry)", "Active"]);
        db.run(`INSERT INTO customers (full_name, email, phone, address, vehicle_info, status) VALUES (?, ?, ?, ?, ?, ?)`,
            ["Alice Smith", "alice@example.com", "+855 98 777 666", "Siem Reap", "2C-5678 (Prius)", "Active"]);
    }

    persistDatabase();
    return true;
};

const executeSelect = (db, sql, params = []) => {
    const stmt = db.prepare(sql);
    if (params && params.length > 0) {
        stmt.bind(params);
    }
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
};

const query = async (sql, params = []) => {
    const db = await getSqliteDb();
    let cleanSql = String(sql || "").trim();

    // Translate ON DUPLICATE KEY UPDATE in settings
    if (/ON DUPLICATE KEY UPDATE/i.test(cleanSql)) {
        if (/INSERT INTO settings/i.test(cleanSql)) {
            cleanSql = `INSERT INTO settings (setting_group, setting_key, setting_value)
                        VALUES (?, ?, ?)
                        ON CONFLICT(setting_group, setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP`;
        } else if (/INSERT INTO parking_slots/i.test(cleanSql)) {
            cleanSql = cleanSql.replace(/ON DUPLICATE KEY UPDATE.*/is, "ON CONFLICT(slot_number) DO UPDATE SET updated_at = CURRENT_TIMESTAMP");
        } else {
            cleanSql = cleanSql.replace(/ON DUPLICATE KEY UPDATE.*/is, "");
        }
    }

    const isSelect = /^(SELECT|PRAGMA|SHOW|EXPLAIN)\b/i.test(cleanSql);

    if (isSelect) {
        const rows = executeSelect(db, cleanSql, params);
        return [rows, []];
    }

    // Mutation (INSERT, UPDATE, DELETE)
    db.run(cleanSql, params);
    const affectedRows = db.getRowsModified();

    let insertId = 0;
    if (/^INSERT\b/i.test(cleanSql)) {
        const idRows = executeSelect(db, "SELECT last_insert_rowid() AS id");
        insertId = idRows[0]?.id || 0;
    }

    schedulePersist();
    return [{ insertId, affectedRows }, []];
};

const sqlitePool = {
    query,
    execute: query,
    end: async () => {
        persistDatabase();
        if (dbInstance) {
            dbInstance.close();
            dbInstance = null;
        }
    }
};

const connectSqlite = async () => {
    await initializeSqliteDatabase();
    return sqlitePool;
};

module.exports = {
    connectSqlite,
    initializeSqliteDatabase,
    sqlitePool,
    persistDatabase
};
