/*
    DropMan KWin script.

    Prototype behavior:
    - register configured global shortcuts;
    - claim only the active window when a claim shortcut is pressed;
    - toggle that window between visible dropdown geometry and hidden offscreen
      geometry on one of the four screen edges.

    Design rule: match many, bind one. Matching rules identify candidates only.
    They must not mutate every matching app window.
*/

const LOG_PREFIX = "dropman: ";

const DEFAULT_CONFIG = {
    bindings: [
        {
            id: "konsole",
            name: "Konsole",
            shortcut: "Meta+K",
            edge: "top",
            widthPercent: 100,
            heightPercent: 45,
            claimShortcut: "Meta+Shift+K",
            windowHints: {},
            match: {
                resourceClass: "org.kde.konsole",
                resourceName: "konsole"
            }
        },
        {
            id: "firefox",
            name: "Firefox",
            shortcut: "Meta+F",
            edge: "right",
            widthPercent: 40,
            heightPercent: 100,
            claimShortcut: "Meta+Shift+F",
            match: {
                resourceClass: "firefox_firefox",
                resourceName: "firefox",
                excludeCaption: "Choose a profile"
            }
        },
        {
            id: "uplink",
            name: "Uplink",
            shortcut: "Meta+U",
            edge: "top",
            widthPercent: 100,
            heightPercent: 45,
            claimShortcut: "Meta+Shift+U",
            windowHints: {},
            match: {
                resourceClass: "Uplink",
                resourceName: "Uplink"
            }
        }
    ]
};

const bindings = new Map();

function log(message) {
    console.info(LOG_PREFIX + message);
}

function asString(value) {
    if (value === undefined || value === null) {
        return "";
    }
    return String(value);
}

function lower(value) {
    return asString(value).toLowerCase();
}

function clampPercent(value, fallback) {
    const numberValue = Number(value);
    if (!isFinite(numberValue)) {
        return fallback;
    }
    return Math.max(5, Math.min(100, numberValue));
}

function trySet(window, property, value) {
    try {
        if (property in window) {
            window[property] = value;
            return true;
        }
    } catch (error) {
        log("could not set " + property + ": " + error);
    }

    return false;
}

function tryCall(object, method, argument) {
    try {
        if (object && typeof object[method] === "function") {
            object[method](argument);
            return true;
        }
    } catch (error) {
        log("could not call " + method + ": " + error);
    }

    return false;
}

function readConfig() {
    // KWin scripts cannot consistently read package data files across Plasma
    // versions from JavaScript alone, so the committed JSON is the source
    // format and this in-script default keeps the MVP installable.
    return DEFAULT_CONFIG;
}

function windowText(window, key) {
    if (!window) {
        return "";
    }
    return lower(window[key]);
}

function matchesField(window, key, expected) {
    if (!expected) {
        return true;
    }
    return windowText(window, key).indexOf(lower(expected)) >= 0;
}

function excludesField(window, key, expected) {
    if (!expected) {
        return false;
    }
    return windowText(window, key).indexOf(lower(expected)) >= 0;
}

function matchesBinding(window, binding) {
    const match = binding.match || {};
    return matchesField(window, "resourceClass", match.resourceClass)
        && matchesField(window, "resourceName", match.resourceName)
        && matchesField(window, "windowClass", match.windowClass)
        && matchesField(window, "caption", match.caption)
        && !excludesField(window, "caption", match.excludeCaption);
}

function activeOutputGeometry(window) {
    if (window && window.output && window.output.geometry) {
        return window.output.geometry;
    }

    if (workspace.activeWindow && workspace.activeWindow.output
        && workspace.activeWindow.output.geometry) {
        return workspace.activeWindow.output.geometry;
    }

    if (workspace.screenOrder && workspace.screenOrder.length > 0
        && workspace.screenOrder[0].geometry) {
        return workspace.screenOrder[0].geometry;
    }

    return null;
}

function visibleGeometry(window, binding) {
    const screen = activeOutputGeometry(window);
    if (!screen) {
        return null;
    }

    const widthPercent = clampPercent(binding.widthPercent, 100);
    const heightPercent = clampPercent(binding.heightPercent, 45);
    const width = Math.round(screen.width * widthPercent / 100);
    const height = Math.round(screen.height * heightPercent / 100);
    const edge = binding.edge || "top";

    let x = screen.x + Math.round((screen.width - width) / 2);
    let y = screen.y + Math.round((screen.height - height) / 2);

    if (edge === "top") {
        y = screen.y;
    } else if (edge === "bottom") {
        y = screen.y + screen.height - height;
    } else if (edge === "left") {
        x = screen.x;
    } else if (edge === "right") {
        x = screen.x + screen.width - width;
    }

    return { x: x, y: y, width: width, height: height };
}

function hiddenGeometry(visible, binding) {
    const edge = binding.edge || "top";
    const hidden = {
        x: visible.x,
        y: visible.y,
        width: visible.width,
        height: visible.height
    };

    if (edge === "top") {
        hidden.y = visible.y - visible.height;
    } else if (edge === "bottom") {
        hidden.y = visible.y + visible.height;
    } else if (edge === "left") {
        hidden.x = visible.x - visible.width;
    } else if (edge === "right") {
        hidden.x = visible.x + visible.width;
    }

    return hidden;
}

