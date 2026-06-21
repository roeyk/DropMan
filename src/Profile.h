#pragma once

#include <QString>

struct MatchRules {
    QString resourceClass;
    QString resourceName;
    QString captionFilter;
    QString captionExclude;
};

struct Profile {
    QString id;
    QString name;
    QString shortcut;
    QString claimShortcut;
    QString edge;
    QString mode = QStringLiteral("preserve_geometry");
    int widthPercent = 100;
    int heightPercent = 45;
    MatchRules match;
    bool claimed = false;
};
