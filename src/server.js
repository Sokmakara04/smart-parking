"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const path = require("node:path");
const { connect, initializeDatabase } = require("./db");

const app = express();
const rootDir = path.resolve(__dirname, "..");
const SESSION_SECRET = process.env.SESSION_SECRET || "smart-parking-session-secret-fallback-key-2026";
const sessionCookieName = "session_token";
let databaseInitializationPromise = null;
const defaultPort = Number(process.env.PORT) || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const successPayload = (data = null, extra = {}) => ({
    success: true,
    ok: true,
    ...(data === null ? {} : { data }),
    ...extra
});

const errorPayload = (message) => ({
    success: false,
    ok: false,
    message
});

const sendSuccess = (res, data = null, extra = {}, status = 200) => {
    res.status(status).json(successPayload(data, extra));
};

const parseCookies = (cookieHeader = "") => {
    const cookies = {};
    for (const chunk of cookieHeader.split(";")) {
        const pair = chunk.trim();
        if (!pair) {
            continue;
        }

        const separatorIndex = pair.indexOf("=");
        if (separatorIndex === -1) {
            cookies[pair] = "";
            continue;
        }

        cookies[pair.slice(0, separatorIndex)] = decodeURIComponent(pair.slice(separatorIndex + 1));
    }

    return cookies;
};

const toBase64Url = (value) => Buffer.from(value).toString("base64url");
const fromBase64Url = (value) => Buffer.from(value, "base64url").toString("utf8");

const signSession = (payload) => {
    if (!SESSION_SECRET) {
        throw new Error("SESSION_SECRET must be configured in production.");
    }
    return crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
};

const createSession = (user) => {
    const session = {
        userId: user.user_id || user.id,
        email: user.email,
        role: user.role || "admin",
        fullName: user.full_name || `${user.first_name || ""} ${user.last_name || ""}`.trim(),
        exp: Math.floor(Date.now() / 1000) + 86400
    };
    const payload = toBase64Url(JSON.stringify(session));
    return `${payload}.${signSession(payload)}`;
};

const readSession = (token) => {
    if (!token || !SESSION_SECRET) {
        return null;
    }

    const [payload, signature] = token.split(".");
    if (!payload || !signature) {
        return null;
    }

    const expected = signSession(payload);
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
        return null;
    }

    try {
        const session = JSON.parse(fromBase64Url(payload));
        if (!session.exp || session.exp < Math.floor(Date.now() / 1000)) {
            return null;
        }
        return session;
    } catch {
        return null;
    }
};

const requireSession = (req, res, next) => {
    const token = parseCookies(req.headers.cookie || "")[sessionCookieName];
    const session = readSession(token);

    if (!session) {
        if (req.path.startsWith("/api/")) {
            return res.status(401).json(errorPayload("Authentication required."));
        }
        return res.redirect("/auth/login.html");
    }

    req.user = session;
    next();
};

const ensureDatabaseForVercel = async (req, res, next) => {
    if (!req.path.startsWith("/api")) {
        return next();
    }

    try {
        if (!databaseInitializationPromise) {
            databaseInitializationPromise = initializeDatabase();
        }
        await databaseInitializationPromise;
        next();
    } catch (error) {
        databaseInitializationPromise = null;
        next(error);
    }
};

app.use(ensureDatabaseForVercel);

const getUserPasswordHash = (user) => {
    if (!user) {
        return null;
    }

    return user.password_hash || user.password || user.passwordHash || null;
};

const safeQuery = async (sql, params = []) => {
    const db = await connect();
    return db.query(sql, params);
};

const cleanString = (value, fallback = "") => {
    const cleaned = String(value ?? "").trim();
    return cleaned || fallback;
};

const optionalString = (value) => {
    const cleaned = cleanString(value);
    return cleaned || null;
};

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

const parseAmount = (value) => {
    const amount = Number.parseFloat(String(value ?? "0").replace(/[^\d.-]/g, ""));
    return Number.isFinite(amount) ? Number(amount.toFixed(2)) : NaN;
};

const normalizePaymentMethod = (value) => {
    const rawValue = cleanString(value, "Cash");
    const aliases = {
        Bank: "Bank Transfer",
        Wallet: "Mobile Wallet",
        "E-Wallet": "Mobile Wallet",
        "Mobile Wallet": "Mobile Wallet",
        KHQR: "KHQR",
        ABA: "ABA",
        Card: "Card",
        Cash: "Cash",
        "Bank Transfer": "Bank Transfer"
    };
    const normalized = aliases[rawValue] || rawValue;
    const validMethods = ["Cash", "ABA", "Card", "Bank Transfer", "KHQR", "Mobile Wallet"];
    return validMethods.includes(normalized) ? normalized : null;
};

const normalizePaymentStatus = (value) => {
    const normalized = cleanString(value, "Paid");
    return ["Paid", "Pending", "Failed"].includes(normalized) ? normalized : "Paid";
};

const normalizeSlotStatus = (value) => {
    const normalized = cleanString(value, "Available");
    return ["Available", "Occupied", "Reserved", "Maintenance"].includes(normalized) ? normalized : "Available";
};

const normalizeCustomerStatus = (value) => {
    const normalized = cleanString(value, "Active");
    return ["Active", "Pending", "Inactive"].includes(normalized) ? normalized : "Active";
};

const normalizeTicketStatus = (value) => {
    const normalized = cleanString(value, "Open");
    return ["Open", "Resolved", "In Progress"].includes(normalized) ? normalized : "Open";
};

const normalizeVipCardStatus = (value) => {
    const normalized = cleanString(value, "Active");
    return ["Active", "Inactive"].includes(normalized) ? normalized : "Active";
};

const normalizeVipAccess = (value) => {
    const normalized = cleanString(value, "ALLOWED").toUpperCase();
    return ["ALLOWED", "DENIED"].includes(normalized) ? normalized : "ALLOWED";
};

const generateUniqueStoreId = async () => {
    const [rows] = await safeQuery("SELECT store_id FROM vip_cards WHERE store_id LIKE 'VIP-%' ORDER BY vip_card_id DESC LIMIT 1");
    let next = 1;
    if (rows.length) {
        const lastValue = String(rows[0].store_id || "").match(/VIP-(\d+)/i);
        if (lastValue) {
            next = Number(lastValue[1]) + 1;
        }
    }
    return `VIP-${String(next).padStart(6, "0")}`;
};

const generateUniqueCardId = async () => {
    const [rows] = await safeQuery("SELECT card_id FROM vip_cards WHERE card_id LIKE 'CARD-%' ORDER BY vip_card_id DESC LIMIT 1");
    let next = 10001;
    if (rows.length) {
        const lastValue = String(rows[0].card_id || "").match(/CARD-(\d+)/i);
        if (lastValue) {
            next = Number(lastValue[1]) + 1;
        }
    }
    return `CARD-${String(next)}`;
};

