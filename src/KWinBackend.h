#pragma once

#include "Profile.h"

#include <QObject>
#include <QSet>
#include <QString>

class KWinBackend : public QObject {
    Q_OBJECT

public:
    explicit KWinBackend(QObject *parent = nullptr);

    QString activeWindowIdentity() const;
    QSet<QString> claimedProfileIds() const;
    void syncEffectClaimsFromScript();
    void claimPickedWindow(Profile &profile);
    void releaseClaim(Profile &profile);
    void testToggle(const Profile &profile);

signals:
    void logMessage(const QString &message);
    void claimSucceeded(const QString &profileName, const QString &windowCaption);
};
