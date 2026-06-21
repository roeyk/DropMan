cmake_minimum_required(VERSION 3.20)

project(DropMan VERSION 0.1.0 LANGUAGES CXX)

find_package(ECM REQUIRED NO_MODULE)
set(CMAKE_MODULE_PATH ${ECM_MODULE_PATH})

include(KDEInstallDirs)
include(KDECMakeSettings)
include(KDECompilerSettings NO_POLICY_SCOPE)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Qt6 REQUIRED COMPONENTS Widgets)
find_package(KF6 REQUIRED COMPONENTS I18n Config ConfigWidgets)

qt_standard_project_setup()

qt_add_executable(dropman
    src/main.cpp
    src/MainWindow.cpp
    src/MainWindow.h
    src/Profile.cpp
    src/Profile.h
    src/ProfileModel.cpp
    src/ProfileModel.h
    src/KWinBackend.cpp
    src/KWinBackend.h
)

target_link_libraries(dropman
    PRIVATE
        Qt6::Widgets
        KF6::I18n
        KF6::ConfigCore
        KF6::ConfigWidgets
)

install(TARGETS dropman RUNTIME DESTINATION bin)