const createReference = (prefix) => `${prefix}-${Date.now().toString().slice(-8)}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;

const formatDate = (value) => {
    if (!value) {
        return "N/A";
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
};

const formatDateTime = (value) => {
    if (!value) {
        return "N/A";
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const parseSettingAmount = (value, fallback) => {
    const amount = parseAmount(value);
    return Number.isFinite(amount) && amount >= 0 ? amount : fallback;
};

const getHourlyRate = async () => {
    const [rows] = await safeQuery(
        "SELECT setting_value FROM settings WHERE setting_group = 'Parking Rates' AND setting_key = 'Hourly Rate' LIMIT 1"
    );
    return parseSettingAmount(rows[0]?.setting_value, 2);
};

const ensureSlotByNumber = async (slotNumber) => {
    const normalizedSlot = cleanString(slotNumber);
    if (!normalizedSlot) {
        return null;
    }

    const [rows] = await safeQuery("SELECT * FROM parking_slots WHERE slot_number = ? LIMIT 1", [normalizedSlot]);
    if (rows.length) {
        return rows[0];
    }

    const [result] = await safeQuery(
        "INSERT INTO parking_slots (slot_number, floor, vehicle_type, status, price) VALUES (?, 'Ground Floor', 'Car', 'Available', ?)",
        [normalizedSlot, await getHourlyRate()]
    );
    const [createdRows] = await safeQuery("SELECT * FROM parking_slots WHERE slot_id = ? LIMIT 1", [result.insertId]);
    return createdRows[0] || null;
};

const setSlotStatusByNumber = async (slotNumber, status) => {
    const normalizedSlot = cleanString(slotNumber);
    if (!normalizedSlot) {
        return;
    }

    await ensureSlotByNumber(normalizedSlot);
    await safeQuery("UPDATE parking_slots SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE slot_number = ?", [
        normalizeSlotStatus(status),
        normalizedSlot
    ]);
};

const ensureCustomerRecord = async (ticket = {}) => {
    const customerName = cleanString(ticket.customerName || ticket.customer_name || ticket.customer, "Walk-in Customer");
    const customerPhone = cleanString(ticket.customerPhone || ticket.phone);
    const vehicleInfo = cleanString(ticket.plateNumber || ticket.plate_number || ticket.vehicle_info);
    const suppliedEmail = cleanString(ticket.email).toLowerCase();
    const generatedEmail = `customer-${Date.now()}-${crypto.randomBytes(2).toString("hex")}@parking.local`;
    const email = isValidEmail(suppliedEmail) ? suppliedEmail : generatedEmail;

    const filters = [];
    const params = [];
    if (isValidEmail(suppliedEmail)) {
        filters.push("email = ?");
        params.push(suppliedEmail);
    }
    if (customerPhone) {
        filters.push("phone = ?");
        params.push(customerPhone);
    }
    if (vehicleInfo) {
        filters.push("vehicle_info = ?");
        params.push(vehicleInfo);
    }

    if (filters.length) {
        const [existingRows] = await safeQuery(
            `SELECT customer_id, full_name, email, phone, vehicle_info FROM customers WHERE ${filters.join(" OR ")} ORDER BY customer_id DESC LIMIT 1`,
            params
        );
        if (existingRows.length) {
            const existing = existingRows[0];
            await safeQuery(
                `UPDATE customers
                 SET full_name = ?, phone = ?, vehicle_info = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE customer_id = ?`,
                [
                    customerName || existing.full_name,
                    customerPhone || existing.phone || null,
                    vehicleInfo || existing.vehicle_info || null,
                    existing.customer_id
                ]
            );
            return Number(existing.customer_id);
        }
    }

    const [result] = await safeQuery(
        `INSERT INTO customers (full_name, email, phone, address, vehicle_info, status)
         VALUES (?, ?, ?, ?, ?, 'Active')`,
        [customerName, email, customerPhone || null, "", vehicleInfo || null]
    );
    return Number(result.insertId);
};

const ensureCustomerExists = async (customerId) => {
    if (customerId === null || customerId === undefined || customerId === "") {
        return null;
    }

    const id = Number(customerId);
    if (!Number.isInteger(id) || id <= 0) {
        throw Object.assign(new Error("Customer ID is invalid."), { statusCode: 400 });
    }

    const [rows] = await safeQuery("SELECT customer_id FROM customers WHERE customer_id = ? LIMIT 1", [id]);
    if (!rows.length) {
        throw Object.assign(new Error("Customer does not exist."), { statusCode: 400 });
    }

    return id;
};

const ensureSlotExists = async (slotId) => {
    const id = Number(slotId);
    if (!Number.isInteger(id) || id <= 0) {
        throw Object.assign(new Error("Slot ID is invalid."), { statusCode: 400 });
    }

    const [rows] = await safeQuery("SELECT slot_id FROM parking_slots WHERE slot_id = ? LIMIT 1", [id]);
    if (!rows.length) {
        throw Object.assign(new Error("Parking slot does not exist."), { statusCode: 400 });
    }

    return id;
};

const ensureContractExists = async (contractId) => {
    const id = cleanString(contractId);
    if (!id) {
        return null;
    }

    const [rows] = await safeQuery("SELECT contract_id FROM contracts WHERE contract_id = ? LIMIT 1", [id]);
    if (!rows.length) {
        throw Object.assign(new Error("Contract does not exist."), { statusCode: 400 });
    }

    return id;
};

const calculateParkingAmount = async (record) => {
    const hourlyRate = await getHourlyRate();
    const checkIn = new Date(record.check_in || record.created_at || Date.now());
    const checkOut = new Date(record.check_out || Date.now());
    if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
        return hourlyRate;
    }

    const hours = Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / 3600000));
    return Number((hours * hourlyRate).toFixed(2));
};

const getContracts = async () => {
    const [rows] = await safeQuery(
        `SELECT c.*,
                cu.full_name AS customer_name,
                ps.slot_number
         FROM contracts c
         LEFT JOIN customers cu ON cu.customer_id = c.customer_id
         LEFT JOIN parking_slots ps ON ps.slot_id = c.slot_id
         ORDER BY c.created_at DESC, c.contract_id DESC`
    );
    return rows;
};

const getPayments = async () => {
    const [rows] = await safeQuery(
        `SELECT p.*,
                COALESCE(c.full_name, 'Walk-in Customer') AS customer_name
         FROM payments p
         LEFT JOIN customers c ON c.customer_id = p.customer_id
         ORDER BY p.payment_date DESC, p.payment_id DESC`
    );
    return rows;
};

const getParkingRecords = async () => {
    const [rows] = await safeQuery("SELECT * FROM parking_records ORDER BY created_at DESC, record_id DESC");
    return rows;
};

const getVipCards = async () => {
    const [rows] = await safeQuery(`
        SELECT vc.*,
               c.full_name AS customer_name,
               c.email,
               c.phone,
               c.vehicle_info AS customer_vehicle,
               c.status AS customer_status
        FROM vip_cards vc
        LEFT JOIN customers c ON c.customer_id = vc.customer_id
        ORDER BY vc.created_at DESC, vc.vip_card_id DESC
    `);
    return rows;
};

const buildDashboardData = async () => {
    const [slotRows] = await safeQuery("SELECT * FROM parking_slots ORDER BY slot_id DESC");
    const [customerRows] = await safeQuery("SELECT * FROM customers ORDER BY customer_id DESC");
    const [staffRows] = await safeQuery("SELECT staff_id, full_name, email, phone, position, username, status, created_at, updated_at FROM staff ORDER BY staff_id DESC");
    const contractRows = await getContracts();
    const paymentRows = await getPayments();
    const recordRows = (await getParkingRecords()).slice(0, 20);
    const [settingsRows] = await safeQuery("SELECT * FROM settings ORDER BY setting_group, setting_key");
    const [ticketRows] = await safeQuery("SELECT * FROM support_tickets ORDER BY created_at DESC LIMIT 20");

    const totalSlots = slotRows.length;
    const availableSlots = slotRows.filter((slot) => slot.status === "Available").length;
    const occupiedSlots = slotRows.filter((slot) => slot.status === "Occupied").length;
    const reservedSlots = slotRows.filter((slot) => slot.status === "Reserved").length;
    const maintenanceSlots = slotRows.filter((slot) => slot.status === "Maintenance").length;
    const activeContracts = contractRows.filter((contract) => contract.status === "Active").length;
    const totalRevenue = paymentRows
        .filter((payment) => payment.payment_status === "Paid")
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const today = new Date().toISOString().slice(0, 10);
    const todayRevenue = paymentRows
        .filter((payment) => String(payment.payment_date || "").slice(0, 10) === today && payment.payment_status === "Paid")
        .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const hourlyRate = await getHourlyRate();

    const defaultSettingsGroups = {
        "Parking Rates": [
            { label: "Hourly Rate", value: "$2.00" },
            { label: "Daily Max", value: "$12.00" },
            { label: "Monthly Pass", value: "$85.00" }
        ],
        Notifications: [
            { label: "SMS Alerts", value: "On" },
            { label: "Email Reports", value: "On" },
            { label: "Sensor Alerts", value: "On" }
        ],
        "Access Roles": [
            { label: "Administrators", value: "3" },
            { label: "Supervisors", value: "6" },
            { label: "Operators", value: "22" }
        ],
        System: [
            { label: "Auto Backup", value: "Daily" },
            { label: "Currency", value: "USD" },
            { label: "Time Zone", value: "GMT+7" }
        ]
    };

    const settingsByGroup = Object.entries(defaultSettingsGroups).reduce((groups, [groupName, fallbackRows]) => {
        groups[groupName] = settingsRows
            .filter((row) => row.setting_group === groupName)
            .map((row) => ({ label: row.setting_key, value: row.setting_value }));

        if (!groups[groupName].length) {
            groups[groupName] = fallbackRows;
        }

        return groups;
    }, {});

    return {
        success: true,
        ok: true,
        profile: { name: "Admin", role: "Administrator" },
        summary: {
            totalSlots,
            availableSlots,
            occupiedSlots,
            reservedSlots,
            maintenanceSlots,
            totalCustomers: customerRows.length,
            totalStaff: staffRows.length,
            activeContracts,
            totalPayments: paymentRows.length,
            totalRevenue,
            recentParkingRecords: recordRows.slice(0, 10),
            recentPayments: paymentRows.slice(0, 10)
        },
        pages: {
            dashboard: {
                cards: [
                    { title: "Total Slots", value: String(totalSlots), icon: "fa-solid fa-square-parking" },
                    { title: "Available", value: String(availableSlots), icon: "fa-solid fa-circle-check" },
                    { title: "Occupied", value: String(occupiedSlots), icon: "fa-solid fa-car" },
                    { title: "Revenue", value: `$${Number(totalRevenue).toLocaleString()}`, icon: "fa-solid fa-dollar-sign" }
                ],
                charts: {
                    revenue: {
                        labels: ["Paid", "Pending", "Failed"],
                        label: "Payments ($)",
                        data: [
                            totalRevenue,
                            paymentRows.filter((payment) => payment.payment_status === "Pending").reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
                            paymentRows.filter((payment) => payment.payment_status === "Failed").reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
                        ]
                    },
                    parkingStatus: {
                        labels: ["Available", "Occupied", "Reserved"],
                        data: [availableSlots, occupiedSlots, reservedSlots]
                    }
                },
                table: {
                    title: "Recent Parking Activity",
                    columns: ["Plate Number", "Customer", "Slot", "Check In", "Status"],
                    rows: recordRows.slice(0, 8).map((record) => ({
                        values: [record.plate_number || "N/A", record.customer_name || "N/A", record.slot_number || "N/A", formatDateTime(record.check_in || record.created_at), record.status || "Active"],
                        status: { label: record.status || "Active", type: record.status === "Completed" ? "success" : "active" }
                    }))
                }
            },
            parkingSlots: {
                cards: [
                    { title: "Total Slots", value: String(totalSlots), icon: "fa-solid fa-square-parking" },
                    { title: "Available", value: String(availableSlots), icon: "fa-solid fa-circle-check" },
                    { title: "Occupied", value: String(occupiedSlots), icon: "fa-solid fa-car" },
                    { title: "Maintenance", value: String(maintenanceSlots), icon: "fa-solid fa-screwdriver-wrench" }
                ],
                slots: slotRows.slice(0, 12).map((slot) => ({
                    id: slot.slot_id,
                    name: slot.slot_number,
                    description: `${slot.floor || "Ground Floor"} - ${slot.status}`,
                    state: slot.status === "Occupied" ? "occupied" : slot.status === "Reserved" ? "reserved" : slot.status === "Maintenance" ? "maintenance" : "",
                    badge: { label: slot.status, type: slot.status === "Available" ? "success" : slot.status === "Occupied" ? "danger" : slot.status === "Reserved" ? "warning" : "info" }
                }))
            },
            sellTicket: {
                ticketPrices: {
                    Hourly: hourlyRate,
                    Daily: parseSettingAmount(settingsRows.find((row) => row.setting_key === "Daily Max")?.setting_value, 12),
                    "VIP Guest": 0,
                    "Lost Ticket": parseSettingAmount(settingsRows.find((row) => row.setting_key === "Lost Ticket")?.setting_value, 10)
                },
                parkingSlots: slotRows.filter((slot) => slot.status === "Available" || slot.status === "Reserved").map((slot) => slot.slot_number),
                ticketTypes: ["Hourly", "Daily", "VIP Guest", "Lost Ticket"],
                durations: ["1 Hour", "2 Hours", "3 Hours", "4 Hours", "8 Hours", "Full Day"],
                paymentMethods: ["Cash", "ABA", "Card", "Bank Transfer", "KHQR", "Mobile Wallet"],
                vipCards: (await getVipCards()).map((card) => ({
                    storeId: card.store_id,
                    cardId: card.card_id,
                    name: card.guest_name || card.customer_name || "VIP Guest",
                    phone: card.phone || "",
                    plate: card.vehicle_info || card.customer_vehicle || "",
                    plan: card.parking_access === "ALLOWED" ? "VIP Access" : "Access Restricted",
                    slot: slotRows.find((slot) => slot.status === "Available")?.slot_number || "A-01",
                    amount: 0,
                    status: card.status,
                    isActive: card.status === "Active"
                })).reduce((customers, card) => {
                    customers[card.storeId] = card;
                    customers[card.cardId] = card;
                    return customers;
                }, {})
            },
            customers: {
                cards: [
                    { title: "Total Customers", value: String(customerRows.length), icon: "fa-solid fa-users" },
                    { title: "Monthly Passes", value: String(activeContracts), icon: "fa-solid fa-id-card" },
                    { title: "Active Vehicles", value: String(customerRows.filter((customer) => customer.status === "Active").length), icon: "fa-solid fa-car-side" },
                    { title: "New Today", value: String(customerRows.filter((customer) => String(customer.created_at || "").slice(0, 10) === today).length), icon: "fa-solid fa-user-check" }
                ],
                table: {
                    title: "Customer List",
                    description: "Recent registered customers",
                    columns: ["Name", "Phone", "Plate Number", "Status"],
                    rows: customerRows.slice(0, 10).map((customer) => ({
                        values: [customer.full_name, customer.phone || "N/A", customer.vehicle_info || "N/A", customer.status || "Active"],
                        status: { label: customer.status || "Active", type: customer.status === "Active" ? "active" : "pending" }
                    }))
                }
            },
            staff: {
                cards: [
                    { title: "On Duty", value: String(staffRows.filter((member) => member.status === "Active").length), icon: "fa-solid fa-user-check" },
                    { title: "Attendants", value: String(staffRows.filter((member) => member.position === "Attendant").length), icon: "fa-solid fa-clipboard-user" },
                    { title: "Supervisors", value: String(staffRows.filter((member) => member.position === "Supervisor").length), icon: "fa-solid fa-user-tie" },
                    { title: "Support", value: String(staffRows.filter((member) => member.position === "Support").length), icon: "fa-solid fa-headset" }
                ],
                table: {
                    title: "Staff Schedule",
                    description: "Today shift assignments",
                    columns: ["Name", "Role", "Username", "Status"],
                    rows: staffRows.slice(0, 10).map((member) => ({
                        values: [member.full_name, member.position || "Staff", member.username || "N/A", member.status || "Active"],
                        status: { label: member.status || "Active", type: member.status === "Active" ? "active" : "pending" }
                    }))
                }
            },
            contracts: {
                cards: [
                    { title: "Active Contracts", value: String(activeContracts), icon: "fa-solid fa-file-signature" },
                    { title: "Expiring Soon", value: String(contractRows.filter((contract) => contract.status === "Expiring").length), icon: "fa-solid fa-clock" },
                    { title: "Monthly Value", value: `$${contractRows.reduce((sum, contract) => sum + Number(contract.monthly_price || 0), 0).toLocaleString()}`, icon: "fa-solid fa-sack-dollar" },
                    { title: "Pending Approval", value: String(contractRows.filter((contract) => contract.status === "Pending").length), icon: "fa-solid fa-hourglass-half" }
                ],
                table: {
                    title: "Contract Records",
                    description: "Latest customer agreements",
                    columns: ["Contract ID", "Customer", "Slot", "End Date", "Status"],
                    rows: contractRows.slice(0, 10).map((contract) => ({
                        values: [contract.contract_id || "N/A", contract.customer_name || "N/A", contract.slot_number || "N/A", formatDate(contract.end_date), contract.status || "Active"],
                        status: { label: contract.status || "Active", type: contract.status === "Active" ? "active" : contract.status === "Pending" ? "pending" : "warning" }
                    }))
                }
            },
            payments: {
                cards: [
                    { title: "Today Collected", value: `$${todayRevenue.toLocaleString()}`, icon: "fa-solid fa-money-bill-wave" },
                    { title: "Unpaid Invoices", value: String(paymentRows.filter((payment) => payment.payment_status === "Pending").length), icon: "fa-solid fa-file-invoice-dollar" },
                    { title: "Total Payments", value: String(paymentRows.length), icon: "fa-solid fa-credit-card" },
                    { title: "Refunds", value: "$0", icon: "fa-solid fa-rotate-left" }
                ],
                table: {
                    title: "Payment History",
                    description: "Latest parking transactions",
                    columns: ["Invoice", "Customer", "Amount", "Method", "Status"],
                    rows: paymentRows.slice(0, 10).map((payment) => ({
                        values: [payment.reference || `INV-${payment.payment_id}`, payment.customer_name || "N/A", `$${Number(payment.amount || 0).toFixed(2)}`, payment.payment_method || "Cash", payment.payment_status || "Paid"],
                        status: { label: payment.payment_status || "Paid", type: payment.payment_status === "Paid" ? "active" : "pending" }
                    }))
                }
            },
            accounting: {
                cards: [
                    { title: "Monthly Revenue", value: `$${Number(totalRevenue).toLocaleString()}`, icon: "fa-solid fa-arrow-trend-up" },
                    { title: "Expenses", value: "$0", icon: "fa-solid fa-receipt" },
                    { title: "Net Profit", value: `$${Number(totalRevenue).toLocaleString()}`, icon: "fa-solid fa-sack-dollar" },
                    { title: "Pending Payout", value: `$${paymentRows.filter((payment) => payment.payment_status === "Pending").reduce((sum, payment) => sum + Number(payment.amount || 0), 0).toLocaleString()}`, icon: "fa-solid fa-building-columns" }
                ],
                table: {
                    title: "Ledger Entries",
                    description: "Latest financial records",
                    columns: ["Date", "Description", "Category", "Amount", "Status"],
                    rows: paymentRows.slice(0, 10).map((payment) => ({
                        values: [formatDate(payment.payment_date), payment.notes || payment.reference || "Parking payment", payment.payment_method || "Revenue", `$${Number(payment.amount || 0).toFixed(2)}`],
                        status: { label: payment.payment_status || "Paid", type: payment.payment_status === "Paid" ? "active" : "pending" }
                    }))
                }
            },
            callCenter: {
                cards: [
                    { title: "Open Tickets", value: String(ticketRows.filter((ticket) => ticket.status === "Open").length), icon: "fa-solid fa-ticket" },
                    { title: "Resolved Today", value: String(ticketRows.filter((ticket) => ticket.status === "Resolved" && String(ticket.updated_at || "").slice(0, 10) === today).length), icon: "fa-solid fa-circle-check" },
                    { title: "In Progress", value: String(ticketRows.filter((ticket) => ticket.status === "In Progress").length), icon: "fa-solid fa-stopwatch" },
                    { title: "Agents Online", value: String(Math.max(1, staffRows.filter((staff) => staff.status === "Active").length)), icon: "fa-solid fa-headset" }
                ],
                table: {
                    title: "Support Queue",
                    description: "Latest customer requests",
                    columns: ["Ticket", "Customer", "Issue", "Agent", "Status"],
                    rows: ticketRows.slice(0, 10).map((ticket) => ({
                        values: [ticket.ticket_code || ticket.ticket || "TCK-0000", ticket.customer_name || "Walk-in Customer", ticket.issue || "No issue", ticket.agent_name || "Auto Assigned", ticket.status || "Open"],
                        status: { label: ticket.status || "Open", type: ticket.status === "Resolved" ? "active" : ticket.status === "In Progress" ? "info" : "pending" }
                    }))
                }
            },
            reports: {
                cards: [
                    { title: "Occupancy Rate", value: `${totalSlots ? Math.round((occupiedSlots / totalSlots) * 100) : 0}%`, icon: "fa-solid fa-chart-pie" },
                    { title: "Revenue Growth", value: `${Math.min(99, Math.max(0, Math.round((totalRevenue > 0 ? (totalRevenue / Math.max(1, totalRevenue || 1)) * 100 : 18))))}%`, icon: "fa-solid fa-arrow-trend-up" },
                    { title: "Peak Hour", value: `${recordRows.length ? "9 AM" : "9 AM"}`, icon: "fa-solid fa-clock" },
                    { title: "Top Zone", value: "Zone B", icon: "fa-solid fa-location-dot" }
                ],
                reports: [
                    { title: "Parking revenue", description: `$${Number(totalRevenue).toLocaleString()} collected from paid payments`, badge: { type: "success", label: "Ready" } },
                    { title: "Occupied slots", description: `${occupiedSlots} of ${totalSlots} slots occupied`, badge: { type: "info", label: "Live" } },
                    { title: "Customer count", description: `${customerRows.length} registered customers`, badge: { type: "warning", label: "Updated" } },
                    { title: "Contract count", description: `${activeContracts} active agreements`, badge: { type: "success", label: "Ready" } }
                ]
            },
            settings: {
                settings: Object.entries(settingsByGroup).map(([title, rows]) => ({ title, rows }))
            }
        }
    };
};

const readFields = (body, fields) => {
    const values = {};
    fields.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(body, field)) {
            values[field] = body[field];
        }
    });
    return values;
};

const validateRequired = (values, fields, entityName) => {
    const missing = fields.filter((field) => values[field] === undefined || values[field] === null || String(values[field]).trim() === "");
    if (missing.length) {
        throw Object.assign(new Error(`Missing required fields for ${entityName}: ${missing.join(", ")}.`), { statusCode: 400 });
    }
};

const insertRow = async (tableName, values) => {
    const fields = Object.keys(values);
    const placeholders = fields.map(() => "?").join(", ");
    const [result] = await safeQuery(
        `INSERT INTO ${tableName} (${fields.join(", ")}) VALUES (${placeholders})`,
        fields.map((field) => values[field])
    );
    return result;
};

const updateRow = async (tableName, idField, id, values) => {
    const fields = Object.keys(values);
    if (!fields.length) {
        throw Object.assign(new Error("No fields were provided to update."), { statusCode: 400 });
    }

    await safeQuery(
        `UPDATE ${tableName} SET ${fields.map((field) => `${field} = ?`).join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE ${idField} = ?`,
        [...fields.map((field) => values[field]), id]
    );
};

const registerCrud = ({ pathName, tableName, idField, entityName, fields, requiredFields = [], transform = (row) => row, prepare = async (values) => values }) => {
    app.get(`/api/${pathName}`, async (req, res, next) => {
        try {
            const [rows] = await safeQuery(`SELECT * FROM ${tableName} ORDER BY ${idField} DESC`);
            sendSuccess(res, rows.map(transform));
        } catch (error) {
            next(error);
        }
    });

    app.post(`/api/${pathName}`, async (req, res, next) => {
        try {
            const values = await prepare(readFields(req.body || {}, fields), "create");
            validateRequired(values, requiredFields, entityName);
            const result = await insertRow(tableName, values);
            const [rows] = await safeQuery(`SELECT * FROM ${tableName} WHERE ${idField} = ? LIMIT 1`, [result.insertId]);
            sendSuccess(res, transform(rows[0]), { message: `${entityName} created successfully.` }, 201);
        } catch (error) {
            next(error);
        }
    });

    app.put(`/api/${pathName}/:id`, async (req, res, next) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                throw Object.assign(new Error(`${entityName} id is invalid.`), { statusCode: 400 });
            }

            const values = await prepare(readFields(req.body || {}, fields), "update");
            await updateRow(tableName, idField, id, values);
            const [rows] = await safeQuery(`SELECT * FROM ${tableName} WHERE ${idField} = ? LIMIT 1`, [id]);
            sendSuccess(res, transform(rows[0]), { message: `${entityName} updated successfully.` });
        } catch (error) {
            next(error);
        }
    });

    app.delete(`/api/${pathName}/:id`, async (req, res, next) => {
        try {
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                throw Object.assign(new Error(`${entityName} id is invalid.`), { statusCode: 400 });
            }

            await safeQuery(`DELETE FROM ${tableName} WHERE ${idField} = ?`, [id]);
            sendSuccess(res, null, { message: `${entityName} deleted successfully.` });
        } catch (error) {
            next(error);
        }
    });
};

app.get("/", requireSession, (req, res) => {
    res.sendFile(path.join(rootDir, "index.html"));
});
app.get("/index.html", requireSession, (req, res) => {
    res.sendFile(path.join(rootDir, "index.html"));
});
app.get("/auth/login.html", (req, res) => {
    res.sendFile(path.join(rootDir, "auth", "login.html"));
});
app.get("/auth/register.html", (req, res) => {
    res.sendFile(path.join(rootDir, "auth", "register.html"));
});
app.get("/pages/:page", requireSession, (req, res) => {
    res.sendFile(path.join(rootDir, "pages", req.params.page));
});

app.use("/assets", express.static(path.join(rootDir, "assets")));
app.use("/scripts", express.static(path.join(rootDir, "scripts")));
app.use("/auth", express.static(path.join(rootDir, "auth")));
app.use("/pages", express.static(path.join(rootDir, "pages")));

app.get("/api/data", async (req, res, next) => {
    try {
        res.json(await buildDashboardData());
    } catch (error) {
        next(error);
    }
});

app.get("/api/settings", async (req, res, next) => {
    try {
        const [rows] = await safeQuery("SELECT * FROM settings ORDER BY setting_group, setting_key");
        sendSuccess(res, rows);
    } catch (error) {
        next(error);
    }
});

app.post("/api/settings", async (req, res, next) => {
    try {
        const settingGroup = cleanString(req.body?.setting_group, "System");
        const settingKey = cleanString(req.body?.setting_key);
        const settingValue = cleanString(req.body?.setting_value);
        if (!settingKey || !settingValue) {
            throw Object.assign(new Error("Setting key and value are required."), { statusCode: 400 });
        }

        await safeQuery(
            `INSERT INTO settings (setting_group, setting_key, setting_value)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP`,
            [settingGroup, settingKey, settingValue]
        );
        sendSuccess(res, null, { message: "Settings saved successfully." });
    } catch (error) {
        next(error);
    }
});

const authRegister = async (req, res, next) => {
    try {
        const fullName = cleanString(req.body?.full_name);
        const email = cleanString(req.body?.email).toLowerCase();
        const password = String(req.body?.password || "");
        const username = cleanString(req.body?.username, email.split("@")[0]);
        const phone = optionalString(req.body?.phone);
        const role = ["admin", "staff", "customer"].includes(req.body?.role) ? req.body.role : "admin";

        if (!fullName || !isValidEmail(email) || password.length < 6) {
            throw Object.assign(new Error("Full name, valid email, and a 6+ character password are required."), { statusCode: 400 });
        }

        const [existingUsers] = await safeQuery("SELECT user_id FROM users WHERE email = ? OR username = ? LIMIT 1", [email, username]);
        if (existingUsers.length) {
            throw Object.assign(new Error("A user with that email or username already exists."), { statusCode: 409 });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const [result] = await safeQuery(
            "INSERT INTO users (full_name, email, phone, username, password, role, status) VALUES (?, ?, ?, ?, ?, ?, 'active')",
            [fullName, email, phone, username, passwordHash, role]
        );
        sendSuccess(res, { userId: result.insertId }, { userId: result.insertId, message: "Registration successful." }, 201);
    } catch (error) {
        next(error);
    }
};

const authLogin = async (req, res, next) => {
    try {
        const ident = cleanString(req.body?.email || req.body?.username);
        const password = String(req.body?.password || "");
        if (!ident || !password) {
            throw Object.assign(new Error("Email/username and password are required."), { statusCode: 400 });
        }

        const [rows] = await safeQuery("SELECT * FROM users WHERE email = ? OR username = ? LIMIT 1", [
            ident.toLowerCase(),
            ident
        ]);
        const user = rows[0];
        const storedHash = getUserPasswordHash(user);
        if (!user || !storedHash || !(await bcrypt.compare(password, storedHash))) {
            throw Object.assign(new Error("Invalid email or password."), { statusCode: 401 });
        }

        const token = createSession(user);
        res.setHeader("Set-Cookie", `${sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${process.env.VERCEL === "1" ? "; Secure" : ""}`);
        sendSuccess(res, { id: user.user_id, email: user.email, full_name: user.full_name, role: user.role }, {
            user: { id: user.user_id, email: user.email, full_name: user.full_name, role: user.role },
            message: "Login successful."
        });
    } catch (error) {
        next(error);
    }
};

const authLogout = (req, res) => {
    res.setHeader("Set-Cookie", `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.VERCEL === "1" ? "; Secure" : ""}`);
    sendSuccess(res, null, { message: "Logged out successfully." });
};

app.post("/api/register", authRegister);
app.post("/api/auth/register", authRegister);
app.post("/api/login", authLogin);
app.post("/api/auth/login", authLogin);
app.post("/api/logout", authLogout);
app.post("/api/auth/logout", authLogout);

app.get("/api/session", (req, res) => {
    const token = parseCookies(req.headers.cookie || "")[sessionCookieName];
    const session = readSession(token);
    if (!session) {
        return res.status(401).json(errorPayload("No active session."));
    }
    sendSuccess(res, session, { user: session });
});

// All remaining API endpoints require an authenticated user.
app.use("/api", requireSession);

registerCrud({
    pathName: "parking_slots",
    tableName: "parking_slots",
    idField: "slot_id",
    entityName: "slot",
    fields: ["slot_number", "floor", "vehicle_type", "status", "price"],
    requiredFields: ["slot_number", "floor", "vehicle_type", "status"],
    prepare: async (values) => ({
        ...values,
        slot_number: cleanString(values.slot_number),
        floor: cleanString(values.floor, "Ground Floor"),
        vehicle_type: cleanString(values.vehicle_type, "Car"),
        status: normalizeSlotStatus(values.status),
        price: values.price === undefined ? 0 : parseAmount(values.price)
    })
});

registerCrud({
    pathName: "customers",
    tableName: "customers",
    idField: "customer_id",
    entityName: "customer",
    fields: ["full_name", "email", "phone", "address", "vehicle_info", "status"],
    requiredFields: ["full_name", "email"],
    prepare: async (values) => {
        if (values.email !== undefined && !isValidEmail(values.email)) {
            throw Object.assign(new Error("Customer email is invalid."), { statusCode: 400 });
        }
        return {
            ...values,
            full_name: values.full_name === undefined ? undefined : cleanString(values.full_name),
            email: values.email === undefined ? undefined : cleanString(values.email).toLowerCase(),
            phone: values.phone === undefined ? undefined : optionalString(values.phone),
            address: values.address === undefined ? undefined : optionalString(values.address),
            vehicle_info: values.vehicle_info === undefined ? undefined : optionalString(values.vehicle_info),
            status: values.status === undefined ? undefined : normalizeCustomerStatus(values.status)
        };
    }
});

registerCrud({
    pathName: "staff",
    tableName: "staff",
    idField: "staff_id",
    entityName: "staff",
    fields: ["full_name", "email", "phone", "position", "username", "password", "status"],
    requiredFields: ["full_name", "email", "username", "password"],
    transform: (row) => {
        if (!row) {
            return row;
        }
        const { password, ...safeRow } = row;
        return safeRow;
    },
    prepare: async (values, mode) => {
        if (values.email !== undefined && !isValidEmail(values.email)) {
            throw Object.assign(new Error("Staff email is invalid."), { statusCode: 400 });
        }
        const prepared = {
            ...values,
            full_name: values.full_name === undefined ? undefined : cleanString(values.full_name),
            email: values.email === undefined ? undefined : cleanString(values.email).toLowerCase(),
            phone: values.phone === undefined ? undefined : optionalString(values.phone),
            position: values.position === undefined ? undefined : cleanString(values.position, "Staff"),
            username: values.username === undefined ? undefined : cleanString(values.username),
            status: values.status === undefined ? undefined : (["Active", "Inactive"].includes(values.status) ? values.status : "Active")
        };

        if (values.password !== undefined) {
            if (String(values.password).trim() === "" && mode === "update") {
                delete prepared.password;
            } else if (String(values.password).length < 6) {
                throw Object.assign(new Error("Staff password must be at least 6 characters."), { statusCode: 400 });
            } else {
                prepared.password = await bcrypt.hash(String(values.password), 10);
            }
        }

        return prepared;
    }
});

app.get("/api/contracts", async (req, res, next) => {
    try {
        sendSuccess(res, await getContracts());
    } catch (error) {
        next(error);
    }
});

app.post("/api/contracts", async (req, res, next) => {
    try {
        const contractId = cleanString(req.body?.contract_id, createReference("CTR"));
        const customerId = await ensureCustomerExists(req.body?.customer_id);
        const slotId = await ensureSlotExists(req.body?.slot_id);
        const startDate = cleanString(req.body?.start_date);
        const endDate = cleanString(req.body?.end_date);
        const monthlyPrice = parseAmount(req.body?.monthly_price ?? 0);
        const status = ["Active", "Pending", "Expired", "Expiring"].includes(req.body?.status) ? req.body.status : "Active";

        validateRequired({ contractId, customerId, slotId, startDate, endDate }, ["contractId", "customerId", "slotId", "startDate", "endDate"], "contract");
        if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0) {
            throw Object.assign(new Error("Monthly price is invalid."), { statusCode: 400 });
        }

        await safeQuery(
            `INSERT INTO contracts (contract_id, customer_id, slot_id, start_date, end_date, monthly_price, status, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [contractId, customerId, slotId, startDate, endDate, monthlyPrice, status, optionalString(req.body?.notes)]
        );
        const rows = await getContracts();
        sendSuccess(res, rows.find((contract) => contract.contract_id === contractId), { message: "Contract created successfully." }, 201);
    } catch (error) {
        next(error);
    }
});

