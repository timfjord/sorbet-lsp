/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from 'path';
import { existsSync } from 'fs';
import * as vscode from 'vscode';
import * as child_process from 'child_process';
import { workspace, ExtensionContext, env } from 'vscode';
import { platform } from 'os';
import crossSpawn = require('cross-spawn');
import shellEscape = require('shell-escape');

import {
	LanguageClient,
	LanguageClientOptions,
	Disposable,
	ServerOptions,
	RevealOutputChannelOn
} from 'vscode-languageclient';

let client: LanguageClient;

const commonOptions = workspace => {
	var opts = {};
	if (workspace) {
		opts['cwd'] = workspace;
	}
	return opts;
}

const spawnWithBash = (cmd, opts) => {
	if (platform().match(/darwin|linux/)) {
		// OSX and Linux need to use an explicit login shell in order to find
		// the correct Ruby environment through installation managers like rvm
		// and rbenv.
		var shell = env.shell || '/bin/bash';
		if (shell.endsWith('bash') || shell.endsWith('zsh')) {
			var shellCmd = shellEscape(cmd);
			if (opts['cwd']) {
				shellCmd = `${shellEscape(['cd', opts['cwd']])} && ${shellCmd}`;
			}
			var shellArgs = [shellCmd];
			shellArgs.unshift('-c');
			shellArgs.unshift('-l');
			return child_process.spawn(shell, shellArgs, { shell, ...opts });
		} else {
			return crossSpawn(cmd.shift(), cmd, opts);
		}
	} else {
		return crossSpawn(cmd.shift(), cmd, opts);
	}
}

export function activate(context: ExtensionContext) {
	let disposableClient: Disposable;

	const startLanguageServer = () => {
		let cmd = [];

		let vsconfig = vscode.workspace.getConfiguration('sorbet');
		const commandPath = vsconfig.commandPath || 'srb';
		const useBundler = vsconfig.useBundler;
		const useWatchman = vsconfig.useWatchman;
		const bundlerPath = vsconfig.bundlerPath || 'bundle';
		const commandOptions = vsconfig.commandOptions.trim();

		if (useBundler) {
			cmd = cmd.concat([bundlerPath, 'exec', 'srb']);
		} else {
			cmd.push(commandPath);
		}

		cmd = cmd.concat(['tc', '--lsp']);

		if (commandOptions) {
			cmd.push(commandOptions);
		} else {
			cmd.push('--enable-all-experimental-lsp-features');
		}

		if (!useWatchman) {
			cmd.push('--disable-watchman');
		}

		const firstWorkspace = (workspace.workspaceFolders && workspace.workspaceFolders[0]) ? workspace.workspaceFolders[0].uri.fsPath : null;

		if (!existsSync(`${firstWorkspace}/sorbet/config`)) {
			vscode.window.showInformationMessage('Sorbet config not found. Sorbet server will not be started');
			return;
		}

		const env = commonOptions(firstWorkspace);

		// The debug options for the server
		// --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
		let debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

		const serverOptions: ServerOptions = () => {
			return new Promise((resolve) => {
				let child = spawnWithBash(cmd, env);
				child.stderr.on('data', (data: Buffer) => {
					console.log(data.toString());
				});
				child.on('exit', (code, signal) => {
					console.log('Sorbet exited with code', code, signal);
				});
				resolve(child);
			});
		}

		// Options to control the language client
    let clientOptions: LanguageClientOptions = {
      // Register the server for plain text documents
      documentSelector: [{ scheme: 'file', language: 'ruby' }],
      synchronize: {
        // Notify the server about changes to relevant files in the workspace
        fileEvents: workspace.createFileSystemWatcher('{**/*.rb,**/*.gemspec,**/Gemfile}')
      },
      outputChannelName: 'Sorbet Language Server',
      revealOutputChannelOn: RevealOutputChannelOn.Never
    };


    // Create the language client and start the client.
    client = new LanguageClient(
      'sorbetLanguageServer',
      'Sorbet Language Server',
      serverOptions,
      clientOptions
    );

		// Start the client. This will also launch the server
		disposableClient = client.start();
	}

	const restartLanguageServer = function (): Promise<void> {
		return new Promise((resolve) => {
			if (disposableClient) {
				client.stop().then(() => {
					disposableClient.dispose();
					startLanguageServer();
					resolve();
				});
			} else {
				startLanguageServer();
				resolve();
			}
		});
	}

	// Restart command
	var disposableRestart = vscode.commands.registerCommand('sorbet.restart', () => {
		restartLanguageServer().then(() => {
			vscode.window.showInformationMessage('Sorbet server restarted.');
		});
	});
	context.subscriptions.push(disposableRestart);

	startLanguageServer();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
