import * as cp from 'child_process';
import * as path from 'path';
import * as os from 'os';
import {
    Disposable,
    EventEmitter,
    LogOutputChannel,
    ProgressLocation,
    ThemeIcon,
    Uri,
    CancellationToken,
    workspace,
    ExtensionContext,
    FileSystemWatcher,
    RelativePattern,
} from 'vscode';
import {
    CreateEnvironmentOptions,
    CreateEnvironmentScope,
    EnvironmentManager,
    PythonEnvironment,
    PythonEnvironmentInfo,
    PythonEnvironmentExecutionInfo,
    PythonEnvironmentApi,
    DidChangeEnvironmentsEventArgs,
    ResolveEnvironmentContext,
    GetEnvironmentsScope,
    RefreshEnvironmentsScope,
    EnvironmentChangeKind,
    DidChangeEnvironmentEventArgs,
    SetEnvironmentScope,
    GetEnvironmentScope,
} from './api';
import { createDeferred, Deferred } from './deferred';
import { withProgress } from './window.apis';
import { promises as fs } from 'fs';

// --- Start: Memento persistence logic ---
const MICROMAMBA_WORKSPACE_KEY = 'micromamba.workspace.selected';
const MICROMAMBA_GLOBAL_KEY = 'micromamba.global.selected';

async function getMicromambaForWorkspace(context: ExtensionContext, fsPath: string): Promise<string | undefined> {
    const allData = context.globalState.get<{ [key: string]: string }>(MICROMAMBA_WORKSPACE_KEY, {});
    return allData[fsPath];
}

async function setMicromambaForWorkspace(context: ExtensionContext, fsPath: string, envPath: string | undefined): Promise<void> {
    const allData = context.globalState.get<{ [key: string]: string }>(MICROMAMBA_WORKSPACE_KEY, {});
    if (envPath) {
        allData[fsPath] = envPath;
    } else {
        delete allData[fsPath];
    }
    await context.globalState.update(MICROMAMBA_WORKSPACE_KEY, allData);
}

async function getMicromambaForGlobal(context: ExtensionContext): Promise<string | undefined> {
    return context.globalState.get<string>(MICROMAMBA_GLOBAL_KEY);
}

async function setMicromambaForGlobal(context: ExtensionContext, envPath: string | undefined): Promise<void> {
    await context.globalState.update(MICROMAMBA_GLOBAL_KEY, envPath);
}
// --- End: Persistence logic ---

async function pathExists(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

function normalize(raw_path:string) {
    let norm_path = path.normalize(raw_path);
    if (process.platform === "win32") {norm_path = norm_path.toLowerCase();}
    return norm_path;
}

function runCommand(command: string, args: string[], token?: CancellationToken): Promise<string> {
    return new Promise((resolve, reject) => {
        const proc = cp.spawn(command, args, { shell: true });
        token?.onCancellationRequested(() => proc.kill());
        let stdout = '', stderr = '';
        proc.stdout?.on('data', (data) => (stdout += data.toString()));
        proc.stderr?.on('data', (data) => (stderr += data.toString()));
        proc.on('error', reject);
        proc.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`Command failed: ${stderr}`)));
    });
}

// Function to run a command in an initialized shell
function runShCommand(command: string, args: string[], token?: CancellationToken): Promise<string> {
    return new Promise((resolve, reject) => {
        const commandWithArgs = [command, ...args].join(' ');
        const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
        // The `-ic` option for bash is crucial to load the user profile (`.bashrc`, etc.)
        const spawnArgs = process.platform === 'win32' ? ['-Command', `& { ${commandWithArgs} }`] : ['-ic', commandWithArgs];
        
        const proc = cp.spawn(shell, spawnArgs);
        token?.onCancellationRequested(() => proc.kill());
        let stdout = '', stderr = '';
        proc.stdout?.on('data', (data) => (stdout += data.toString()));
        proc.stderr?.on('data', (data) => (stderr += data.toString()));
        proc.on('error', reject);
        proc.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`Command failed: ${stderr}`)));
    });
}


export class MicromambaEnvManager implements EnvironmentManager, Disposable {
    public readonly name: string = 'micromamba';
    public readonly displayName: string = 'Micromamba';
    public readonly preferredPackageManagerId = 'ms-python.python:conda';

    private readonly _onDidChangeEnvironments = new EventEmitter<DidChangeEnvironmentsEventArgs>();
    public readonly onDidChangeEnvironments = this._onDidChangeEnvironments.event;

    private readonly _onDidChangeEnvironment = new EventEmitter<DidChangeEnvironmentEventArgs>();
    public readonly onDidChangeEnvironment = this._onDidChangeEnvironment.event;