app.put("/api/contracts/:id", async (req, res, next) => {
    try {
        const contractId = cleanString(req.params.id);
        await ensureContractExists(contractId);
        const values = readFields(req.body || {}, ["customer_id", "slot_id", "start_date", "end_date", "monthly_price", "status", "notes"]);

        if (values.customer_id !== undefined) {
            values.customer_id = await ensureCustomerExists(values.customer_id);
        }
        if (values.slot_id !== undefined) {
            values.slot_id = await ensureSlotExists(values.slot_id);
        }
        if (values.monthly_price !== undefined) {
            values.monthly_price = parseAmount(values.monthly_price);
            if (!Number.isFinite(values.monthly_price) || values.monthly_price < 0) {
                throw Object.assign(new Error("Monthly price is invalid."), { statusCode: 400 });
            }
        }
        if (values.status !== undefined && !["Active", "Pending", "Expired", "Expiring"].includes(values.status)) {
            values.status = "Active";
        }
        if (values.notes !== undefined) {
            values.notes = optionalString(values.notes);
        }

        await updateRow("contracts", "contract_id", contractId, values);
        const rows = await getContracts();
        sendSuccess(res, rows.find((contract) => contract.contract_id === contractId), { message: "Contract updated successfully." });
    } catch (error) {
        next(error);
    }
});

