# Micromamba Environment Provider

A Visual Studio Code extension that discovers and displays your micromamba environments, seamlessly integrating with the Python Environments extension.

## Features

-   **Automatic Discovery**: Finds all your micromamba environments, whether they are global (in `MAMBA_ROOT_PREFIX`) or local to your workspace.
-   **Seamless Integration**: Registers as an environment provider for the official `ms-python.vscode-python-envs` extension.
-   **Workspace-Aware**: Workspace-local environments are prioritized and listed first for easy access.
-   **Real-time Updates**: Watches for changes and automatically refreshes the list when you create or delete an environment.

## Requirements

-   [Visual Studio Code](https://code.visualstudio.com/) (v1.90.0 or higher)
-   [ms-python.vscode-python-envs](https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-python-envs) extension
-   **Micromamba**: Must be installed and configured in your shell environment. The extension relies on the `MAMBA_ROOT_PREFIX` environment variable to locate your environments.

## Installation

1.  Open **Visual Studio Code**.
2.  Go to the **Extensions** view (`Ctrl+Shift+X`).
3.  Search for `Micromamba Environment Provider`.
4.  Click **Install**.

## Development

To contribute to this extension, you can follow these steps:

1.  **Clone the repository**:
    ```bash
    git clone <your-repository-url>
    cd <repository-folder>
    ```
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Compile the code**:
    ```bash
    npm run compile
    ```
    You can also run `npm run watch` to automatically recompile on file changes.

4.  **Launch in Debug Mode**:
    -   Press `F5` in VS Code to open a new "Extension Development Host" window with the extension running.
    -   You can now test your changes in this new window.