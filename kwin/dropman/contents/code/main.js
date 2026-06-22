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
const SCRIPT_VERSION = "shortcut-entry-diagnostics-20260622";

const STATE = {
    UNCLAIMED: "unclaimed",
    VISIBLE: "visible",
    HIDDEN: "hidden",
    SUMMONING: "summoning",
    HIDING: "hiding",
    EXTERNAL_MINIMIZED: "external_minimized",
    LOST: "lost"
};

const EVENT = {
    CLAIM: "claim",
    RESTORE_CLAIM: "restore_claim",
    RECOVER_PARKED: "recover_parked",
    RECOVER_VISIBLE: "recover_visible",
    HIDE: "hide",
    SHOW: "show",
    SYNC_HIDDEN: "sync_hidden",
    RELEASE: "release",
    WINDOW_CLOSED: "window_closed"
};

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
        },
        {
            id: "cool-retro-term",
            name: "Cool Retro Term",
            shortcut: "Meta+J",
            edge: "top",
            mode: "preserve_geometry",
            widthPercent: 100,
            heightPercent: 45,
            claimShortcut: "Meta+Shift+J",
            windowHints: {},
            match: {
                resourceClass: "cool-retro-term",
                resourceName: "cool-retro-term"
            }
        }
    ]
};

const bindings = new Map();
let runtimeConfig = null;
let appPersistedClaims = {};

function log(message) {
    console.info(LOG_PREFIX + message);
}

function setBindingState(binding, state, reason) {
    if (!binding || binding.state === state) {
        return;
    }

    const previous = binding.state || STATE.UNCLAIMED;
    binding.state = state;
    log("state " + binding.id + " " + previous + " -> " + state
        + (reason ? " (" + reason + ")" : ""));
}

