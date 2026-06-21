#pragma once

#include "KWinBackend.h"
#include "ProfileModel.h"

#include <QMainWindow>

class QLabel;
class QPlainTextEdit;
class QPushButton;
class QTableView;
class QWidget;

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);

private:
    Profile *selectedProfile();
    void appendLog(const QString &message);
    void loadProfiles();
    void saveProfiles();
    void refreshSelectionState();
    void showClaimNotice(const QString &profileName, const QString &windowCaption);

    ProfileModel m_profiles;
    KWinBackend m_backend;
    QTableView *m_table = nullptr;
    QLabel *m_identity = nullptr;
    QPlainTextEdit *m_log = nullptr;
    QPushButton *m_claimButton = nullptr;
    QPushButton *m_releaseButton = nullptr;
    QPushButton *m_toggleButton = nullptr;
    QPushButton *m_reloadButton = nullptr;
    QPushButton *m_saveButton = nullptr;
    QWidget *m_claimNotice = nullptr;
};
