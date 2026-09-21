"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const isProduction = (process.env.NODE_ENV || "").toLowerCase() === "production" || process.env.VERCEL === "1";

const getEnvValue = (key, fallback = "") => {
    const value = process.env[key];
    if (typeof value === "string" && value.trim() !== "") {
        return value.trim();
    }
    return fallback;
};

const buildDbConfig = () => {
    const host = getEnvValue("DB_HOST", isProduction ? "" : "127.0.0.1");
    const port = Number(getEnvValue("DB_PORT", "3306"));
    const user = getEnvValue("DB_USER", isProduction ? "" : "root");
    const password = getEnvValue("DB_PASSWORD", "");
    const database = getEnvValue("DB_NAME", "smart_parking");

    if (isProduction && (!host || /localhost|127\.0\.0\.1/i.test(host))) {
        throw new Error("Production DB_HOST must be set to a non-local MySQL host.");
    }

    if (!host || !user || !database) {
        throw new Error("Missing required MySQL environment variables: DB_HOST, DB_USER, and DB_NAME. Fill them in .env before running the app.");
    }

    return {
        host,
        port,
        user,
        password,
        database,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        multipleStatements: true,
        charset: "utf8mb4"
    };
};

const dbConfig = buildDbConfig();

let pool = null;

const connect = async () => {
    if (pool) {
        return pool;
    }

    pool = mysql.createPool(dbConfig);
    const [rows] = await pool.query("SELECT 1 AS ok");
    if (!rows.length) {
        throw new Error("MySQL connection test failed.");
    }

    return pool;
};

const getExistingTables = async (connection) => {
    const [rows] = await connection.query("SHOW TABLES");
    return rows.map((row) => Object.values(row)[0]);
};

