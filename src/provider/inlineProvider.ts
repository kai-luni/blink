import * as vscode from "vscode";
import { IConfigProvider } from "../config/config.js";
import { matchDisabledFile } from "../config/fileBlacklist.js";
import type { ModelConfig } from "../config/models.js";
import { ICompletionEngine } from "../completion/completionEngine.js";
import { ICompletionComposer } from "../context/composer.js";
import { Metrics } from "../metrics.js";
import { StatusStore } from "../status/statusStore.js";
import { ILogger } from "../common/logging.js";
import { token, Inject } from "../di/container.js";
import { ExtensionContext } from "../di/vscodeTokens.js";

export const DID_ACCEPT_COMMAND = "blink.didAccept";
export const TAB_ACCEPT_COMMAND = "blink.tabAccept";

// Merges with the interface below: one name serves as both type and token.
export const IInlineCompletionItemProvider =
  token<IInlineCompletionItemProvider>("inlineProvider");

export interface IInlineCompletionItemProvider
  extends vscode.InlineCompletionItemProvider {
  register(): void;
  setEnabled(enabled: boolean): void;
  setModel(model: ModelConfig | undefined): void;
  readonly lastPrompt: string | undefined;
}

/**
 * Thin VS Code adapter: gates requests, gathers context, calls the completion
 * engine and converts the result into a VS Code inline completion item.
 */
export class BlinkInlineProvider
  implements IInlineCompletionItemProvider {
  private _enabled = false;
  private _model: ModelConfig | undefined;
  private _lastPrompt: string | undefined;

  /**
   * After Tab accepts an inline suggestion, VS Code immediately asks for
   * another suggestion. Suppress requests for a short moment so the editor
   * stays quiet after acceptance.
   */
  private suppressRequestsUntil = 0;

  constructor(
    @ExtensionContext
    private readonly extensionContext: vscode.ExtensionContext,

    @IConfigProvider
    private readonly config: IConfigProvider,

    @ICompletionEngine
    private readonly engine: ICompletionEngine,

    @ICompletionComposer
    private readonly composer: ICompletionComposer,

    @Inject(Metrics)
    private readonly metrics: Metrics,

    @Inject(StatusStore)
    private readonly status: StatusStore,

    @ILogger
    private readonly log: ILogger,
  ) {}

  get lastPrompt(): string | undefined {
    return this._lastPrompt;
  }

  register(): void {
    this.extensionContext.subscriptions.push(
      vscode.languages.registerInlineCompletionItemProvider(
        { pattern: "**" },
        this,
      ),

      /*
       * Used by the Tab keybinding when an inline suggestion is visible.
       *
       * First suppress follow-up requests, then let VS Code accept the
       * currently visible inline suggestion.
       */
      vscode.commands.registerCommand(
        TAB_ACCEPT_COMMAND,
        async () => {
          this.suppressRequestsUntil = Date.now() + 500;

          this.log.info(
            "suppressing inline completions after Tab",
          );

          await vscode.commands.executeCommand(
            "editor.action.inlineSuggest.commit",
          );
        },
      ),

      vscode.workspace.onDidOpenTextDocument((document) => {
        const scheme = document.uri.scheme;

        if (scheme === "file" || scheme === "untitled") {
          this.maybePrewarm();
        }
      }),
    );
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    this.maybePrewarm();
  }

  setModel(model: ModelConfig | undefined): void {
    this._model = model;
    this.maybePrewarm();
  }

  /**
   * Prewarms the active completion client when a normal editor is active.
   */
  private maybePrewarm(): void {
    if (!this._enabled || !this._model) {
      return;
    }

    const scheme =
      vscode.window.activeTextEditor?.document.uri.scheme;

    if (scheme === "file" || scheme === "untitled") {
      this.engine.prewarm();
    }
  }

  /**
   * Returns the final path segment without requiring Node's path module.
   */
  private getFileName(document: vscode.TextDocument): string {
    const uriPath = document.uri.path;
    const slashIndex = uriPath.lastIndexOf("/");

    if (slashIndex >= 0) {
      return uriPath.slice(slashIndex + 1);
    }

    return uriPath;
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | null> {
    if (!this._enabled || !this._model) {
      return null;
    }

    /*
     * Do not immediately generate another completion after Tab accepted
     * the previous one.
     */
    if (Date.now() < this.suppressRequestsUntil) {
      return null;
    }

    const config = this.config.readConfig();
    const fileName = this.getFileName(document);

    if (
      matchDisabledFile(
        fileName,
        config.disabledFiles,
      )
    ) {
      return null;
    }

    /*
     * AbortController exists in the VS Code extension-host runtime, but this
     * project's current TypeScript configuration does not expose its type.
     */
    const AbortControllerConstructor = (
      globalThis as unknown as {
        AbortController: new () => {
          signal: any;
          abort(): void;
        };
      }
    ).AbortController;

    const controller = new AbortControllerConstructor();

    const cancellationSubscription =
      token.onCancellationRequested(() => {
        controller.abort();
      });

    try {
      const completionRequest =
        await this.composer.compose(
          document,
          position,
          config,
        );

      if (
        token.isCancellationRequested ||
        controller.signal.aborted
      ) {
        return null;
      }

      const result = await this.engine.complete(
        completionRequest,
        controller.signal,
      );

      if (
        result.text === null ||
        result.text.length === 0 ||
        token.isCancellationRequested
      ) {
        return null;
      }

      const item = new vscode.InlineCompletionItem(
        result.text,
        new vscode.Range(position, position),
      );

      item.command = {
        title: "",
        command: DID_ACCEPT_COMMAND,
      };

      return [item];
    } catch (error) {
      this.log.info(
        `provideInlineCompletionItems error: ${String(error)}`,
      );

      return null;
    } finally {
      cancellationSubscription.dispose();
    }
  }
}