"use strict";

const { initializeDatabase } = require("../src/db");

initializeDatabase()
    .then(() => {
        console.log("MySQL database initialized successfully.");
    })
    .catch((error) => {
        console.error("Database initialization failed:", error.message);
        process.exit(1);
    });
