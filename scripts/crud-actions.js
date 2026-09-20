"use strict";

window.SmartParkingActions = (() => {
    const getSafeId = (value) => {
        if (value === null || value === undefined || value === "") {
            return "";
        }
        return String(value);
    };

    const buildActionCell = (id, label = "Record") => {
        const safeId = getSafeId(id);
        if (!safeId) {
            return "";
        }

        return `
            <div class="action-buttons" data-row-id="${safeId}">
                <button class="action-btn edit-btn" type="button" data-action="edit" data-id="${safeId}" title="Edit ${label}" aria-label="Edit ${label}">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button class="action-btn delete-btn" type="button" data-action="delete" data-id="${safeId}" title="Delete ${label}" aria-label="Delete ${label}">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
    };

    const confirmDelete = (message = "Are you sure you want to delete this record?") => window.confirm(message);

    const openModal = ({ title, fields = [], values = {}, submitLabel = "Save Changes", onSubmit }) => {
        const overlay = document.createElement("div");
        overlay.className = "smart-modal-overlay";

        const modal = document.createElement("div");
        modal.className = "smart-modal";

        const header = document.createElement("div");
        header.className = "smart-modal-header";
        header.innerHTML = `
            <h3>${title}</h3>
            <button type="button" class="smart-modal-close" aria-label="Close">×</button>
        `;

        const form = document.createElement("form");
        form.className = "smart-modal-form";

        const grid = document.createElement("div");
        grid.className = "smart-modal-grid";

        fields.forEach((field) => {
            const wrapper = document.createElement("label");
            wrapper.className = `smart-modal-field ${field.fullWidth ? "full" : ""}`;

            const label = document.createElement("span");
            label.textContent = field.label;

            let control = null;
            const value = Object.prototype.hasOwnProperty.call(values, field.name) ? values[field.name] : (field.value ?? "");

            if (field.type === "select") {
                control = document.createElement("select");
                control.name = field.name;
                (field.options || []).forEach((option) => {
                    const optionEl = document.createElement("option");
                    optionEl.value = option.value;
                    optionEl.textContent = option.label;
                    if (String(option.value) === String(value ?? "")) {
                        optionEl.selected = true;
                    }
                    control.appendChild(optionEl);
                });
            } else if (field.type === "textarea") {
                control = document.createElement("textarea");
                control.name = field.name;
                control.value = value ?? "";
            } else {
                control = document.createElement("input");
                control.type = field.type || "text";
                control.name = field.name;
                control.value = value ?? "";
                if (field.placeholder) {
                    control.placeholder = field.placeholder;
                }
                if (field.min !== undefined) {
                    control.min = String(field.min);
                }
                if (field.step !== undefined) {
                    control.step = String(field.step);
                }
            }

            wrapper.appendChild(label);
            wrapper.appendChild(control);
            grid.appendChild(wrapper);
        });

        const actions = document.createElement("div");
        actions.className = "smart-modal-actions";
        actions.innerHTML = `
            <button type="button" class="action-button secondary" data-action="cancel">Cancel</button>
            <button type="submit" class="action-button">${submitLabel}</button>
        `;

        form.appendChild(grid);
        form.appendChild(actions);

        modal.appendChild(header);
        modal.appendChild(form);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const closeModal = () => overlay.remove();

        header.querySelector(".smart-modal-close").addEventListener("click", closeModal);
        actions.querySelector("[data-action='cancel']").addEventListener("click", closeModal);
        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) {
                closeModal();
            }
        });

        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const formData = new FormData(form);
            const payload = {};
            fields.forEach((field) => {
                const rawValue = formData.get(field.name);
                if (rawValue === null || rawValue === undefined) {
                    return;
                }
                payload[field.name] = field.type === "number" ? Number(rawValue) : String(rawValue);
            });

            if (typeof onSubmit === "function") {
                try {
                    const result = await onSubmit(payload);
                    if (result !== false) {
                        closeModal();
                    }
                } catch (error) {
                    window.alert(error?.message || "Unable to save the record.");
                }
                return;
            }

            closeModal();
        });

        return { overlay, form, close: closeModal };
    };

    return {
        buildActionCell,
        confirmDelete,
        openModal
    };
})();
