#pragma once

#include "Profile.h"

#include <QObject>
#include <QString>

class KWinBackend : public QObject {
    Q_OBJECT

public:
    explicit KWinBackend(QObject *parent = nullptr);

    QString activeWindowIdentity() const;
    void claimPickedWindow(Profile &profile);
    void releaseClaim(Profile &profile);
    void testToggle(const Profile &profile);

signals:
    void logMessage(const QString &message);
};
