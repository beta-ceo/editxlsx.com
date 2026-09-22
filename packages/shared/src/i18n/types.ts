/**
 * The message table's shape, kept apart from the tables themselves.
 *
 * Every locale file imports this type and nothing else, so adding a language is
 * adding a file rather than editing a thousand-line one, and two changes to two
 * different languages no longer touch the same lines.
 */
export interface I18nMessages {
  // UI text
  webOffice: string;
  uploadDocument: string;
  newWord: string;
  newExcel: string;
  newPowerPoint: string;
  themeLabel: string;
  themeSystem: string;
  themeLight: string;
  themeDark: string;

  // Messages
  fileSavedSuccess: string;
  documentLoaded: string;

  // Error messages
  failedToLoadEditor: string;
  unsupportedFileType: string;
  invalidFileObject: string;
  documentOperationFailed: string;
  openUrlFailed: string;
  openUrlUnreachable: string;
  editorErrorToast: string;
  editorErrorFormatMismatch: string;
  editorErrorOpenFailed: string;
  editorErrorOutOfMemory: string;
  editorOpenRetrying: string;

  // AI agent panel
  agentTitle: string;
  agentOpenTip: string;
  agentSettings: string;
  agentRoleUser: string;
  agentRoleTool: string;
  agentRoleError: string;
  agentProviderClaude: string;
  agentProviderOpenAI: string;
  agentProviderGemini: string;
  agentProviderLocal: string;
  agentProviderOllama: string;
  agentOllamaModelPlaceholder: string;
  agentOllamaHint: string;
  agentLoadModel: string;
  agentModelLoaded: string;
  agentCheckingCache: string;
  agentModelCached: string;
  /** `{size}` placeholder is replaced with the model's download size. */
  agentModelFirstDownload: string;
  agentNoWebGPU: string;
  agentLocalChatOnly: string;
  agentSwitchCloud: string;
  agentReviewMode: string;
  agentQuote: string;
  agentQuoteTip: string;
  agentClear: string;
  agentInputPlaceholder: string;
  agentSend: string;
  agentStop: string;
  agentNeedKey: string;
  agentNoSelection: string;
  agentQuotePrefix: string;
  agentStopped: string;
  agentMaxSteps: string;
  agentToolCallPrefix: string;
  agentToolErrorPrefix: string;

  // Local history: autosave and the history page
  autosaveStopped: string;
  historyChip: string;
  historyTitle: string;
  historyIntro: string;
  historyColDocument: string;
  historyColEdited: string;
  historyColSize: string;
  historyColExpires: string;
  historyNotBackup: string;
  historySearchPlaceholder: string;
  historyEmptyTitle: string;
  historyEmpty: string;
  historyEmptySearchTitle: string;
  historyEmptySearch: string;
  historyClearSearch: string;
  historyOpen: string;
  historyDelete: string;
  historyCancel: string;
  historyDeleteTitle: string;
  historyClearTitle: string;
  /** `{title}` is the file name. */
  historyDeleteConfirm: string;
  historyClearAll: string;
  historyClearConfirm: string;
  historyUnsaved: string;
  /** `{size}` is a human-readable byte size. */
  historyUsage: string;
  /** `{count}` is the number of documents currently stored. */
  historyCount: string;
  /** `{page}` and `{pages}` are 1-based page numbers. */
  historyPageInfo: string;
  historyPrev: string;
  historyNext: string;
  historyBack: string;
  historyAutosaveLabel: string;
  historyAutosaveOff: string;
  historyRetention: string;
  /** `{days}` is a whole number of days, always 2 or more (see historyExpiresInOne). */
  historyExpiresIn: string;
  historyExpiresInOne: string;
  historyExpiresToday: string;
  /** Row action: write this snapshot straight to disk, without opening it. */
  historyDownload: string;
  historyDownloadFailed: string;
  /** Toolbar filter: only the documents that were never exported to disk. */
  historyOnlyUnsaved: string;
  historyOpenFile: string;
  historyRailSettings: string;
  historyRailRetention: string;

  // Cloud Excel SaaS (Appwrite auth + workbooks)
  cloudSignIn: string;
  cloudSignUp: string;
  cloudSignOut: string;
  cloudEmail: string;
  cloudPassword: string;
  cloudNameOptional: string;
  cloudPasswordHint: string;
  cloudHaveAccount: string;
  cloudNeedAccount: string;
  cloudAuthFailed: string;
  cloudFilesTitle: string;
  cloudFilesIntro: string;
  cloudNewWorkbook: string;
  cloudNewDocument: string;
  cloudNewFolder: string;
  /** Shown when a New-menu action is not wired to cloud storage yet. */
  cloudComingSoon: string;
  cloudUploadWorkbook: string;
  cloudEmptyTitle: string;
  cloudEmpty: string;
  cloudEmptySearchTitle: string;
  cloudEmptySearch: string;
  cloudOpen: string;
  cloudDelete: string;
  cloudDeleteTitle: string;
  /** `{title}` is the workbook name. */
  cloudDeleteConfirm: string;
  cloudCancel: string;
  cloudSearchPlaceholder: string;
  cloudColDocument: string;
  cloudColEdited: string;
  cloudColSize: string;
  cloudBack: string;
  cloudSaved: string;
  cloudSaveFailed: string;
  cloudAutosaveStopped: string;
  cloudOpenFailed: string;
  cloudNotConfigured: string;
  cloudSignedInAs: string;
  cloudOpenEditor: string;
  cloudNavHome: string;
  cloudNavDirectory: string;
  cloudNavWorkspace: string;
  cloudAllDocuments: string;
  cloudNavDocuments: string;
  cloudStorage: string;
  /** `{size}` is a formatted byte count. */
  cloudStorageUsed: string;
  cloudExport: string;
  /** `{when}` is a relative time, such as "2 hours ago". */
  cloudSavedWhen: string;
  cloudSelectWorkbook: string;
  cloudWorkspaceMine: string;
  cloudNew: string;
  cloudHelp: string;
  cloudOpeningWorkbook: string;
  cloudOpenFailedTitle: string;
  /** Shown when the framed editor never posts shell:workbook-ready. */
  cloudOpenTimedOut: string;
  /** Shown when the editor page loaded but its JS bundle never ran. */
  cloudOpenBootFailed: string;
  cloudSaveStatusSaving: string;
  /** Local IDB write done; Appwrite upload still in flight. */
  cloudSaveStatusLocal: string;
  cloudSaveStatusSaved: string;
  cloudSaveStatusError: string;
}
