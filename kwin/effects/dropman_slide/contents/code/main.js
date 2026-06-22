/*
    DropMan KWin effect.

    Experimental compositor-side animation for exact app-picked DropMan
    claims. This effect intentionally tracks only UUIDs mirrored by the
    DropMan app into Effect-dropman_slide claimsJson.
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
        this.duration = 420;

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
        const configuredDuration = Number(effect.readConfig("Duration", 420));
        const scaledDuration = animationTime(configuredDuration);
        this.duration = Math.max(scaledDuration, 260);

        const claimsJson = effect.readConfig("claimsJson", "");
        if (!claimsJson) {
            log("no claimsJson in Effect-dropman_slide config; duration=" + this.duration);
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
                + " tracked claim UUIDs; duration=" + this.duration);
        } catch (error) {
            log("could not parse claimsJson: " + error);
        }
    }

    isTracked(window) {
        const uuid = windowUuid(window);
        return uuid && this.claimsByUuid[uuid] !== undefined;
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
        if (!this.isTracked(window)) {
            return;
        }
        if (!window.visible || !oldGeometry || !window.geometry) {
            log("tracked geometry change ignored visible=" + window.visible
                + " old=" + geometryText(oldGeometry)
                + " new=" + geometryText(window.geometry)
                + " caption=" + asString(window.caption));
            return;
        }

        const newGeometry = window.geometry;
        const deltaX = oldGeometry.x - newGeometry.x;
        const deltaY = oldGeometry.y - newGeometry.y;

        if (deltaX === 0 && deltaY === 0
            && oldGeometry.width === newGeometry.width
            && oldGeometry.height === newGeometry.height) {
            log("tracked geometry change had no movement "
                + geometryText(oldGeometry)
                + " caption=" + asString(window.caption));
            return;
        }

        if (window.dropmanSlideAnimation) {
            cancel(window.dropmanSlideAnimation);
            delete window.dropmanSlideAnimation;
        }

        window.dropmanSlideAnimation = animate({
            window: window,
            duration: this.duration,
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
                curve: QEasingCurve.OutCubic
            }]
        });

        log("animated " + asString(window.caption)
            + " from=" + geometryText(oldGeometry)
            + " to=" + geometryText(newGeometry)
            + " delta=" + deltaX + "," + deltaY
            + " duration=" + this.duration);
    }
}

new DropManSlideEffect();
