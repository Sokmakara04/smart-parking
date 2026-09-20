CREATE DATABASE IF NOT EXISTS smart_parking;
USE smart_parking;

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
);

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
);

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
);

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
);

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
);

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
    INDEX idx_payments_status (payment_status),
    INDEX idx_payments_contract (contract_id)
);

CREATE TABLE IF NOT EXISTS settings (
    setting_id INT AUTO_INCREMENT PRIMARY KEY,
    setting_group VARCHAR(80) NOT NULL DEFAULT 'System',
    setting_key VARCHAR(120) NOT NULL,
    setting_value VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_setting (setting_group, setting_key),
    INDEX idx_settings_group (setting_group)
);

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
    INDEX idx_records_status (status)
);

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
);

INSERT INTO settings (setting_group, setting_key, setting_value)
VALUES
('Parking Rates', 'Hourly Rate', '$2.00'),
('Parking Rates', 'Daily Max', '$12.00'),
('Parking Rates', 'Monthly Pass', '$85.00'),
('Parking Rates', 'Lost Ticket', '$10.00'),
('Notifications', 'SMS Alerts', 'On'),
('Notifications', 'Email Reports', 'On'),
('Notifications', 'Sensor Alerts', 'On'),
('Access Roles', 'Administrators', '3'),
('Access Roles', 'Supervisors', '6'),
('Access Roles', 'Operators', '22'),
('System', 'Auto Backup', 'Daily'),
('System', 'Currency', 'USD'),
('System', 'Time Zone', 'GMT+7')
ON DUPLICATE KEY UPDATE setting_value = setting_value;

INSERT INTO parking_slots (slot_number, floor, vehicle_type, status, price)
VALUES
('A-01', 'Ground Floor', 'Car', 'Available', 2.00),
('A-02', 'Ground Floor', 'Car', 'Occupied', 2.00),
('A-03', 'Ground Floor', 'Car', 'Reserved', 2.00),
('B-01', '1st Floor', 'Car', 'Available', 2.00),
('B-02', '1st Floor', 'Car', 'Available', 2.00),
('C-01', '2nd Floor', 'VIP', 'Available', 0.00)
ON DUPLICATE KEY UPDATE slot_number = VALUES(slot_number);

INSERT INTO customers (full_name, email, phone, address, vehicle_info, status)
VALUES
('John Smith', 'john@example.com', '012 345 678', 'Phnom Penh', '2AB-1234', 'Active'),
('Sophia Chen', 'sophia@example.com', '010 555 824', 'Siem Reap', '2EF-9999', 'Pending'),
('David Kim', 'david@example.com', '096 884 221', 'Kampot', '2CD-4321', 'Active')
ON DUPLICATE KEY UPDATE full_name = VALUES(full_name);

INSERT INTO staff (full_name, email, phone, position, username, password, status)
VALUES
('Rina Sok', 'rina@example.com', '012111222', 'Supervisor', 'rina', '$2a$10$R/0P9bgjLw55YdYAEozBjeXC8gM2ZL0Q2Xx2gHf4cRQ2N4s0x5SgK', 'Active'),
('Malis Dara', 'malis@example.com', '012222333', 'Attendant', 'malis', '$2a$10$R/0P9bgjLw55YdYAEozBjeXC8gM2ZL0Q2Xx2gHf4cRQ2N4s0x5SgK', 'Active')
ON DUPLICATE KEY UPDATE full_name = VALUES(full_name);

