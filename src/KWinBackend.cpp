#include "KWinBackend.h"

#include <KConfig>
#include <KConfigGroup>

#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QProcess>
#include <QRegularExpression>
#include <QSet>
#include <QStringList>
#include <QThread>

namespace {

QString actionId(const QString &prefix, const Profile &profile)
{
    return QStringLiteral("DropMan-%1%2").arg(prefix, profile.id);
}

bool invokeKWinShortcut(const QString &id)
{
    const QStringList qualifiedArgs{
        QStringLiteral("org.kde.kglobalaccel"),
        QStringLiteral("/component/kwin"),
        QStringLiteral("org.kde.kglobalaccel.Component.invokeShortcut"),
        id
    };

    if (QProcess::execute(QStringLiteral("qdbus6"), qualifiedArgs) == 0) {
        return true;
    }

    const QStringList shortArgs{
        QStringLiteral("org.kde.kglobalaccel"),
        QStringLiteral("/component/kwin"),
        QStringLiteral("invokeShortcut"),
        id
    };

    return QProcess::execute(QStringLiteral("qdbus6"), shortArgs) == 0;
}

bool reconfigureKWin()
{
    return QProcess::execute(
        QStringLiteral("qdbus6"),
        {
            QStringLiteral("org.kde.KWin"),
            QStringLiteral("/KWin"),
            QStringLiteral("reconfigure")
        }) == 0;
}

QString runKWinWindowPicker(QString *errorMessage)
{
    const QStringList qualifiedArgs{
        QStringLiteral("org.kde.KWin"),
        QStringLiteral("/KWin"),
        QStringLiteral("org.kde.KWin.queryWindowInfo")
    };

    QProcess process;
    process.start(QStringLiteral("qdbus6"), qualifiedArgs);
    process.waitForFinished(-1);
    if (process.exitStatus() == QProcess::NormalExit && process.exitCode() == 0) {
        return QString::fromUtf8(process.readAllStandardOutput());
    }

    const QStringList shortArgs{
        QStringLiteral("org.kde.KWin"),
        QStringLiteral("/KWin"),
        QStringLiteral("queryWindowInfo")
    };

    process.start(QStringLiteral("qdbus6"), shortArgs);
    process.waitForFinished(-1);
    if (process.exitStatus() == QProcess::NormalExit && process.exitCode() == 0) {
        return QString::fromUtf8(process.readAllStandardOutput());
    }

    if (errorMessage) {
        const QString stderrText = QString::fromUtf8(process.readAllStandardError()).trimmed();
        *errorMessage = stderrText.isEmpty()
            ? QStringLiteral("qdbus6 queryWindowInfo failed")
            : stderrText;
    }

    return {};
}

QString pickedWindowUuid(const QString &pickerOutput)
{
    const QRegularExpression uuidLine(QStringLiteral(R"(^uuid:\s*\{?([^}\n\r]+)\}?\s*$)"),
                                      QRegularExpression::MultilineOption);
    const auto match = uuidLine.match(pickerOutput);
    return match.hasMatch() ? match.captured(1).trimmed() : QString();
}

QString pickedWindowField(const QString &pickerOutput, const QString &field)
{
    const QRegularExpression line(
        QStringLiteral(R"(^%1:\s*(.*?)\s*$)").arg(QRegularExpression::escape(field)),
        QRegularExpression::MultilineOption);
    const auto match = line.match(pickerOutput);
    return match.hasMatch() ? match.captured(1).trimmed() : QString();
}

QString pickedWindowCaptionValue(const QString &pickerOutput)
{
    return pickedWindowField(pickerOutput, QStringLiteral("caption"));
}

bool pickedWindowNumberField(const QString &pickerOutput, const QString &field, double *value)
{
    bool ok = false;
    const double parsed = pickedWindowField(pickerOutput, field).toDouble(&ok);
    if (!ok) {
        return false;
    }

    if (value) {
        *value = parsed;
    }
    return true;
}

QJsonObject pickedWindowGeometry(const QString &pickerOutput)
{
    double x = 0.0;
    double y = 0.0;
    double width = 0.0;
    double height = 0.0;

    if (!pickedWindowNumberField(pickerOutput, QStringLiteral("x"), &x)
        || !pickedWindowNumberField(pickerOutput, QStringLiteral("y"), &y)
        || !pickedWindowNumberField(pickerOutput, QStringLiteral("width"), &width)
        || !pickedWindowNumberField(pickerOutput, QStringLiteral("height"), &height)) {
        return {};
    }

    QJsonObject geometry;
    geometry.insert(QStringLiteral("x"), x);
    geometry.insert(QStringLiteral("y"), y);
    geometry.insert(QStringLiteral("width"), width);
    geometry.insert(QStringLiteral("height"), height);
    return geometry;
}

bool containsMatch(const QString &actual, const QString &expected)
{
    return expected.isEmpty() || actual.contains(expected, Qt::CaseInsensitive);
}

bool containsExcluded(const QString &actual, const QString &expected)
{
    return !expected.isEmpty() && actual.contains(expected, Qt::CaseInsensitive);
}

bool isDropManControlPick(const QString &pickerOutput)
{
    const QString caption = pickedWindowCaptionValue(pickerOutput).toLower();
    const QString resourceClass = pickedWindowField(pickerOutput, QStringLiteral("resourceClass")).toLower();
    const QString resourceName = pickedWindowField(pickerOutput, QStringLiteral("resourceName")).toLower();
    const QString desktopFile = pickedWindowField(pickerOutput, QStringLiteral("desktopFile")).toLower();

    return caption == QStringLiteral("dropman")
        || caption.startsWith(QStringLiteral("dropman :"))
        || resourceClass == QStringLiteral("dropman")
        || resourceName == QStringLiteral("dropman")
        || desktopFile == QStringLiteral("dropman");
}

bool pickedWindowMatchesProfile(const QString &pickerOutput, const Profile &profile)
{
    const QString resourceClass = pickedWindowField(pickerOutput, QStringLiteral("resourceClass"));
    const QString resourceName = pickedWindowField(pickerOutput, QStringLiteral("resourceName"));
    const QString caption = pickedWindowCaptionValue(pickerOutput);

    return containsMatch(resourceClass, profile.match.resourceClass)
        && containsMatch(resourceName, profile.match.resourceName)
        && containsMatch(caption, profile.match.captionFilter)
        && !containsExcluded(caption, profile.match.captionExclude);
}

QString pickedWindowSummary(const QString &pickerOutput)
{
    return QStringLiteral("resourceClass=%1 resourceName=%2 desktopFile=%3 caption=%4")
        .arg(pickedWindowField(pickerOutput, QStringLiteral("resourceClass")),
             pickedWindowField(pickerOutput, QStringLiteral("resourceName")),
             pickedWindowField(pickerOutput, QStringLiteral("desktopFile")),
             pickedWindowCaptionValue(pickerOutput));
}

void writeSlideEffectClaims(KConfig &kwinConfig, const QString &claimsJson)
{
    const QStringList groupNames{
        QStringLiteral("Effect-dropman_slide"),
        QStringLiteral("Effect-kwin4_effect_dropman_slide"),
        QStringLiteral("Effect-kwin_wayland4_effect_dropman_slide"),
        QStringLiteral("Effect-kwin4_effect_dropman-slide"),
        QStringLiteral("Effect-kwin_wayland4_effect_dropman-slide")
    };

    for (const QString &groupName : groupNames) {
        KConfigGroup group(&kwinConfig, groupName);
        group.writeEntry(QStringLiteral("claimsJson"), claimsJson);
        group.sync();
    }
}

bool writePendingClaim(const Profile &profile,
                       const QString &uuid,
                       const QString &pickerOutput,
                       QString *errorMessage)
{
    KConfig kwinConfig(QStringLiteral("kwinrc"), KConfig::NoGlobals);
    KConfigGroup scriptGroup(&kwinConfig, QStringLiteral("Script-dropman"));

    const QString profilesJson = scriptGroup.readEntry(QStringLiteral("profilesJson"), QString());
    if (!profilesJson.isEmpty()) {
        QJsonParseError parseError;
        QJsonDocument document = QJsonDocument::fromJson(profilesJson.toUtf8(), &parseError);
        if (document.isObject()) {
            QJsonObject root = document.object();
            QJsonObject pendingClaim;
            pendingClaim.insert(QStringLiteral("profileId"), profile.id);
            pendingClaim.insert(QStringLiteral("windowUuid"), uuid);
            root.insert(QStringLiteral("pendingClaim"), pendingClaim);
            document.setObject(root);
            scriptGroup.writeEntry(
                QStringLiteral("profilesJson"),
                QString::fromUtf8(document.toJson(QJsonDocument::Compact)));
        } else if (errorMessage) {
            *errorMessage = QStringLiteral("Could not parse mirrored profilesJson: %1")
                                .arg(parseError.errorString());
            return false;
        }
    }

    QJsonObject claimsRoot;
    const QString claimsJson = scriptGroup.readEntry(QStringLiteral("claimsJson"), QString());
    if (!claimsJson.isEmpty()) {
        QJsonParseError parseError;
        QJsonDocument document = QJsonDocument::fromJson(claimsJson.toUtf8(), &parseError);
        if (!document.isObject()) {
            if (errorMessage) {
                *errorMessage = QStringLiteral("Could not parse existing claimsJson: %1")
                                    .arg(parseError.errorString());
            }
            return false;
        }
        claimsRoot = document.object();
    }

    QJsonObject claims = claimsRoot.value(QStringLiteral("claims")).toObject();
    QJsonObject claim;
    claim.insert(QStringLiteral("windowUuid"), uuid);
    claim.insert(QStringLiteral("visible"), true);
    claim.insert(QStringLiteral("edge"), profile.edge);

    const QJsonObject geometry = pickedWindowGeometry(pickerOutput);
    if (!geometry.isEmpty()) {
        claim.insert(QStringLiteral("shownGeometry"), geometry);
    }

    claims.insert(profile.id, claim);
    claimsRoot.insert(QStringLiteral("schemaVersion"), 1);
    claimsRoot.insert(QStringLiteral("claims"), claims);
    scriptGroup.writeEntry(
        QStringLiteral("claimsJson"),
        QString::fromUtf8(QJsonDocument(claimsRoot).toJson(QJsonDocument::Compact)));
    writeSlideEffectClaims(
        kwinConfig,
        QString::fromUtf8(QJsonDocument(claimsRoot).toJson(QJsonDocument::Compact)));

    scriptGroup.writeEntry(QStringLiteral("pendingClaimProfileId"), profile.id);
    scriptGroup.writeEntry(QStringLiteral("pendingClaimWindowUuid"), uuid);
    scriptGroup.sync();

    if (!kwinConfig.sync()) {
        if (errorMessage) {
            *errorMessage = QStringLiteral("Could not sync pending claim to kwinrc");
        }
        return false;
    }

    return true;
}

bool removePersistedClaim(const Profile &profile, QString *errorMessage)
{
    KConfig kwinConfig(QStringLiteral("kwinrc"), KConfig::NoGlobals);
    KConfigGroup scriptGroup(&kwinConfig, QStringLiteral("Script-dropman"));

    const QString claimsJson = scriptGroup.readEntry(QStringLiteral("claimsJson"), QString());
    if (claimsJson.isEmpty()) {
        return true;
    }

    QJsonParseError parseError;
    QJsonDocument document = QJsonDocument::fromJson(claimsJson.toUtf8(), &parseError);
    if (!document.isObject()) {
        if (errorMessage) {
            *errorMessage = QStringLiteral("Could not parse existing claimsJson: %1")
                                .arg(parseError.errorString());
        }
        return false;
    }

    QJsonObject root = document.object();
    QJsonObject claims = root.value(QStringLiteral("claims")).toObject();
    claims.remove(profile.id);
    root.insert(QStringLiteral("claims"), claims);

    scriptGroup.writeEntry(
        QStringLiteral("claimsJson"),
        QString::fromUtf8(QJsonDocument(root).toJson(QJsonDocument::Compact)));
    writeSlideEffectClaims(
        kwinConfig,
        QString::fromUtf8(QJsonDocument(root).toJson(QJsonDocument::Compact)));
    scriptGroup.sync();

    if (!kwinConfig.sync()) {
        if (errorMessage) {
            *errorMessage = QStringLiteral("Could not sync claim removal to kwinrc");
        }
        return false;
    }

    return true;
}

}