app.delete("/api/contracts/:id", async (req, res, next) => {
    try {
        const contractId = cleanString(req.params.id);
        await safeQuery("DELETE FROM contracts WHERE contract_id = ?", [contractId]);
        sendSuccess(res, null, { message: "Contract deleted successfully." });
    } catch (error) {
        next(error);
    }
});

app.get("/api/payments", async (req, res, next) => {
    try {
        sendSuccess(res, await getPayments());
    } catch (error) {
        next(error);
    }
});

app.post("/api/payments", async (req, res, next) => {
    try {
        const amount = parseAmount(req.body?.amount);
        const paymentMethod = normalizePaymentMethod(req.body?.payment_method || req.body?.paymentMethod);
        if (!Number.isFinite(amount) || amount <= 0) {
            throw Object.assign(new Error("Payment amount must be greater than zero."), { statusCode: 400 });
        }
        if (!paymentMethod) {
            throw Object.assign(new Error("Payment method is invalid."), { statusCode: 400 });
        }

        const customerId = await ensureCustomerExists(req.body?.customer_id);
        const contractId = await ensureContractExists(req.body?.contract_id);
        const paymentStatus = normalizePaymentStatus(req.body?.payment_status);
        const paymentDate = cleanString(req.body?.payment_date) || new Date().toISOString().slice(0, 19).replace("T", " ");
        const reference = cleanString(req.body?.reference, createReference("INV"));
        const notes = optionalString(req.body?.notes);

        const [result] = await safeQuery(
            `INSERT INTO payments (customer_id, contract_id, amount, payment_method, payment_status, payment_date, reference, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [customerId, contractId, amount, paymentMethod, paymentStatus, paymentDate, reference, notes]
        );
        const rows = await getPayments();
        sendSuccess(res, rows.find((payment) => payment.payment_id === result.insertId), {
            paymentId: result.insertId,
            message: "Payment recorded successfully."
        }, 201);
    } catch (error) {
        next(error);
    }
});

app.put("/api/payments/:id", async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            throw Object.assign(new Error("Payment id is invalid."), { statusCode: 400 });
        }

        const values = readFields(req.body || {}, ["customer_id", "contract_id", "amount", "payment_method", "payment_status", "payment_date", "reference", "notes"]);

        if (values.customer_id !== undefined) {
            values.customer_id = await ensureCustomerExists(values.customer_id);
        }
        if (values.contract_id !== undefined) {
            values.contract_id = await ensureContractExists(values.contract_id);
        }
        if (values.amount !== undefined) {
            values.amount = parseAmount(values.amount);
            if (!Number.isFinite(values.amount) || values.amount <= 0) {
                throw Object.assign(new Error("Payment amount is invalid."), { statusCode: 400 });
            }
        }
        if (values.payment_method !== undefined) {
            values.payment_method = normalizePaymentMethod(values.payment_method);
            if (!values.payment_method) {
                throw Object.assign(new Error("Payment method is invalid."), { statusCode: 400 });
            }
        }
        if (values.payment_status !== undefined) {
            values.payment_status = normalizePaymentStatus(values.payment_status);
            if (!values.payment_status) {
                throw Object.assign(new Error("Payment status is invalid."), { statusCode: 400 });
            }
        }
        if (values.payment_date !== undefined) {
            values.payment_date = cleanString(values.payment_date);
        }
        if (values.reference !== undefined) {
            values.reference = cleanString(values.reference, createReference("INV"));
        }
        if (values.notes !== undefined) {
            values.notes = optionalString(values.notes);
        }

        await updateRow("payments", "payment_id", id, values);
        const rows = await getPayments();
        sendSuccess(res, rows.find((payment) => payment.payment_id === id), { message: "Payment updated successfully." });
    } catch (error) {
        next(error);
    }
});

app.delete("/api/payments/:id", async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            throw Object.assign(new Error("Payment id is invalid."), { statusCode: 400 });
        }

        await safeQuery("DELETE FROM payments WHERE payment_id = ?", [id]);
        sendSuccess(res, null, { message: "Payment deleted successfully." });
    } catch (error) {
        next(error);
    }
});

app.get("/api/parking_records", async (req, res, next) => {
    try {
        sendSuccess(res, await getParkingRecords());
    } catch (error) {
        next(error);
    }
});

app.post("/api/parking_records", async (req, res, next) => {
    try {
        const customerName = cleanString(req.body?.customer_name || req.body?.customerName, "Walk-in Customer");
        const plateNumber = cleanString(req.body?.plate_number || req.body?.plateNumber);
        const slotNumber = cleanString(req.body?.slot_number || req.body?.parkingSlot);
        const checkIn = cleanString(req.body?.check_in) || new Date().toISOString().slice(0, 19).replace("T", " ");
        const status = ["Active", "Completed", "Reserved"].includes(req.body?.status) ? req.body.status : "Active";
        const amount = Number.isFinite(parseAmount(req.body?.amount)) ? parseAmount(req.body?.amount) : 0;
        const storeId = cleanString(req.body?.store_id);
        const cardId = cleanString(req.body?.card_id);
        const customerId = req.body?.customer_id === undefined || req.body?.customer_id === null || req.body?.customer_id === "" ? null : await ensureCustomerExists(req.body.customer_id);
        const vipCardId = req.body?.vip_card_id === undefined || req.body?.vip_card_id === null || req.body?.vip_card_id === "" ? null : Number(req.body.vip_card_id);
        const paymentStatus = normalizePaymentStatus(req.body?.payment_status || "Paid");
        const paymentMethod = normalizePaymentMethod(req.body?.payment_method || "Cash");

        validateRequired({ plateNumber, slotNumber }, ["plateNumber", "slotNumber"], "parking record");
        await ensureCustomerRecord({ ...req.body, customerName, plateNumber });
        await ensureSlotByNumber(slotNumber);

        const [result] = await safeQuery(
            `INSERT INTO parking_records (customer_name, customer_id, plate_number, slot_number, check_in, check_out, status, amount, vip_card_id, store_id, card_id, payment_status, payment_method)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [customerName, customerId, plateNumber, slotNumber, checkIn, optionalString(req.body?.check_out), status, amount, vipCardId, storeId || null, cardId || null, paymentStatus, paymentMethod || "Cash"]
        );
        if (status === "Active") {
            await setSlotStatusByNumber(slotNumber, "Occupied");
        }
        if (status === "Completed") {
            await setSlotStatusByNumber(slotNumber, "Available");
        }

        const rows = await getParkingRecords();
        sendSuccess(res, rows.find((record) => record.record_id === result.insertId), { message: "Parking record created successfully." }, 201);
    } catch (error) {
        next(error);
    }
});

