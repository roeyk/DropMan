#pragma once

#include "Profile.h"

#include <QAbstractTableModel>
#include <QVector>

class ProfileModel : public QAbstractTableModel {
    Q_OBJECT

public:
    explicit ProfileModel(QObject *parent = nullptr);

    int rowCount(const QModelIndex &parent = QModelIndex()) const override;
    int columnCount(const QModelIndex &parent = QModelIndex()) const override;
    QVariant data(const QModelIndex &index, int role = Qt::DisplayRole) const override;
    bool setData(const QModelIndex &index, const QVariant &value, int role = Qt::EditRole) override;
    Qt::ItemFlags flags(const QModelIndex &index) const override;
    QVariant headerData(int section, Qt::Orientation orientation, int role) const override;

    const QVector<Profile> &profiles() const;
    void setProfiles(QVector<Profile> profiles);
    Profile *profileAt(int row);
    const Profile *profileAt(int row) const;

private:
    QVector<Profile> m_profiles;
};