    private collection: PythonEnvironment[] = [];
    private micromambaExePath: string | undefined;
    private _initialized: Deferred<void> | undefined;
    private mambaRootPrefix: string | undefined;
    private watchers: FileSystemWatcher[] = [];
    private temporaryWatchers: Map<string, { watcher: FileSystemWatcher; timeout: NodeJS.Timeout }> = new Map();
    private refreshPromise: Promise<void> | undefined;

    private fsPathToEnv: Map<string, PythonEnvironment> = new Map();
    private globalEnv: PythonEnvironment | undefined;

    constructor(
        private readonly api: PythonEnvironmentApi,
        public readonly log: LogOutputChannel,
        private readonly context: ExtensionContext,
    ) { }

    public dispose() {
        this._onDidChangeEnvironments.dispose();
        this._onDidChangeEnvironment.dispose();
        this.watchers.forEach(w => w.dispose());
        this.temporaryWatchers.forEach(w => {
            clearTimeout(w.timeout);
            w.watcher.dispose();
        });
        this.temporaryWatchers.clear();
    }
    
    private async getMambaRootPrefix(): Promise<string> {
        if (this.mambaRootPrefix) return this.mambaRootPrefix;

        this.log.info(`Attempting to get MAMBA_ROOT_PREFIX from an initialized shell...`);
        try {
            // Use runShCommand to read the environment variable
            const command = process.platform === 'win32' ? 'echo $env:MAMBA_ROOT_PREFIX' : 'echo $MAMBA_ROOT_PREFIX';
            const envVar = (await runShCommand(command, [])).trim();

            // Check if the command returned a non-empty and valid value
            if (envVar && !envVar.startsWith('$')) {
                this.log.info(`Using MAMBA_ROOT_PREFIX from shell environment variable: ${envVar}`);
                this.mambaRootPrefix = envVar;
                return this.mambaRootPrefix;
            }
        } catch (error) {
            this.log.warn('Failed to get MAMBA_ROOT_PREFIX from shell. This can happen if the variable is not set.');
        }
        
        // Fallback if the variable is not set
        const defaultPath = path.join(os.homedir(), 'micromamba');
        this.log.warn(`MAMBA_ROOT_PREFIX environment variable not found in shell. Using fallback: ${defaultPath}`);
        this.mambaRootPrefix = defaultPath;
        return this.mambaRootPrefix;
    }

    private async initialize(): Promise<void> {
        if (this._initialized) return this._initialized.promise;
        this._initialized = createDeferred<void>();

        try { this.micromambaExePath = 'micromamba'; }
        catch (error) {
            this.log.error('Micromamba not in PATH.');
            this._initialized.resolve();
            return;
        }

        await this.refresh(undefined);
        await this.loadEnvMap();
        // Set up file watcher
        const condaFolderPath = path.join(os.homedir(), '.conda');
        if (await pathExists(condaFolderPath)) {
            const watcher = workspace.createFileSystemWatcher(
                new RelativePattern(Uri.file(condaFolderPath), 'environments.txt')
            );

            const scheduleRefresh = (uri: Uri) => {
                this.log.info(`Change detected in: ${uri.fsPath}. Scheduling a refresh.`);
                if (!this.refreshPromise) {
                    this.refreshPromise = this.refresh(undefined).finally(() => {
                        this.refreshPromise = undefined;
                    });
                }
            };

            let debounceTimer: NodeJS.Timeout;
            const debouncedRefresh = (uri: Uri) => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => scheduleRefresh(uri), 500);
            };

            watcher.onDidChange(debouncedRefresh);
            watcher.onDidCreate(debouncedRefresh);
            watcher.onDidDelete(debouncedRefresh);

