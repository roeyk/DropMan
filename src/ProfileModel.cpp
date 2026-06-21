#include "ProfileModel.h"

ProfileModel::ProfileModel(QObject *parent)
    : QAbstractTableModel(parent)
{
    m_profiles = {
        Profile{
            .name = QStringLiteral("Firefox"),
            .shortcut = QStringLiteral("Meta+F"),
            .edge = QStringLiteral("right"),
            .sizePercent = 40,
            .match = MatchRules{
                .resourceClass = QStringLiteral("firefox_firefox"),
                .resourceName = QStringLiteral("firefox"),
                .captionFilter = QStringLiteral("Firefox")
            }
        },
        Profile{
            .name = QStringLiteral("Uplink"),
            .shortcut = QStringLiteral("Meta+U"),
            .edge = QStringLiteral("top"),
            .sizePercent = 45,
            .match = MatchRules{
                .resourceClass = QStringLiteral("Uplink"),
                .resourceName = QStringLiteral("Uplink")
            }
        },
        Profile{
            .name = QStringLiteral("Konsole"),
            .shortcut = QStringLiteral("Meta+K"),
            .edge = QStringLiteral("top"),
            .sizePercent = 45,
            .match = MatchRules{
                .resourceClass = QStringLiteral("org.kde.konsole"),
                .resourceName = QStringLiteral("konsole")
            }
        }
    };
}

int ProfileModel::rowCount(const QModelIndex &parent) const
{
    return parent.isValid() ? 0 : m_profiles.size();
}

int ProfileModel::columnCount(const QModelIndex &parent) const
{
    return parent.isValid() ? 0 : 6;
}

QVariant ProfileModel::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || index.row() < 0 || index.row() >= m_profiles.size()) {
        return {};
    }

    const auto &profile = m_profiles.at(index.row());

    if (role == Qt::DisplayRole) {
        switch (index.column()) {
        case 0:
            return profile.name;
        case 1:
            return profile.shortcut;
        case 2:
            return profile.edge;
        case 3:
            return QStringLiteral("%1%").arg(profile.sizePercent);
        case 4:
            return profile.match.resourceClass;
        case 5:
            return profile.claimed ? QStringLiteral("claimed") : QStringLiteral("unclaimed");
        default:
            return {};
        }
    }

    return {};
}

QVariant ProfileModel::headerData(int section, Qt::Orientation orientation, int role) const
{
    if (orientation != Qt::Horizontal || role != Qt::DisplayRole) {
        return {};
    }

    switch (section) {
    case 0:
        return QStringLiteral("Profile");
    case 1:
        return QStringLiteral("Shortcut");
    case 2:
        return QStringLiteral("Edge");
    case 3:
        return QStringLiteral("Size");
    case 4:
        return QStringLiteral("resourceClass");
    case 5:
        return QStringLiteral("Claim");
    default:
        return {};
    }
}

Profile *ProfileModel::profileAt(int row)
{
    if (row < 0 || row >= m_profiles.size()) {
        return nullptr;
    }
    return &m_profiles[row];
}

const Profile *ProfileModel::profileAt(int row) const
{
    if (row < 0 || row >= m_profiles.size()) {
        return nullptr;
    }
    return &m_profiles[row];
}
