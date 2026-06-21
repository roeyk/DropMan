#pragma once

#include "KWinBackend.h"
#include "ProfileModel.h"

#include <QMainWindow>

class QLabel;
class QPlainTextEdit;
class QPushButton;
class QTableView;

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);

private:
    Profile *selectedProfile();
    void appendLog(const QString &message);
    void refreshSelectionState();

    ProfileModel m_profiles;
    KWinBackend m_backend;
    QTableView *m_table = nullptr;
    QLabel *m_identity = nullptr;
    QPlainTextEdit *m_log = nullptr;
    QPushButton *m_claimButton = nullptr;
    QPushButton *m_releaseButton = nullptr;
    QPushButton *m_toggleButton = nullptr;
};
