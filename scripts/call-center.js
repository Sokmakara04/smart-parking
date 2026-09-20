"use strict";

let tickets = [];

const requestJson = async (url, options = {}) => {
    const response = await fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success === false || result.ok === false) {
        throw new Error(result.message || "Request failed.");
    }
    return result.data ?? result;
};

const renderTickets = (rows = []) => {
    tickets = rows;
    const tableBody = document.querySelector(".table-section tbody");
    const tableHead = document.querySelector(".table-section thead");
    if (tableHead) {
        tableHead.innerHTML = `
            <tr>
                <th>Ticket</th>
                <th>Customer</th>
                <th>Issue</th>
                <th>Agent</th>
                <th>Status</th>
                <th style="width: 120px;">Action</th>
            </tr>
        `;
    }

    if (!tableBody) {
        return;
    }

    tableBody.innerHTML = (rows || []).map((ticket) => {
        const statusClass = ticket.status === "Resolved" ? "active" : ticket.status === "Open" ? "pending" : "info";
        return `
            <tr>
                <td>${ticket.ticket}</td>
                <td>${ticket.customer}</td>
                <td>${ticket.issue}</td>
                <td>${ticket.agent}</td>
                <td><span class="status ${statusClass}">${ticket.status}</span></td>
                <td>${window.SmartParkingActions.buildActionCell(ticket.ticket_id, ticket.ticket || "ticket")}</td>
            </tr>
        `;
    }).join("");
};

const loadTickets = async () => {
    renderTickets(await requestJson("/api/call-center/tickets"));
};

const submitTicketForm = async (payload, ticket = null) => {
    const body = {
        customer: (payload.customer || "Walk-in Customer").trim(),
        issue: (payload.issue || "").trim(),
        agent: (payload.agent || "Auto Assigned").trim(),
        status: payload.status || "Open"
    };

    if (!body.issue) {
        throw new Error("Issue text is required.");
    }

    const url = ticket ? `/api/call-center/tickets/${ticket.ticket_id}` : "/api/call-center/tickets";
    const method = ticket ? "PUT" : "POST";
    await requestJson(url, {
        method,
        body: JSON.stringify(body)
    });
    await loadTickets();
    window.alert(ticket ? "Ticket updated successfully." : "Ticket created successfully.");
};

const openTicketEditor = (ticket = null) => {
    const values = ticket ? {
        customer: ticket.customer || "Walk-in Customer",
        issue: ticket.issue || "",
        agent: ticket.agent || "Auto Assigned",
        status: ticket.status || "Open"
    } : {
        customer: "Walk-in Customer",
        issue: "Customer request for parking slot update",
        agent: "Auto Assigned",
        status: "Open"
    };

    window.SmartParkingActions.openModal({
        title: ticket ? "Edit Ticket" : "Add Ticket",
        submitLabel: ticket ? "Save Changes" : "Create Ticket",
        values,
        fields: [
            { name: "customer", label: "Customer", value: values.customer },
            { name: "agent", label: "Agent", value: values.agent },
            {
                name: "status",
                label: "Status",
                type: "select",
                value: values.status,
                options: [
                    { label: "Open", value: "Open" },
                    { label: "In Progress", value: "In Progress" },
                    { label: "Resolved", value: "Resolved" }
                ]
            },
            { name: "issue", label: "Issue", value: values.issue, type: "textarea", fullWidth: true }
        ],
        onSubmit: async (payload) => {
            await submitTicketForm(payload, ticket);
        }
    });
};

const bindCallCenterActions = () => {
    const newTicketButton = document.getElementById("newTicketButton");
    if (!newTicketButton || newTicketButton.dataset.bound === "true") {
        return;
    }
    newTicketButton.dataset.bound = "true";
    newTicketButton.addEventListener("click", () => openTicketEditor());

    const table = document.querySelector(".table-section table");
    if (!table || table.dataset.bound === "true") {
        return;
    }
    table.dataset.bound = "true";
    table.addEventListener("click", (event) => {
        const button = event.target.closest("[data-action]");
        if (!button) {
            return;
        }
        const ticket = tickets.find((item) => String(item.ticket_id) === String(button.dataset.id));
        if (!ticket) {
            return;
        }

        if (button.dataset.action === "edit") {
            openTicketEditor(ticket);
            return;
        }

        if (button.dataset.action === "delete") {
            if (!window.SmartParkingActions.confirmDelete("Are you sure you want to delete this record?")) {
                return;
            }
            requestJson(`/api/call-center/tickets/${ticket.ticket_id}`, { method: "DELETE" })
                .then(async () => {
                    await loadTickets();
                    window.alert("Support ticket deleted successfully.");
                })
                .catch((error) => window.alert(error.message));
        }
    });
};

SmartParkingData.load()
    .then(async (data) => {
        SmartParkingData.renderPage(data, "callCenter");
        bindCallCenterActions();
        await loadTickets();
    })
    .catch((error) => console.error(error));
