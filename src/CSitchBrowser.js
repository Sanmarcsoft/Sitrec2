/**
 * S3 Sitch Browser - full-screen dialog for browsing saved sitches.
 * Supports a list+preview mode and a thumbnail grid mode.
 */
import {SITREC_SERVER} from "./configUtils";

export class CSitchBrowser {
    constructor(fileManager) {
        this.fileManager = fileManager;
        this.sitches = []; // [{name, date, screenshotUrl}]
        this.filtered = [];
        this.sortColumn = "date";
        this.sortAsc = false;
        this.searchText = "";
        this.selectedName = null;
        this.overlay = null;
        this.viewMode = "thumbnails"; // "list" or "thumbnails"
        this.thumbColumns = 3;
        this._thumbObserver = null;
    }

    open() {
        if (this.overlay) return;
        this.fetchFromServer();
    }

    fetchFromServer() {
        fetch(SITREC_SERVER + "getsitches.php?get=myfiles", {mode: 'cors'})
            .then(r => {
                if (r.status !== 200) throw new Error(`Server returned ${r.status}`);
                return r.json();
            })
            .then(data => {
                this.sitches = data.map(entry => ({
                    name: String(entry[0]),
                    date: String(entry[1]),
                    screenshotUrl: entry[2] || null,
                }));
                this.applyFilterAndSort();
                this.show();
            })
            .catch(err => {
                console.error("CSitchBrowser fetch error:", err);
                this.sitches = [];
                this.applyFilterAndSort();
                this.show();
            });
    }

    applyFilterAndSort() {
        let list = this.sitches;
        if (this.searchText) {
            list = list.filter(s => this._matchesSearch(s.name, this.searchText));
        }
        list = [...list];
        list.sort((a, b) => {
            let cmp;
            if (this.sortColumn === "name") {
                cmp = a.name.localeCompare(b.name);
            } else {
                cmp = a.date.localeCompare(b.date);
            }
            return this.sortAsc ? cmp : -cmp;
        });
        this.filtered = list;
    }

    show() {
        if (this.overlay) this.close();
        this.selectedName = null;

        const overlay = document.createElement("div");
        this.overlay = overlay;
        Object.assign(overlay.style, {
            position: "fixed",
            left: "0", top: "0", width: "100%", height: "100%",
            backgroundColor: "rgba(0,0,0,0.7)",
            zIndex: "10002",
            display: "flex",
            fontFamily: "system-ui, -apple-system, sans-serif",
            color: "#e0e0e0",
        });

        // --- Sidebar ---
        const sidebar = document.createElement("div");
        Object.assign(sidebar.style, {
            width: "180px",
            minWidth: "180px",
            backgroundColor: "#1e1e2e",
            display: "flex",
            flexDirection: "column",
            padding: "16px",
            gap: "8px",
            borderRight: "1px solid #333",
        });

        const makeLink = (text, onClick, active) => {
            const a = document.createElement("a");
            a.textContent = text;
            a.href = "#";
            Object.assign(a.style, {
                color: active ? "#e0e0e0" : "#8ab4f8",
                textDecoration: "none",
                fontSize: "15px",
                padding: "8px 12px",
                borderRadius: "6px",
                backgroundColor: active ? "#2a2a3e" : "transparent",
            });
            a.addEventListener("mouseenter", () => a.style.backgroundColor = "#2a2a3e");
            a.addEventListener("mouseleave", () => a.style.backgroundColor = active ? "#2a2a3e" : "transparent");
            a.addEventListener("click", e => { e.preventDefault(); onClick(); });
            return a;
        };

        sidebar.appendChild(makeLink("Home", () => {}));
        sidebar.appendChild(makeLink("Deleted", () => {}));

        // View mode links
        const viewSpacer = document.createElement("div");
        viewSpacer.style.marginTop = "16px";
        viewSpacer.style.borderTop = "1px solid #333";
        viewSpacer.style.paddingTop = "12px";
        const viewLabel = document.createElement("div");
        Object.assign(viewLabel.style, { fontSize: "11px", color: "#666", textTransform: "uppercase", letterSpacing: "0.5px", padding: "0 12px 4px" });
        viewLabel.textContent = "View";
        viewSpacer.appendChild(viewLabel);
        sidebar.appendChild(viewSpacer);

        this._listLink = makeLink("List", () => { this.viewMode = "list"; this.rebuildContent(); }, this.viewMode === "list");
        this._thumbLink = makeLink("Thumbnails", () => { this.viewMode = "thumbnails"; this.rebuildContent(); }, this.viewMode === "thumbnails");
        sidebar.appendChild(this._listLink);
        sidebar.appendChild(this._thumbLink);

        const spacer = document.createElement("div");
        spacer.style.flex = "1";
        sidebar.appendChild(spacer);

        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "Cancel";
        Object.assign(cancelBtn.style, {
            padding: "10px 16px",
            backgroundColor: "#333",
            color: "#e0e0e0",
            border: "1px solid #555",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "14px",
        });
        cancelBtn.addEventListener("click", () => this.close());
        sidebar.appendChild(cancelBtn);

        overlay.appendChild(sidebar);

        // --- Content area (right of sidebar) ---
        this._contentArea = document.createElement("div");
        Object.assign(this._contentArea.style, {
            flex: "1",
            display: "flex",
            overflow: "hidden",
            minWidth: "0",
        });
        overlay.appendChild(this._contentArea);

        document.body.appendChild(overlay);

        // Keyboard handler
        this._keyHandler = (e) => {
            if (e.key === "Escape") { this.close(); return; }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (this.filtered.length === 0) return;
                let idx = this.filtered.findIndex(s => s.name === this.selectedName);
                if (e.key === "ArrowDown") {
                    idx = idx < this.filtered.length - 1 ? idx + 1 : 0;
                } else {
                    idx = idx > 0 ? idx - 1 : this.filtered.length - 1;
                }
                this.selectIndex(idx);
            }
            if (e.key === "Enter" && this.selectedName) {
                this.close();
                this.fileManager.loadSavedFile(this.selectedName);
            }
        };
        document.addEventListener("keydown", this._keyHandler);

