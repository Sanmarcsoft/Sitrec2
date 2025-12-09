# How to Add New Settings to Sitrec

This guide explains how to add a new user setting to the Sitrec application.

## Overview

Settings in Sitrec are:
- Stored on the server (S3) for logged-in users
- Stored in browser cookies as a fallback
- Sanitized on both client and server to prevent exploits
- Only available in custom sitches (when `Sit.isCustom || Sit.canMod`)

## Required Changes

When adding a new setting, you must update **5 files**:

### 1. SettingsManager.js - Add Default Value

**File:** `sitrec/src/SettingsManager.js`

In the `initializeSettings()` function, add your default value:

```javascript
export async function initializeSettings() {
    if (!Globals.settings) {
        Globals.settings = {
            maxDetails: 15,
            yourNewSetting: defaultValue  // ← Add here
        };
    }
    // ...
}
```

### 2. SettingsManager.js - Add Sanitization (Client-Side)

**File:** `sitrec/src/SettingsManager.js`

In the `sanitizeSettings()` function, add validation:

```javascript
export function sanitizeSettings(settings) {
    const sanitized = {};
    
    // ... existing settings ...
    
    if (settings.yourNewSetting !== undefined) {
        // For boolean:
        sanitized.yourNewSetting = Boolean(settings.yourNewSetting);
        
        // For number with range:
        // const value = Number(settings.yourNewSetting);
        // sanitized.yourNewSetting = Math.max(min, Math.min(max, value));
        
        // For string:
        // sanitized.yourNewSetting = String(settings.yourNewSetting).substring(0, maxLength);
    }
    
    return sanitized;
}
```

### 3. settings.php - Add Sanitization (Server-Side)

**File:** `sitrec/sitrecServer/settings.php`

⚠️ **CRITICAL:** This is the most commonly forgotten step!

In the `sanitizeSettings()` function, add validation:

```php
function sanitizeSettings($settings) {
    // ... existing code ...
    
    if (isset($settings['yourNewSetting'])) {
        // For boolean:
        $sanitized['yourNewSetting'] = (bool)$settings['yourNewSetting'];
        
        // For number with range:
        // $value = floatval($settings['yourNewSetting']);
        // $sanitized['yourNewSetting'] = max($min, min($max, $value));
        
        // For string:
        // $sanitized['yourNewSetting'] = substr($settings['yourNewSetting'], 0, $maxLength);
    }
    
    return $sanitized;
}
```

### 4. CustomSupport.js - Add UI Control

**File:** `sitrec/src/CustomSupport.js`

In the `setupSettingsMenu()` method, add a UI control:

```javascript
setupSettingsMenu() {
    const settingsFolder = guiMenus.main.addFolder("Settings")
        .tooltip(tooltipText)
        .close();
    
    // ... existing controls ...
    
    // For boolean (checkbox):
    settingsFolder.add(Globals.settings, "yourNewSetting")
        .name("Your Setting Name")
        .tooltip("Description of what this setting does")
        .onChange((value) => {
            Globals.settings.yourNewSetting = Boolean(value);
            this.saveGlobalSettings(true); // Immediate save for toggles
        })
        .listen();
    
    // For number (slider):
    // settingsFolder.add(Globals.settings, "yourNewSetting", min, max, step)
    //     .name("Your Setting Name")
    //     .tooltip("Description")
    //     .onChange((value) => {
    //         Globals.settings.yourNewSetting = value;
    //         this.saveGlobalSettings(); // Debounced save for sliders
    //     })
    //     .onFinishChange(() => {
    //         this.saveGlobalSettings(true); // Force save when done
    //     })
    //     .listen();
}
```

### 5. SettingsManager.test.js - Add Tests

**File:** `sitrec/tests/SettingsManager.test.js`

Add test cases for your new setting:

```javascript
describe('sanitizeSettings', () => {
    // ... existing tests ...
    
    test('should sanitize yourNewSetting as boolean', () => {
        const input = { yourNewSetting: true };
        const result = sanitizeSettings(input);
        expect(result.yourNewSetting).toBe(true);
        expect(typeof result.yourNewSetting).toBe('boolean');
    });
    
    test('should convert truthy values to boolean for yourNewSetting', () => {
        const input = { yourNewSetting: 1 };
        const result = sanitizeSettings(input);
        expect(result.yourNewSetting).toBe(true);
    });
    
    test('should convert falsy values to boolean for yourNewSetting', () => {
        const input = { yourNewSetting: 0 };
        const result = sanitizeSettings(input);
        expect(result.yourNewSetting).toBe(false);
    });
});

describe('initializeSettings', () => {
    test('should initialize with default yourNewSetting', async () => {
        const result = await initializeSettings();
        expect(result.yourNewSetting).toBe(defaultValue);
    });
});
```

## Checklist

When adding a new setting, use this checklist:

- [ ] Add default value in `initializeSettings()` (SettingsManager.js)
- [ ] Add client-side sanitization in `sanitizeSettings()` (SettingsManager.js)
- [ ] Add server-side sanitization in `sanitizeSettings()` (settings.php) ⚠️
- [ ] Add UI control in `setupSettingsMenu()` (CustomSupport.js)
- [ ] Add tests in SettingsManager.test.js
- [ ] Run `npm test` to verify all tests pass
- [ ] Run `npm run build` to verify build succeeds
- [ ] Test in browser:
  - [ ] Toggle/change the setting
  - [ ] Reload page and verify it persists
  - [ ] Check browser console for any errors

## Common Pitfalls

1. **Forgetting server-side sanitization** - This is the most common mistake! The PHP `sanitizeSettings()` function will strip out any settings it doesn't recognize.

2. **Type mismatches** - Make sure the sanitization on both client and server produces the same type (boolean, number, string).

3. **Not using `.listen()`** - GUI controls need `.listen()` to update when the value changes programmatically.

4. **Wrong save timing** - Use `saveGlobalSettings(true)` for immediate saves (checkboxes), `saveGlobalSettings()` for debounced saves (sliders).

## Example: Adding a "Dark Mode" Setting

Here's a complete example:

```javascript
// 1. SettingsManager.js - initializeSettings()
Globals.settings = {
    maxDetails: 15,
    startFullScreen: false,
    darkMode: false  // ← New setting
};

// 2. SettingsManager.js - sanitizeSettings()
if (settings.darkMode !== undefined) {
    sanitized.darkMode = Boolean(settings.darkMode);
}

// 3. settings.php - sanitizeSettings()
if (isset($settings['darkMode'])) {
    $sanitized['darkMode'] = (bool)$settings['darkMode'];
}

// 4. CustomSupport.js - setupSettingsMenu()
settingsFolder.add(Globals.settings, "darkMode")
    .name("Dark Mode")
    .tooltip("Enable dark color scheme")
    .onChange((value) => {
        Globals.settings.darkMode = Boolean(value);
        this.saveGlobalSettings(true);
        // Apply dark mode styling here
        document.body.classList.toggle('dark-mode', value);
    })
    .listen();

// 5. SettingsManager.test.js
test('should sanitize darkMode as boolean', () => {
    const input = { darkMode: true };
    const result = sanitizeSettings(input);
    expect(result.darkMode).toBe(true);
});
```

## Testing Your Changes

1. **Build:** `npm run build`
2. **Test:** `npm test`
3. **Manual test:**
   - Load a custom sitch
   - Open browser console (F12)
   - Change your setting
   - Check console for save confirmation
   - Reload page
   - Verify setting persists

## Questions?

If you're unsure about any step, refer to the existing `maxDetails` or `startFullScreen` settings as examples.