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

function outputGeometry(window) {
    if (window && window.output && window.output.geometry) {
        return window.output.geometry;
    }

    return null;
}

function parsedGeometry(value) {
    if (!value
        || typeof value.x !== "number"
        || typeof value.y !== "number"
        || typeof value.width !== "number"
        || typeof value.height !== "number") {
        return null;
    }

    return {
        x: value.x,
        y: value.y,
        width: value.width,
        height: value.height
    };
}

function geometriesEqual(a, b) {
    const tolerance = 3;
    return a && b
        && Math.abs(a.x - b.x) <= tolerance
        && Math.abs(a.y - b.y) <= tolerance
        && Math.abs(a.width - b.width) <= tolerance
        && Math.abs(a.height - b.height) <= tolerance;
}

class DropManSlideEffect {
    constructor() {
        this.claimsByUuid = {};
        this.claims = [];
        this.showDuration = 170;
        this.hideDuration = 140;

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
        this.claims = [];
        const configuredShowDuration = Number(effect.readConfig("ShowDuration", 170));
        const configuredHideDuration = Number(effect.readConfig("HideDuration", 140));
        this.largeEdgeFallback = effect.readConfig("LargeEdgeFallback", true) === true;
        this.showDuration = Math.max(animationTime(configuredShowDuration), 120);
        this.hideDuration = Math.max(animationTime(configuredHideDuration), 120);

        const claimsJson = effect.readConfig("claimsJson", "");
        if (!claimsJson) {
            log("no claimsJson in Effect-dropman_slide config; showDuration="
                + this.showDuration + " hideDuration=" + this.hideDuration
                + " largeEdgeFallback=" + this.largeEdgeFallback);
            return;
        }

        try {
            const parsed = JSON.parse(claimsJson);
            const claims = (parsed && parsed.claims) || {};
            Object.keys(claims).forEach((profileId) => {
                const claim = claims[profileId] || {};
                const uuid = normalizedId(claim.windowUuid);
                const shownGeometry = parsedGeometry(claim.shownGeometry);
                if (uuid) {
                    this.claimsByUuid[uuid] = {
                        profileId: profileId
                    };
                }
                if (shownGeometry) {
                    this.claims.push({
                        profileId: profileId,
                        uuid: uuid,
                        edge: asString(claim.edge || ""),
                        shownGeometry: shownGeometry
                    });
                }
            });
            log("loaded " + Object.keys(this.claimsByUuid).length
                + " tracked claim UUIDs and " + this.claims.length
                + " claim geometries; showDuration=" + this.showDuration
                + " hideDuration=" + this.hideDuration
                + " largeEdgeFallback=" + this.largeEdgeFallback);
        } catch (error) {
            log("could not parse claimsJson: " + error);
        }
    }

    isTracked(window) {
        const uuid = windowUuid(window);
        return propertyBool(window, "dropmanDropdown")
            || (uuid && this.claimsByUuid[uuid] !== undefined);
    }

    hiddenGeometriesForClaim(claim, window) {
        const shown = claim.shownGeometry;
        const screen = outputGeometry(window);
        const edges = claim.edge
            ? [claim.edge]
            : ["top", "right", "bottom", "left"];
        const geometries = [];

        for (let i = 0; i < edges.length; ++i) {
            const edge = edges[i];
            const hidden = {
                x: shown.x,
                y: shown.y,
                width: shown.width,
                height: shown.height
            };

            if (edge === "top") {
                hidden.y = screen ? screen.y - shown.height : shown.y - shown.height;
            } else if (edge === "bottom") {
                hidden.y = screen ? screen.y + screen.height : shown.y + shown.height;
            } else if (edge === "left") {
                hidden.x = screen ? screen.x - shown.width : shown.x - shown.width;
            } else if (edge === "right") {
                hidden.x = screen ? screen.x + screen.width : shown.x + shown.width;
            } else {
                continue;
            }

            geometries.push(hidden);
        }

        return geometries;
    }

    matchingClaimTransition(window, oldGeometry, newGeometry) {
        for (let i = 0; i < this.claims.length; ++i) {
            const claim = this.claims[i];
            const hiddenGeometries = this.hiddenGeometriesForClaim(claim, window);
            for (let j = 0; j < hiddenGeometries.length; ++j) {
                const hidden = hiddenGeometries[j];
                const showing = geometriesEqual(oldGeometry, hidden)
                    && geometriesEqual(newGeometry, claim.shownGeometry);
                const hiding = geometriesEqual(oldGeometry, claim.shownGeometry)
                    && geometriesEqual(newGeometry, hidden);

                if (showing || hiding) {
                    return {
                        profileId: claim.profileId,
                        showing: showing,
                        hiding: hiding
                    };
                }
            }
        }

        return null;
    }

    isLargeEdgeMove(oldGeometry, newGeometry) {
        if (this.largeEdgeFallback !== true) {
            return false;
        }

        if (!oldGeometry || !newGeometry) {
            return false;
        }

        const minimumDropdownWidth = 500;
        const minimumDropdownHeight = 300;
        if (Math.min(oldGeometry.width, newGeometry.width) < minimumDropdownWidth
            || Math.min(oldGeometry.height, newGeometry.height) < minimumDropdownHeight) {
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
        const explicitTransition = this.matchingClaimTransition(window, oldGeometry, newGeometry);
        const largeEdgeMove = this.isLargeEdgeMove(oldGeometry, newGeometry);
        if (!tracked && !explicitTransition && !largeEdgeMove) {
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
            + " explicit=" + (explicitTransition ? explicitTransition.profileId : false)
            + " largeEdgeMove=" + largeEdgeMove
            + " class=" + propertyText(window, "resourceClass")
            + " name=" + propertyText(window, "resourceName")
            + " visible=" + window.visible);
    }
}

new DropManSlideEffect();