const ensureColumn = async (connection, tableName, columnName, columnDefinition) => {
    const [columns] = await connection.query(`SHOW COLUMNS FROM \`${tableName}\` LIKE ?`, [columnName]);
    if (columns.length === 0) {
        await connection.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${columnDefinition}`);
    }
};

const ensureCoreTables = async (connection) => {
    await connection.query(`
        CREATE TABLE IF NOT EXISTS users (
            user_id INT AUTO_INCREMENT PRIMARY KEY,
            full_name VARCHAR(150) NOT NULL,
            email VARCHAR(150) NOT NULL UNIQUE,
            phone VARCHAR(30) NULL,
            username VARCHAR(80) NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            role ENUM('admin', 'staff', 'customer') NOT NULL DEFAULT 'customer',
            status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_users_email (email),
            INDEX idx_users_username (username)
        )
    `);

    await connection.query(`
        CREATE TABLE IF NOT EXISTS customers (
            customer_id INT AUTO_INCREMENT PRIMARY KEY,
            full_name VARCHAR(150) NOT NULL,
            email VARCHAR(150) NOT NULL UNIQUE,
            phone VARCHAR(30) NULL,
            address VARCHAR(255) NULL,
            vehicle_info VARCHAR(255) NULL,
            status ENUM('Active', 'Pending', 'Inactive') NOT NULL DEFAULT 'Active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_customers_email (email)
        )
    `);

    await connection.query(`
        CREATE TABLE IF NOT EXISTS staff (
            staff_id INT AUTO_INCREMENT PRIMARY KEY,
            full_name VARCHAR(150) NOT NULL,
            email VARCHAR(150) NOT NULL UNIQUE,
            phone VARCHAR(30) NULL,
            position VARCHAR(80) NULL,
            username VARCHAR(80) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_staff_email (email),
            INDEX idx_staff_username (username)
        )
    `);

    await connection.query(`
        CREATE TABLE IF NOT EXISTS parking_slots (
            slot_id INT AUTO_INCREMENT PRIMARY KEY,
            slot_number VARCHAR(50) NOT NULL UNIQUE,
            floor VARCHAR(80) NOT NULL DEFAULT 'Ground Floor',
            vehicle_type VARCHAR(50) NOT NULL DEFAULT 'Car',
            status ENUM('Available', 'Occupied', 'Reserved', 'Maintenance') NOT NULL DEFAULT 'Available',
            price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_slots_status (status),
            INDEX idx_slots_floor (floor)
        )
    `);

    await connection.query(`
        CREATE TABLE IF NOT EXISTS contracts (
            contract_id VARCHAR(80) NOT NULL PRIMARY KEY,
            customer_id INT NOT NULL,
            slot_id INT NOT NULL,
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            monthly_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
            status ENUM('Active', 'Pending', 'Expired', 'Expiring') NOT NULL DEFAULT 'Active',
            notes TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT fk_contract_customer FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE,
            CONSTRAINT fk_contract_slot FOREIGN KEY (slot_id) REFERENCES parking_slots(slot_id) ON DELETE CASCADE,
            INDEX idx_contracts_customer (customer_id),
            INDEX idx_contracts_slot (slot_id),
            INDEX idx_contracts_status (status)
        )
    `);

    await connection.query(`
        CREATE TABLE IF NOT EXISTS payments (
            payment_id INT AUTO_INCREMENT PRIMARY KEY,
            customer_id INT NULL,
            contract_id VARCHAR(80) NULL,
            amount DECIMAL(10,2) NOT NULL,
            payment_method ENUM('Cash', 'ABA', 'Card', 'Bank Transfer', 'KHQR', 'Mobile Wallet') NOT NULL DEFAULT 'Cash',
            payment_status ENUM('Paid', 'Pending', 'Failed') NOT NULL DEFAULT 'Paid',
            payment_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            reference VARCHAR(120) NULL,
            notes TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT fk_payment_customer FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE SET NULL,
            CONSTRAINT fk_payment_contract FOREIGN KEY (contract_id) REFERENCES contracts(contract_id) ON DELETE SET NULL,
            INDEX idx_payments_customer (customer_id),
            INDEX idx_payments_contract (contract_id),
            INDEX idx_payments_status (payment_status)
        )
    `);

    await connection.query(`
        CREATE TABLE IF NOT EXISTS settings (
            setting_id INT AUTO_INCREMENT PRIMARY KEY,
            setting_group VARCHAR(80) NOT NULL DEFAULT 'System',
            setting_key VARCHAR(120) NOT NULL,
            setting_value VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY unique_setting (setting_group, setting_key),
            INDEX idx_settings_group (setting_group)
        )
    `);

    await connection.query(`
        CREATE TABLE IF NOT EXISTS parking_records (
            record_id INT AUTO_INCREMENT PRIMARY KEY,
            customer_name VARCHAR(150) NULL,
            plate_number VARCHAR(80) NULL,
            slot_number VARCHAR(80) NULL,
            check_in DATETIME NOT NULL,
            check_out DATETIME NULL,
            status ENUM('Active', 'Completed', 'Reserved') NOT NULL DEFAULT 'Active',
            amount DECIMAL(10,2) DEFAULT 0.00,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_records_plate (plate_number),
            INDEX idx_records_slot (slot_number),
            INDEX idx_records_status (status)
        )
    `);

    await connection.query(`
        CREATE TABLE IF NOT EXISTS support_tickets (
            ticket_id INT AUTO_INCREMENT PRIMARY KEY,
            ticket_code VARCHAR(80) NOT NULL UNIQUE,
            customer_name VARCHAR(150) DEFAULT 'Walk-in Customer',
            issue TEXT NOT NULL,
            agent_name VARCHAR(120) DEFAULT 'Auto Assigned',
            status ENUM('Open', 'Resolved', 'In Progress') NOT NULL DEFAULT 'Open',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_support_tickets_status (status),
            INDEX idx_support_tickets_customer (customer_name)
        )
    `);
};

const ensureVipCardsTable = async (connection) => {
    await connection.query(`
        CREATE TABLE IF NOT EXISTS vip_cards (
            vip_card_id INT AUTO_INCREMENT PRIMARY KEY,
            store_id VARCHAR(80) NOT NULL UNIQUE,
            card_id VARCHAR(80) NOT NULL UNIQUE,
            customer_id INT NULL,
            guest_name VARCHAR(150) NOT NULL,
            vehicle_info VARCHAR(120) NULL,
            status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
            parking_access ENUM('ALLOWED', 'DENIED') NOT NULL DEFAULT 'ALLOWED',
            notes TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT fk_vip_card_customer FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE SET NULL,
            INDEX idx_vip_cards_store_id (store_id),
            INDEX idx_vip_cards_card_id (card_id),
            INDEX idx_vip_cards_status (status)
        )
    `);
};

const ensureCompatibility = async (connection) => {
    await ensureCoreTables(connection);
    await ensureVipCardsTable(connection);
    await connection.query(`
        CREATE TABLE IF NOT EXISTS support_tickets (
            ticket_id INT AUTO_INCREMENT PRIMARY KEY,
            ticket_code VARCHAR(80) NOT NULL UNIQUE,
            customer_name VARCHAR(150) DEFAULT 'Walk-in Customer',
            issue TEXT NOT NULL,
            agent_name VARCHAR(120) DEFAULT 'Auto Assigned',
            status ENUM('Open', 'Resolved', 'In Progress') NOT NULL DEFAULT 'Open',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_support_tickets_status (status),
            INDEX idx_support_tickets_customer (customer_name)
        )
    `);

    await ensureColumn(connection, "users", "phone", "phone VARCHAR(30) NULL AFTER email");
    await ensureColumn(connection, "users", "username", "username VARCHAR(80) NULL UNIQUE AFTER phone");
    await ensureColumn(connection, "users", "password", "password VARCHAR(255) NOT NULL DEFAULT '' AFTER username");
    await ensureColumn(connection, "users", "role", "role ENUM('admin', 'staff', 'customer') NOT NULL DEFAULT 'customer' AFTER password");
    await ensureColumn(connection, "users", "status", "status ENUM('active', 'inactive') NOT NULL DEFAULT 'active' AFTER role");

    await ensureColumn(connection, "customers", "phone", "phone VARCHAR(30) NULL AFTER email");
    await ensureColumn(connection, "customers", "address", "address VARCHAR(255) NULL AFTER phone");
    await ensureColumn(connection, "customers", "vehicle_info", "vehicle_info VARCHAR(255) NULL AFTER address");
    await ensureColumn(connection, "customers", "status", "status ENUM('Active', 'Pending', 'Inactive') NOT NULL DEFAULT 'Active' AFTER vehicle_info");
    await ensureColumn(connection, "customers", "created_at", "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER status");
    await ensureColumn(connection, "customers", "updated_at", "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at");

    await ensureColumn(connection, "staff", "phone", "phone VARCHAR(30) NULL AFTER email");
    await ensureColumn(connection, "staff", "position", "position VARCHAR(80) NULL AFTER phone");
    await ensureColumn(connection, "staff", "username", "username VARCHAR(80) NOT NULL DEFAULT '' AFTER position");
    await ensureColumn(connection, "staff", "password", "password VARCHAR(255) NOT NULL DEFAULT '' AFTER username");
    await ensureColumn(connection, "staff", "status", "status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active' AFTER password");

    await ensureColumn(connection, "parking_slots", "floor", "floor VARCHAR(80) NOT NULL DEFAULT 'Ground Floor' AFTER slot_number");
    await ensureColumn(connection, "parking_slots", "vehicle_type", "vehicle_type VARCHAR(50) NOT NULL DEFAULT 'Car' AFTER floor");
    await ensureColumn(connection, "parking_slots", "price", "price DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER status");
    await ensureColumn(connection, "parking_slots", "created_at", "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER price");
    await ensureColumn(connection, "parking_slots", "updated_at", "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at");

    await ensureColumn(connection, "contracts", "notes", "notes TEXT NULL AFTER status");
    await ensureColumn(connection, "contracts", "created_at", "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER notes");
    await ensureColumn(connection, "contracts", "updated_at", "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at");

    await ensureColumn(connection, "payments", "customer_id", "customer_id INT NULL AFTER payment_id");
    await ensureColumn(connection, "payments", "contract_id", "contract_id VARCHAR(80) NULL AFTER customer_id");
    await ensureColumn(connection, "payments", "reference", "reference VARCHAR(120) NULL AFTER payment_date");
    await ensureColumn(connection, "payments", "notes", "notes TEXT NULL AFTER reference");
    await ensureColumn(connection, "payments", "created_at", "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER notes");
    await ensureColumn(connection, "payments", "updated_at", "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at");
    await connection.query("ALTER TABLE payments MODIFY payment_method ENUM('Cash', 'ABA', 'Card', 'Bank Transfer', 'KHQR', 'Mobile Wallet') NOT NULL DEFAULT 'Cash'");
    await connection.query("ALTER TABLE payments MODIFY payment_status ENUM('Paid', 'Pending', 'Failed') NOT NULL DEFAULT 'Paid'");

    await ensureColumn(connection, "parking_records", "amount", "amount DECIMAL(10,2) DEFAULT 0.00 AFTER status");
    await ensureColumn(connection, "parking_records", "customer_id", "customer_id INT NULL AFTER plate_number");
    await ensureColumn(connection, "parking_records", "vip_card_id", "vip_card_id INT NULL AFTER customer_id");
    await ensureColumn(connection, "parking_records", "store_id", "store_id VARCHAR(80) NULL AFTER vip_card_id");
    await ensureColumn(connection, "parking_records", "card_id", "card_id VARCHAR(80) NULL AFTER store_id");
    await ensureColumn(connection, "parking_records", "payment_status", "payment_status ENUM('Paid', 'Pending', 'Failed') NOT NULL DEFAULT 'Paid' AFTER amount");
    await ensureColumn(connection, "parking_records", "payment_method", "payment_method ENUM('Cash', 'ABA', 'Card', 'Bank Transfer', 'KHQR', 'Mobile Wallet') NOT NULL DEFAULT 'Cash' AFTER payment_status");
    await ensureColumn(connection, "parking_records", "created_at", "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER payment_method");
    await ensureColumn(connection, "parking_records", "updated_at", "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at");

    await ensureColumn(connection, "support_tickets", "updated_at", "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at");

    await connection.query(`
        INSERT INTO settings (setting_group, setting_key, setting_value)
        VALUES
            ('Parking Rates', 'Hourly Rate', '$2.00'),
            ('Parking Rates', 'Daily Max', '$12.00'),
            ('Parking Rates', 'Monthly Pass', '$85.00'),
            ('Parking Rates', 'Lost Ticket', '$10.00'),
            ('System', 'Currency', 'USD'),
            ('System', 'Time Zone', 'GMT+7')
        ON DUPLICATE KEY UPDATE setting_value = setting_value
    `);

    await connection.query(`
        INSERT INTO parking_slots (slot_number, floor, vehicle_type, status, price)
        VALUES
            ('A-01', 'Ground Floor', 'Car', 'Available', 2.00),
            ('A-02', 'Ground Floor', 'Car', 'Available', 2.00),
            ('A-03', 'Ground Floor', 'Car', 'Reserved', 2.00),
            ('B-01', '1st Floor', 'Car', 'Available', 2.00),
            ('B-02', '1st Floor', 'Car', 'Available', 2.00),
            ('C-01', '2nd Floor', 'VIP', 'Available', 0.00)
        ON DUPLICATE KEY UPDATE slot_number = VALUES(slot_number)
    `);

    const defaultAdminEmail = "admin@smartparking.com";
    const defaultAdminPassword = "Password123!";
    const defaultAdminHash = bcrypt.hashSync(defaultAdminPassword, 10);
    const [existingAdmins] = await connection.query(
        "SELECT user_id, password, username, full_name, role FROM users WHERE email = ? OR username = ? LIMIT 1",
        [defaultAdminEmail, "admin"]
    );

    if (!existingAdmins.length) {
        await connection.query(
            "INSERT INTO users (full_name, email, phone, username, password, role, status) VALUES (?, ?, ?, ?, ?, ?, 'active')",
            ["System Administrator", defaultAdminEmail, "+855 12 345 678", "admin", defaultAdminHash, "admin"]
        );
        return;
    }

    const existingAdmin = existingAdmins[0];
    const shouldResetAdmin = !existingAdmin.password || !bcrypt.compareSync(defaultAdminPassword, existingAdmin.password);
    if (shouldResetAdmin) {
        await connection.query(
            `UPDATE users
             SET full_name = ?, phone = ?, username = ?, password = ?, role = ?, status = 'active', updated_at = CURRENT_TIMESTAMP
             WHERE email = ? OR username = ?`,
            ["System Administrator", "+855 12 345 678", "admin", defaultAdminHash, "admin", defaultAdminEmail, "admin"]
        );
    }
};

const initializeDatabase = async () => {
    const shouldCreateDatabase = String(process.env.DB_CREATE_DATABASE || "").toLowerCase() === "true";
    const adminConnection = await mysql.createConnection({
        host: dbConfig.host,
        port: dbConfig.port,
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbConfig.database,
        multipleStatements: true
    });

    try {
        if (shouldCreateDatabase) {
            await adminConnection.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\``);
            await adminConnection.query(`USE \`${dbConfig.database}\``);
        }

        const tables = await getExistingTables(adminConnection);
        if (tables.length === 0) {
            const schemaPath = path.join(__dirname, "..", "database", "smart_parking.sql");
            const schemaSql = await fs.readFile(schemaPath, "utf8");
            await adminConnection.query(schemaSql);
        }

        await ensureCompatibility(adminConnection);
        return true;
    } catch (error) {
        if (error && error.code === "ER_BAD_DB_ERROR" && !shouldCreateDatabase) {
            throw new Error("The configured database does not exist. Create it in your MySQL provider or set DB_CREATE_DATABASE=true for local setup.");
        }
        throw error;
    } finally {
        await adminConnection.end();
    }
};

