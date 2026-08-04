import * as vscode from "vscode";
import {
  BlinkConfigProvider,
  IConfigProvider,
} from "./config/config.js";
import {
  CompletionClientManager,
  ICompletionClientManager,
} from "./clients/manager.js";
import {
  BackendRegistry,
  IBackendRegistry,
} from "./clients/backends.js";
import { CompletionCache } from "./cache.js";
import {
  CompletionEngine,
  ICompletionEngine,
} from "./completion/completionEngine.js";
import { Metrics } from "./metrics.js";
import {
  EditTracker,
  IEditTracker,
} from "./edits/editTracker.js";
import {
  LspContextProvider,
  ILspContextProvider,
} from "./context/lspContext.js";
import {
  CompletionComposer,
  ICompletionComposer,
} from "./context/composer.js";
import {
  BlinkInlineProvider,
  IInlineCompletionItemProvider,
} from "./provider/inlineProvider.js";
import { StatusStore } from "./status/statusStore.js";
import { BlinkStatusBar } from "./status/statusBar.js";
import {
  ActiveFileMonitor,
  IActiveFileMonitor,
} from "./status/activeFileMonitor.js";
import {
  ReleaseNotesMonitor,
  IReleaseNotesMonitor,
} from "./status/releaseNotesMonitor.js";
import {
  Logger,
  ILogger,
} from "./common/logger.js";
import {
  BlinkExtension,
  IStatusBar,
} from "./blinkExtension.js";
import { FimTemplates } from "./completion/fimTemplates.js";
import {
  ModelDownloader,
  IModelDownloader,
} from "./setup/modelDownloader.js";
import {
  SetupController,
  ISetupController,
} from "./setup/setupController.js";
import {
  Commands,
  ICommands,
} from "./commands.js";
import {
  CudaInstaller,
  ICudaInstaller,
} from "./setup/cudaInstaller.js";
import {
  CudaController,
  ICudaController,
} from "./setup/cudaController.js";
import { Container } from "./di/container.js";
import { ExtensionContext } from "./di/vscodeTokens.js";

let blink: BlinkExtension | undefined;

export function activate(
  context: vscode.ExtensionContext,
): void {
  const logger = new Logger(context);

  try {
    const c = new Container();

    c.register(
      ExtensionContext,
      () => context,
    );

    c.register(
      ILogger,
      () => logger,
    );

    c.register(
      CompletionCache,
      () => new CompletionCache(100),
    );

    c.register(
      IConfigProvider,
      BlinkConfigProvider,
    );

    c.register(StatusStore);

    c.register(
      IStatusBar,
      BlinkStatusBar,
    );

    c.register(
      IActiveFileMonitor,
      ActiveFileMonitor,
    );

    c.register(
      IReleaseNotesMonitor,
      ReleaseNotesMonitor,
    );

    c.register(Metrics);

    c.register(
      IEditTracker,
      EditTracker,
    );

    c.register(
      ILspContextProvider,
      LspContextProvider,
    );

    c.register(
      IBackendRegistry,
      BackendRegistry,
    );

    c.register(
      ICompletionClientManager,
      CompletionClientManager,
    );

    c.register(FimTemplates);

    c.register(
      ICompletionEngine,
      CompletionEngine,
    );

    c.register(
      ICompletionComposer,
      CompletionComposer,
    );

    c.register(
      IInlineCompletionItemProvider,
      BlinkInlineProvider,
    );

    c.register(
      IModelDownloader,
      ModelDownloader,
    );

    c.register(
      ICudaInstaller,
      (cc) =>
        new CudaInstaller({
          storageDir: vscode.Uri.joinPath(
            context.globalStorageUri,
            "cuda",
          ).fsPath,
          extensionRoot: context.extensionPath,
          downloader: cc.get(
            IModelDownloader,
          ),
        }),
    );

    c.register(
      ICudaController,
      CudaController,
    );

    c.register(
      ISetupController,
      SetupController,
    );

    c.register(
      ICommands,
      Commands,
    );

    c.register(BlinkExtension);

    blink = c.get(BlinkExtension);
    blink.start();

    logger.info("blink activated");
  } catch (error) {
    const details =
      error instanceof Error
        ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
        : String(error);

    logger.error(
      `Error activating Blink extension:\n${details}`,
    );
  }
}

export function deactivate():
  | void
  | Thenable<void> {
  const disposing = blink?.dispose();
  blink = undefined;

  return disposing;
}