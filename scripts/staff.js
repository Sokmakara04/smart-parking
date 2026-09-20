"use strict";

let staffRecords = [];

const staffStatusClass = (status) => status === "Active" ? "active" : "pending";

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

const renderStaff = (rows = []) => {
    staffRecords = rows;
    const tbody = document.querySelector(".table-section tbody");
    const thead = document.querySelector(".table-section thead");

    if (thead) {
        thead.innerHTML = `
            <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Email</th>
                <th>Username</th>
                <th>Status</th>
                <th style="width: 120px;">Action</th>
            </tr>
        `;
    }

    if (!tbody) {
        return;
    }

    tbody.innerHTML = rows.map((staff) => `
        <tr>
            <td>${staff.full_name || "N/A"}</td>
            <td>${staff.position || "Staff"}</td>
            <td>${staff.email || "N/A"}</td>
            <td>${staff.username || "N/A"}</td>
            <td><span class="status ${staffStatusClass(staff.status)}">${staff.status || "Active"}</span></td>
            <td>${window.SmartParkingActions.buildActionCell(staff.staff_id, staff.full_name || "staff")}</td>
        </tr>
    `).join("");
};

const refreshStaff = async () => {
    renderStaff(await requestJson("/api/staff"));
};

const submitStaffForm = async (payload, staff = null) => {
    const body = {
        full_name: (payload.full_name || "").trim(),
        email: (payload.email || "").trim(),
        phone: (payload.phone || "").trim(),
        position: (payload.position || "").trim() || "Staff",
        username: (payload.username || "").trim(),
        password: (payload.password || "").trim(),
        status: payload.status || "Active"
    };

    if (!body.full_name || !body.email || !body.username || (!staff && !body.password)) {
        throw new Error("Name, email, username, and password are required.");
    }
    if (body.password && body.password.length < 6) {
        throw new Error("Password must be at least 6 characters.");
    }

    const url = staff ? `/api/staff/${staff.staff_id}` : "/api/staff";
    const method = staff ? "PUT" : "POST";
    await requestJson(url, {
        method,
        body: JSON.stringify(body)
    });
    await refreshStaff();
    window.alert(staff ? "Staff updated successfully." : "Staff created successfully.");
};

const openStaffEditor = (staff = null) => {
    const values = staff ? {
        full_name: staff.full_name || "",
        email: staff.email || "",
        phone: staff.phone || "",
        position: staff.position || "Staff",
        username: staff.username || "",
        password: "",
        status: staff.status || "Active"
    } : {
        full_name: "",
        email: "",
        phone: "",
        position: "Staff",
        username: "",
        password: "",
        status: "Active"
    };

    window.SmartParkingActions.openModal({
        title: staff ? "Edit Staff" : "Add Staff",
        submitLabel: staff ? "Save Changes" : "Create Staff",
        values,
        fields: [
            { name: "full_name", label: "Full name", value: values.full_name },
            { name: "email", label: "Email", value: values.email, type: "email" },
            { name: "phone", label: "Phone", value: values.phone },
            { name: "position", label: "Role", value: values.position },
            { name: "username", label: "Username", value: values.username },
            { name: "password", label: "Password", value: values.password, type: "password", placeholder: staff ? "Leave blank to keep current password" : "Enter password" },
            {
                name: "status",
                label: "Status",
                type: "select",
                value: values.status,
                options: [
                    { label: "Active", value: "Active" },
                    { label: "Inactive", value: "Inactive" }
                ]
            }
        ],
        onSubmit: async (payload) => {
            if (!staff && !payload.password) {
                throw new Error("Password is required.");
            }
            if (staff && payload.password === "") {
                delete payload.password;
            }
            await submitStaffForm(payload, staff);
        }
    });
};

const bindStaffActions = () => {
    const addButton = document.querySelector(".action-button");
    if (!addButton || addButton.dataset.bound === "true") {
        return;
    }
    addButton.dataset.bound = "true";
    addButton.addEventListener("click", () => openStaffEditor());

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
        const staff = staffRecords.find((item) => String(item.staff_id) === String(button.dataset.id));
        if (!staff) {
            return;
        }

        if (button.dataset.action === "edit") {
            openStaffEditor(staff);
            return;
        }

        if (button.dataset.action === "delete") {
            if (!window.SmartParkingActions.confirmDelete("Are you sure you want to delete this record?")) {
                return;
            }
            requestJson(`/api/staff/${staff.staff_id}`, { method: "DELETE" })
                .then(async () => {
                    await refreshStaff();
                    window.alert("Staff deleted successfully.");
                })
                .catch((error) => window.alert(error.message));
        }
    });
};

SmartParkingData.load()
    .then(async (data) => {
        SmartParkingData.renderPage(data, "staff");
        bindStaffActions();
        await refreshStaff();
    })
    .catch((error) => console.error(error));
