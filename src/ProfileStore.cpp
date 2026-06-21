#include "ProfileStore.h"

#include <KConfig>
#include <KConfigGroup>

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QIODevice>
#include <QStandardPaths>

namespace {

QString stringValue(const QJsonObject &object, const QString &key, const QString &fallback = {})
{
    const auto value = object.value(key);
    return value.isString() ? value.toString() : fallback;
}

int intValue(const QJsonObject &object, const QString &key, int fallback)
{
    const auto value = object.value(key);
    return value.isDouble() ? value.toInt() : fallback;
}

QJsonObject matchToJson(const MatchRules &match)
{
    QJsonObject object;
    if (!match.resourceClass.isEmpty()) {
        object.insert(QStringLiteral("resourceClass"), match.resourceClass);
    }
    if (!match.resourceName.isEmpty()) {
        object.insert(QStringLiteral("resourceName"), match.resourceName);
    }
    if (!match.captionFilter.isEmpty()) {
        object.insert(QStringLiteral("caption"), match.captionFilter);
    }
    if (!match.captionExclude.isEmpty()) {
        object.insert(QStringLiteral("excludeCaption"), match.captionExclude);
    }
    return object;
}

MatchRules matchFromJson(const QJsonObject &object)
{
    return MatchRules{
        .resourceClass = stringValue(object, QStringLiteral("resourceClass")),
        .resourceName = stringValue(object, QStringLiteral("resourceName")),
        .captionFilter = stringValue(object, QStringLiteral("caption")),
        .captionExclude = stringValue(object, QStringLiteral("excludeCaption"))
    };
}

QJsonObject profileToJson(const Profile &profile)
{
    QJsonObject object;
    object.insert(QStringLiteral("id"), profile.id);
    object.insert(QStringLiteral("name"), profile.name);
    object.insert(QStringLiteral("shortcut"), profile.shortcut);
    object.insert(QStringLiteral("claimShortcut"), profile.claimShortcut);
    object.insert(QStringLiteral("edge"), profile.edge);
    object.insert(QStringLiteral("mode"), profile.mode);
    object.insert(QStringLiteral("widthPercent"), profile.widthPercent);
    object.insert(QStringLiteral("heightPercent"), profile.heightPercent);
    object.insert(QStringLiteral("match"), matchToJson(profile.match));
    return object;
}

QJsonDocument profilesDocument(const QVector<Profile> &profiles)
{
    QJsonArray bindings;
    for (const auto &profile : profiles) {
        bindings.append(profileToJson(profile));
    }

    QJsonObject root;
    root.insert(QStringLiteral("schemaVersion"), 1);
    root.insert(QStringLiteral("bindings"), bindings);
    return QJsonDocument(root);
}

Profile profileFromJson(const QJsonObject &object)
{
    return Profile{
        .id = stringValue(object, QStringLiteral("id")),
        .name = stringValue(object, QStringLiteral("name")),
        .shortcut = stringValue(object, QStringLiteral("shortcut")),
        .claimShortcut = stringValue(object, QStringLiteral("claimShortcut")),
        .edge = stringValue(object, QStringLiteral("edge"), QStringLiteral("top")),
        .mode = stringValue(object, QStringLiteral("mode"), QStringLiteral("preserve_geometry")),
        .widthPercent = intValue(object, QStringLiteral("widthPercent"), 100),
        .heightPercent = intValue(object, QStringLiteral("heightPercent"), 45),
        .match = matchFromJson(object.value(QStringLiteral("match")).toObject())
    };
}

}

QString ProfileStore::configPath()
{
    const QString dir = QStandardPaths::writableLocation(QStandardPaths::AppConfigLocation);
    return QDir(dir).filePath(QStringLiteral("profiles.json"));
}

