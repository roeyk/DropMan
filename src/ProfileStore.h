#pragma once

#include "Profile.h"

#include <QVector>

class QString;

class ProfileStore {
public:
    static QString configPath();
    static QVector<Profile> defaultProfiles();
    static QVector<Profile> load(QString *errorMessage = nullptr);
    static bool save(const QVector<Profile> &profiles, QString *errorMessage = nullptr);
};