        this.rebuildContent();
    }

    rebuildContent() {
        this._destroyThumbObserver();
        this._contentArea.innerHTML = "";

        // Update sidebar link highlights
        if (this._listLink) {
            this._listLink.style.color = this.viewMode === "list" ? "#e0e0e0" : "#8ab4f8";
            this._listLink.style.backgroundColor = this.viewMode === "list" ? "#2a2a3e" : "transparent";
        }
        if (this._thumbLink) {
            this._thumbLink.style.color = this.viewMode === "thumbnails" ? "#e0e0e0" : "#8ab4f8";
            this._thumbLink.style.backgroundColor = this.viewMode === "thumbnails" ? "#2a2a3e" : "transparent";
        }

        if (this.viewMode === "list") {
            this.buildListView();
        } else {
            this.buildThumbnailView();
        }
    }

    // ========== LIST VIEW ==========

    buildListView() {
        // --- List area ---
        const listArea = document.createElement("div");
        Object.assign(listArea.style, {
            flex: "1",
            display: "flex",
            flexDirection: "column",
            backgroundColor: "#181825",
            overflow: "hidden",
            minWidth: "0",
        });

        // Title bar
        const titleBar = document.createElement("div");
        Object.assign(titleBar.style, { padding: "16px 24px", fontSize: "20px", fontWeight: "600", borderBottom: "1px solid #333" });
        titleBar.textContent = "Browse Sitches";
        listArea.appendChild(titleBar);

        // Search bar
        const searchBar = document.createElement("div");
        Object.assign(searchBar.style, { padding: "12px 24px", borderBottom: "1px solid #333" });
        const searchInput = this._createSearchInput(() => this.renderRows(this._tbody));
        searchBar.appendChild(searchInput);
        listArea.appendChild(searchBar);

        // Table header
        const headerRow = document.createElement("div");
        Object.assign(headerRow.style, {
            display: "flex", padding: "10px 24px", borderBottom: "2px solid #444",
            fontSize: "13px", fontWeight: "600", textTransform: "uppercase",
            letterSpacing: "0.5px", color: "#888", userSelect: "none",
        });

        const makeHeaderCell = (text, column, flex) => {
            const cell = document.createElement("div");
            cell.style.flex = flex;
            cell.style.cursor = "pointer";
            cell.style.padding = "4px 0";
            const updateLabel = () => {
                let arrow = "";
                if (this.sortColumn === column) arrow = this.sortAsc ? " \u25B2" : " \u25BC";
                cell.textContent = text + arrow;
            };
            updateLabel();
            cell.addEventListener("click", () => {
                if (this.sortColumn === column) { this.sortAsc = !this.sortAsc; }
                else { this.sortColumn = column; this.sortAsc = column === "name"; }
                this.applyFilterAndSort();
                headerRow._updateLabels();
                this.renderRows(this._tbody);
            });
            cell._updateLabel = updateLabel;
            return cell;
        };

        const nameHeader = makeHeaderCell("Name", "name", "3");
        const dateHeader = makeHeaderCell("Date", "date", "2");
        headerRow.appendChild(nameHeader);
        headerRow.appendChild(dateHeader);
        headerRow._updateLabels = () => { nameHeader._updateLabel(); dateHeader._updateLabel(); };
        listArea.appendChild(headerRow);

        // Scrollable list
        const listContainer = document.createElement("div");
        Object.assign(listContainer.style, { flex: "1", overflowY: "auto", padding: "0 24px" });
        const tbody = document.createElement("div");
        this._tbody = tbody;
        this.renderRows(tbody);
        listContainer.appendChild(tbody);
        listArea.appendChild(listContainer);

        this._contentArea.appendChild(listArea);

        // --- Preview panel ---
        const preview = document.createElement("div");
        Object.assign(preview.style, {
            width: "640px", minWidth: "640px", backgroundColor: "#1e1e2e",
            borderLeft: "1px solid #333", display: "flex", flexDirection: "column",
            alignItems: "center", padding: "24px", gap: "16px",
        });

        const previewTitle = document.createElement("div");
        Object.assign(previewTitle.style, { fontSize: "14px", fontWeight: "600", color: "#888", textTransform: "uppercase", letterSpacing: "0.5px", alignSelf: "flex-start" });
        previewTitle.textContent = "Preview";
        preview.appendChild(previewTitle);

        this._previewName = document.createElement("div");
        Object.assign(this._previewName.style, { fontSize: "16px", fontWeight: "600", color: "#e0e0e0", wordBreak: "break-word", textAlign: "center" });
        preview.appendChild(this._previewName);

        this._previewImg = document.createElement("img");
        Object.assign(this._previewImg.style, { maxWidth: "100%", maxHeight: "50%", borderRadius: "6px", border: "1px solid #333", objectFit: "contain", display: "none" });
        preview.appendChild(this._previewImg);

        this._previewNoImage = document.createElement("div");
        Object.assign(this._previewNoImage.style, { width: "100%", aspectRatio: "16/9", backgroundColor: "#2a2a3e", borderRadius: "6px", border: "1px solid #333", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: "13px" });
        this._previewNoImage.textContent = "No preview available";
        this._previewNoImage.style.display = "none";
        preview.appendChild(this._previewNoImage);

        this._previewDate = document.createElement("div");
        Object.assign(this._previewDate.style, { fontSize: "13px", color: "#888" });
        preview.appendChild(this._previewDate);

        this.updatePreview(null);
        this._contentArea.appendChild(preview);

        searchInput.focus();
    }

    updatePreview(sitch) {
        if (!this._previewName) return;
        if (!sitch) {
            this._previewName.textContent = "";
            this._previewImg.style.display = "none";
            this._previewNoImage.style.display = "none";
            this._previewDate.textContent = "Click a sitch to preview";
            return;
        }
        this._previewName.textContent = sitch.name;
        this._previewDate.textContent = sitch.date;
        if (sitch.screenshotUrl) {
            this._previewImg.src = sitch.screenshotUrl;
            this._previewImg.style.display = "block";
            this._previewNoImage.style.display = "none";
            this._previewImg.onerror = () => { this._previewImg.style.display = "none"; this._previewNoImage.style.display = "flex"; };
        } else {
            this._previewImg.style.display = "none";
            this._previewNoImage.style.display = "flex";
        }
    }

    selectIndex(idx) {
        const sitch = this.filtered[idx];
        if (!sitch) return;
        this.selectedName = sitch.name;
        if (this.viewMode === "list") {
            this.updatePreview(sitch);
            if (this._tbody) {
                for (const child of this._tbody.children) { if (child._setHighlight) child._setHighlight(); }
                const row = this._tbody.children[idx];
                if (row) row.scrollIntoView({block: "nearest"});
            }
        } else {
            if (this._thumbGrid) {
                for (const child of this._thumbGrid.children) { if (child._setHighlight) child._setHighlight(); }
                const card = this._thumbGrid.children[idx];
                if (card) card.scrollIntoView({block: "nearest"});
            }
        }
    }

    renderRows(tbody) {
        tbody.innerHTML = "";
        if (this.filtered.length === 0) {
            const empty = document.createElement("div");
            Object.assign(empty.style, { padding: "40px 0", textAlign: "center", color: "#666", fontSize: "14px" });
            empty.textContent = this.searchText ? "No matching sitches found." : "No saved sitches.";
            tbody.appendChild(empty);
            return;
        }
        this.filtered.forEach((sitch) => {
            const row = document.createElement("div");
            Object.assign(row.style, { display: "flex", padding: "12px 0", borderBottom: "1px solid #2a2a3e", cursor: "pointer", borderRadius: "4px" });
            const setHighlight = () => { row.style.backgroundColor = (this.selectedName === sitch.name) ? "#2a2a3e" : "transparent"; };
            setHighlight();
            row.addEventListener("mouseenter", () => { row.style.backgroundColor = "#2a2a3e"; });
            row.addEventListener("mouseleave", () => { setHighlight(); });

            const nameCell = document.createElement("div");
            nameCell.style.flex = "3"; nameCell.style.fontSize = "14px"; nameCell.textContent = sitch.name;
            const dateCell = document.createElement("div");
            dateCell.style.flex = "2"; dateCell.style.fontSize = "13px"; dateCell.style.color = "#888"; dateCell.textContent = sitch.date;
            row.appendChild(nameCell);
            row.appendChild(dateCell);

            row.addEventListener("click", () => {
                this.selectedName = sitch.name;
                this.updatePreview(sitch);
                for (const child of tbody.children) { if (child._setHighlight) child._setHighlight(); }
            });
            row.addEventListener("dblclick", () => { this.close(); this.fileManager.loadSavedFile(sitch.name); });
            row._setHighlight = setHighlight;
            tbody.appendChild(row);
        });

        // Scroll selected item into view after search changes
        if (this.selectedName) {
            const idx = this.filtered.findIndex(s => s.name === this.selectedName);
            if (idx >= 0 && tbody.children[idx]) {
                tbody.children[idx].scrollIntoView({block: "nearest"});
            }
        }
    }

    // ========== THUMBNAIL VIEW ==========

    buildThumbnailView() {
        const area = document.createElement("div");
        Object.assign(area.style, {
            flex: "1", display: "flex", flexDirection: "column",
            backgroundColor: "#181825", overflow: "hidden", minWidth: "0",
        });

        // Title bar
        const titleBar = document.createElement("div");
        Object.assign(titleBar.style, { padding: "16px 24px", fontSize: "20px", fontWeight: "600", borderBottom: "1px solid #333" });
        titleBar.textContent = "Browse Sitches";
        area.appendChild(titleBar);

        // Search bar + column slider
        const searchBar = document.createElement("div");
        Object.assign(searchBar.style, { padding: "12px 24px", borderBottom: "1px solid #333", display: "flex", gap: "16px", alignItems: "center" });

        const searchInput = this._createSearchInput(() => this.renderThumbnails());
        searchInput.style.flex = "1";
        searchBar.appendChild(searchInput);

        // Sort controls
        const sortLabel = document.createElement("div");
        Object.assign(sortLabel.style, { fontSize: "12px", color: "#888", whiteSpace: "nowrap" });
        sortLabel.textContent = "Sort:";
        searchBar.appendChild(sortLabel);

        const sortSelect = document.createElement("select");
        Object.assign(sortSelect.style, { backgroundColor: "#2a2a3e", color: "#e0e0e0", border: "1px solid #444", borderRadius: "4px", padding: "4px 8px", fontSize: "12px" });
        const options = [["date_desc", "Date (newest)"], ["date_asc", "Date (oldest)"], ["name_asc", "Name (A-Z)"], ["name_desc", "Name (Z-A)"]];
        for (const [val, label] of options) {
            const opt = document.createElement("option");
            opt.value = val; opt.textContent = label;
            if (val === this.sortColumn + "_" + (this.sortAsc ? "asc" : "desc")) opt.selected = true;
            sortSelect.appendChild(opt);
        }
        sortSelect.addEventListener("change", () => {
            const [col, dir] = sortSelect.value.split("_");
            this.sortColumn = col;
            this.sortAsc = dir === "asc";
            this.applyFilterAndSort();
            this.renderThumbnails();
        });
        searchBar.appendChild(sortSelect);

        // Column slider
        const colLabel = document.createElement("div");
        Object.assign(colLabel.style, { fontSize: "12px", color: "#888", whiteSpace: "nowrap" });
        colLabel.textContent = `Columns: ${this.thumbColumns}`;
        searchBar.appendChild(colLabel);

        const colSlider = document.createElement("input");
        colSlider.type = "range"; colSlider.min = "1"; colSlider.max = "10"; colSlider.value = String(this.thumbColumns);
        Object.assign(colSlider.style, { width: "100px", accentColor: "#8ab4f8" });
        colSlider.addEventListener("input", () => {
            this.thumbColumns = parseInt(colSlider.value);
            colLabel.textContent = `Columns: ${this.thumbColumns}`;

            // Preserve selected card's screen position across column change
            let selectedCard = null;
            let offsetFromViewport = 0;
            if (this.selectedName && this._thumbGrid) {
                const idx = this.filtered.findIndex(s => s.name === this.selectedName);
                if (idx >= 0) {
                    selectedCard = this._thumbGrid.children[idx];
                    if (selectedCard) {
                        const containerRect = this._thumbScrollContainer.getBoundingClientRect();
                        const cardRect = selectedCard.getBoundingClientRect();
                        offsetFromViewport = cardRect.top - containerRect.top;
                    }
                }
            }

            this._thumbGrid.style.gridTemplateColumns = `repeat(${this.thumbColumns}, 1fr)`;

            if (selectedCard) {
                const containerRect = this._thumbScrollContainer.getBoundingClientRect();
                const newCardRect = selectedCard.getBoundingClientRect();
                const newOffset = newCardRect.top - containerRect.top;
                this._thumbScrollContainer.scrollTop += (newOffset - offsetFromViewport);
            }
        });
        searchBar.appendChild(colSlider);

        area.appendChild(searchBar);

        // Scrollable grid
        const scrollContainer = document.createElement("div");
        Object.assign(scrollContainer.style, { flex: "1", overflowY: "auto", padding: "16px 24px" });
        this._thumbScrollContainer = scrollContainer;

        const grid = document.createElement("div");
        Object.assign(grid.style, {
            display: "grid",
            gridTemplateColumns: `repeat(${this.thumbColumns}, 1fr)`,
            gap: "16px",
        });
        this._thumbGrid = grid;

        this.renderThumbnails();

        scrollContainer.appendChild(grid);
        area.appendChild(scrollContainer);
        this._contentArea.appendChild(area);

        searchInput.focus();
    }

    renderThumbnails() {
        this._destroyThumbObserver();
        this._thumbGrid.innerHTML = "";

        if (this.filtered.length === 0) {
            const empty = document.createElement("div");
            Object.assign(empty.style, { padding: "40px 0", textAlign: "center", color: "#666", fontSize: "14px", gridColumn: "1 / -1" });
            empty.textContent = this.searchText ? "No matching sitches found." : "No saved sitches.";
            this._thumbGrid.appendChild(empty);
            return;
        }

        // IntersectionObserver for lazy loading
        this._thumbObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        delete img.dataset.src;
                        this._thumbObserver.unobserve(img);
                    }
                }
            }
        }, { root: this._thumbScrollContainer, rootMargin: "200px" });

        this.filtered.forEach((sitch) => {
            const card = document.createElement("div");
            Object.assign(card.style, {
                backgroundColor: "#1e1e2e",
                borderRadius: "8px",
                border: "1px solid #333",
                overflow: "hidden",
                cursor: "pointer",
                transition: "border-color 0.15s",
            });

            const setHighlight = () => {
                card.style.borderColor = (this.selectedName === sitch.name) ? "#8ab4f8" : "#333";
            };
            setHighlight();

            card.addEventListener("mouseenter", () => { card.style.borderColor = "#8ab4f8"; });
            card.addEventListener("mouseleave", () => { setHighlight(); });

            // Thumbnail image area
            const imgWrap = document.createElement("div");
            Object.assign(imgWrap.style, { width: "100%", aspectRatio: "16/9", backgroundColor: "#2a2a3e", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" });

            if (sitch.screenshotUrl) {
                const img = document.createElement("img");
                Object.assign(img.style, { width: "100%", height: "100%", objectFit: "cover", display: "block" });
                img.dataset.src = sitch.screenshotUrl;
                img.alt = sitch.name;
                img.onerror = () => {
                    img.style.display = "none";
                    const placeholder = document.createElement("div");
                    Object.assign(placeholder.style, { color: "#555", fontSize: "12px" });
                    placeholder.textContent = "No preview";
                    imgWrap.appendChild(placeholder);
                };
                imgWrap.appendChild(img);
                this._thumbObserver.observe(img);
            } else {
                const placeholder = document.createElement("div");
                Object.assign(placeholder.style, { color: "#555", fontSize: "12px" });
                placeholder.textContent = "No preview";
                imgWrap.appendChild(placeholder);
            }
            card.appendChild(imgWrap);

            // Info area
            const info = document.createElement("div");
            Object.assign(info.style, { padding: "8px 10px" });

            const nameDiv = document.createElement("div");
            Object.assign(nameDiv.style, { fontSize: "13px", fontWeight: "600", color: "#e0e0e0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
            nameDiv.textContent = sitch.name;
            nameDiv.title = sitch.name;
            info.appendChild(nameDiv);

            const dateDiv = document.createElement("div");
            Object.assign(dateDiv.style, { fontSize: "11px", color: "#888", marginTop: "2px" });
            dateDiv.textContent = sitch.date;
            info.appendChild(dateDiv);

            card.appendChild(info);

            card.addEventListener("click", () => {
                this.selectedName = sitch.name;
                for (const child of this._thumbGrid.children) { if (child._setHighlight) child._setHighlight(); }
            });
            card.addEventListener("dblclick", () => { this.close(); this.fileManager.loadSavedFile(sitch.name); });

            card._setHighlight = setHighlight;
            this._thumbGrid.appendChild(card);
        });

        // Scroll selected item into view after search changes
        if (this.selectedName) {
            const idx = this.filtered.findIndex(s => s.name === this.selectedName);
            if (idx >= 0 && this._thumbGrid.children[idx]) {
                this._thumbGrid.children[idx].scrollIntoView({block: "nearest"});
            }
        }
    }

    // ========== SHARED HELPERS ==========

    _createSearchInput(onUpdate) {
        const searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.placeholder = "Search by name...";
        searchInput.value = this.searchText;
        Object.assign(searchInput.style, {
            width: "100%", boxSizing: "border-box", padding: "10px 14px", fontSize: "14px",
            backgroundColor: "#2a2a3e", color: "#e0e0e0", border: "1px solid #444",
            borderRadius: "6px", outline: "none",
        });
        searchInput.addEventListener("input", () => {
            this.searchText = searchInput.value;
            this.applyFilterAndSort();
            onUpdate();
        });
        return searchInput;
    }

    _matchesSearch(name, searchText) {
        const nameLower = name.toLowerCase();
        // Split on " OR " (uppercase) to get OR groups
        const orParts = searchText.split(' OR ');
        if (orParts.length > 1) {
            return orParts.some(part => this._matchesSearch(name, part.trim()));
        }
        // Split on " AND " (uppercase) to get AND terms
        const andParts = searchText.split(' AND ');
        if (andParts.length > 1) {
            return andParts.every(part => nameLower.includes(part.trim().toLowerCase()));
        }
        // Plain text match
        return nameLower.includes(searchText.toLowerCase());
    }

    _destroyThumbObserver() {
        if (this._thumbObserver) {
            this._thumbObserver.disconnect();
            this._thumbObserver = null;
        }
    }

    close() {
        this._destroyThumbObserver();
        if (this.overlay) {
            document.body.removeChild(this.overlay);
            this.overlay = null;
        }
        if (this._keyHandler) {
            document.removeEventListener("keydown", this._keyHandler);
            this._keyHandler = null;
        }
    }
}
