/*
    DropMan KWin script.

    Prototype behavior:
    - register configured global shortcuts;
    - claim only the active window when a claim shortcut is pressed;
    - preserve the claimed window geometry as the shown state;
    - hide by moving that exact rectangle offscreen along the configured edge.

    Design rule: match many, bind one. Matching rules identify candidates only.
    They must not mutate every matching app window.
*/

const LOG_PREFIX = "dropman: ";
const SCRIPT_VERSION = "picked-claim-config-20260621";

const DEFAULT_CONFIG = {
    bindings: [
        {
            id: "konsole",
            name: "Konsole",
            shortcut: "Meta+K",
            edge: "top",
            mode: "preserve_geometry",
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
            mode: "preserve_geometry",
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
            mode: "preserve_geometry",
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
let runtimeConfig = null;

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

function normalizedId(value) {
    return lower(value).replace(/[{}]/g, "").trim();
}

function propertyText(object, key) {
    try {
        if (object && key in object) {
            const value = object[key];
            if (value !== undefined && value !== null) {
                return asString(value);
            }
        }
    } catch (error) {
        log("could not read " + key + ": " + error);
    }

    return "";
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

function readRuntimeConfig() {
    const profilesJson = readConfig("profilesJson", "");
    if (profilesJson) {
        try {
            const parsed = JSON.parse(profilesJson);
            if (parsed && parsed.bindings && parsed.bindings.length >= 0) {
                log("loaded " + parsed.bindings.length + " profiles from KWin Script-dropman config");
                return parsed;
            }
            log("profilesJson did not contain a bindings array");
        } catch (error) {
            log("could not parse profilesJson: " + error);
        }
    } else {
        log("no profilesJson in KWin Script-dropman config; using packaged defaults");
    }

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

function copyGeometry(geometry) {
    if (!geometry) {
        return null;
    }

    return {
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height
    };
}

function currentFrameGeometry(window) {
    return copyGeometry(window && window.frameGeometry);
}

function hiddenGeometry(shown, binding, window) {
    const edge = binding.edge || "top";
    const hidden = {
        x: shown.x,
        y: shown.y,
        width: shown.width,
        height: shown.height
    };
    const screen = activeOutputGeometry(window);

    if (edge === "top") {
        hidden.y = screen ? screen.y - shown.height : shown.y - shown.height;
    } else if (edge === "bottom") {
        hidden.y = screen ? screen.y + screen.height : shown.y + shown.height;
    } else if (edge === "left") {
        hidden.x = screen ? screen.x - shown.width : shown.x - shown.width;
    } else if (edge === "right") {
        hidden.x = screen ? screen.x + screen.width : shown.x + shown.width;
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

function windowIdentityText(window) {
    const values = [];
    ["uuid", "internalId", "windowId", "id"].forEach((key) => {
        const value = propertyText(window, key);
        if (value) {
            values.push(key + "=" + value);
        }
    });

    return values.join(" ");
}

function windowMatchesUuid(window, uuid) {
    const expected = normalizedId(uuid);
    if (!expected) {
        return false;
    }

    const keys = ["uuid", "internalId", "windowId", "id"];
    for (let i = 0; i < keys.length; ++i) {
        const value = normalizedId(propertyText(window, keys[i]));
        if (value && value === expected) {
            return true;
        }
    }

    return false;
}

function findWindowByUuid(uuid) {
    const windows = workspace.windowList();
    for (let i = 0; i < windows.length; ++i) {
        if (windowMatchesUuid(windows[i], uuid)) {
            return windows[i];
        }
    }

    return null;
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

function currentDesktop() {
    if (workspace.currentDesktop) {
        return workspace.currentDesktop;
    }
    if (workspace.currentVirtualDesktop) {
        return workspace.currentVirtualDesktop;
    }
    return null;
}

function moveWindowToCurrentContext(window, binding) {
    const desktop = currentDesktop();
    let movedDesktop = false;
    let movedActivity = false;

    if (desktop) {
        if ("desktops" in window) {
            movedDesktop = trySet(window, "desktops", [desktop]);
        }
        if (!movedDesktop) {
            movedDesktop = trySet(window, "desktop", desktop);
        }
    }

    if (workspace.currentActivity && "activities" in window) {
        movedActivity = trySet(window, "activities", [workspace.currentActivity]);
    }

    log("context for " + binding.id
        + " movedDesktop=" + movedDesktop
        + " movedActivity=" + movedActivity);
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
    binding.shownGeometry = currentFrameGeometry(window);
    prepareWindow(window, binding);

    if (binding.shownGeometry) {
        const hidden = hiddenGeometry(binding.shownGeometry, binding, window);
        trySet(window, "frameGeometry", hidden);
        binding.visible = false;
        log("claimed and hid " + binding.id
            + " shown=" + geometryText(binding.shownGeometry)
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

    if (!binding.shownGeometry) {
        binding.shownGeometry = currentFrameGeometry(window);
    }

    if (!binding.shownGeometry) {
        log("no shown geometry available for " + binding.id);
        return;
    }

    prepareWindow(window, binding);

    if (binding.visible) {
        const current = currentFrameGeometry(window);
        if (current) {
            binding.shownGeometry = current;
        }

        const hidden = hiddenGeometry(binding.shownGeometry, binding, window);
        trySet(window, "frameGeometry", hidden);
        binding.visible = false;
        log("hid " + binding.id
            + " shown=" + geometryText(binding.shownGeometry)
            + " hidden=" + geometryText(hidden));
    } else {
        moveWindowToCurrentContext(window, binding);
        trySet(window, "frameGeometry", binding.shownGeometry);
        activateWindow(window, binding);
        binding.visible = true;
        log("showed " + binding.id + " shown=" + geometryText(binding.shownGeometry));
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

function claimPickedWindow(binding) {
    const pendingClaim = (runtimeConfig && runtimeConfig.pendingClaim) || {};
    const profileId = asString(pendingClaim.profileId || readConfig("pendingClaimProfileId", ""));
    const uuid = asString(pendingClaim.windowUuid || readConfig("pendingClaimWindowUuid", ""));

    if (profileId !== binding.id) {
        log("pending picked claim is for " + profileId + ", not " + binding.id);
        return;
    }

    if (!uuid) {
        log("no pending picked window uuid for " + binding.id);
        return;
    }

    const window = findWindowByUuid(uuid);
    if (!window) {
        log("no picked window for " + binding.id + " uuid=" + uuid);
        workspace.windowList().forEach((candidate) => {
            log("available window: " + asString(candidate.caption)
                + " " + windowIdentityText(candidate));
        });
        return;
    }

    if (!matchesBinding(window, binding)) {
        log("picked window does not match candidate rules for " + binding.id
            + ": " + asString(window.caption)
            + " " + windowIdentityText(window));
        return;
    }

    claimWindow(binding, window);
    log("claimed picked " + asString(window.caption) + " for " + binding.id
        + " uuid=" + uuid);
}

function releaseBinding(binding) {
    if (!binding.window) {
        log("no claimed window to release for " + binding.id);
        return;
    }

    if (!binding.visible && binding.shownGeometry) {
        moveWindowToCurrentContext(binding.window, binding);
        trySet(binding.window, "frameGeometry", binding.shownGeometry);
        activateWindow(binding.window, binding);
    }

    log("released " + binding.id + " from " + asString(binding.window.caption));
    binding.window = null;
    binding.shownGeometry = null;
    binding.visible = false;
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
        mode: config.mode || "preserve_geometry",
        widthPercent: config.widthPercent,
        heightPercent: config.heightPercent,
        match: config.match || {},
        claimShortcut: config.claimShortcut,
        windowHints: config.windowHints || {},
        window: null,
        shownGeometry: null,
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

    registerShortcut(
        "DropMan-ClaimPicked-" + binding.id,
        "DropMan: Claim picked " + binding.name,
        "",
        () => claimPickedWindow(binding)
    );

    registerShortcut(
        "DropMan-Release-" + binding.id,
        "DropMan: Release " + binding.name,
        "",
        () => releaseBinding(binding)
    );
}

function processWindow(window) {
    bindings.forEach((binding) => {
        if (!binding.window && matchesBinding(window, binding)) {
            log("candidate for " + binding.id + ": " + asString(window.caption));
        }
    });
}

function main() {
    runtimeConfig = readRuntimeConfig();
    (runtimeConfig.bindings || []).forEach(registerBinding);

    workspace.windowList().forEach(processWindow);
    workspace.windowAdded.connect(processWindow);

    if (workspace.screensChanged) {
        workspace.screensChanged.connect(() => {
            bindings.forEach((binding) => {
                if (binding.window && !binding.visible && binding.shownGeometry) {
                    const hidden = hiddenGeometry(binding.shownGeometry, binding, binding.window);
                    trySet(binding.window, "frameGeometry", hidden);
                    log("reparked hidden " + binding.id
                        + " shown=" + geometryText(binding.shownGeometry)
                        + " hidden=" + geometryText(hidden));
                }
            });
        });
    }

    log("loaded " + bindings.size + " bindings; scriptVersion=" + SCRIPT_VERSION);
}

main();
