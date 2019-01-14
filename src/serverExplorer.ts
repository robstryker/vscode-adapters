import {
    TreeDataProvider,
    Event,
    TreeItem,
    window,
    OpenDialogOptions,
    InputBoxOptions,
    EventEmitter,
    OutputChannel,
    workspace,
    Uri
} from 'vscode';
import * as path from 'path';

import {
    RSPClient,
    Protocol,
    ServerState
} from 'rsp-client';

export class ServersViewTreeDataProvider implements TreeDataProvider< Protocol.ServerState | Protocol.DeployableState> {

    private _onDidChangeTreeData: EventEmitter<Protocol.ServerState | undefined> = new EventEmitter<Protocol.ServerState | undefined>();
    readonly onDidChangeTreeData: Event<Protocol.ServerState | undefined> = this._onDidChangeTreeData.event;
    private client: RSPClient;
    public serverStatus: Map<string, Protocol.ServerState> = new Map<string, Protocol.ServerState>();
    public serverOutputChannels: Map<string, OutputChannel> = new Map<string, OutputChannel>();
    public runStateEnum: Map<number, string> = new Map<number, string>();
    public publishStateEnum: Map<number, string> = new Map<number, string>();

    constructor(client: RSPClient) {
        this.client = client;
        this.runStateEnum.set(0, 'Unknown');
        this.runStateEnum.set(1, 'Starting');
        this.runStateEnum.set(2, 'Started');
        this.runStateEnum.set(3, 'Stopping');
        this.runStateEnum.set(4, 'Stopped');

        this.publishStateEnum.set(1, 'None');
        this.publishStateEnum.set(2, 'Incremental');
        this.publishStateEnum.set(3, 'Full');
        this.publishStateEnum.set(4, 'Add');
        this.publishStateEnum.set(5, 'Remove');
        this.publishStateEnum.set(6, 'Unknown');

        client.getServerHandles().then(servers => servers.forEach(server => this.insertServer(server)));
    }

    insertServer(handle): void {
        this.refresh();
    }

    updateServer(event: Protocol.ServerState): void {
        this.serverStatus.set(event.server.id, event);
        this.refresh(event);
        const channel: OutputChannel = this.serverOutputChannels.get(event.server.id);
        if (event.state === ServerState.STARTING && channel) {
            channel.clear();
        }
    }

    removeServer(handle: Protocol.ServerHandle): void {
        this.serverStatus.delete(handle.id);
        this.refresh();
        const channel: OutputChannel = this.serverOutputChannels.get(handle.id);
        this.serverOutputChannels.delete(handle.id);
        if (channel) {
            channel.clear();
            channel.dispose();
        }
    }

    addServerOutput(output: Protocol.ServerProcessOutput): void {
        let channel: OutputChannel = this.serverOutputChannels.get(output.server.id);
        if (channel === undefined) {
            channel = window.createOutputChannel(`Server: ${output.server.id}`);
            this.serverOutputChannels.set(output.server.id, channel);
        }
        channel.append(output.text);
        if (workspace.getConfiguration('vscodeAdapters').get<boolean>('showChannelOnServerOutput')) {
            channel.show();
        }
    }

    showOutput(server: Protocol.ServerHandle): void {
        const channel: OutputChannel = this.serverOutputChannels.get(server.id);
        if (channel) {
            channel.show();
        }
    }

    refresh(data?): void {
        this._onDidChangeTreeData.fire(data);
    }

    addLocation(): Thenable<Protocol.Status> {
        return window.showOpenDialog(<OpenDialogOptions>{
            canSelectFiles: false,
            canSelectMany: false,
            canSelectFolders: true,
            openLabel: 'Select desired server location'
        }).then(folders => {
            if (folders && folders.length === 1) {
                return this.client.findServerBeans(folders[0].fsPath);
            }
        }).then(async serverBeans => {
            if (serverBeans && serverBeans.length > 0 && serverBeans[0].typeCategory && serverBeans[0].typeCategory !== 'UNKNOWN') {
                // Prompt for server name
                const options: InputBoxOptions = {
                    prompt: `Provide the server name`,
                    placeHolder: `Server name`,
                    validateInput: (value: string) => {
                        if (!value || value.trim().length === 0) {
                            return 'Cannot set empty server name';
                        }
                        if (this.serverStatus.get(value)) {
                            return 'Cannot set duplicate server name';
                        }
                        return null;
                    }
                };
                return window.showInputBox(options).then(value => {
                    return { name: value, bean: serverBeans[0] };
                });
            } else {
                if (serverBeans) {
                    return Promise.reject('Cannot detect server in selected location!');
                }
            }
        }).then(async data => {
            if (data && data.name) {
               const status = await this.client.createServerAsync(data.bean, data.name);
               if (status.severity > 0) {
                   return Promise.reject(status.message);
               }
               return status;
            }
        });
    }

    getTreeItem(item: Protocol.ServerState |  Protocol.DeployableState): TreeItem {
        if( (<Protocol.ServerState>item).deployableStates ) {
            // item is a serverState
            const item2 : Protocol.ServerHandle = (<Protocol.ServerState>item).server;
            const id1: string = item2.id;
            const status: Protocol.ServerState = this.serverStatus.get(id1);
            const runState : number = (status == null ? 0 : status.state);
            const treeItem: TreeItem = new TreeItem(`${id1}:${item2.type.visibleName}(${this.runStateEnum.get(runState)})`);
            treeItem.iconPath = Uri.file(path.join(__dirname, '../../images/server-light.png'));
            treeItem.contextValue =  this.runStateEnum.get(runState);
            return treeItem;
        } else if( (<Protocol.DeployableState>item).reference ) {
            const item2 : Protocol.DeployableState = (<Protocol.DeployableState>item);
            const treeItem: TreeItem = new TreeItem(`I am a deployment: ` + item2.state);
            treeItem.iconPath = Uri.file(path.join(__dirname, '../../images/server-light.png'));
            treeItem.contextValue =  this.runStateEnum.get(item2.state);
            return treeItem;
        }
    }

    getChildren(element?:  Protocol.ServerState | Protocol.DeployableState):  Protocol.ServerState[] | Protocol.DeployableState[] {
        if (element === undefined) {
            return Array.from(this.serverStatus.values());
        }
        if( (<Protocol.ServerState>element).deployableStates ) {
            return (<Protocol.ServerState>element).deployableStates;
        }
    }
}