const completeParkingRecord = async (id, body = {}) => {
    const [existingRows] = await safeQuery("SELECT * FROM parking_records WHERE record_id = ? LIMIT 1", [id]);
    if (!existingRows.length) {
        throw Object.assign(new Error("Parking record does not exist."), { statusCode: 404 });
    }

    const existing = existingRows[0];
    const values = readFields(body, ["customer_name", "plate_number", "slot_number", "check_in", "check_out", "status", "amount"]);
    if (values.status !== undefined && !["Active", "Completed", "Reserved"].includes(values.status)) {
        values.status = "Active";
    }
    if (values.amount !== undefined) {
        values.amount = parseAmount(values.amount);
    }
    if ((values.status === "Completed" || values.check_out) && (values.amount === undefined || !Number.isFinite(values.amount) || values.amount <= 0)) {
        values.check_out = values.check_out || new Date().toISOString().slice(0, 19).replace("T", " ");
        values.amount = await calculateParkingAmount({ ...existing, ...values });
    }

    await updateRow("parking_records", "record_id", id, values);
    const [updatedRows] = await safeQuery("SELECT * FROM parking_records WHERE record_id = ? LIMIT 1", [id]);
    const updated = updatedRows[0];
    if (updated.status === "Completed") {
        await setSlotStatusByNumber(updated.slot_number, "Available");
    }
    if (updated.status === "Active") {
        await setSlotStatusByNumber(updated.slot_number, "Occupied");
    }

    return updated;
};

