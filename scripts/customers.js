"use strict";

let customers = [];

const customerStatusClass = (status) => status === "Active" ? "active" : status === "Inactive" ? "danger" : "pending";

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

const renderCustomers = (rows = []) => {
    customers = rows;
    const tbody = document.querySelector(".table-section tbody");
    const thead = document.querySelector(".table-section thead");
    const headerTitle = document.querySelector(".table-header h3");
    const headerText = document.querySelector(".table-header p");

    if (headerTitle) {
        headerTitle.textContent = "Customer List";
    }
    if (headerText) {
        headerText.textContent = `${rows.length} records stored in MySQL`;
    }
    if (thead) {
        thead.innerHTML = `
            <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Plate Number</th>
                <th>Status</th>
                <th style="width: 120px;">Action</th>
            </tr>
        `;
    }
    if (!tbody) {
        return;
    }

    tbody.innerHTML = rows.map((customer) => `
        <tr>
            <td>${customer.full_name || "N/A"}</td>
            <td>${customer.phone || "N/A"}</td>
            <td>${customer.email || "N/A"}</td>
            <td>${customer.vehicle_info || "N/A"}</td>
            <td><span class="status ${customerStatusClass(customer.status)}">${customer.status || "Active"}</span></td>
            <td>${window.SmartParkingActions.buildActionCell(customer.customer_id, customer.full_name || "customer")}</td>
        </tr>
    `).join("");
};

const refreshCustomers = async () => {
    renderCustomers(await requestJson("/api/customers"));
};

const submitCustomerForm = async (payload, customer = null) => {
    const body = {
        full_name: (payload.full_name || "").trim(),
        email: (payload.email || "").trim(),
        phone: (payload.phone || "").trim(),
        address: (payload.address || "").trim(),
        vehicle_info: (payload.vehicle_info || "").trim(),
        status: payload.status || "Active"
    };

    if (!body.full_name || !body.email) {
        throw new Error("Customer name and email are required.");
    }

    const url = customer ? `/api/customers/${customer.customer_id}` : "/api/customers";
    const method = customer ? "PUT" : "POST";
    await requestJson(url, {
        method,
        body: JSON.stringify(body)
    });
    await refreshCustomers();
    window.alert(customer ? "Customer updated successfully." : "Customer created successfully.");
};

const openCustomerEditor = (customer = null) => {
    const values = customer ? {
        full_name: customer.full_name || "",
        email: customer.email || "",
        phone: customer.phone || "",
        address: customer.address || "",
        vehicle_info: customer.vehicle_info || "",
        status: customer.status || "Active"
    } : {
        full_name: "",
        email: "",
        phone: "",
        address: "",
        vehicle_info: "",
        status: "Active"
    };

    window.SmartParkingActions.openModal({
        title: customer ? "Edit Customer" : "Add Customer",
        submitLabel: customer ? "Save Changes" : "Create Customer",
        values,
        fields: [
            { name: "full_name", label: "Full name", value: values.full_name },
            { name: "email", label: "Email", value: values.email, type: "email" },
            { name: "phone", label: "Phone", value: values.phone },
            { name: "vehicle_info", label: "Plate number", value: values.vehicle_info },
            { name: "address", label: "Address", value: values.address, fullWidth: true },
            {
                name: "status",
                label: "Status",
                type: "select",
                value: values.status,
                options: [
                    { label: "Active", value: "Active" },
                    { label: "Pending", value: "Pending" },
                    { label: "Inactive", value: "Inactive" }
                ]
            }
        ],
        onSubmit: async (payload) => {
            await submitCustomerForm(payload, customer);
        }
    });
};

const bindCustomerActions = () => {
    const addButton = document.querySelector(".action-button");
    if (addButton && addButton.dataset.bound !== "true") {
        addButton.dataset.bound = "true";
        addButton.addEventListener("click", () => {
            openCustomerEditor();
        });
    }

    const table = document.querySelector(".table-section table");
    if (table && table.dataset.bound !== "true") {
        table.dataset.bound = "true";
        table.addEventListener("click", (event) => {
            const button = event.target.closest("[data-action]");
            if (!button) {
                return;
            }
            const customer = customers.find((item) => String(item.customer_id) === String(button.dataset.id));
            if (!customer) {
                return;
            }

            if (button.dataset.action === "edit") {
                openCustomerEditor(customer);
                return;
            }

            if (button.dataset.action === "delete") {
                if (!window.SmartParkingActions.confirmDelete("Are you sure you want to delete this record?")) {
                    return;
                }
                requestJson(`/api/customers/${customer.customer_id}`, { method: "DELETE" })
                    .then(async () => {
                        await refreshCustomers();
                        window.alert("Customer deleted successfully.");
                    })
                    .catch((error) => window.alert(error.message));
            }
        });
    }
};

SmartParkingData.load()
    .then(async (data) => {
        SmartParkingData.renderPage(data, "customers");
        bindCustomerActions();
        await refreshCustomers();
    })
    .catch((error) => console.error(error));