const getAppData = async () => {
    const poolInstance = await connect();
    const [slots] = await poolInstance.query("SELECT * FROM parking_slots ORDER BY slot_id DESC");
    const [customers] = await poolInstance.query("SELECT * FROM customers ORDER BY customer_id DESC");
    const [staff] = await poolInstance.query("SELECT staff_id, full_name, email, phone, position, username, status, created_at, updated_at FROM staff ORDER BY staff_id DESC");
    const [contracts] = await poolInstance.query(`
        SELECT c.*, cu.full_name AS customer_name, ps.slot_number
        FROM contracts c
        LEFT JOIN customers cu ON cu.customer_id = c.customer_id
        LEFT JOIN parking_slots ps ON ps.slot_id = c.slot_id
        ORDER BY c.created_at DESC
    `);
    const [payments] = await poolInstance.query(`
        SELECT p.*, COALESCE(c.full_name, 'Walk-in Customer') AS customer_name
        FROM payments p
        LEFT JOIN customers c ON c.customer_id = p.customer_id
        ORDER BY p.payment_date DESC, p.payment_id DESC
    `);
    const [records] = await poolInstance.query("SELECT * FROM parking_records ORDER BY created_at DESC LIMIT 10");
    const [settings] = await poolInstance.query("SELECT * FROM settings ORDER BY setting_group, setting_key");

    const totalSlots = slots.length;
    const availableSlots = slots.filter((slot) => slot.status === "Available").length;
    const occupiedSlots = slots.filter((slot) => slot.status === "Occupied").length;
    const reservedSlots = slots.filter((slot) => slot.status === "Reserved").length;
    const totalRevenue = payments
        .filter((payment) => payment.payment_status === "Paid")
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

    return {
        profile: { name: "Admin", role: "Administrator" },
        pages: {
            dashboard: {
                cards: [
                    { title: "Total Slots", value: String(totalSlots), icon: "fa-solid fa-square-parking" },
                    { title: "Available", value: String(availableSlots), icon: "fa-solid fa-circle-check" },
                    { title: "Occupied", value: String(occupiedSlots), icon: "fa-solid fa-car" },
                    { title: "Revenue", value: `$${Number(totalRevenue).toLocaleString()}`, icon: "fa-solid fa-dollar-sign" }
                ],
                charts: {
                    revenue: { labels: ["Paid", "Pending", "Failed"], label: "Revenue ($)", data: [totalRevenue, 0, 0] },
                    parkingStatus: { labels: ["Available", "Occupied", "Reserved"], data: [availableSlots, occupiedSlots, reservedSlots] }
                },
                table: {
                    title: "Recent Parking Activity",
                    columns: ["Plate Number", "Customer", "Slot", "Check In", "Status"],
                    rows: records.map((record) => ({
                        values: [record.plate_number || "N/A", record.customer_name || "N/A", record.slot_number || "N/A", new Date(record.check_in || record.created_at).toLocaleString(), record.status || "Active"],
                        status: { label: record.status || "Active", type: record.status === "Completed" ? "success" : "active" }
                    }))
                }
            },
            parkingSlots: { slots },
            customers: { rows: customers },
            staff: { rows: staff },
            contracts: { rows: contracts },
            payments: { rows: payments },
            settings
        }
    };
};

module.exports = {
    connect,
    initializeDatabase,
    getAppData,
    dbConfig
};
