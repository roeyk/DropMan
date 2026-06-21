#include "KWinBackend.h"

#include <QProcess>
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

void KWinBackend::claimActiveWindow(Profile &profile)
{
    const QString id = actionId(QStringLiteral("Claim-"), profile);
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