app.put("/api/parking_records/:id", async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            throw Object.assign(new Error("Parking record id is invalid."), { statusCode: 400 });
        }
        const updated = await completeParkingRecord(id, req.body || {});
        sendSuccess(res, updated, { message: "Parking record updated successfully." });
    } catch (error) {
        next(error);
    }
});

app.post("/api/parking_records/:id/checkout", async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            throw Object.assign(new Error("Parking record id is invalid."), { statusCode: 400 });
        }
        const updated = await completeParkingRecord(id, {
            ...(req.body || {}),
            status: "Completed",
            check_out: req.body?.check_out || new Date().toISOString().slice(0, 19).replace("T", " ")
        });
        sendSuccess(res, updated, { message: "Parking checkout completed successfully." });
    } catch (error) {
        next(error);
    }
});

app.delete("/api/parking_records/:id", async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            throw Object.assign(new Error("Parking record id is invalid."), { statusCode: 400 });
        }
        const [rows] = await safeQuery("SELECT slot_number, status FROM parking_records WHERE record_id = ? LIMIT 1", [id]);
        await safeQuery("DELETE FROM parking_records WHERE record_id = ?", [id]);
        if (rows[0]?.status === "Active") {
            await setSlotStatusByNumber(rows[0].slot_number, "Available");
        }
        sendSuccess(res, null, { message: "Parking record deleted successfully." });
    } catch (error) {
        next(error);
    }
});

app.post("/api/tickets", async (req, res, next) => {
    try {
        const ticket = req.body || {};
        const plateNumber = cleanString(ticket.plateNumber || ticket.plate_number);
        const slotNumber = cleanString(ticket.parkingSlot || ticket.slot_number);
        const paymentMethod = normalizePaymentMethod(ticket.paymentMethod || ticket.payment_method);
        const amount = parseAmount(ticket.amount);
        const storeId = cleanString(ticket.store_id || ticket.storeId);
        const cardId = cleanString(ticket.card_id || ticket.cardId);
        const customerIdInput = ticket.customer_id;
        const customerId = customerIdInput === null || customerIdInput === undefined || customerIdInput === "" ? await ensureCustomerRecord(ticket) : await ensureCustomerExists(customerIdInput);

        validateRequired({ plateNumber, slotNumber }, ["plateNumber", "slotNumber"], "ticket");
        if (!paymentMethod) {
            throw Object.assign(new Error("Payment method is invalid."), { statusCode: 400 });
        }
        if (!Number.isFinite(amount) || amount < 0) {
            throw Object.assign(new Error("Ticket amount is invalid."), { statusCode: 400 });
        }

        await ensureSlotByNumber(slotNumber);
        const checkIn = new Date().toISOString().slice(0, 19).replace("T", " ");
        const [recordResult] = await safeQuery(
            `INSERT INTO parking_records (customer_name, customer_id, plate_number, slot_number, check_in, status, amount, store_id, card_id, payment_status, payment_method)
             VALUES (?, ?, ?, ?, ?, 'Active', ?, ?, ?, ?, ?)`,
            [
                cleanString(ticket.customerName, "Walk-in Customer"),
                customerId,
                plateNumber,
                slotNumber,
                checkIn,
                amount,
                storeId || null,
                cardId || null,
                amount > 0 ? "Paid" : "Paid",
                paymentMethod || "Cash"
            ]
        );
        await setSlotStatusByNumber(slotNumber, "Occupied");

        const reference = createReference("INV");
        let payment = null;
        if (amount > 0) {
            const [paymentResult] = await safeQuery(
                `INSERT INTO payments (customer_id, amount, payment_method, payment_status, payment_date, reference, notes)
                 VALUES (?, ?, ?, 'Paid', NOW(), ?, ?)`,
                [customerId, amount, paymentMethod, reference, cleanString(ticket.note || ticket.ticketType, "Parking ticket")]
            );
            const payments = await getPayments();
            payment = payments.find((row) => row.payment_id === paymentResult.insertId) || null;
        }

        const invoice = {
            invoice: payment?.reference || reference,
            amount: `$${amount.toFixed(2)}`,
            customer: cleanString(ticket.customerName, "Walk-in Customer"),
            customerName: cleanString(ticket.customerName, "Walk-in Customer"),
            phone: cleanString(ticket.customerPhone),
            customerPhone: cleanString(ticket.customerPhone),
            slot: slotNumber,
            ticketType: cleanString(ticket.ticketType, "Hourly"),
            type: cleanString(ticket.ticketType, "Hourly"),
            notes: cleanString(ticket.note, "Parking ticket"),
            paymentStatus: amount > 0 ? "Paid" : "No Charge",
            paymentMethod,
            date: new Date().toLocaleDateString(),
            time: new Date().toLocaleTimeString(),
            recordId: recordResult.insertId,
            customerId
        };

        res.status(201).json({
            success: true,
            ok: true,
            message: "Ticket sold successfully.",
            customerId,
            recordId: recordResult.insertId,
            payment,
            invoice,
            invoices: [invoice]
        });
    } catch (error) {
        next(error);
    }
});

