#include "KWinBackend.h"

#include <KConfig>
#include <KConfigGroup>

#include <QProcess>
#include <QRegularExpression>
#include <QStringList>

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

QString pickedWindowCaption(const QString &pickerOutput)
{
    const QRegularExpression captionLine(QStringLiteral(R"(^caption:\s*(.+?)\s*$)"),
                                         QRegularExpression::MultilineOption);
    const auto match = captionLine.match(pickerOutput);
    return match.hasMatch() ? match.captured(1).trimmed() : QString();
}

bool writePendingClaim(const Profile &profile, const QString &uuid, QString *errorMessage)
{
    KConfig kwinConfig(QStringLiteral("kwinrc"), KConfig::NoGlobals);
    KConfigGroup scriptGroup(&kwinConfig, QStringLiteral("Script-dropman"));
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

    if (!writePendingClaim(profile, uuid, &error)) {
        emit logMessage(QStringLiteral("Could not stage picked window claim: %1").arg(error));
        return;
    }

    const QString caption = pickedWindowCaption(pickerOutput);
    emit logMessage(QStringLiteral("Picked %1 for %2; uuid=%3")
                        .arg(caption.isEmpty() ? QStringLiteral("<unnamed window>") : caption,
                             profile.name,
                             uuid));

    if (!reconfigureKWin()) {
        emit logMessage(QStringLiteral("Could not request KWin reconfigure for pending picked claim"));
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
