/**
 * CodeLens — Endpoint Tree View Provider
 *
 * Renders a hierarchical VS Code TreeView for discovered API endpoints:
 *   Level 0: Framework groups (e.g., "FastAPI (12 endpoints)")
 *   Level 1: Individual endpoints ("GET /users/{id}")
 *   Level 2: Endpoint details (params, response schemas, auth, side effects)
 *
 * Tree items at Level 1 carry a command that opens the handler's source file
 * at the exact line where the route is declared.
 *
 * @module ui/treeView
 */
import * as vscode from 'vscode';
import { EndpointRecord, PipelineResult, SupportedFramework } from '../shared/types';
/** The kind of detail displayed at tree Level 2 */
type DetailKind = 'param' | 'response' | 'auth' | 'sideEffect' | 'info';
/**
 * Represents a single node in the endpoint tree.
 *
 * There are three levels:
 *  - **framework** — collapsible group header
 *  - **endpoint**  — individual route, clickable → opens source
 *  - **detail**    — leaf node showing a single attribute of the endpoint
 */
export declare class EndpointTreeItem extends vscode.TreeItem {
    /** The level within the tree hierarchy (0, 1, or 2). */
    readonly level: number;
    /** Framework key — only present on level-0 and level-1 items. */
    readonly framework?: SupportedFramework;
    /** The underlying endpoint record — only present on level-1 and level-2 items. */
    readonly endpoint?: EndpointRecord;
    /** Detail kind — only present on level-2 items. */
    readonly detailKind?: DetailKind;
    /**
     * @param label      - Display label for the tree node
     * @param level      - Hierarchy depth (0 = framework, 1 = endpoint, 2 = detail)
     * @param collapsibleState - Whether the item is expandable
     * @param options    - Optional metadata attached to the node
     */
    constructor(label: string, level: number, collapsibleState: vscode.TreeItemCollapsibleState, options?: {
        framework?: SupportedFramework;
        endpoint?: EndpointRecord;
        detailKind?: DetailKind;
    });
}
/**
 * VS Code TreeDataProvider that displays discovered API endpoints grouped by
 * framework. Call {@link refresh} with new pipeline results to update the view.
 *
 * Register in the extension activation with:
 * ```ts
 * const provider = new EndpointTreeProvider(workspaceRoot);
 * vscode.window.registerTreeDataProvider('codelensEndpoints', provider);
 * ```
 */
export declare class EndpointTreeProvider implements vscode.TreeDataProvider<EndpointTreeItem> {
    private _onDidChangeTreeData;
    /** Fires when the tree data should be refreshed. */
    readonly onDidChangeTreeData: vscode.Event<EndpointTreeItem | undefined | null | void>;
    /** Endpoints grouped by framework key */
    private frameworkGroups;
    /** Absolute workspace root (used to resolve relative source-file paths). */
    private workspaceRoot;
    /**
     * @param workspaceRoot Absolute path to the VS Code workspace root folder.
     */
    constructor(workspaceRoot: string);
    /**
     * Return the VS Code tree item representation for a given element.
     */
    getTreeItem(element: EndpointTreeItem): vscode.TreeItem;
    /**
     * Return children for the given element, or top-level items when
     * `element` is `undefined`.
     *
     * - **No element** → framework group nodes (Level 0)
     * - **Level 0** → endpoint nodes for that framework (Level 1)
     * - **Level 1** → detail nodes for that endpoint (Level 2)
     * - **Level 2** → no children (leaf)
     */
    getChildren(element?: EndpointTreeItem): EndpointTreeItem[];
    /**
     * Replace the tree contents with the results of a new pipeline run.
     *
     * @param result The completed pipeline result containing all endpoints.
     */
    refresh(result: PipelineResult): void;
    /**
     * Clear the tree completely.
     */
    clear(): void;
    /**
     * Dispose of internal resources.
     */
    dispose(): void;
    /**
     * Build the top-level nodes, one per detected framework.
     */
    private buildFrameworkNodes;
    /**
     * Build endpoint nodes for a given framework.
     */
    private buildEndpointNodes;
    /**
     * Build detail nodes for an individual endpoint (params, responses, auth,
     * side effects).
     */
    private buildDetailNodes;
    /**
     * Create a detail node for a single parameter.
     */
    private paramDetailItem;
    /**
     * Create a detail node for a single response schema.
     */
    private responseDetailItem;
    /**
     * Create a detail node for authentication info.
     */
    private authDetailItem;
    /**
     * Create a detail node for a single side effect.
     */
    private sideEffectDetailItem;
    /**
     * Build a rich Markdown tooltip for an endpoint tree item.
     */
    private buildEndpointTooltip;
}
export {};
//# sourceMappingURL=treeView.d.ts.map