"use strict";

const { app, startServer } = require("./src/server");

if (require.main === module) {
    const port = Number(process.env.PORT) || 3000;
    startServer(port);
}

module.exports = app;
