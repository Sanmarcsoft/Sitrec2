# Synthetic Objects Refactoring Plan

## Overview

This document outlines inconsistencies and DRY violations in the synthetic object code (buildings, clouds, overlays) and proposes a refactoring plan to address them.

### Files Reviewed
- `src/nodes/CNodeSynthBuilding.js` (~2782 lines)
- `src/nodes/CNodeSynthClouds.js` (~1161 lines)
- `src/nodes/CNodeGroundOverlay.js` (~1802 lines)
- `src/C3DSynthManager.js` (~527 lines)
- `src/CustomSupport.js` (editing menu methods)

---

## UI Inconsistencies

### 1. Edit Menu Signature Mismatch
| Class | Method Call |
|-------|-------------|
| Building | `CustomManager.showBuildingEditingMenu(100, 100)` |
| Clouds | `CustomManager.showCloudsEditingMenu(100, 100)` |
| Overlay | `CustomManager.showOverlayEditingMenu(this, 100, 100)` |

**Issue**: Overlay passes `this` as first parameter; others don't.

**Fix**: Standardize to `(mouseX, mouseY)` - get object from `Globals.editingX`.

### 2. Sidebar State Persistence
| Class | Persists Sidebar Position |
|-------|---------------------------|
| Building | Yes (`lastBuildingEditMenuSidebar`) |
| Clouds | No |
| Overlay | No |

**Fix**: Add sidebar state persistence to Clouds and Overlay.

### 3. Name Change Behavior
| Class | Calls `setRenderOne` | Calls `saveGlobalSettings` |
|-------|---------------------|---------------------------|
| Building | Yes | Yes |
| Clouds | No | Yes |
| Overlay | No | No |

**Fix**: Standardize to call both on name change.

### 4. GUI Folder Close State
| Class | Closes folder at end of `createGUIFolder()` |
|-------|---------------------------------------------|
| Building | Yes |
| Clouds | No |
| Overlay | Yes |

**Fix**: Standardize behavior.

### 5. Missing Features
| Feature | Building | Clouds | Overlay |
|---------|----------|--------|---------|
| `duplicate()` | Yes | No | No |
| `goTo()` | No | No | Yes (`gotoOverlay()`) |
| Highlight border on hover | No | No | Yes |

**Fix**: Add missing features where appropriate.

---

## DRY Violations

### 1. Pointer Event Handling (~100 lines each, 3x duplication)

All three classes have nearly identical:
- `setupEventListeners()` with same `.bind(this)` pattern
- `onPointerDown()` with GUI click detection, view check, handle detection
- `onPointerMove()` with drag plane intersection
- `onPointerUp()` with undo recording, controls re-enable

**Location in each file:**
- Building: lines 1380-2347
- Clouds: lines 507-697
- Overlay: lines 1000-1381

### 2. Handle Management (~80 lines each, 3x duplication)

- `createControlPoints()`/`createControlHandles()` - sphere geometry creation
- `updateHandleScales(view)` - same 20px target size, same scaling math
- `removeControlPoints()`/`removeControlHandles()` - dispose loops
- Handle hover detection and color updates

### 3. Edit Mode Toggle (~40 lines each, 3x duplication)

Pattern in all three:
```javascript
setEditMode(enable) {
    if (this.editMode === enable) return;
    this.editMode = enable;
    if (enable) {
        Globals.editingX = this;
        this.createHandles();
        CustomManager.showXEditingMenu(...);
    } else {
        if (Globals.editingX === this) Globals.editingX = null;
        this.removeHandles();
        // destroy menu
    }
    if (this.editModeController) this.editModeController.setValue(enable);
    setRenderOne(true);
}
```

### 4. Serialization Pattern (~30 lines each, 3x duplication)

All have:
- `serialize()` - returns object with all properties
- `static deserialize(data)` - creates new instance from data

### 5. Undo Integration (~25 lines each, 3x duplication)

All have:
- `captureState()` - snapshot current state
- `restoreState(state)` - restore from snapshot
- Same undo action structure in drag handlers

### 6. GUI Folder Creation (~60 lines each, 3x duplication)

All follow same pattern:
- Name controller with title update on change
- Edit mode controller with proxy object pattern
- Properties subfolder
- Delete action button

### 7. Manager Storage (C3DSynthManager)

Three separate storage mechanisms:
- Buildings: `this.list` (inherited from CManager)
- Clouds: `this.cloudsList` (custom dictionary)
- Overlays: `this.overlaysList` (custom dictionary)

