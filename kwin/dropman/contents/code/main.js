/*
    DropMan KWin script.

    Prototype behavior:
    - register configured global shortcuts;
    - claim only the active window when a claim shortcut is pressed;
    - preserve the claimed window geometry as the shown state;
    - leave newly claimed windows visible;
    - hide by moving that exact rectangle offscreen along the configured edge.

    Design rule: match many, bind one. Matching rules identify candidates only.
    They must not mutate every matching app window.
*/

const LOG_PREFIX = "dropman: ";
const SCRIPT_VERSION = "reload-recovery-20260621";

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
let lastNonDropdownWindow = null;

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

function restoredGeometryFromHidden(hidden, binding, window) {
    const edge = binding.edge || "top";
    const restored = {
        x: hidden.x,
        y: hidden.y,
        width: hidden.width,
        height: hidden.height
    };
    const screen = activeOutputGeometry(window);

    if (edge === "top") {
        restored.y = screen ? screen.y : hidden.y + hidden.height;
    } else if (edge === "bottom") {
        restored.y = screen ? screen.y + screen.height - hidden.height : hidden.y - hidden.height;
    } else if (edge === "left") {
        restored.x = screen ? screen.x : hidden.x + hidden.width;
    } else if (edge === "right") {
        restored.x = screen ? screen.x + screen.width - hidden.width : hidden.x - hidden.width;
    }

    return restored;
}

function isParkedOffscreen(geometry, binding, window) {
    if (!geometry) {
        return false;
    }

    const edge = binding.edge || "top";
    const screen = activeOutputGeometry(window);
    const tolerance = 4;

    if (!screen) {
        return false;
    }

    if (edge === "top") {
        return geometry.y + geometry.height <= screen.y + tolerance;
    } else if (edge === "bottom") {
        return geometry.y >= screen.y + screen.height - tolerance;
    } else if (edge === "left") {
        return geometry.x + geometry.width <= screen.x + tolerance;
    } else if (edge === "right") {
        return geometry.x >= screen.x + screen.width - tolerance;
    }

    return false;
}

function geometryText(geometry) {
    if (!geometry) {
        return "<none>";
    }
    return geometry.x + "," + geometry.y + " "
        + geometry.width + "x" + geometry.height;
}