function geometryText(geometry) {
    if (!geometry) {
        return "<none>";
    }
    return geometry.x + "," + geometry.y + " "
        + geometry.width + "x" + geometry.height;
}

function prepareWindow(window, binding) {
    const hints = binding.windowHints || {};

    if (hints.noBorder === true) {
        trySet(window, "noBorder", true);
    }
    if (hints.keepAbove === true) {
        trySet(window, "keepAbove", true);
    }
    if (hints.skipTaskbar === true) {
        trySet(window, "skipTaskbar", true);
    }
    if (hints.skipPager === true) {
        trySet(window, "skipPager", true);
    }
    if (hints.onAllDesktops === true) {
        trySet(window, "onAllDesktops", true);
    }
}

function activateWindow(window, binding) {
    trySet(window, "minimized", false);

    const activated = tryCall(workspace, "activateWindow", window)
        || trySet(workspace, "activeWindow", window)
        || trySet(window, "active", true);

    const raised = tryCall(workspace, "raiseWindow", window)
        || tryCall(window, "raise");

    log("activation for " + binding.id
        + " activated=" + activated
        + " raised=" + raised
        + " activeWindow=" + asString(workspace.activeWindow && workspace.activeWindow.caption));
}

function claimWindow(binding, window) {
    binding.window = window;
    prepareWindow(window, binding);

    const visible = visibleGeometry(window, binding);
    if (visible) {
        const hidden = hiddenGeometry(visible, binding);
        trySet(window, "frameGeometry", hidden);
        binding.visible = false;
        log("claimed and hid " + binding.id
            + " visible=" + geometryText(visible)
            + " hidden=" + geometryText(hidden));
    } else {
        binding.visible = true;
        log("claimed " + binding.id + " without changing geometry: no output geometry available");
    }

    if (window.closed) {
        window.closed.connect(() => {
            if (binding.window === window) {
                binding.window = null;
                binding.visible = false;
            }
        });
    }
}

function findWindow(binding) {
    return binding.window || null;
}

function toggleBinding(binding) {
    const window = findWindow(binding);
    if (!window) {
        log("no matching window for " + binding.id);
        return;
    }

    const visible = visibleGeometry(window, binding);
    if (!visible) {
        log("no output geometry available for " + binding.id);
        return;
    }

    prepareWindow(window, binding);

    if (binding.visible) {
        const hidden = hiddenGeometry(visible, binding);
        trySet(window, "frameGeometry", hidden);
        binding.visible = false;
        log("hid " + binding.id
            + " visible=" + geometryText(visible)
            + " hidden=" + geometryText(hidden));
    } else {
        trySet(window, "frameGeometry", visible);
        activateWindow(window, binding);
        binding.visible = true;
        log("showed " + binding.id + " visible=" + geometryText(visible));
    }
}

function claimActiveWindow(binding) {
    const window = workspace.activeWindow;
    if (!window) {
        log("no active window to claim for " + binding.id);
        return;
    }

    if (!matchesBinding(window, binding)) {
        log("active window does not match candidate rules for " + binding.id
            + ": " + asString(window.caption));
        return;
    }

    claimWindow(binding, window);
    log("claimed " + asString(window.caption) + " for " + binding.id);
}

function registerBinding(config) {
    if (!config.id || !config.shortcut) {
        log("skipping incomplete binding");
        return;
    }

    const binding = {
        id: config.id,
        name: config.name || config.id,
        shortcut: config.shortcut,
        edge: config.edge || "top",
        widthPercent: config.widthPercent,
        heightPercent: config.heightPercent,
        match: config.match || {},
        claimShortcut: config.claimShortcut,
        windowHints: config.windowHints || {},
        window: null,
        visible: false
    };

    bindings.set(binding.id, binding);

    registerShortcut(
        "DropMan-" + binding.id,
        "DropMan: " + binding.name,
        binding.shortcut,
        () => toggleBinding(binding)
    );

    if (binding.claimShortcut) {
        registerShortcut(
            "DropMan-Claim-" + binding.id,
            "DropMan: Claim " + binding.name,
            binding.claimShortcut,
            () => claimActiveWindow(binding)
        );
    }
}

function processWindow(window) {
    bindings.forEach((binding) => {
        if (!binding.window && matchesBinding(window, binding)) {
            log("candidate for " + binding.id + ": " + asString(window.caption));
        }
    });
}

function main() {
    const config = readConfig();
    (config.bindings || []).forEach(registerBinding);

    workspace.windowList().forEach(processWindow);
    workspace.windowAdded.connect(processWindow);

    if (workspace.screensChanged) {
        workspace.screensChanged.connect(() => {
            bindings.forEach((binding) => {
                if (binding.window && binding.visible) {
                    const visible = visibleGeometry(binding.window, binding);
                    if (visible) {
                        trySet(binding.window, "frameGeometry", visible);
                    }
                }
            });
        });
    }

    log("loaded " + bindings.size + " bindings");
}

main();