Three parallel sets of methods:
- `addBuilding/removeBuiding/getBuilding/iterate`
- `addClouds/removeClouds/getClouds/iterateClouds`
- `addOverlay/removeOverlay/getOverlay/iterateOverlays`

---

## Proposed Refactoring

### Phase 1: Create Base Class `CNodeSynthObject`

**New file**: `src/nodes/CNodeSynthObject.js`

**Class hierarchy:**
```
CNode3DGroup
    └── CNodeSynthObject (NEW)
            ├── CNodeSynthBuilding
            ├── CNodeSynthClouds  
            └── CNodeGroundOverlay
```

**Base class contains:**
- Common properties: `name`, `editMode`, `isDragging`, `hoveredHandle`, `raycaster`
- `setupEventListeners()` / event cleanup in `dispose()`
- `onPointerDown()` / `onPointerMove()` / `onPointerUp()` with template method hooks
- `setEditMode(enable)` with abstract hooks
- `updateHandleScales(view)` with configurable target pixel size
- `captureState()` / `restoreState()` base pattern
- Common GUI creation helpers

**Abstract methods for subclasses:**
- `createHandles()` - create type-specific handles
- `removeHandles()` - dispose type-specific handles
- `getHandleAtMouse(mouseX, mouseY)` - hit test handles
- `handleDrag(handle, intersection)` - process drag for handle type
- `getEditingGlobalKey()` - returns 'editingBuilding', 'editingClouds', etc.
- `getEditMenuName()` - returns menu property name

### Phase 2: Unify Manager Storage

**Changes to C3DSynthManager:**
- Store all synth objects in `this.list` (inherited)
- Add `type` property to each object: `'building'`, `'clouds'`, `'overlay'`
- Replace three method sets with unified methods that filter by type
- Or use interface-based approach with common method names

### Phase 3: Fix UI Inconsistencies

1. Standardize `showEditingMenu()` signature to `(mouseX, mouseY)`
2. Add sidebar state persistence to Clouds and Overlay
3. Add `saveGlobalSettings()` and `setRenderOne()` to Overlay name change
4. Add `duplicate()` to Clouds and Overlay
5. Add `goTo()` to Building and Clouds
6. Standardize GUI folder close behavior

### Phase 4: Extract Handle Utilities

**New file**: `src/SynthHandleUtils.js`

```javascript
export function createSphereHandle(radius, color, layerMask) { ... }
export function updateHandleScale(handle, view, targetPixels) { ... }
export function getHoveredHandle(raycaster, handles) { ... }
export function setHandleColor(handle, baseColor, isHovered) { ... }
```

---

## Risk Assessment

| Change | Risk Level | Notes |
|--------|------------|-------|
| Base class extraction | Medium | Inheritance changes require careful testing |
| Manager storage unification | Low | Internal only, serialization unchanged |
| Edit menu signature fix | Low | Only CustomSupport.js affected |
| Adding missing methods | None | Additive changes only |
| Handle utilities extraction | Low | Pure functions, easy to test |

---

## Implementation Order (by Risk/Reward)

### Low Risk, High Reward (Do First)
1. Fix UI inconsistencies (Phase 3) - immediate user-facing improvements
2. Extract handle utilities (Phase 4) - reduces duplication safely

### Medium Risk, High Reward (Do Second)
3. Create base class (Phase 1) - biggest DRY improvement
4. Unify manager storage (Phase 2) - simplifies manager code

---

## Testing Strategy

1. Run existing regression tests after each phase
2. Manually test each synth object type:
   - Create new object
   - Enter/exit edit mode
   - Drag handles
   - Undo/redo
   - Delete with undo
   - Serialize/deserialize (save/load)
   - Edit menu sidebar docking
3. Test interaction between multiple edit modes (switching between object types)

---

## Files to Modify

### Phase 1 (Base Class)
- NEW: `src/nodes/CNodeSynthObject.js`
- MODIFY: `src/nodes/CNodeSynthBuilding.js`
- MODIFY: `src/nodes/CNodeSynthClouds.js`
- MODIFY: `src/nodes/CNodeGroundOverlay.js`

### Phase 2 (Manager Unification)
- MODIFY: `src/C3DSynthManager.js`

### Phase 3 (UI Fixes)
- MODIFY: `src/nodes/CNodeSynthClouds.js`
- MODIFY: `src/nodes/CNodeGroundOverlay.js`
- MODIFY: `src/CustomSupport.js`

### Phase 4 (Handle Utilities)
- NEW: `src/SynthHandleUtils.js`
- MODIFY: All three synth node files
