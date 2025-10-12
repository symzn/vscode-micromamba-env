# Micromamba Environment Provider

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/symzn.vscode-micromamba-env?style=flat-square&label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=symzn.vscode-micromamba-env)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Visual Studio Code extension that discovers and displays your micromamba environments, seamlessly integrating with the Python Environments extension.

## Features

-   **Automatic Discovery**: Finds all your micromamba environments, whether they are global (in `$MAMBA_ROOT_PREFIX/envs`) or local to your workspace.
-   **Workspace-Aware**: Workspace-local environments are prioritized and listed first for easy access.
-   **Real-time Updates**: Watches for changes and automatically refreshes the list when you create or delete an environment.

## Requirements

-   [Visual Studio Code](https://code.visualstudio.com/) (v1.90.0 or higher)
-   [Python Environments](https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-python-envs) extension (`ms-python.vscode-python-envs`)
-   **Micromamba**: Must be installed and configured in your shell environment. The extension relies on:
    -   The `~/.conda/environments.txt` file to locate your environments.
    -   The `MAMBA_ROOT_PREFIX` environment variable to detect the environment type (e.g., `Workspace` vs. `Named`).

> **Important: Activating the Python Environments extension**<br/>
> The Python Environments icon may not appear in the Activity Bar due to its ongoing rollout. If you don't see it, you must enable it manually by adding the following line to your User `settings.json` file:
> ```json
> "python.useEnvironmentsExtension": true
> ```
> This is a temporary requirement until the rollout is complete. (cf. [note](https://github.com/microsoft/vscode-python-environments?tab=readme-ov-file#python-environments-preview))

## Installation

1.  Open **Visual Studio Code**.
2.  Go to the **Extensions** view (`Ctrl+Shift+X`).
3.  Search for `Micromamba Environment Provider`.
4.  Click **Install**.

## Known Issues

-   **Debugger Activation on Linux**: There is a known issue on Linux where the Python debugger may launch before the micromamba environment is fully activated. This can cause errors if your code relies on packages or environment variables from that environment. For more details, please follow the discussion on [GitHub Issue #934](https://github.com/microsoft/vscode-python-environments/issues/934).

## Contributing

Contributions are welcome! Please feel free to open an issue to report a bug or suggest a feature. If you want to contribute code, please open a Pull Request.

## Development

To get started with development:

1.  **Clone the repository**:
    ```bash
    git clone [https://github.com/symzn/vscode-micromamba-env.git](https://github.com/symzn/vscode-micromamba-env.git)
    cd vscode-micromamba-env
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

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.