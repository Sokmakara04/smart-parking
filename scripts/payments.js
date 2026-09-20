"use strict";

let payments = [];

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

const renderPayments = (rows = []) => {
    payments = rows;
    const tbody = document.querySelector(".table-section tbody");
    const thead = document.querySelector(".table-section thead");

    if (thead) {
        thead.innerHTML = `
            <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Status</th>
                <th style="width: 120px;">Action</th>
            </tr>
        `;
    }

    if (!tbody) {
        return;
    }

    tbody.innerHTML = rows.map((payment) => `
        <tr>
            <td>${payment.reference || payment.payment_id || "N/A"}</td>
            <td>${payment.customer_name || "Walk-in Customer"}</td>
            <td>$${Number(payment.amount || 0).toFixed(2)}</td>
            <td>${payment.payment_method || "Cash"}</td>
            <td><span class="status ${payment.payment_status === "Paid" ? "active" : "pending"}">${payment.payment_status || "Paid"}</span></td>
            <td>${window.SmartParkingActions.buildActionCell(payment.payment_id, payment.reference || "payment")}</td>
        </tr>
    `).join("");
};

const refreshPayments = async () => {
    renderPayments(await requestJson("/api/payments"));
};

const submitPaymentForm = async (payload, payment = null) => {
    const body = {
        customer_id: payload.customer_id ? Number(payload.customer_id) : null,
        contract_id: payload.contract_id || null,
        amount: Number(payload.amount || 0),
        payment_method: payload.payment_method || "Cash",
        payment_status: payload.payment_status || "Paid",
        payment_date: payload.payment_date || new Date().toISOString().slice(0, 19).replace("T", " "),
        reference: payload.reference || `INV-${Date.now().toString().slice(-6)}`,
        notes: payload.notes || ""
    };

    if (!Number.isFinite(body.amount) || body.amount <= 0) {
        throw new Error("Payment amount must be greater than zero.");
    }

    const url = payment ? `/api/payments/${payment.payment_id}` : "/api/payments";
    const method = payment ? "PUT" : "POST";
    await requestJson(url, {
        method,
        body: JSON.stringify(body)
    });
    await refreshPayments();
    window.alert(payment ? "Payment updated successfully." : "Payment recorded successfully.");
};

const openPaymentEditor = (payment = null) => {
    const values = payment ? {
        customer_id: payment.customer_id || "",
        contract_id: payment.contract_id || "",
        amount: payment.amount || "",
        payment_method: payment.payment_method || "Cash",
        payment_status: payment.payment_status || "Paid",
        payment_date: payment.payment_date ? payment.payment_date.slice(0, 16) : new Date().toISOString().slice(0, 16),
        reference: payment.reference || "",
        notes: payment.notes || ""
    } : {
        customer_id: "",
        contract_id: "",
        amount: "25.00",
        payment_method: "Card",
        payment_status: "Paid",
        payment_date: new Date().toISOString().slice(0, 16),
        reference: `INV-${Date.now().toString().slice(-6)}`,
        notes: ""
    };

    window.SmartParkingActions.openModal({
        title: payment ? "Edit Payment" : "Add Payment",
        submitLabel: payment ? "Save Changes" : "Record Payment",
        values,
        fields: [
            { name: "reference", label: "Invoice reference", value: values.reference },
            { name: "customer_id", label: "Customer ID", value: values.customer_id, type: "number", min: 1 },
            { name: "contract_id", label: "Contract ID", value: values.contract_id },
            { name: "amount", label: "Amount", value: values.amount, type: "number", step: "0.01", min: 0 },
            {
                name: "payment_method",
                label: "Method",
                type: "select",
                value: values.payment_method,
                options: [
                    { label: "Cash", value: "Cash" },
                    { label: "ABA", value: "ABA" },
                    { label: "Card", value: "Card" },
                    { label: "Bank Transfer", value: "Bank Transfer" },
                    { label: "KHQR", value: "KHQR" },
                    { label: "Mobile Wallet", value: "Mobile Wallet" }
                ]
            },
            {
                name: "payment_status",
                label: "Status",
                type: "select",
                value: values.payment_status,
                options: [
                    { label: "Paid", value: "Paid" },
                    { label: "Pending", value: "Pending" },
                    { label: "Failed", value: "Failed" }
                ]
            },
            { name: "payment_date", label: "Payment date", value: values.payment_date, type: "datetime-local" },
            { name: "notes", label: "Notes", value: values.notes, type: "textarea", fullWidth: true }
        ],
        onSubmit: async (payload) => {
            await submitPaymentForm(payload, payment);
        }
    });
};

const bindPaymentActions = () => {
    const addButton = document.querySelector(".action-button");
    if (!addButton || addButton.dataset.bound === "true") {
        return;
    }
    addButton.dataset.bound = "true";
    addButton.addEventListener("click", () => openPaymentEditor());

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
        const payment = payments.find((item) => String(item.payment_id) === String(button.dataset.id));
        if (!payment) {
            return;
        }

        if (button.dataset.action === "edit") {
            openPaymentEditor(payment);
            return;
        }

        if (button.dataset.action === "delete") {
            if (!window.SmartParkingActions.confirmDelete("Are you sure you want to delete this record?")) {
                return;
            }
            requestJson(`/api/payments/${payment.payment_id}`, { method: "DELETE" })
                .then(async () => {
                    await refreshPayments();
                    window.alert("Payment deleted successfully.");
                })
                .catch((error) => window.alert(error.message));
        }
    });
};

SmartParkingData.load()
    .then(async (data) => {
        SmartParkingData.renderPage(data, "payments");
        bindPaymentActions();
        await refreshPayments();
    })
    .catch((error) => console.error(error));