KWinBackend::KWinBackend(QObject *parent)
    : QObject(parent)
{
}

QString KWinBackend::activeWindowIdentity() const
{
    return QStringLiteral(
        "KWin backend placeholder: wire this to the Plasma/KWin bridge. "
        "Expected fields: resourceClass, resourceName, caption.");
}

QSet<QString> KWinBackend::claimedProfileIds() const
{
    KConfig kwinConfig(QStringLiteral("kwinrc"), KConfig::NoGlobals);
    KConfigGroup scriptGroup(&kwinConfig, QStringLiteral("Script-dropman"));

    const QString claimsJson = scriptGroup.readEntry(QStringLiteral("claimsJson"), QString());
    if (claimsJson.isEmpty()) {
        return {};
    }

    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(claimsJson.toUtf8(), &parseError);
    if (!document.isObject()) {
        return {};
    }

    QSet<QString> ids;
    const QJsonObject claims = document.object().value(QStringLiteral("claims")).toObject();
    for (auto it = claims.constBegin(); it != claims.constEnd(); ++it) {
        if (it.value().isObject()) {
            ids.insert(it.key());
        }
    }

    return ids;
}

void KWinBackend::syncEffectClaimsFromScript()
{
    KConfig kwinConfig(QStringLiteral("kwinrc"), KConfig::NoGlobals);
    KConfigGroup scriptGroup(&kwinConfig, QStringLiteral("Script-dropman"));

    const QString claimsJson = scriptGroup.readEntry(QStringLiteral("claimsJson"), QString());
    if (claimsJson.isEmpty()) {
        emit logMessage(QStringLiteral("No existing Script-dropman claims to mirror to DropMan Slide"));
        return;
    }

    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(claimsJson.toUtf8(), &parseError);
    if (!document.isObject()) {
        emit logMessage(QStringLiteral("Could not mirror existing claims to DropMan Slide: %1")
                            .arg(parseError.errorString()));
        return;
    }

    writeSlideEffectClaims(kwinConfig, claimsJson);
    if (!kwinConfig.sync()) {
        emit logMessage(QStringLiteral("Could not sync existing claims to DropMan Slide config"));
        return;
    }

    emit logMessage(QStringLiteral("Mirrored existing claims to DropMan Slide effect config groups"));
    if (reconfigureKWin()) {
        emit logMessage(QStringLiteral("Requested KWin reconfigure for DropMan Slide claims"));
    } else {
        emit logMessage(QStringLiteral("Could not request KWin reconfigure for DropMan Slide claims"));
    }
}

