"use strict";

const { startServer } = require("./src/server");

const port = Number(process.env.PORT) || 3000;
startServer(port);