function windowUuid(window) {
    const keys = ["uuid", "internalId", "windowId", "id"];
    for (let i = 0; i < keys.length; ++i) {
        const value = propertyText(window, keys[i]);
        if (value) {
            return normalizedId(value);
        }
    }

    return "";
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

function isClaimedWindow(window) {
    let claimed = false;
    bindings.forEach((binding) => {
        if (binding.window === window) {
            claimed = true;
        }
    });
    return claimed;
}

function isDropManControlWindow(window) {
    const caption = lower(window && window.caption);
    const resourceClass = lower(window && window.resourceClass);
    const resourceName = lower(window && window.resourceName);
    const desktopFile = lower(window && window.desktopFile);

    return caption === "dropman"
        || resourceClass === "dropman"
        || resourceName === "dropman"
        || desktopFile === "dropman";
}

function rememberFocusWindow(window) {
    if (!window || isClaimedWindow(window) || isDropManControlWindow(window)) {
        return;
    }

    lastNonDropdownWindow = window;
    log("remembered focus window: " + asString(window.caption));
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

function contextId(value) {
    if (!value) {
        return "";
    }
    if (typeof value === "string") {
        return value;
    }
    const id = propertyText(value, "id");
    return id || asString(value);
}

function sameContextId(left, right) {
    const leftId = normalizedId(contextId(left));
    const rightId = normalizedId(contextId(right));
    return leftId && rightId && leftId === rightId;
}

function windowOnCurrentDesktop(window) {
    const desktop = currentDesktop();
    if (!desktop) {
        return true;
    }

    if ("desktops" in window && window.desktops) {
        for (let i = 0; i < window.desktops.length; ++i) {
            if (sameContextId(window.desktops[i], desktop)) {
                return true;
            }
        }
        return false;
    }

    if ("desktop" in window) {
        return sameContextId(window.desktop, desktop);
    }

    return true;
}

function windowOnCurrentActivity(window) {
    if (!workspace.currentActivity || !("activities" in window) || !window.activities) {
        return true;
    }

    for (let i = 0; i < window.activities.length; ++i) {
        if (sameContextId(window.activities[i], workspace.currentActivity)) {
            return true;
        }
    }

    return false;
}

function windowOnCurrentContext(window) {
    return windowOnCurrentDesktop(window) && windowOnCurrentActivity(window);
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

function restoreFocusAfterHide(hiddenWindow, previousWindow, binding) {
    if (!previousWindow || previousWindow === hiddenWindow) {
        return;
    }

    trySet(previousWindow, "minimized", false);
    const activated = tryCall(workspace, "activateWindow", previousWindow)
        || trySet(workspace, "activeWindow", previousWindow)
        || trySet(previousWindow, "active", true);
    const raised = tryCall(workspace, "raiseWindow", previousWindow)
        || tryCall(previousWindow, "raise");

    log("restored focus after hiding " + binding.id
        + " activated=" + activated
        + " raised=" + raised
        + " activeWindow=" + asString(workspace.activeWindow && workspace.activeWindow.caption));
}

function watchClaimedWindow(binding, window) {
    if (window.closed) {
        window.closed.connect(() => {
            if (binding.window === window) {
                binding.window = null;
                binding.visible = false;
            }
        });
    }
}

function finishClaimWindow(binding, window) {
    binding.window = window;
    binding.shownGeometry = currentFrameGeometry(window);
    binding.visible = true;

    if (binding.shownGeometry) {
        log("claimed " + binding.id
            + " shown=" + geometryText(binding.shownGeometry)
            + " left visible");
    } else {
        log("claimed " + binding.id + " without changing geometry: no output geometry available");
    }

    watchClaimedWindow(binding, window);
}

function claimWindow(binding, window) {
    prepareWindow(window, binding);
    finishClaimWindow(binding, window);
}

function findWindow(binding) {
    return binding.window || null;
}

function recoverParkedWindow(binding) {
    const candidates = [];
    workspace.windowList().forEach((window) => {
        if (!matchesBinding(window, binding)) {
            return;
        }

        const current = currentFrameGeometry(window);
        if (isParkedOffscreen(current, binding, window)) {
            candidates.push({
                window: window,
                hidden: current
            });
        }
    });

    if (candidates.length === 0) {
        return false;
    }

    if (candidates.length > 1) {
        log("ambiguous parked windows for " + binding.id + ": " + candidates.length);
        return false;
    }

    const candidate = candidates[0];
    binding.window = candidate.window;
    binding.shownGeometry = restoredGeometryFromHidden(candidate.hidden, binding, candidate.window);
    binding.visible = false;
    watchClaimedWindow(binding, candidate.window);
    log("recovered parked " + binding.id
        + " hidden=" + geometryText(candidate.hidden)
        + " shown=" + geometryText(binding.shownGeometry));
    return true;
}

function recoverSoleMatchingWindow(binding) {
    const candidates = [];
    workspace.windowList().forEach((window) => {
        if (matchesBinding(window, binding)) {
            candidates.push(window);
        }
    });

    if (candidates.length === 0) {
        return false;
    }

    if (candidates.length > 1) {
        log("ambiguous matching windows for " + binding.id + ": " + candidates.length);
        return false;
    }

    const window = candidates[0];
    binding.window = window;
    binding.shownGeometry = currentFrameGeometry(window);
    binding.visible = !isParkedOffscreen(binding.shownGeometry, binding, window);
    watchClaimedWindow(binding, window);
    log("recovered sole matching " + binding.id
        + " visible=" + binding.visible
        + " shown=" + geometryText(binding.shownGeometry)
        + " " + windowIdentityText(window));
    return true;
}

function toggleBinding(binding) {
    let window = findWindow(binding);
    if (!window) {
        if (!recoverParkedWindow(binding) && !recoverSoleMatchingWindow(binding)) {
            log("no matching window for " + binding.id);
            return;
        }
        window = findWindow(binding);
    }

    if (!binding.shownGeometry) {
        binding.shownGeometry = currentFrameGeometry(window);
    }

    if (!binding.shownGeometry) {
        log("no shown geometry available for " + binding.id);
        return;
    }

    prepareWindow(window, binding);

    const liveGeometry = currentFrameGeometry(window);
    const liveParkedOffscreen = isParkedOffscreen(liveGeometry, binding, window);
    if (liveParkedOffscreen) {
        binding.visible = false;
    }

    if (binding.visible) {
        if (!windowOnCurrentContext(window)) {
            moveWindowToCurrentContext(window, binding);
            trySet(window, "frameGeometry", binding.shownGeometry);
            activateWindow(window, binding);
            binding.visible = true;
            log("moved visible " + binding.id
                + " to current context shown=" + geometryText(binding.shownGeometry));
            return;
        }

        if (workspace.activeWindow !== window) {
            trySet(window, "frameGeometry", binding.shownGeometry);
            activateWindow(window, binding);
            binding.visible = true;
            log("raised visible " + binding.id
                + " shown=" + geometryText(binding.shownGeometry));
            return;
        }

        const current = liveGeometry || currentFrameGeometry(window);
        if (current) {
            binding.shownGeometry = current;
        }

        const hidden = hiddenGeometry(binding.shownGeometry, binding, window);
        trySet(window, "frameGeometry", hidden);
        binding.visible = false;
        restoreFocusAfterHide(window, lastNonDropdownWindow, binding);
        log("hid " + binding.id
            + " shown=" + geometryText(binding.shownGeometry)
            + " hidden=" + geometryText(hidden));
    } else {
        moveWindowToCurrentContext(window, binding);
        trySet(window, "frameGeometry", binding.shownGeometry);
        activateWindow(window, binding);
        binding.visible = true;
        log("showed " + binding.id
            + " shown=" + geometryText(binding.shownGeometry)
            + " recoveredOffscreen=" + liveParkedOffscreen);
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

function pickedWindowForBinding(binding) {
    const pendingClaim = (runtimeConfig && runtimeConfig.pendingClaim) || {};
    const profileId = asString(readConfig("pendingClaimProfileId", "") || pendingClaim.profileId);
    const uuid = asString(readConfig("pendingClaimWindowUuid", "") || pendingClaim.windowUuid);

    if (profileId !== binding.id) {
        log("pending picked claim is for " + profileId + ", not " + binding.id);
        return null;
    }

    if (!uuid) {
        log("no pending picked window uuid for " + binding.id);
        return null;
    }

    const window = findWindowByUuid(uuid);
    if (!window) {
        log("no picked window for " + binding.id + " uuid=" + uuid);
        workspace.windowList().forEach((candidate) => {
            log("available window: " + asString(candidate.caption)
                + " " + windowIdentityText(candidate));
        });
        return null;
    }

    if (!matchesBinding(window, binding)) {
        log("picked window does not match candidate rules for " + binding.id
            + ": " + asString(window.caption)
            + " " + windowIdentityText(window));
        return null;
    }

    return {
        window: window,
        uuid: uuid
    };
}

function claimPickedWindow(binding) {
    const picked = pickedWindowForBinding(binding);
    if (!picked) {
        return;
    }

    const window = picked.window;
    claimWindow(binding, window);
    log("claimed picked " + asString(window.caption) + " for " + binding.id
        + " uuid=" + picked.uuid);
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
    rememberFocusWindow(workspace.activeWindow);

    if (workspace.windowActivated) {
        workspace.windowActivated.connect(rememberFocusWindow);
    } else if (workspace.clientActivated) {
        workspace.clientActivated.connect(rememberFocusWindow);
    } else {
        log("focus tracking unavailable: no windowActivated signal");
    }

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
