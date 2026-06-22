/*
    DropMan KWin effect.

    Experimental compositor-side animation for exact app-picked DropMan
    claims. It prefers exact UUID/config or KWin-script window tags, and falls
    back to large edge translations while the runtime protocol is still
    experimental.
*/

"use strict";

const LOG_PREFIX = "dropman-slide: ";

function log(message) {
    console.info(LOG_PREFIX + message);
}

function asString(value) {
    if (value === undefined || value === null) {
        return "";
    }
    return String(value);
}

function normalizedId(value) {
    return asString(value).toLowerCase().replace(/[{}]/g, "").trim();
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

function windowUuid(window) {
    const keys = ["uuid", "internalId", "windowId", "id"];
    for (let i = 0; i < keys.length; ++i) {
        const value = normalizedId(propertyText(window, keys[i]));
        if (value) {
            return value;
        }
    }

    return "";
}

function geometryText(geometry) {
    if (!geometry) {
        return "<none>";
    }
    return geometry.x + "," + geometry.y + " "
        + geometry.width + "x" + geometry.height;
}

class DropManSlideEffect {
    constructor() {
        this.claimsByUuid = {};
        this.showDuration = 420;
        this.hideDuration = 420;

        effect.configChanged.connect(this.loadConfig.bind(this));
        effects.windowAdded.connect(this.manage.bind(this));

        for (const window of effects.stackingOrder) {
            this.manage(window);
        }

        this.loadConfig();
        log("loaded");
    }

    loadConfig() {
        this.claimsByUuid = {};
        const configuredShowDuration = Number(effect.readConfig("ShowDuration", 420));
        const configuredHideDuration = Number(effect.readConfig("HideDuration", 420));
        this.showDuration = Math.max(animationTime(configuredShowDuration), 260);
        this.hideDuration = Math.max(animationTime(configuredHideDuration), 260);

        const claimsJson = effect.readConfig("claimsJson", "");
        if (!claimsJson) {
            log("no claimsJson in Effect-dropman_slide config; showDuration="
                + this.showDuration + " hideDuration=" + this.hideDuration);
            return;
        }

        try {
            const parsed = JSON.parse(claimsJson);
            const claims = (parsed && parsed.claims) || {};
            Object.keys(claims).forEach((profileId) => {
                const uuid = normalizedId(claims[profileId].windowUuid);
                if (uuid) {
                    this.claimsByUuid[uuid] = {
                        profileId: profileId
                    };
                }
            });
            log("loaded " + Object.keys(this.claimsByUuid).length
                + " tracked claim UUIDs; showDuration=" + this.showDuration
                + " hideDuration=" + this.hideDuration);
        } catch (error) {
            log("could not parse claimsJson: " + error);
        }
    }

    isTracked(window) {
        const uuid = windowUuid(window);
        return propertyBool(window, "dropmanDropdown")
            || (uuid && this.claimsByUuid[uuid] !== undefined);
    }

    isLargeEdgeMove(oldGeometry, newGeometry) {
        if (!oldGeometry || !newGeometry) {
            return false;
        }

        const deltaX = Math.abs(oldGeometry.x - newGeometry.x);
        const deltaY = Math.abs(oldGeometry.y - newGeometry.y);
        const thresholdX = Math.max(240, Math.min(oldGeometry.width, newGeometry.width) * 0.35);
        const thresholdY = Math.max(180, Math.min(oldGeometry.height, newGeometry.height) * 0.35);

        return deltaX >= thresholdX || deltaY >= thresholdY;
    }

    isMovingFartherOffscreen(oldGeometry, newGeometry) {
        return Math.abs(newGeometry.x) > Math.abs(oldGeometry.x)
            || Math.abs(newGeometry.y) > Math.abs(oldGeometry.y);
    }

    manage(window) {
        if (!window || window.dropmanSlideManaged) {
            return;
        }

        window.dropmanSlideManaged = true;
        if (window.windowFrameGeometryChanged) {
            window.windowFrameGeometryChanged.connect(
                this.onWindowFrameGeometryChanged.bind(this));
            if (this.isTracked(window)) {
                log("watching tracked window " + asString(window.caption)
                    + " uuid=" + windowUuid(window));
            }
        } else if (this.isTracked(window)) {
            log("tracked window has no geometry signal " + asString(window.caption)
                + " uuid=" + windowUuid(window));
        }
    }

    onWindowFrameGeometryChanged(window, oldGeometry) {
        if (!window.visible || !oldGeometry || !window.geometry) {
            if (this.isTracked(window)) {
                log("tracked geometry change ignored visible=" + window.visible
                    + " old=" + geometryText(oldGeometry)
                    + " new=" + geometryText(window.geometry)
                    + " caption=" + asString(window.caption));
            }
            return;
        }

        const newGeometry = window.geometry;
        const tracked = this.isTracked(window);
        const largeEdgeMove = this.isLargeEdgeMove(oldGeometry, newGeometry);
        if (!tracked && !largeEdgeMove) {
            return;
        }

        const deltaX = oldGeometry.x - newGeometry.x;
        const deltaY = oldGeometry.y - newGeometry.y;

        if (deltaX === 0 && deltaY === 0
            && oldGeometry.width === newGeometry.width
            && oldGeometry.height === newGeometry.height) {
            if (tracked) {
                log("tracked geometry change had no movement "
                    + geometryText(oldGeometry)
                    + " caption=" + asString(window.caption));
            }
            return;
        }

        if (window.dropmanSlideAnimation) {
            cancel(window.dropmanSlideAnimation);
            delete window.dropmanSlideAnimation;
        }

        const hiding = this.isMovingFartherOffscreen(oldGeometry, newGeometry);
        const duration = hiding ? this.hideDuration : this.showDuration;
        const curve = hiding ? QEasingCurve.InOutCubic : QEasingCurve.OutCubic;

        window.dropmanSlideAnimation = animate({
            window: window,
            duration: duration,
            animations: [{
                type: Effect.Translation,
                from: {
                    value1: deltaX,
                    value2: deltaY
                },
                to: {
                    value1: 0,
                    value2: 0
                },
                curve: curve
            }]
        });

        log("animated " + asString(window.caption)
            + " from=" + geometryText(oldGeometry)
            + " to=" + geometryText(newGeometry)
            + " delta=" + deltaX + "," + deltaY
            + " duration=" + duration
            + " hiding=" + hiding
            + " tracked=" + tracked
            + " largeEdgeMove=" + largeEdgeMove
            + " class=" + propertyText(window, "resourceClass")
            + " name=" + propertyText(window, "resourceName")
            + " visible=" + window.visible);
    }
}

new DropManSlideEffect();