QVector<Profile> ProfileStore::defaultProfiles()
{
    return {
        Profile{
            .id = QStringLiteral("firefox"),
            .name = QStringLiteral("Firefox"),
            .shortcut = QStringLiteral("Meta+F"),
            .claimShortcut = QStringLiteral("Meta+Shift+F"),
            .edge = QStringLiteral("right"),
            .mode = QStringLiteral("preserve_geometry"),
            .widthPercent = 40,
            .heightPercent = 100,
            .match = MatchRules{
                .resourceClass = QStringLiteral("firefox_firefox"),
                .resourceName = QStringLiteral("firefox"),
                .captionFilter = QString(),
                .captionExclude = QStringLiteral("Choose a profile")
            }
        },
        Profile{
            .id = QStringLiteral("uplink"),
            .name = QStringLiteral("Uplink"),
            .shortcut = QStringLiteral("Meta+U"),
            .claimShortcut = QStringLiteral("Meta+Shift+U"),
            .edge = QStringLiteral("top"),
            .mode = QStringLiteral("preserve_geometry"),
            .widthPercent = 100,
            .heightPercent = 45,
            .match = MatchRules{
                .resourceClass = QStringLiteral("Uplink"),
                .resourceName = QStringLiteral("Uplink"),
                .captionFilter = QString(),
                .captionExclude = QString()
            }
        },
        Profile{
            .id = QStringLiteral("konsole"),
            .name = QStringLiteral("Konsole"),
            .shortcut = QStringLiteral("Meta+K"),
            .claimShortcut = QStringLiteral("Meta+Shift+K"),
            .edge = QStringLiteral("top"),
            .mode = QStringLiteral("preserve_geometry"),
            .widthPercent = 100,
            .heightPercent = 45,
            .match = MatchRules{
                .resourceClass = QStringLiteral("org.kde.konsole"),
                .resourceName = QStringLiteral("konsole"),
                .captionFilter = QString(),
                .captionExclude = QString()
            }
        }
    };
}

QVector<Profile> ProfileStore::load(QString *errorMessage)
{
    QFile file(configPath());
    if (!file.exists()) {
        return defaultProfiles();
    }

    if (!file.open(QIODevice::ReadOnly)) {
        if (errorMessage) {
            *errorMessage = file.errorString();
        }
        return defaultProfiles();
    }

    QJsonParseError parseError;
    const auto document = QJsonDocument::fromJson(file.readAll(), &parseError);
    if (document.isNull() || !document.isObject()) {
        if (errorMessage) {
            *errorMessage = parseError.errorString();
        }
        return defaultProfiles();
    }

    QVector<Profile> profiles;
    const auto bindings = document.object().value(QStringLiteral("bindings")).toArray();
    profiles.reserve(bindings.size());
    for (const auto &binding : bindings) {
        if (binding.isObject()) {
            profiles.append(profileFromJson(binding.toObject()));
        }
    }

    return profiles.isEmpty() ? defaultProfiles() : profiles;
}

bool ProfileStore::save(const QVector<Profile> &profiles, QString *errorMessage)
{
    QFileInfo info(configPath());
    if (!QDir().mkpath(info.absolutePath())) {
        if (errorMessage) {
            *errorMessage = QStringLiteral("Could not create %1").arg(info.absolutePath());
        }
        return false;
    }

    QFile file(configPath());
    if (!file.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
        if (errorMessage) {
            *errorMessage = file.errorString();
        }
        return false;
    }

    file.write(profilesDocument(profiles).toJson(QJsonDocument::Indented));
    return true;
}

bool ProfileStore::mirrorToKWin(const QVector<Profile> &profiles, QString *errorMessage)
{
    const QString json = QString::fromUtf8(profilesDocument(profiles).toJson(QJsonDocument::Compact));

    KConfig kwinConfig(QStringLiteral("kwinrc"), KConfig::NoGlobals);
    KConfigGroup scriptGroup(&kwinConfig, QStringLiteral("Script-dropman"));
    scriptGroup.writeEntry(QStringLiteral("profilesJson"), json);
    scriptGroup.sync();

    if (!kwinConfig.sync()) {
        if (errorMessage) {
            *errorMessage = QStringLiteral("Could not sync kwinrc");
        }
        return false;
    }

    return true;
}
