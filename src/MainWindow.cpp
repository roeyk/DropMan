#include "MainWindow.h"
#include "ProfileStore.h"

#include <QCursor>
#include <QGraphicsOpacityEffect>
#include <QGuiApplication>
#include <QHeaderView>
#include <QHBoxLayout>
#include <QItemSelectionModel>
#include <QLabel>
#include <QPropertyAnimation>
#include <QPlainTextEdit>
#include <QProcess>
#include <QPushButton>
#include <QScreen>
#include <QTableView>
#include <QTimer>
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

    m_claimButton = new QPushButton(QStringLiteral("Claim picked window"), buttonRow);
    m_releaseButton = new QPushButton(QStringLiteral("Release claimed window"), buttonRow);
    m_toggleButton = new QPushButton(QStringLiteral("Test toggle"), buttonRow);
    m_reloadButton = new QPushButton(QStringLiteral("Reload profiles"), buttonRow);
    m_saveButton = new QPushButton(QStringLiteral("Save profiles"), buttonRow);

    buttonLayout->addWidget(m_claimButton);
    buttonLayout->addWidget(m_releaseButton);
    buttonLayout->addWidget(m_toggleButton);
    buttonLayout->addWidget(m_reloadButton);
    buttonLayout->addWidget(m_saveButton);
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
    connect(&m_backend, &KWinBackend::claimSucceeded, this, &MainWindow::showClaimNotice);

    connect(m_claimButton, &QPushButton::clicked, this, [this]() {
        if (auto *profile = selectedProfile()) {
            m_backend.claimPickedWindow(*profile);
        }
    });

    connect(m_releaseButton, &QPushButton::clicked, this, [this]() {
        if (auto *profile = selectedProfile()) {
            m_backend.releaseClaim(*profile);
        }
    });

    connect(m_toggleButton, &QPushButton::clicked, this, [this]() {
        if (auto *profile = selectedProfile()) {
            m_backend.testToggle(*profile);
        }
    });

    connect(m_reloadButton, &QPushButton::clicked, this, &MainWindow::loadProfiles);
    connect(m_saveButton, &QPushButton::clicked, this, &MainWindow::saveProfiles);

    connect(m_table->selectionModel(), &QItemSelectionModel::selectionChanged, this, [this]() {
        refreshSelectionState();
    });

    loadProfiles();
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

void MainWindow::loadProfiles()
{
    QString error;
    m_profiles.setProfiles(ProfileStore::load(&error));
    m_table->resizeColumnsToContents();
    if (m_profiles.rowCount() > 0) {
        m_table->selectRow(0);
    }

    appendLog(QStringLiteral("Loaded profiles from %1%2")
                  .arg(ProfileStore::configPath(),
                       error.isEmpty() ? QString() : QStringLiteral(" (fallback: %1)").arg(error)));
}

void MainWindow::saveProfiles()
{
    QString error;
    if (ProfileStore::save(m_profiles.profiles(), &error)) {
        appendLog(QStringLiteral("Saved profiles to %1").arg(ProfileStore::configPath()));
    } else {
        appendLog(QStringLiteral("Could not save profiles: %1").arg(error));
        return;
    }

    if (ProfileStore::mirrorToKWin(m_profiles.profiles(), &error)) {
        appendLog(QStringLiteral("Mirrored profiles to KWin Script-dropman config"));
    } else {
        appendLog(QStringLiteral("Could not mirror profiles to KWin: %1").arg(error));
        return;
    }

    const bool reconfigureStarted = QProcess::startDetached(
        QStringLiteral("qdbus6"),
        {
            QStringLiteral("org.kde.KWin"),
            QStringLiteral("/KWin"),
            QStringLiteral("reconfigure")
        });

    if (reconfigureStarted) {
        appendLog(QStringLiteral("Requested KWin reconfigure"));
    } else {
        appendLog(QStringLiteral("Could not start qdbus6 to reconfigure KWin"));
    }
}

void MainWindow::showClaimNotice(const QString &profileName, const QString &windowCaption)
{
    if (m_claimNotice) {
        m_claimNotice->close();
        m_claimNotice = nullptr;
    }

    auto *notice = new QWidget(nullptr,
                               Qt::Window
                                   | Qt::FramelessWindowHint
                                   | Qt::WindowStaysOnTopHint
                                   | Qt::WindowDoesNotAcceptFocus);
    notice->setObjectName(QStringLiteral("ClaimNotice"));
    notice->setAttribute(Qt::WA_DeleteOnClose);
    notice->setAttribute(Qt::WA_TranslucentBackground);
    notice->setAttribute(Qt::WA_ShowWithoutActivating);
    notice->setWindowTitle(QStringLiteral("DropMan claim confirmation"));

    auto *layout = new QVBoxLayout(notice);
    layout->setContentsMargins(28, 20, 28, 20);
    layout->setSpacing(6);

    auto *title = new QLabel(QStringLiteral("DropMan claimed %1").arg(profileName), notice);
    title->setAlignment(Qt::AlignCenter);
    title->setStyleSheet(QStringLiteral("font-size: 30px; font-weight: 800; color: white;"));

    auto *caption = new QLabel(windowCaption, notice);
    caption->setAlignment(Qt::AlignCenter);
    caption->setWordWrap(true);
    caption->setStyleSheet(QStringLiteral("font-size: 17px; color: rgba(255, 255, 255, 210);"));

    layout->addWidget(title);
    layout->addWidget(caption);

    notice->setStyleSheet(QStringLiteral(
        "#ClaimNotice {"
        "  background-color: rgba(20, 22, 28, 235);"
        "  border: 2px solid rgba(255, 255, 255, 180);"
        "  border-radius: 18px;"
        "}"));

    auto *effect = new QGraphicsOpacityEffect(notice);
    effect->setOpacity(1.0);
    notice->setGraphicsEffect(effect);

    QScreen *screen = QGuiApplication::screenAt(QCursor::pos());
    if (!screen) {
        screen = QGuiApplication::primaryScreen();
    }
    const QRect available = screen ? screen->availableGeometry() : QRect(0, 0, 1280, 720);
    const int width = qMin(available.width() - 80, 980);
    const int height = 118;
    notice->resize(qMax(width, 520), height);
    notice->move(available.x() + (available.width() - notice->width()) / 2,
                 available.y() + 24);

    appendLog(QStringLiteral("Showing claim notice for %1 at %2,%3 %4x%5")
                  .arg(profileName)
                  .arg(notice->x())
                  .arg(notice->y())
                  .arg(notice->width())
                  .arg(notice->height()));

    m_claimNotice = notice;
    notice->show();
    notice->raise();
    QTimer::singleShot(0, notice, [notice]() {
        if (notice->isVisible()) {
            notice->raise();
        }
    });

    QTimer::singleShot(5000, notice, [this, notice, effect]() {
        if (!notice->isVisible()) {
            return;
        }

        auto *animation = new QPropertyAnimation(effect, "opacity", notice);
        animation->setDuration(650);
        animation->setStartValue(1.0);
        animation->setEndValue(0.0);
        connect(animation, &QPropertyAnimation::finished, notice, [this, notice]() {
            if (m_claimNotice == notice) {
                m_claimNotice = nullptr;
            }
            notice->close();
        });
        animation->start(QAbstractAnimation::DeleteWhenStopped);
    });
}

void MainWindow::refreshSelectionState()
{
    const bool hasProfile = selectedProfile() != nullptr;
    m_claimButton->setEnabled(hasProfile);
    m_releaseButton->setEnabled(hasProfile);
    m_toggleButton->setEnabled(hasProfile);
}