            this.context.subscriptions.push(watcher);
            this.watchers.push(watcher);
            this.log.info(`Watching for changes in: ${path.join(condaFolderPath, 'environments.txt')}`);
        }

        this._initialized.resolve();
    }

    public async getEnvironments(scope: GetEnvironmentsScope): Promise<PythonEnvironment[]> {
        await this.initialize();
        return this.collection;
    }

    public async resolve(context: ResolveEnvironmentContext): Promise<PythonEnvironment | undefined> {
        await this.initialize();
        const ctxtpath = process.platform === 'win32' ? path.dirname(context.fsPath) : path.dirname(path.dirname(context.fsPath));
        return this.collection.find((e) => e.environmentPath.fsPath === ctxtpath);
    }

    private async getEnvsFromEnvironmentsTxt(): Promise<string[]> {
        const environmentsTxtPath = path.join(os.homedir(), '.conda', 'environments.txt');
        if (await pathExists(environmentsTxtPath)) {
            try {
                const content = await fs.readFile(environmentsTxtPath, 'utf-8');
                return content.split(/\r?\n/).map(p => p.trim()).filter(p => p);
            } catch (error) {
                this.log.error('Error reading .conda/environments.txt', error);
            }
        }
        return [];
    }
    
    public async refresh(scope: RefreshEnvironmentsScope): Promise<void> {
        if (!this.micromambaExePath) return;

        const allPrefixes = await this.getEnvsFromEnvironmentsTxt();
        const currentPrefixes = new Set(allPrefixes);

        for (const [prefix, { watcher, timeout }] of this.temporaryWatchers.entries()) {
            if (!currentPrefixes.has(prefix)) {
                this.log.info(`Environment at ${prefix} was removed. Cleaning up its temporary watcher.`);
                clearTimeout(timeout);
                watcher.dispose();
                this.temporaryWatchers.delete(prefix);
            }
        }

        await withProgress({ location: ProgressLocation.Window, title: 'Searching Micromamba environments...' },
            async () => {
                const oldEnvs = [...this.collection];
                let newEnvs: PythonEnvironment[] = [];

                try {
                    const rootPrefix = await this.getMambaRootPrefix();
                    const globalEnvsPath = normalize(path.join(rootPrefix, 'envs'));
                    const workspaceFolders = this.api.getPythonProjects().map(p => normalize(p.uri.fsPath));

                    const isWorkspace = (p: string) => workspaceFolders.some(ws => normalize(p).startsWith(ws));
                    const isGlobalNamed = (p: string) => normalize(path.dirname(p)) === globalEnvsPath;

                    const relevantPrefixes = allPrefixes.filter(p => isWorkspace(p) || isGlobalNamed(p));
                    
                    this.log.info(`Found ${allPrefixes.length} total envs, processing ${relevantPrefixes.length} relevant envs.`);
                    
                    newEnvs = (await Promise.all(relevantPrefixes.map(async (prefix) => {
                        if (!await pathExists(prefix)) return null;

                        const folderName = path.basename(prefix);
                        const pythonExecutable = process.platform === 'win32' ? path.join(prefix, 'python.exe') : path.join(prefix, 'bin', 'python');
                        const pythonExists = await pathExists(pythonExecutable);

                        if (pythonExists && this.temporaryWatchers.has(prefix)) {
                            this.log.info(`Python executable found for ${prefix}, removing temporary watcher.`);
                            const { watcher, timeout } = this.temporaryWatchers.get(prefix)!;
                            clearTimeout(timeout);
                            watcher.dispose();
                            this.temporaryWatchers.delete(prefix);
                        }

                        if (!pythonExists && !this.temporaryWatchers.has(prefix)) {
                            const stats = await fs.stat(prefix);
                            const ageInSeconds = (Date.now() - stats.mtime.getTime()) / 1000;
                            
                            if (ageInSeconds < 60) {
                                this.log.info(`Python executable not found for new environment ${prefix}. Setting up a temporary watcher.`);
                                const relativePath = path.relative(prefix, pythonExecutable);
                                const watcher = workspace.createFileSystemWatcher(new RelativePattern(Uri.file(prefix), relativePath));
                                
                                const timeout = setTimeout(() => {
                                    this.log.warn(`Watcher for ${prefix} timed out after 30 seconds. Disposing.`);
                                    watcher.dispose();
                                    this.temporaryWatchers.delete(prefix);
                                }, 30000);

                                const onPythonCreated = (uri: Uri) => {
                                    this.log.info(`Python executable created at: ${uri.fsPath}. Triggering a refresh.`);
                                    clearTimeout(timeout);
                                    this.refresh(undefined);
                                    watcher.dispose();
                                    this.temporaryWatchers.delete(prefix);
                                };

                                watcher.onDidCreate(onPythonCreated);
                                this.context.subscriptions.push(watcher);
                                this.temporaryWatchers.set(prefix, { watcher, timeout });
                            }
                        }

                        const group = isWorkspace(prefix) ? 'Workspace' : 'Named';
                        const execInfo: PythonEnvironmentExecutionInfo = {
                            run: { executable: pythonExecutable },
                            activatedRun: { executable: pythonExecutable, args: [] },
                            activation: [{ executable: this.micromambaExePath!, args: ['activate', prefix] }],
                            deactivation: [{ executable: this.micromambaExePath!, args: ['deactivate'] }],
                        };

                        let envItemInfo: PythonEnvironmentInfo;
                        if (pythonExists) {
                            const version = (await runCommand(pythonExecutable, ['--version'])).replace('Python ', '').trim();
                            envItemInfo = { 
                                displayPath: prefix, name: folderName, version: version, 
                                displayName: `${folderName} (${version})`, environmentPath: Uri.file(prefix),
                                sysPrefix: prefix, execInfo: execInfo, group:group 
                            };
                        } else {
                            envItemInfo = { 
                                displayPath: prefix, name: folderName, version: 'no-python', 
                                displayName: `${folderName} (no python)`, environmentPath: Uri.file(prefix),
                                sysPrefix: prefix, execInfo: execInfo, group: group,
                                iconPath: new ThemeIcon('warning') };
                        }

                        return this.api.createPythonEnvironmentItem({ ...envItemInfo, displayPath: prefix, environmentPath: Uri.file(prefix), sysPrefix: prefix, execInfo }, this);
                    }))).filter((e): e is PythonEnvironment => e !== null);

                    newEnvs.sort((a, b) => {
                        const aIsWorkspace = a.group === 'Workspace';
                        const bIsWorkspace = b.group === 'Workspace';
                        if (aIsWorkspace && !bIsWorkspace) return -1;
                        if (!aIsWorkspace && bIsWorkspace) return 1;
                        return a.name.localeCompare(b.name);
                    });

                } catch (error) { this.log.error('Error refreshing micromamba envs.', error); }
                
                const oldEnvsMap = new Map(oldEnvs.map(e => [e.environmentPath.fsPath, e]));
                const newEnvsMap = new Map(newEnvs.map(e => [e.environmentPath.fsPath, e]));
                const events: DidChangeEnvironmentsEventArgs = [];

                for (const [fsPath, oldEnv] of oldEnvsMap.entries()) {
                    const newEnv = newEnvsMap.get(fsPath);
                    if (!newEnv) {
                        events.push({ environment: oldEnv, kind: EnvironmentChangeKind.remove });
                    } else if (newEnv.displayName !== oldEnv.displayName) {
                        events.push({ environment: oldEnv, kind: EnvironmentChangeKind.remove });
                        events.push({ environment: newEnv, kind: EnvironmentChangeKind.add });
                    }
                }

                for (const [fsPath, newEnv] of newEnvsMap.entries()) {
                    if (!oldEnvsMap.has(fsPath)) {
                        events.push({ environment: newEnv, kind: EnvironmentChangeKind.add });
                    }
                }

                this.collection = newEnvs;
                if (events.length > 0) {
                    this.log.info(`Firing ${events.length} environment change events to update UI.`);
                    this._onDidChangeEnvironments.fire(events);
                }
            }
        );
    }

    public async get(scope: GetEnvironmentScope): Promise<PythonEnvironment | undefined> {
        await this.initialize();
        if (scope instanceof Uri) {
            const project = this.api.getPythonProject(scope);
            const projectPath = project ? project.uri.fsPath : scope.fsPath;
            return this.fsPathToEnv.get(projectPath);
        }
        return this.globalEnv;
    }

    public async set(scope: SetEnvironmentScope, environment?: PythonEnvironment): Promise<void> {
        await this.initialize();
        const fire = (uri: Uri | undefined, oldEnv?: PythonEnvironment) => {
            if (oldEnv?.envId.id !== environment?.envId.id) {
                this._onDidChangeEnvironment.fire({ uri, old: oldEnv, new: environment });
            }
        };

        if (scope === undefined) {
            const old = this.globalEnv;
            this.globalEnv = environment;
            await setMicromambaForGlobal(this.context, environment?.environmentPath.fsPath);
            fire(undefined, old);
        } else {
            const uris = Array.isArray(scope) ? scope : [scope];
            uris.forEach(uri => {
                const project = this.api.getPythonProject(uri);
                if (project) {
                    const fsPath = project.uri.fsPath;
                    const old = this.fsPathToEnv.get(fsPath);
                    if (environment) this.fsPathToEnv.set(fsPath, environment);
                    else this.fsPathToEnv.delete(fsPath);
                    setMicromambaForWorkspace(this.context, fsPath, environment?.environmentPath.fsPath);
                    fire(uri, old);
                }
            });
        }
    }
    
    private async loadEnvMap(): Promise<void> {
        const globalPath = await getMicromambaForGlobal(this.context);
        if (globalPath) this.globalEnv = this.collection.find(e => e.environmentPath.fsPath === globalPath);

        for (const project of this.api.getPythonProjects()) {
            const envPath = await getMicromambaForWorkspace(this.context, project.uri.fsPath);
            if (envPath) {
                const env = this.collection.find(e => e.environmentPath.fsPath === envPath);
                if (env) this.fsPathToEnv.set(project.uri.fsPath, env);
            }
        }
    }

    public async create(scope: CreateEnvironmentScope, options?: CreateEnvironmentOptions): Promise<PythonEnvironment | undefined> {
        this.log.warn('Not implemented.');
        return undefined;
    }

    public async remove(environment: PythonEnvironment): Promise<void> {
        this.log.warn('Not implemented.');
    }
}