const getSupportTickets = async () => {
    const [rows] = await safeQuery(
        `SELECT ticket_id,
                ticket_code AS ticket,
                customer_name AS customer,
                issue,
                agent_name AS agent,
                status,
                created_at,
                updated_at
         FROM support_tickets
         ORDER BY created_at DESC, ticket_id DESC`
    );
    return rows;
};

app.get("/api/vip-cards", async (req, res, next) => {
    try {
        sendSuccess(res, await getVipCards());
    } catch (error) {
        next(error);
    }
});

app.get("/api/vip-cards/:storeId", async (req, res, next) => {
    try {
        const storeId = cleanString(req.params.storeId);
        const [rows] = await safeQuery(
            `SELECT vc.*,
                    c.full_name AS customer_name,
                    c.phone,
                    c.email,
                    c.vehicle_info AS customer_vehicle
             FROM vip_cards vc
             LEFT JOIN customers c ON c.customer_id = vc.customer_id
             WHERE vc.store_id = ? OR vc.card_id = ?
             LIMIT 1`,
            [storeId, storeId]
        );
        if (!rows.length) {
            throw Object.assign(new Error("VIP Card not found."), { statusCode: 404 });
        }
        sendSuccess(res, rows[0]);
    } catch (error) {
        next(error);
    }
});

