# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2025-10-12

### Changed

-   **Improved Real-time Updates**: The file watcher for environment changes is now significantly more robust and reliable.
-   **Optimized Python Detection**: The extension now uses an event-based approach to detect when Python is added to a new environment, eliminating unnecessary delays during refresh.
-   **Performance Enhancement**: Implemented a smart watcher system that only monitors recently created environments and automatically disposes of watchers after a 30-second timeout to conserve system resources.
-   **Documentation**: Added a known issue to the README regarding debugger activation on Linux.

### Fixed

-   **UI Refresh Bug**: Fixed a critical issue where the user interface would not update when an environment changed from "no python" to a specific Python version. The UI now correctly reflects the environment's state in real-time.

## [0.1.0] - 2025-10-10

### Added

-   **Initial Release**
-   **Automatic Discovery**: Finds all micromamba environments, both global (`$MAMBA_ROOT_PREFIX/envs`) and workspace-local.
-   **Workspace-Aware**: Prioritizes and lists workspace-local environments first for easier access.
-   **Basic Real-time Updates**: Watches `~/.conda/environments.txt` for changes and automatically refreshes the environment list.