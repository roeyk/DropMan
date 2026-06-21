#include "KWinBackend.h"

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
    profile.claimed = true;
    emit logMessage(QStringLiteral("Claim requested for '%1'. Match rules are candidates only; the active window is the binding target.")
                        .arg(profile.name));
}

void KWinBackend::releaseClaim(Profile &profile)
{
    profile.claimed = false;
    emit logMessage(QStringLiteral("Released claim for '%1'.").arg(profile.name));
}

void KWinBackend::testToggle(const Profile &profile)
{
    if (!profile.claimed) {
        emit logMessage(QStringLiteral("Cannot test '%1': no window is claimed.").arg(profile.name));
        return;
    }

    emit logMessage(QStringLiteral("Test toggle requested for '%1' on %2 edge at %3%.")
                        .arg(profile.name, profile.edge)
                        .arg(profile.heightPercent));
}