function setBindingVisible(binding, visible, reason) {
    binding.visible = visible;
    setBindingState(binding, visible ? STATE.VISIBLE : STATE.HIDDEN, reason);
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

function propertyBool(object, key) {
    try {
        if (object && key in object) {
            return object[key] === true || object[key] === "true";
        }
    } catch (error) {
        log("could not read " + key + ": " + error);
    }

    return false;
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

function isMinimized(window) {
    return propertyBool(window, "minimized");
}

function nowMilliseconds() {
    return Date.now ? Date.now() : new Date().getTime();
}

function clearRestoreState(window) {
    trySet(window, "minimized", false);
    trySet(window, "maximizeHorizontal", 0);
    trySet(window, "maximizeVertical", 0);
    trySet(window, "fullscreen", false);
}

function applyClaimedGeometry(window, geometry) {
    return trySet(window, "frameGeometry", geometry);
}

function applyRecoveredClaimedGeometry(window, geometry) {
    clearRestoreState(window);
    return trySet(window, "frameGeometry", geometry);
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

function objectKeyCount(object) {
    let count = 0;
    if (!object) {
        return 0;
    }
    Object.keys(object).forEach(() => {
        ++count;
    });
    return count;
}

function readAppPersistedClaims() {
    const claimsJson = readConfig("claimsJson", "");
    if (!claimsJson) {
        log("no app-persisted claim state in KWin Script-dropman config");
        return {};
    }

    try {
        const parsed = JSON.parse(claimsJson);
        if (parsed && parsed.claims) {
            log("loaded app-persisted claim state for "
                + objectKeyCount(parsed.claims) + " profiles");
            return parsed.claims;
        }
        log("claimsJson did not contain a claims object");
    } catch (error) {
        log("could not parse claimsJson: " + error);
    }

    return {};
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

function isNormalCandidateWindow(window) {
    if (!window) {
        return false;
    }

    const type = propertyText(window, "type");
    if (type && Number(type) !== 0) {
        return false;
    }

    if (propertyBool(window, "modal")) {
        return false;
    }

    if (propertyText(window, "transientFor")
        || propertyText(window, "transientParent")) {
        return false;
    }

    return true;
}

function matchesBinding(window, binding) {
    const match = binding.match || {};
    return isNormalCandidateWindow(window)
        && matchesField(window, "resourceClass", match.resourceClass)
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

function persistedGeometry(value) {
    if (!value) {
        return null;
    }

    if (typeof value.x !== "number"
        || typeof value.y !== "number"
        || typeof value.width !== "number"
        || typeof value.height !== "number") {
        return null;
    }

    return copyGeometry(value);
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

function bindingForWindow(window) {
    let found = null;
    bindings.forEach((binding) => {
        if (binding.window === window) {
            found = binding;
        }
    });
    return found;
}

function isDropManControlWindow(window) {
    const caption = lower(window && window.caption);
    const resourceClass = lower(window && window.resourceClass);
    const resourceName = lower(window && window.resourceName);
    const desktopFile = lower(window && window.desktopFile);

    return caption === "dropman"
        || caption.indexOf("dropman :") === 0
        || resourceClass === "dropman"
        || resourceName === "dropman"
        || desktopFile === "dropman";
}

function isDropManNoticeWindow(window) {
    return lower(window && window.caption) === "dropman claim confirmation";
}

function prepareNoticeWindow(window) {
    trySet(window, "keepAbove", true);
    trySet(window, "skipTaskbar", true);
    trySet(window, "skipPager", true);

    if (workspace.currentActivity && "activities" in window) {
        trySet(window, "activities", [workspace.currentActivity]);
    }

    const desktop = currentDesktop();
    if (desktop) {
        if ("desktops" in window) {
            trySet(window, "desktops", [desktop]);
        } else {
            trySet(window, "desktop", desktop);
        }
    }

    tryCall(workspace, "raiseWindow", window) || tryCall(window, "raise");
    log("prepared claim notice window keepAbove=true caption=" + asString(window.caption));
}

function rememberFocusWindow(window) {
    if (!window || isClaimedWindow(window) || isDropManControlWindow(window)) {
        if (isClaimedWindow(window)) {
            bindings.forEach((binding) => {
                if (binding.suppressActivationUntil
                    && nowMilliseconds() < binding.suppressActivationUntil) {
                    return;
                }
                if (binding.window === window
                    && !binding.visible
                    && isParkedOffscreen(currentFrameGeometry(window), binding, window)) {
                    showRetractedWindowFromActivation(binding, window);
                }
            });

            const binding = bindingForWindow(window);
            if (binding && binding.visible) {
                log("remembered dropdown focus window: " + binding.id);
            }
        }
        return;
    }

    log("remembered focus window: " + asString(window.caption));
}

function prepareWindow(window, binding) {
    const hints = binding.windowHints || {};

    if (hints.noBorder === true) {
        trySet(window, "noBorder", true);
    }
    if (hints.keepAbove === true) {
        trySet(window, "keepAbove", true);
    } else {
        trySet(window, "keepAbove", false);
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

function attachClaim(binding, window, shownGeometry, visible, reason) {
    binding.window = window;
    binding.shownGeometry = shownGeometry || currentFrameGeometry(window);
    prepareWindow(window, binding);
    tagDropManWindow(binding, window);
    setBindingVisible(binding, visible, reason);
    watchClaimedWindow(binding, window);
}

function hideBinding(binding, reason, options) {
    const window = binding.window;
    if (!window) {
        log("cannot hide unclaimed " + binding.id);
        return false;
    }

    const opts = options || {};
    if (!binding.shownGeometry || opts.captureCurrent === true) {
        const current = currentFrameGeometry(window);
        if (current && !isParkedOffscreen(current, binding, window)) {
            binding.shownGeometry = current;
        }
    }

    if (!binding.shownGeometry) {
        log("cannot hide " + binding.id + ": no shown geometry");
        setBindingVisible(binding, false, reason + " without geometry");
        return false;
    }

    prepareWindow(window, binding);
    const hidden = hiddenGeometry(binding.shownGeometry, binding, window);
    setBindingVisible(binding, false, reason);
    binding.suppressActivationUntil = nowMilliseconds() + 600;
    applyRecoveredClaimedGeometry(window, hidden);
    log("hid " + binding.id
        + " reason=" + reason
        + " shown=" + geometryText(binding.shownGeometry)
        + " hidden=" + geometryText(hidden));
    return true;
}

function showBinding(binding, reason, options) {
    const window = binding.window;
    if (!window) {
        log("cannot show unclaimed " + binding.id);
        return false;
    }

    const opts = options || {};
    if (!binding.shownGeometry) {
        binding.shownGeometry = opts.fromHidden
            ? restoredGeometryFromHidden(currentFrameGeometry(window), binding, window)
            : currentFrameGeometry(window);
    }

    if (!binding.shownGeometry) {
        log("cannot show " + binding.id + ": no shown geometry");
        return false;
    }

    prepareWindow(window, binding);
    moveWindowToCurrentContext(window, binding);
    if (opts.fromHidden || isMinimized(window)) {
        const hidden = hiddenGeometry(binding.shownGeometry, binding, window);
        applyRecoveredClaimedGeometry(window, hidden);
    }
    applyRecoveredClaimedGeometry(window, binding.shownGeometry);
    activateWindow(window, binding);
    setBindingVisible(binding, true, reason);
    log("showed " + binding.id
        + " reason=" + reason
        + " shown=" + geometryText(binding.shownGeometry));
    return true;
}

function releaseBindingState(binding, reason) {
    if (!binding.window) {
        log("no claimed window to release for " + binding.id);
        return false;
    }

    const window = binding.window;
    if (!binding.visible && binding.shownGeometry) {
        showBinding(binding, reason + " restore before release", { fromHidden: true });
    }

    trySet(window, "keepAbove", false);
    log("released " + binding.id + " from " + asString(window.caption));
    binding.window = null;
    binding.shownGeometry = null;
    binding.visible = false;
    setBindingState(binding, STATE.UNCLAIMED, reason);
    return true;
}

function transitionBinding(binding, event, payload) {
    const data = payload || {};

    if (event === EVENT.CLAIM
        || event === EVENT.RESTORE_CLAIM
        || event === EVENT.RECOVER_PARKED
        || event === EVENT.RECOVER_VISIBLE) {
        attachClaim(
            binding,
            data.window,
            data.shownGeometry,
            data.visible === true,
            data.reason || event);
        return true;
    }

    if (event === EVENT.HIDE) {
        return hideBinding(binding, data.reason || event, data.options || {});
    }

    if (event === EVENT.SHOW) {
        return showBinding(binding, data.reason || event, data.options || {});
    }

    if (event === EVENT.SYNC_HIDDEN) {
        setBindingVisible(binding, false, data.reason || event);
        return true;
    }

    if (event === EVENT.RELEASE) {
        return releaseBindingState(binding, data.reason || event);
    }

    if (event === EVENT.WINDOW_CLOSED) {
        binding.window = null;
        binding.shownGeometry = null;
        binding.visible = false;
        setBindingState(binding, STATE.UNCLAIMED, data.reason || event);
        return true;
    }

    log("unknown transition event for " + binding.id + ": " + event);
    return false;
}

function parkExternallyMinimizedWindow(binding, window) {
    if (!binding.shownGeometry) {
        binding.shownGeometry = currentFrameGeometry(window);
    }

    if (!binding.shownGeometry) {
        log("externally minimized " + binding.id + " without known shown geometry");
        setBindingVisible(binding, false, "external minimize without geometry");
        return;
    }

    transitionBinding(binding, EVENT.HIDE, {
        reason: "taskbar minimize",
        options: { captureCurrent: false }
    });
}

function showRetractedWindowFromActivation(binding, window) {
    if (!binding.shownGeometry) {
        binding.shownGeometry = restoredGeometryFromHidden(
            currentFrameGeometry(window),
            binding,
            window);
    }

    if (!binding.shownGeometry) {
        log("activated retracted " + binding.id + " without known shown geometry");
        return;
    }

    transitionBinding(binding, EVENT.SHOW, {
        reason: "taskbar activation",
        options: { fromHidden: true }
    });
}

function watchClaimedWindow(binding, window) {
    if (window.closed) {
        window.closed.connect(() => {
            if (binding.window === window) {
                transitionBinding(binding, EVENT.WINDOW_CLOSED, { reason: "window closed" });
            }
        });
    }

    if (window.minimizedChanged && !window.dropmanMinimizedWatcher) {
        window.dropmanMinimizedWatcher = true;
        window.minimizedChanged.connect(() => {
            if (binding.window === window && isMinimized(window)) {
                parkExternallyMinimizedWindow(binding, window);
            }
        });
    }
}

function tagDropManWindow(binding, window) {
    if (!window) {
        return;
    }

    trySet(window, "dropmanDropdown", true);
    trySet(window, "dropmanProfileId", binding.id);
    trySet(window, "dropmanEdge", binding.edge || "top");
}

function finishClaimWindow(binding, window) {
    transitionBinding(binding, EVENT.CLAIM, {
        window: window,
        shownGeometry: currentFrameGeometry(window),
        visible: true,
        reason: "claim"
    });
    if (binding.shownGeometry) {
        log("claimed " + binding.id
            + " shown=" + geometryText(binding.shownGeometry)
            + " left visible");
    } else {
        log("claimed " + binding.id + " without changing geometry: no output geometry available");
    }

}

function claimWindow(binding, window) {
    finishClaimWindow(binding, window);
}

function findWindow(binding) {
    return binding.window || null;
}

function recoverParkedWindow(binding) {
    const candidates = [];
    workspace.windowList().forEach((window) => {
        if (isDropManControlWindow(window)) {
            return;
        }

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
    transitionBinding(binding, EVENT.RECOVER_PARKED, {
        window: candidate.window,
        shownGeometry: restoredGeometryFromHidden(candidate.hidden, binding, candidate.window),
        visible: false,
        reason: "recovered parked"
    });
    log("recovered parked " + binding.id
        + " hidden=" + geometryText(candidate.hidden)
        + " shown=" + geometryText(binding.shownGeometry));
    return true;
}

function recoverSoleMatchingWindow(binding) {
    const candidates = [];
    workspace.windowList().forEach((window) => {
        if (!isDropManControlWindow(window) && matchesBinding(window, binding)) {
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
    const shownGeometry = currentFrameGeometry(window);
    const visible = !isMinimized(window)
        && !isParkedOffscreen(shownGeometry, binding, window);
    transitionBinding(binding, EVENT.RECOVER_VISIBLE, {
        window: window,
        shownGeometry: shownGeometry,
        visible: visible,
        reason: "recovered sole matching"
    });
    log("recovered sole matching " + binding.id
        + " visible=" + binding.visible
        + " shown=" + geometryText(binding.shownGeometry)
        + " " + windowIdentityText(window));
    return true;
}

function restoreAppPersistedClaim(binding) {
    const claim = appPersistedClaims[binding.id];
    if (!claim) {
        return false;
    }

    const uuid = asString(claim.windowUuid);
    if (!uuid) {
        log("forgot app-persisted claim for " + binding.id + ": missing uuid");
        return false;
    }

    const window = findWindowByUuid(uuid);
    if (!window) {
        log("forgot app-persisted claim for " + binding.id
            + ": uuid not found uuid=" + uuid);
        return false;
    }

    if (isDropManControlWindow(window)) {
        log("discarded app-persisted claim for " + binding.id
            + ": remembered window is DropMan control window "
            + asString(window.caption)
            + " " + windowIdentityText(window));
        return false;
    }

    if (!matchesBinding(window, binding)) {
        log("discarded app-persisted claim for " + binding.id
            + ": candidate rules reject " + asString(window.caption)
            + " " + windowIdentityText(window));
        return false;
    }

    const shown = persistedGeometry(claim.shownGeometry)
        || currentFrameGeometry(window);
    if (!shown) {
        log("forgot app-persisted claim for " + binding.id
            + ": no shown geometry uuid=" + uuid);
        return false;
    }

    transitionBinding(binding, EVENT.RESTORE_CLAIM, {
        window: window,
        shownGeometry: shown,
        visible: claim.visible === true,
        reason: "restored persisted claim"
    });

    const liveGeometry = currentFrameGeometry(window);
    if (isMinimized(window) || isParkedOffscreen(liveGeometry, binding, window)) {
        transitionBinding(binding, EVENT.SYNC_HIDDEN, {
            reason: "restored parked or minimized"
        });
    }

    log("restored app-persisted claim " + binding.id
        + " visible=" + binding.visible
        + " shown=" + geometryText(binding.shownGeometry)
        + " live=" + geometryText(liveGeometry)
        + " uuid=" + uuid
        + " " + asString(window.caption));
    return true;
}

function toggleBinding(binding) {
    const now = nowMilliseconds();
    if (binding.lastToggleAt && now - binding.lastToggleAt < 300) {
        log("ignored rapid toggle for " + binding.id
            + " after " + (now - binding.lastToggleAt) + "ms");
        return;
    }
    binding.lastToggleAt = now;

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
    const liveMinimized = isMinimized(window);
    const liveParkedOffscreen = isParkedOffscreen(liveGeometry, binding, window);
    if (liveMinimized || liveParkedOffscreen) {
        transitionBinding(binding, EVENT.SYNC_HIDDEN, {
            reason: "live geometry hidden"
        });
    }

    if (binding.visible) {
        const activeBinding = bindingForWindow(workspace.activeWindow);
        if (activeBinding && activeBinding !== binding && activeBinding.visible) {
            transitionBinding(binding, EVENT.SHOW, {
                reason: "summoned from behind another dropdown",
                options: { fromHidden: true }
            });
            log("summoned covered " + binding.id
                + " over " + activeBinding.id);
            return;
        }

        if (!windowOnCurrentContext(window)) {
            transitionBinding(binding, EVENT.SHOW, {
                reason: "summoned to current context",
                options: { fromHidden: true }
            });
            log("summoned visible " + binding.id
                + " to current context");
            return;
        }

        transitionBinding(binding, EVENT.HIDE, {
            reason: "profile shortcut hide",
            options: { captureCurrent: true }
        });
    } else {
        transitionBinding(binding, EVENT.SHOW, {
            reason: liveMinimized ? "show minimized" : "show hidden",
            options: { fromHidden: liveMinimized || liveParkedOffscreen }
        });
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

    if (isDropManControlWindow(window)) {
        log("refusing to claim DropMan control window for " + binding.id
            + ": " + asString(window.caption)
            + " " + windowIdentityText(window));
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

    if (isDropManControlWindow(window)) {
        log("refusing picked DropMan control window for " + binding.id
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

function claimPendingPickedWindow() {
    const pendingClaim = (runtimeConfig && runtimeConfig.pendingClaim) || {};
    const profileId = asString(readConfig("pendingClaimProfileId", "") || pendingClaim.profileId);
    if (!profileId) {
        return false;
    }

    const binding = bindings.get(profileId);
    if (!binding) {
        log("pending picked claim has unknown profile " + profileId);
        return false;
    }

    if (binding.window) {
        return false;
    }

    const before = binding.window;
    claimPickedWindow(binding);
    return binding.window !== before && binding.window !== null;
}

function releaseBinding(binding) {
    transitionBinding(binding, EVENT.RELEASE, { reason: "release" });
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
        state: STATE.UNCLAIMED,
        visible: false,
        lastToggleAt: 0,
        suppressActivationUntil: 0
    };

    bindings.set(binding.id, binding);

    registerShortcut(
        "DropMan-" + binding.id,
        "DropMan: " + binding.name,
        binding.shortcut,
        () => {
            log("shortcut fired " + binding.id
                + " state=" + binding.state
                + " visible=" + binding.visible
                + " hasWindow=" + Boolean(binding.window));
            toggleBinding(binding);
        }
    );

    if (binding.claimShortcut) {
        registerShortcut(
            "DropMan-Claim-" + binding.id,
            "DropMan: Claim " + binding.name,
            binding.claimShortcut,
            () => {
                log("claim shortcut fired " + binding.id);
                claimActiveWindow(binding);
            }
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
    if (isDropManNoticeWindow(window)) {
        prepareNoticeWindow(window);
        return;
    }

    if (isDropManControlWindow(window)) {
        return;
    }

    bindings.forEach((binding) => {
        if (!binding.window && matchesBinding(window, binding)) {
            log("candidate for " + binding.id + ": " + asString(window.caption));
        }
    });
}

function main() {
    runtimeConfig = readRuntimeConfig();
    appPersistedClaims = readAppPersistedClaims();
    (runtimeConfig.bindings || []).forEach(registerBinding);

    bindings.forEach(restoreAppPersistedClaim);
    claimPendingPickedWindow();
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
                    applyClaimedGeometry(binding.window, hidden);
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