void KWinBackend::claimPickedWindow(Profile &profile)
{
    emit logMessage(QStringLiteral("Starting KWin window picker for %1").arg(profile.name));

    QString error;
    const QString pickerOutput = runKWinWindowPicker(&error);
    if (pickerOutput.isEmpty()) {
        emit logMessage(QStringLiteral("KWin window picker failed: %1").arg(error));
        return;
    }

    const QString uuid = pickedWindowUuid(pickerOutput);
    if (uuid.isEmpty()) {
        emit logMessage(QStringLiteral("KWin picker did not return a window uuid"));
        return;
    }

    const QString caption = pickedWindowCaptionValue(pickerOutput);
    emit logMessage(QStringLiteral("Picked %1 for %2; uuid=%3")
                        .arg(caption.isEmpty() ? QStringLiteral("<unnamed window>") : caption,
                             profile.name,
                             uuid));

    if (isDropManControlPick(pickerOutput)) {
        emit logMessage(QStringLiteral("Refusing to claim DropMan's own control window for %1: %2")
                            .arg(profile.name, pickedWindowSummary(pickerOutput)));
        return;
    }

    const QString resourceClass = pickedWindowField(pickerOutput, QStringLiteral("resourceClass"));
    const QString resourceName = pickedWindowField(pickerOutput, QStringLiteral("resourceName"));
    bool filledMatchFields = false;
    if (profile.match.resourceClass.isEmpty()) {
        profile.match.resourceClass = resourceClass;
        filledMatchFields = true;
    }
    if (profile.match.resourceName.isEmpty()) {
        profile.match.resourceName = resourceName;
        filledMatchFields = true;
    }
    if ((profile.name.isEmpty() || profile.name == QStringLiteral("New Profile"))
        && (!resourceName.isEmpty() || !resourceClass.isEmpty())) {
        profile.name = resourceName.isEmpty() ? resourceClass : resourceName;
        filledMatchFields = true;
    }
    if (filledMatchFields) {
        emit logMessage(QStringLiteral("Filled match fields for %1: resourceClass=%2 resourceName=%3")
                            .arg(profile.name, profile.match.resourceClass, profile.match.resourceName));
    }

    if (!pickedWindowMatchesProfile(pickerOutput, profile)) {
        emit logMessage(QStringLiteral("Picked window does not match %1 profile: %2")
                            .arg(profile.name, pickedWindowSummary(pickerOutput)));
        return;
    }

    if (!writePendingClaim(profile, uuid, pickerOutput, &error)) {
        emit logMessage(QStringLiteral("Could not stage picked window claim: %1").arg(error));
        return;
    }
    emit logMessage(QStringLiteral("Persisted picked claim for %1 into KWin config").arg(profile.name));

    bool reconfigured = false;
    if (!reconfigureKWin()) {
        emit logMessage(QStringLiteral("Could not request KWin reconfigure for pending picked claim"));
    } else {
        reconfigured = true;
        emit logMessage(QStringLiteral("Requested KWin reconfigure for picked claim"));
        QThread::msleep(750);
    }

    const QString id = actionId(QStringLiteral("ClaimPicked-"), profile);
    if (invokeKWinShortcut(id)) {
        profile.claimed = true;
        emit logMessage(QStringLiteral("Invoked KWin action %1").arg(id));
        emit claimSucceeded(profile.name, caption.isEmpty() ? profile.name : caption);
    } else if (reconfigured) {
        profile.claimed = true;
        emit logMessage(QStringLiteral(
            "Staged claim for %1; resident KWin script should consume it on reconfigure")
                            .arg(profile.name));
        emit claimSucceeded(profile.name, caption.isEmpty() ? profile.name : caption);
    } else {
        emit logMessage(QStringLiteral("Could not invoke KWin action %1").arg(id));
    }
}

void KWinBackend::releaseClaim(Profile &profile)
{
    QString error;
    if (removePersistedClaim(profile, &error)) {
        emit logMessage(QStringLiteral("Removed persisted picked claim for %1").arg(profile.name));
    } else {
        emit logMessage(QStringLiteral("Could not remove persisted claim for %1: %2")
                            .arg(profile.name, error));
    }

    const QString id = actionId(QStringLiteral("Release-"), profile);
    if (invokeKWinShortcut(id)) {
        profile.claimed = false;
        emit logMessage(QStringLiteral("Invoked KWin action %1").arg(id));
    } else {
        emit logMessage(QStringLiteral("Could not invoke KWin action %1").arg(id));
    }
}

void KWinBackend::testToggle(const Profile &profile)
{
    const QString id = actionId(QString(), profile);
    if (invokeKWinShortcut(id)) {
        emit logMessage(QStringLiteral("Invoked KWin action %1").arg(id));
    } else {
        emit logMessage(QStringLiteral("Could not invoke KWin action %1").arg(id));
    }
}
