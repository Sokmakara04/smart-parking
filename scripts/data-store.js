"use strict";

window.SmartParkingData = (() => {
    let cachedData = null;

    const load = async () => {
        if (cachedData) {
            return cachedData;
        }

        const response = await fetch("/api/data");
        if (!response.ok) {
            throw new Error("Unable to load smart parking data from the database.");
        }

        cachedData = await response.json();
        return cachedData;
    };

    const getPage = (data, pageName) => data.pages[pageName] || {};

    const formatDisplayValue = (value, title = "") => {
        const safeValue = value ?? "";
        if (safeValue === "" || safeValue === null || safeValue === undefined) {
            return "";
        }

        if (typeof safeValue === "string" && /^\s*\$/.test(safeValue)) {
            return safeValue;
        }

        const moneyTitle = /amount|revenue|cost|profit|price|paid|pending payout|monthly value|today collected|expenses|net profit|balance|invoice|cash/i.test(title);
        const countTitle = /slots|customers|staff|tickets|contracts|records|count|total|available|occupied|pending approval|expiring soon|agents online|in progress|resolved today|open tickets/i.test(title);

        if (typeof safeValue === "number") {
            const numericValue = Number(safeValue);
            const formatted = Number.isInteger(numericValue)
                ? numericValue.toLocaleString("en-US")
                : numericValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            if (moneyTitle && !countTitle) {
                return `$${formatted}`;
            }

            return formatted;
        }

        if (typeof safeValue === "string" && /^-?\d+(\.\d+)?$/.test(safeValue.trim())) {
            const numericValue = Number(safeValue);
            const formatted = Number.isInteger(numericValue)
                ? numericValue.toLocaleString("en-US")
                : numericValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            if (moneyTitle && !countTitle) {
                return `$${formatted}`;
            }

            return formatted;
        }

        return String(safeValue);
    };

    const setCards = (cards = []) => {
        document.querySelectorAll(".cards .card").forEach((card, index) => {
            const cardData = cards[index];
            if (!cardData) {
                return;
            }

            const title = card.querySelector("h3");
            const value = card.querySelector("h2");
            const icon = card.querySelector("i");

            if (title) {
                title.textContent = cardData.title;
            }

            if (value) {
                value.textContent = formatDisplayValue(cardData.value, cardData.title || "");
            }

            if (icon && cardData.icon) {
                icon.className = cardData.icon;
            }
        });
    };

    const statusClass = (type = "info") => {
        const classes = {
            active: "active",
            danger: "inactive",
            info: "info",
            pending: "pending",
            success: "active",
            warning: "pending"
        };

        return classes[type] || "info";
    };

    const badgeClass = (type = "info") => {
        const classes = {
            active: "success",
            danger: "danger",
            info: "info",
            pending: "warning",
            success: "success",
            warning: "warning"
        };

        return classes[type] || "info";
    };

    const renderTable = (tableData, selector = ".table-section") => {
        if (!tableData) {
            return;
        }

        const section = document.querySelector(selector);
        const table = section ? section.querySelector("table") : null;
        if (!section || !table) {
            return;
        }

        const headerTitle = section.querySelector(".table-header h3");
        const headerText = section.querySelector(".table-header p");
        const thead = table.querySelector("thead");
        const tbody = table.querySelector("tbody");

        if (headerTitle && tableData.title) {
            headerTitle.textContent = tableData.title;
        }

        if (headerText && tableData.description) {
            headerText.textContent = tableData.description;
        }

        if (thead) {
            thead.innerHTML = `<tr>${(tableData.columns || []).map((column) => `<th>${column}</th>`).join("")}</tr>`;
        }

        if (tbody) {
            tbody.innerHTML = (tableData.rows || []).map((row) => {
                const values = (row.values || []).map((value) => `<td>${value}</td>`).join("");
                const status = row.status
                    ? `<td><span class="status ${statusClass(row.status.type)}">${row.status.label}</span></td>`
                    : "";

                return `<tr>${values}${status}</tr>`;
            }).join("");
        }
    };

    const renderSlots = (slots = []) => {
        const grid = document.querySelector(".slot-grid");
        if (!grid) {
            return;
        }

        grid.innerHTML = slots.map((slot) => `
            <div class="slot-card ${slot.state || ""}">
                <h3>${slot.name}</h3>
                <p>${slot.description}</p>
                <span class="badge ${badgeClass(slot.badge.type)}">${slot.badge.label}</span>
            </div>
        `).join("");
    };

    const renderReports = (reports = []) => {
        const grid = document.querySelector(".report-grid");
        if (!grid) {
            return;
        }

        grid.innerHTML = reports.map((report) => `
            <div class="report-card">
                <h3>${report.title}</h3>
                <p>${report.description}</p>
                <span class="badge ${badgeClass(report.badge.type)}">${report.badge.label}</span>
            </div>
        `).join("");
    };

    const renderSettings = (panels = []) => {
        const grid = document.querySelector(".settings-grid");
        if (!grid) {
            return;
        }

        const settingsPanels = Array.isArray(panels)
            ? panels
            : Array.isArray(panels?.settings)
                ? panels.settings
                : [];

        grid.innerHTML = settingsPanels.map((panel) => `
            <div class="settings-panel">
                <h3>${panel?.title || "Settings"}</h3>
                ${(panel?.rows || []).map((row) => `
                    <div class="setting-row">
                        <span>${row?.label || ""}</span>
                        <span class="setting-value">${row?.value ?? ""}</span>
                    </div>
                `).join("")}
            </div>
        `).join("");
    };

    const renderInvoices = (invoices = []) => {
        const list = document.querySelector(".small-invoice-list");
        const countText = document.querySelector(".small-invoice-panel .table-header p");
        const invoiceGrid = document.querySelector(".invoice-grid");
        const invoiceHeaderText = document.querySelector(".invoice-header p");

        const normalizeInvoice = (invoice = {}) => {
            const customerName = invoice.customer || invoice.customerName || "Walk-in Customer";
            const initials = customerName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "WC";
            const recordId = invoice.recordId ?? invoice.record_id ?? invoice.id ?? null;

            return {
                invoice: invoice.invoice || invoice.reference || "INV-0000",
                amount: invoice.amount || "$0.00",
                customer: customerName,
                initials,
                phone: invoice.phone || invoice.customerPhone || "No phone",
                slot: invoice.slot || "N/A",
                type: invoice.type || invoice.ticketType || "Hourly",
                recordId
            };
        };

        const normalizedInvoices = invoices.map(normalizeInvoice);

        if (countText) {
            countText.textContent = `${normalizedInvoices.length} customer invoices`;
        }

        if (invoiceHeaderText) {
            invoiceHeaderText.textContent = `${normalizedInvoices.length} customer invoices`;
        }

        if (list) {
            list.innerHTML = normalizedInvoices.map((invoice) => `
                <article class="small-invoice-card">
                    <div class="small-invoice-top">
                        <span>${invoice.invoice}</span>
                        <strong>${invoice.amount}</strong>
                    </div>
                    <div class="small-invoice-customer">
                        <span class="customer-initials">${invoice.initials}</span>
                        <div>
                            <h4>${invoice.customer}</h4>
                            <p>${invoice.phone}</p>
                        </div>
                    </div>
                    <div class="small-invoice-meta">
                        <span><i class="fa-solid fa-square-parking"></i> ${invoice.slot}</span>
                        <span>${invoice.type}</span>
                    </div>
                </article>
            `).join("");
        }

        if (invoiceGrid) {
            invoiceGrid.innerHTML = normalizedInvoices.map((invoice) => `
                <div class="invoice-card">
                    <div class="invoice-top">
                        <span>${invoice.invoice}</span>
                        <strong>${invoice.amount}</strong>
                    </div>
                    <div class="invoice-customer">
                        <div class="invoice-avatar">${invoice.initials}</div>
                        <div>
                            <h3>${invoice.customer}</h3>
                            <p>${invoice.phone}</p>
                        </div>
                    </div>
                    <div class="invoice-divider"></div>
                    <div class="invoice-bottom">
                        <span><i class="fa-solid fa-square-parking"></i> ${invoice.slot}</span>
                        <span>${invoice.type}</span>
                    </div>
                    ${invoice.recordId ? `
                        <div class="invoice-divider"></div>
                        <div class="invoice-bottom" style="justify-content: flex-end;">
                            <button type="button" class="action-button secondary" data-checkout-record-id="${invoice.recordId}" style="padding: 0.35rem 0.7rem; font-size: 0.8rem;">
                                <i class="fa-solid fa-right-from-bracket"></i>
                                Check Out
                            </button>
                        </div>
                    ` : ""}
                </div>
            `).join("");
        }
    };

    const fillSelect = (id, options = []) => {
        const select = document.getElementById(id);
        if (!select || !options.length) {
            return;
        }

        select.innerHTML = options.map((option) => `<option>${option}</option>`).join("");
    };

    const buildCsv = (rows) => {
        const lines = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","));
        return lines.join("\n");
    };

    const downloadCsv = (filename, rows) => {
        const csv = buildCsv(rows);
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    };

    const renderPage = (data, pageName) => {
        const page = getPage(data, pageName) || {};
        const pageData = Array.isArray(page) ? { settings: page } : page;

        setCards(pageData.cards || []);
        renderTable(pageData.table || null);
        renderSlots(pageData.slots || []);
        renderReports(pageData.reports || []);
        renderSettings(pageData.settings || []);
        renderInvoices(pageData.invoices || []);
        return pageData;
    };

    const saveTicket = async (ticket) => {
        const response = await fetch("/api/tickets", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(ticket)
        });

        if (!response.ok) {
            throw new Error("Ticket could not be saved.");
        }

        cachedData = null;
        return response.json();
    };

    return {
        buildCsv,
        downloadCsv,
        fillSelect,
        getPage,
        load,
        renderInvoices,
        renderPage,
        saveTicket,
        setCards
    };
})();