app.post("/api/vip-cards", async (req, res, next) => {
    try {
        const guestName = cleanString(req.body?.guest_name || req.body?.full_name || req.body?.customer_name, "VIP Guest");
        const cardId = cleanString(req.body?.card_id, await generateUniqueCardId());
        const vehicleInfo = optionalString(req.body?.vehicle_info || req.body?.vehicleInfo || req.body?.plate_number || req.body?.plateNumber);
        const customerIdInput = req.body?.customer_id;
        const customerId = customerIdInput === null || customerIdInput === undefined || customerIdInput === "" ? null : await ensureCustomerExists(customerIdInput);
        const status = normalizeVipCardStatus(req.body?.status);
        const parkingAccess = normalizeVipAccess(req.body?.parking_access || req.body?.access);
        const notes = optionalString(req.body?.notes);
        const storeId = cleanString(req.body?.store_id, await generateUniqueStoreId());

        const [existingRows] = await safeQuery("SELECT vip_card_id FROM vip_cards WHERE store_id = ? OR card_id = ? LIMIT 1", [storeId, cardId]);
        if (existingRows.length) {
            throw Object.assign(new Error("VIP Store ID or Card ID already exists."), { statusCode: 409 });
        }

        const [result] = await safeQuery(
            `INSERT INTO vip_cards (store_id, card_id, customer_id, guest_name, vehicle_info, status, parking_access, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [storeId, cardId, customerId, guestName, vehicleInfo, status, parkingAccess, notes]
        );

        const [rows] = await safeQuery(`SELECT * FROM vip_cards WHERE vip_card_id = ? LIMIT 1`, [result.insertId]);
        sendSuccess(res, rows[0], { message: "VIP card created successfully." }, 201);
    } catch (error) {
        next(error);
    }
});

app.put("/api/vip-cards/:id", async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            throw Object.assign(new Error("VIP card id is invalid."), { statusCode: 400 });
        }

        const values = {};
        if (req.body?.store_id !== undefined) {
            values.store_id = cleanString(req.body.store_id);
        }
        if (req.body?.card_id !== undefined) {
            values.card_id = cleanString(req.body.card_id);
        }
        if (req.body?.guest_name !== undefined || req.body?.customer_name !== undefined) {
            values.guest_name = cleanString(req.body.guest_name || req.body.customer_name, "VIP Guest");
        }
        if (req.body?.vehicle_info !== undefined || req.body?.vehicleInfo !== undefined) {
            values.vehicle_info = optionalString(req.body.vehicle_info || req.body.vehicleInfo);
        }
        if (req.body?.status !== undefined) {
            values.status = normalizeVipCardStatus(req.body.status);
        }
        if (req.body?.parking_access !== undefined || req.body?.access !== undefined) {
            values.parking_access = normalizeVipAccess(req.body.parking_access || req.body.access);
        }
        if (req.body?.notes !== undefined) {
            values.notes = optionalString(req.body.notes);
        }
        if (req.body?.customer_id !== undefined) {
            values.customer_id = req.body.customer_id === null || req.body.customer_id === "" ? null : await ensureCustomerExists(req.body.customer_id);
        }

        if (!Object.keys(values).length) {
            throw Object.assign(new Error("No VIP card updates were provided."), { statusCode: 400 });
        }

        await updateRow("vip_cards", "vip_card_id", id, values);
        const [rows] = await safeQuery("SELECT * FROM vip_cards WHERE vip_card_id = ? LIMIT 1", [id]);
        sendSuccess(res, rows[0], { message: "VIP card updated successfully." });
    } catch (error) {
        next(error);
    }
});

app.delete("/api/vip-cards/:id", async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            throw Object.assign(new Error("VIP card id is invalid."), { statusCode: 400 });
        }
        await safeQuery("DELETE FROM vip_cards WHERE vip_card_id = ?", [id]);
        sendSuccess(res, null, { message: "VIP card deleted successfully." });
    } catch (error) {
        next(error);
    }
});

app.post("/api/vip-cards/scan", async (req, res, next) => {
    try {
        const lookup = cleanString(req.body?.store_id || req.body?.card_id || req.body?.cardId || req.body?.query);
        if (!lookup) {
            throw Object.assign(new Error("VIP card lookup is required."), { statusCode: 400 });
        }

        const [rows] = await safeQuery(
            `SELECT vc.*,
                    c.full_name AS customer_name,
                    c.email,
                    c.phone,
                    c.vehicle_info AS customer_vehicle
             FROM vip_cards vc
             LEFT JOIN customers c ON c.customer_id = vc.customer_id
             WHERE vc.store_id = ? OR vc.card_id = ?
             LIMIT 1`,
            [lookup, lookup]
        );

        if (!rows.length) {
            throw Object.assign(new Error("VIP Card not found."), { statusCode: 404 });
        }

        const card = rows[0];
        if (card.status !== "Active") {
            throw Object.assign(new Error("VIP Card is inactive."), { statusCode: 403 });
        }
        if (card.parking_access !== "ALLOWED") {
            throw Object.assign(new Error("Parking access is denied for this VIP card."), { statusCode: 403 });
        }

        const [sessionRows] = await safeQuery(
            `SELECT * FROM parking_records WHERE (store_id = ? OR card_id = ? OR plate_number = ?) AND status = 'Active' ORDER BY check_in DESC LIMIT 1`,
            [card.store_id, card.card_id, card.vehicle_info || card.guest_name || ""]
        );

        sendSuccess(res, {
            card,
            customer: {
                full_name: card.customer_name || card.guest_name,
                phone: card.phone || "",
                email: card.email || "",
                vehicle_info: card.vehicle_info || card.customer_vehicle || ""
            },
            activeSession: sessionRows[0] || null,
            message: "VIP Card verified successfully."
        });
    } catch (error) {
        next(error);
    }
});

app.post("/api/parking/checkout", async (req, res, next) => {
    try {
        let record = null;
        const recordId = Number(req.body?.record_id);
        const lookup = cleanString(req.body?.store_id || req.body?.card_id || req.body?.query || req.body?.plate_number || req.body?.plateNumber || req.body?.slot_number || req.body?.slotNumber);

        if (Number.isInteger(recordId) && recordId > 0) {
            const [rows] = await safeQuery("SELECT * FROM parking_records WHERE record_id = ? LIMIT 1", [recordId]);
            record = rows[0] || null;
        } else if (lookup) {
            const [rows] = await safeQuery(
                `SELECT * FROM parking_records
                 WHERE status <> 'Completed'
                   AND (store_id = ? OR card_id = ? OR plate_number = ? OR slot_number = ?)
                 ORDER BY check_in DESC
                 LIMIT 1`,
                [lookup, lookup, lookup, lookup]
            );
            record = rows[0] || null;
        }

        if (!record) {
            throw Object.assign(new Error("Active parking session not found."), { statusCode: 404 });
        }
        if (record.status === "Completed") {
            throw Object.assign(new Error("Parking session has already been checked out."), { statusCode: 400 });
        }

        const checkoutTime = cleanString(req.body?.checkout_time) || new Date().toISOString().slice(0, 19).replace("T", " ");
        const paymentMethod = normalizePaymentMethod(req.body?.payment_method || "Cash") || "Cash";
        const lookupCard = lookup ? await safeQuery("SELECT * FROM vip_cards WHERE store_id = ? OR card_id = ? LIMIT 1", [lookup, lookup]) : [null];
        const vipCard = lookupCard[0]?.length ? lookupCard[0][0] : null;

        let amount = Number.isFinite(parseAmount(req.body?.amount)) ? parseAmount(req.body?.amount) : await calculateParkingAmount(record);
        if (vipCard && vipCard.status === "Active" && vipCard.parking_access === "ALLOWED") {
            amount = 0;
        }

        const [updatedRows] = await safeQuery(
            `UPDATE parking_records
             SET check_out = ?,
                 status = 'Completed',
                 amount = ?,
                 payment_status = ?,
                 payment_method = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE record_id = ?`,
            [checkoutTime, Number(amount.toFixed(2)), amount > 0 ? "Pending" : "Paid", paymentMethod, record.record_id]
        );

        if (record.slot_number) {
            await setSlotStatusByNumber(record.slot_number, "Available");
        }

        if (amount > 0) {
            const paymentReference = createReference("INV");
            const customerId = record.customer_id || null;
            await safeQuery(
                `INSERT INTO payments (customer_id, amount, payment_method, payment_status, payment_date, reference, notes)
                 VALUES (?, ?, ?, 'Pending', ?, ?, ?)`,
                [customerId, Number(amount.toFixed(2)), paymentMethod, checkoutTime, paymentReference, `Parking checkout for ${record.plate_number || record.customer_name || "guest"}`]
            );
        }

        const [finalRows] = await safeQuery("SELECT * FROM parking_records WHERE record_id = ? LIMIT 1", [record.record_id]);
        sendSuccess(res, finalRows[0], { message: "Checkout completed successfully." });
    } catch (error) {
        next(error);
    }
});

app.get("/api/support_tickets", async (req, res, next) => {
    try {
        sendSuccess(res, await getSupportTickets());
    } catch (error) {
        next(error);
    }
});

app.get("/api/call-center/tickets", async (req, res, next) => {
    try {
        sendSuccess(res, await getSupportTickets());
    } catch (error) {
        next(error);
    }
});

app.post(["/api/support_tickets", "/api/call-center/tickets"], async (req, res, next) => {
    try {
        const customer = cleanString(req.body?.customer || req.body?.customer_name, "Walk-in Customer");
        const issue = cleanString(req.body?.issue);
        const agent = cleanString(req.body?.agent || req.body?.agent_name, "Auto Assigned");
        const status = normalizeTicketStatus(req.body?.status);
        if (!issue) {
            throw Object.assign(new Error("Issue text is required."), { statusCode: 400 });
        }

        const ticketCode = createReference("TCK");
        const [result] = await safeQuery(
            "INSERT INTO support_tickets (ticket_code, customer_name, issue, agent_name, status) VALUES (?, ?, ?, ?, ?)",
            [ticketCode, customer, issue, agent, status]
        );
        const tickets = await getSupportTickets();
        const ticket = tickets.find((row) => row.ticket_id === result.insertId) || {
            ticket_id: result.insertId,
            ticket: ticketCode,
            customer,
            issue,
            agent,
            status
        };
        res.status(201).json({ success: true, ok: true, data: ticket, ticket, message: "Support ticket created successfully." });
    } catch (error) {
        next(error);
    }
});

app.put(["/api/support_tickets/:id", "/api/call-center/tickets/:id"], async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            throw Object.assign(new Error("Ticket id is invalid."), { statusCode: 400 });
        }

        const values = {};
        if (req.body?.customer !== undefined || req.body?.customer_name !== undefined) {
            values.customer_name = cleanString(req.body.customer || req.body.customer_name, "Walk-in Customer");
        }
        if (req.body?.issue !== undefined) {
            values.issue = cleanString(req.body.issue);
        }
        if (req.body?.agent !== undefined || req.body?.agent_name !== undefined) {
            values.agent_name = cleanString(req.body.agent || req.body.agent_name, "Auto Assigned");
        }
        if (req.body?.status !== undefined) {
            values.status = normalizeTicketStatus(req.body.status);
        }

        await updateRow("support_tickets", "ticket_id", id, values);
        const tickets = await getSupportTickets();
        sendSuccess(res, tickets.find((ticket) => ticket.ticket_id === id), { message: "Support ticket updated successfully." });
    } catch (error) {
        next(error);
    }
});

app.delete(["/api/support_tickets/:id", "/api/call-center/tickets/:id"], async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            throw Object.assign(new Error("Ticket id is invalid."), { statusCode: 400 });
        }
        await safeQuery("DELETE FROM support_tickets WHERE ticket_id = ?", [id]);
        sendSuccess(res, null, { message: "Support ticket deleted successfully." });
    } catch (error) {
        next(error);
    }
});

app.get("/api/accounting", async (req, res, next) => {
    try {
        const rows = await getPayments();
        const totalRevenue = rows.filter((row) => row.payment_status === "Paid").reduce((sum, row) => sum + Number(row.amount || 0), 0);
        const paid = rows.filter((row) => row.payment_status === "Paid").reduce((sum, row) => sum + Number(row.amount || 0), 0);
        const pending = rows.filter((row) => row.payment_status === "Pending").reduce((sum, row) => sum + Number(row.amount || 0), 0);
        sendSuccess(res, {
            total_revenue: totalRevenue,
            paid_amount: paid,
            pending_amount: pending,
            rows
        });
    } catch (error) {
        next(error);
    }
});

app.get("/api/reports", async (req, res, next) => {
    try {
        const start = req.query.start || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
        const end = req.query.end || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
        const [[paymentStats]] = await safeQuery(
            "SELECT COUNT(*) AS payment_count, COALESCE(SUM(amount), 0) AS total_payments FROM payments WHERE payment_date BETWEEN ? AND ?",
            [start, end]
        );
        const [[slotStats]] = await safeQuery(
            `SELECT COUNT(*) AS total_slots,
                    SUM(CASE WHEN status = 'Available' THEN 1 ELSE 0 END) AS available_slots,
                    SUM(CASE WHEN status = 'Occupied' THEN 1 ELSE 0 END) AS occupied_slots,
                    SUM(CASE WHEN status = 'Reserved' THEN 1 ELSE 0 END) AS reserved_slots
             FROM parking_slots`
        );
        const [[customerStats]] = await safeQuery("SELECT COUNT(*) AS customer_count FROM customers");
        const [[contractStats]] = await safeQuery("SELECT COUNT(*) AS contract_count FROM contracts");
        const [[staffStats]] = await safeQuery("SELECT COUNT(*) AS staff_count FROM staff");
        const [[recordStats]] = await safeQuery("SELECT COUNT(*) AS parking_record_count FROM parking_records WHERE check_in BETWEEN ? AND ?", [start, end]);

        sendSuccess(res, {
            total_payments: Number(paymentStats.total_payments || 0),
            payment_count: Number(paymentStats.payment_count || 0),
            total_slots: Number(slotStats.total_slots || 0),
            available_slots: Number(slotStats.available_slots || 0),
            occupied_slots: Number(slotStats.occupied_slots || 0),
            reserved_slots: Number(slotStats.reserved_slots || 0),
            customer_count: Number(customerStats.customer_count || 0),
            contract_count: Number(contractStats.contract_count || 0),
            staff_count: Number(staffStats.staff_count || 0),
            parking_record_count: Number(recordStats.parking_record_count || 0),
            start,
            end
        });
    } catch (error) {
        next(error);
    }
});

const buildCsv = (header, rows) => {
    const escapeCsv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    return [header.map(escapeCsv).join(","), ...rows.map((row) => row.map(escapeCsv).join(","))].join("\n");
};

app.get("/api/reports/export", async (req, res, next) => {
    try {
        const payments = await getPayments();
        const records = await getParkingRecords();
        const rows = [
            ...payments.map((payment) => [formatDate(payment.payment_date), "Payment", payment.customer_name, payment.payment_method, payment.amount, payment.payment_status]),
            ...records.map((record) => [formatDate(record.check_in), "Parking", record.customer_name, record.slot_number, record.amount, record.status])
        ];
        const csv = buildCsv(["Date", "Type", "Customer", "Detail", "Amount", "Status"], rows);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", "attachment; filename=smart-parking-reports.csv");
        res.send(csv);
    } catch (error) {
        next(error);
    }
});

app.get("/api/accounting/export", async (req, res, next) => {
    try {
        const payments = await getPayments();
        const csv = buildCsv(
            ["Date", "Customer", "Reference", "Amount", "Payment Method", "Status", "Notes"],
            payments.map((payment) => [formatDate(payment.payment_date), payment.customer_name, payment.reference, payment.amount, payment.payment_method, payment.payment_status, payment.notes])
        );
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", "attachment; filename=smart-parking-accounting.csv");
        res.send(csv);
    } catch (error) {
        next(error);
    }
});

app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
        return res.status(404).json(errorPayload("API route not found."));
    }

    if (req.path === "/") {
        return res.sendFile(path.join(rootDir, "index.html"));
    }

    return res.status(404).send("Not Found");
});

app.use((error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    const statusCode = error.statusCode || error.status || 500;
    const message = statusCode >= 500 ? "Unexpected server error." : error.message;
    if (statusCode >= 500) {
        console.error(error);
    }
    res.status(statusCode).json(errorPayload(message || "Unexpected server error."));
});

const startServer = async (port = defaultPort, attempts = 10) => {
    try {
        await initializeDatabase();
        console.log("Database connected successfully");
    } catch (error) {
        console.error("MySQL connection error:", error.message);
        process.exit(1);
    }

    const server = app.listen(port, () => {
        console.log(`Smart Parking is running at http://localhost:${port}`);
    });

    server.on("error", (error) => {
        if (error.code === "EADDRINUSE" && attempts > 0) {
            const nextPort = port + 1;
            console.warn(`Port ${port} is already in use. Retrying on port ${nextPort}...`);
            server.close(() => startServer(nextPort, attempts - 1));
            return;
        }

        if (error.code === "EADDRINUSE") {
            console.error("Unable to start the app because all retry ports are occupied.");
            process.exit(1);
        }

        console.error("Server startup error:", error.message);
        process.exit(1);
    });

    return server;
};

if (require.main === module) {
    startServer(defaultPort);
}

module.exports = { app, startServer };
