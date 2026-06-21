#include "MainWindow.h"

#include <QHeaderView>
#include <QHBoxLayout>
#include <QItemSelectionModel>
#include <QLabel>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QTableView>
#include <QVBoxLayout>
#include <QWidget>

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
{
    auto *central = new QWidget(this);
    auto *layout = new QVBoxLayout(central);

    m_identity = new QLabel(m_backend.activeWindowIdentity(), central);
    m_identity->setWordWrap(true);
    layout->addWidget(m_identity);

    m_table = new QTableView(central);
    m_table->setModel(&m_profiles);
    m_table->setSelectionBehavior(QAbstractItemView::SelectRows);
    m_table->setSelectionMode(QAbstractItemView::SingleSelection);
    m_table->horizontalHeader()->setStretchLastSection(true);
    m_table->verticalHeader()->hide();
    layout->addWidget(m_table, 1);

    auto *buttonRow = new QWidget(central);
    auto *buttonLayout = new QHBoxLayout(buttonRow);
    buttonLayout->setContentsMargins(0, 0, 0, 0);

    m_claimButton = new QPushButton(QStringLiteral("Claim active window"), buttonRow);
    m_releaseButton = new QPushButton(QStringLiteral("Release claimed window"), buttonRow);
    m_toggleButton = new QPushButton(QStringLiteral("Test toggle"), buttonRow);

    buttonLayout->addWidget(m_claimButton);
    buttonLayout->addWidget(m_releaseButton);
    buttonLayout->addWidget(m_toggleButton);
    buttonLayout->addStretch(1);
    layout->addWidget(buttonRow);

    m_log = new QPlainTextEdit(central);
    m_log->setReadOnly(true);
    m_log->setMaximumBlockCount(500);
    layout->addWidget(m_log, 1);

    setCentralWidget(central);
    setWindowTitle(QStringLiteral("DropMan"));
    resize(920, 640);

    connect(&m_backend, &KWinBackend::logMessage, this, &MainWindow::appendLog);

    connect(m_claimButton, &QPushButton::clicked, this, [this]() {
        if (auto *profile = selectedProfile()) {
            m_backend.claimActiveWindow(*profile);
            m_profiles.dataChanged(QModelIndex(), QModelIndex());
        }
    });

    connect(m_releaseButton, &QPushButton::clicked, this, [this]() {
        if (auto *profile = selectedProfile()) {
            m_backend.releaseClaim(*profile);
            m_profiles.dataChanged(QModelIndex(), QModelIndex());
        }
    });

    connect(m_toggleButton, &QPushButton::clicked, this, [this]() {
        if (auto *profile = selectedProfile()) {
            m_backend.testToggle(*profile);
        }
    });

    connect(m_table->selectionModel(), &QItemSelectionModel::selectionChanged, this, [this]() {
        refreshSelectionState();
    });

    if (m_profiles.rowCount() > 0) {
        m_table->selectRow(0);
    }
    refreshSelectionState();
    appendLog(QStringLiteral("DropMan started. Design rule: match many, bind one."));
}

Profile *MainWindow::selectedProfile()
{
    const auto rows = m_table->selectionModel()->selectedRows();
    if (rows.isEmpty()) {
        return nullptr;
    }
    return m_profiles.profileAt(rows.first().row());
}

void MainWindow::appendLog(const QString &message)
{
    m_log->appendPlainText(message);
}

void MainWindow::refreshSelectionState()
{
    const bool hasProfile = selectedProfile() != nullptr;
    m_claimButton->setEnabled(hasProfile);
    m_releaseButton->setEnabled(hasProfile);
    m_toggleButton->setEnabled(hasProfile);
}
