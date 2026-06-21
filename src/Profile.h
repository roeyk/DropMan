#pragma once

#include <QString>

struct MatchRules {
    QString resourceClass;
    QString resourceName;
    QString captionFilter;
};

struct Profile {
    QString name;
    QString shortcut;
    QString edge;
    int sizePercent = 45;
    MatchRules match;
    bool claimed = false;
};
