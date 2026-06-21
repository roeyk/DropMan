#include "KWinBackend.h"

#include <KConfig>
#include <KConfigGroup>

#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QProcess>
#include <QRegularExpression>
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

bool containsMatch(const QString &actual, const QString &expected)
{
    return expected.isEmpty() || actual.contains(expected, Qt::CaseInsensitive);
}

bool containsExcluded(const QString &actual, const QString &expected)
{
    return !expected.isEmpty() && actual.contains(expected, Qt::CaseInsensitive);
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
    return QStringLiteral("resourceClass=%1 resourceName=%2 caption=%3")
        .arg(pickedWindowField(pickerOutput, QStringLiteral("resourceClass")),
             pickedWindowField(pickerOutput, QStringLiteral("resourceName")),
             pickedWindowCaptionValue(pickerOutput));
}

bool writePendingClaim(const Profile &profile, const QString &uuid, QString *errorMessage)
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

    if (!pickedWindowMatchesProfile(pickerOutput, profile)) {
        emit logMessage(QStringLiteral("Picked window does not match %1 profile: %2")
                            .arg(profile.name, pickedWindowSummary(pickerOutput)));
        return;
    }

    if (!writePendingClaim(profile, uuid, &error)) {
        emit logMessage(QStringLiteral("Could not stage picked window claim: %1").arg(error));
        return;
    }

    if (!reconfigureKWin()) {
        emit logMessage(QStringLiteral("Could not request KWin reconfigure for pending picked claim"));
    } else {
        emit logMessage(QStringLiteral("Requested KWin reconfigure for picked claim"));
        QThread::msleep(750);
    }

    const QString id = actionId(QStringLiteral("ClaimPicked-"), profile);
    if (invokeKWinShortcut(id)) {
        profile.claimed = true;
        emit logMessage(QStringLiteral("Invoked KWin action %1").arg(id));
    } else {
        emit logMessage(QStringLiteral("Could not invoke KWin action %1").arg(id));
    }
}

void KWinBackend::releaseClaim(Profile &profile)
{
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
