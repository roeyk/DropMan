cmake_minimum_required(VERSION 3.20)

project(DropMan VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Qt6 REQUIRED COMPONENTS Widgets)

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

target_link_libraries(dropman PRIVATE Qt6::Widgets)

install(TARGETS dropman RUNTIME DESTINATION bin)
