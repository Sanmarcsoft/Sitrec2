import GUI from "../js/lil-gui.esm";
import {CNodeViewCanvas2D} from "./CNodeViewCanvas";

class CNodeTabbedCanvasView extends CNodeViewCanvas2D {
    constructor(v) {
        super(v);

        this.menuName = v.menuName ?? 'Menu';

        this.createTabMenu();
        this.setupTabDragging();
    }

    createTabMenu() {
        const menuContainer = document.createElement('div');
        menuContainer.style.position = 'absolute';
        menuContainer.style.left = '0px';
        menuContainer.style.top = '0px';
        menuContainer.style.zIndex = '1000';
        this.div.appendChild(menuContainer);

        this.tabMenu = new GUI({
            container: menuContainer,
            autoPlace: false,
            title: this.menuName ?? 'Menu',
            closeFolders: false
        });
        this.tabMenu.domElement.style.position = 'relative';

        const closeObj = {
            close: () => {
                this.tabMenu.close();
                this.show(false);
            }
        };
        this.tabMenu.add(closeObj, 'close').name('Hide')
            .tooltip("Hide this tabbed canvas view\nTo show it again, use the 'Show/Hide -> Views' menu.");

        this.tabMenu.close();

        this.menuContainer = menuContainer;
    }

    setupTabDragging() {
        this.isDraggingTab = false;
        this.dragStartX = 0;
        this.dragStartY = 0;

        this.boundTabPointerMove = (e) => this.onTabPointerMove(e);
        this.boundTabPointerUp = (e) => this.onTabPointerUp(e);

        const titleElement = this.tabMenu.domElement.querySelector('.title');
        if (titleElement) {
            titleElement.style.cursor = 'pointer';
            titleElement.addEventListener('pointerdown', (e) => this.onTabPointerDown(e));
        }
    }

    onTabPointerDown(e) {
        e.preventDefault();
        e.stopPropagation();

        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;

        document.addEventListener('pointermove', this.boundTabPointerMove);
        document.addEventListener('pointerup', this.boundTabPointerUp);
    }

    onTabPointerMove(e) {
        const dx = Math.abs(e.clientX - this.dragStartX);
        const dy = Math.abs(e.clientY - this.dragStartY);

        if (!this.isDraggingTab && (dx > 5 || dy > 5)) {
            this.isDraggingTab = true;
        }

        if (this.isDraggingTab) {
            const deltaX = e.clientX - this.dragStartX;
            const deltaY = e.clientY - this.dragStartY;

            const currentLeft = parseInt(this.div.style.left || 0);
            const currentTop = parseInt(this.div.style.top || 0);

            let newLeft = currentLeft + deltaX;
            let newTop = currentTop + deltaY;

            const constrainedPos = this.constrainToScreen(newLeft, newTop);
            this.div.style.left = constrainedPos.left + 'px';
            this.div.style.top = constrainedPos.top + 'px';

            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;
        }
    }

    constrainToScreen(left, top) {
        const rect = this.div.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const halfWidth = rect.width / 2;
        const halfHeight = rect.height / 2;

        if (left < -halfWidth) {
            left = -halfWidth;
        } else if (left + halfWidth > viewportWidth) {
            left = viewportWidth - halfWidth;
        }

        if (top < -halfHeight) {
            top = -halfHeight;
        } else if (top + halfHeight > viewportHeight) {
            top = viewportHeight - halfHeight;
        }

        return { left, top };
    }

    ensureOnScreen() {
        const currentLeft = parseInt(this.div.style.left || 0);
        const currentTop = parseInt(this.div.style.top || 0);

        const constrainedPos = this.constrainToScreen(currentLeft, currentTop);
        
        if (constrainedPos.left !== currentLeft || constrainedPos.top !== currentTop) {
            this.div.style.left = constrainedPos.left + 'px';
            this.div.style.top = constrainedPos.top + 'px';
        }
    }

    onTabPointerUp(e) {
        document.removeEventListener('pointermove', this.boundTabPointerMove);
        document.removeEventListener('pointerup', this.boundTabPointerUp);

        if (!this.isDraggingTab) {
            this.toggleTabMenu();
        }

        this.isDraggingTab = false;
    }

    toggleTabMenu() {
        if (this.tabMenu._closed) {
            this.tabMenu.open();
        } else {
            this.tabMenu.close();
        }
    }

    renderCanvas(frame) {
        super.renderCanvas(frame);
        
        if (this.visible) {
            this.ensureOnScreen();
        }
    }

    dispose() {
        document.removeEventListener('pointermove', this.boundTabPointerMove);
        document.removeEventListener('pointerup', this.boundTabPointerUp);

        if (this.tabMenu) {
            this.tabMenu.destroy();
        }

        if (this.menuContainer && this.div.contains(this.menuContainer)) {
            this.div.removeChild(this.menuContainer);
        }

        super.dispose();
    }
}

export {CNodeTabbedCanvasView};