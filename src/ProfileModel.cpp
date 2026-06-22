#include "ProfileModel.h"
#include "ProfileStore.h"

#include <QString>

#include <utility>

ProfileModel::ProfileModel(QObject *parent)
    : QAbstractTableModel(parent)
{
    m_profiles = ProfileStore::defaultProfiles();
}

int ProfileModel::rowCount(const QModelIndex &parent) const
{
    return parent.isValid() ? 0 : m_profiles.size();
}

int ProfileModel::columnCount(const QModelIndex &parent) const
{
    return parent.isValid() ? 0 : 10;
}

QVariant ProfileModel::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || index.row() < 0 || index.row() >= m_profiles.size()) {
        return {};
    }

    const auto &profile = m_profiles.at(index.row());

    if (role == Qt::DisplayRole || role == Qt::EditRole) {
        switch (index.column()) {
        case 0:
            return profile.id;
        case 1:
            return profile.name;
        case 2:
            return profile.shortcut;
        case 3:
            return profile.claimShortcut;
        case 4:
            return profile.edge;
        case 5:
            return profile.mode;
        case 6:
            return profile.match.resourceClass;
        case 7:
            return profile.match.resourceName;
        case 8:
            return profile.match.captionExclude;
        case 9:
            return profile.claimed ? QStringLiteral("claimed") : QStringLiteral("unclaimed");
        default:
            return {};
        }
    }

    return {};
}

bool ProfileModel::setData(const QModelIndex &index, const QVariant &value, int role)
{
    if (role != Qt::EditRole || !index.isValid()
        || index.row() < 0 || index.row() >= m_profiles.size()) {
        return false;
    }

    auto &profile = m_profiles[index.row()];
    const QString text = value.toString().trimmed();

    switch (index.column()) {
    case 0:
        profile.id = text;
        break;
    case 1:
        profile.name = text;
        break;
    case 2:
        profile.shortcut = text;
        break;
    case 3:
        profile.claimShortcut = text;
        break;
    case 4:
        profile.edge = text;
        break;
    case 5:
        profile.mode = text;
        break;
    case 6:
        profile.match.resourceClass = text;
        break;
    case 7:
        profile.match.resourceName = text;
        break;
    case 8:
        profile.match.captionExclude = text;
        break;
    default:
        return false;
    }

    emit dataChanged(index, index, {role, Qt::DisplayRole});
    return true;
}

Qt::ItemFlags ProfileModel::flags(const QModelIndex &index) const
{
    auto flags = QAbstractTableModel::flags(index);
    if (index.isValid() && index.column() < 9) {
        flags |= Qt::ItemIsEditable;
    }
    return flags;
}

QVariant ProfileModel::headerData(int section, Qt::Orientation orientation, int role) const
{
    if (orientation != Qt::Horizontal || role != Qt::DisplayRole) {
        return {};
    }

    switch (section) {
    case 0:
        return QStringLiteral("ID");
    case 1:
        return QStringLiteral("Profile");
    case 2:
        return QStringLiteral("Shortcut");
    case 3:
        return QStringLiteral("Claim shortcut");
    case 4:
        return QStringLiteral("Edge");
    case 5:
        return QStringLiteral("Mode");
    case 6:
        return QStringLiteral("resourceClass");
    case 7:
        return QStringLiteral("resourceName");
    case 8:
        return QStringLiteral("exclude caption");
    case 9:
        return QStringLiteral("Claim");
    default:
        return {};
    }
}

const QVector<Profile> &ProfileModel::profiles() const
{
    return m_profiles;
}

void ProfileModel::setProfiles(QVector<Profile> profiles)
{
    beginResetModel();
    m_profiles = std::move(profiles);
    endResetModel();
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

int ProfileModel::addProfile()
{
    const int row = m_profiles.size();
    beginInsertRows(QModelIndex(), row, row);
    m_profiles.append(Profile{
        .id = uniqueProfileId(QStringLiteral("profile")),
        .name = QStringLiteral("New Profile"),
        .shortcut = QString(),
        .claimShortcut = QString(),
        .edge = QStringLiteral("top"),
        .mode = QStringLiteral("preserve_geometry"),
        .widthPercent = 100,
        .heightPercent = 45,
        .match = MatchRules{}
    });
    endInsertRows();
    return row;
}

bool ProfileModel::removeProfile(int row)
{
    if (row < 0 || row >= m_profiles.size()) {
        return false;
    }

    beginRemoveRows(QModelIndex(), row, row);
    m_profiles.removeAt(row);
    endRemoveRows();
    return true;
}

void ProfileModel::notifyProfileChanged(int row)
{
    if (row < 0 || row >= m_profiles.size()) {
        return;
    }

    emit dataChanged(index(row, 0), index(row, columnCount() - 1), {Qt::DisplayRole, Qt::EditRole});
}

void ProfileModel::setClaimedProfileIds(const QSet<QString> &ids)
{
    for (int row = 0; row < m_profiles.size(); ++row) {
        auto &profile = m_profiles[row];
        const bool claimed = ids.contains(profile.id);
        if (profile.claimed == claimed) {
            continue;
        }

        profile.claimed = claimed;
        emit dataChanged(index(row, 9), index(row, 9), {Qt::DisplayRole});
    }
}

QString ProfileModel::uniqueProfileId(const QString &base) const
{
    auto exists = [this](const QString &candidate) {
        for (const auto &profile : m_profiles) {
            if (profile.id == candidate) {
                return true;
            }
        }
        return false;
    };

    if (!exists(base)) {
        return base;
    }

    for (int suffix = 2; suffix < 10000; ++suffix) {
        const QString candidate = QStringLiteral("%1-%2").arg(base).arg(suffix);
        if (!exists(candidate)) {
            return candidate;
        }
    }

    return QStringLiteral("%1-%2").arg(base).arg(m_profiles.size() + 1);
}
