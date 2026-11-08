import type { Recipe } from '../recipe';
import type { Settings, SettingKey } from '../utils/settings';
import { defaultSettings } from '../utils/settings';

type ElectronAPI = Window['electron'];
type IpcCallback = (event: unknown, ...args: unknown[]) => void;

let acpUrl: string | null = null;

let webuiAgentId = 'web';

export const setWebuiAgentId = (id: string) => {
  webuiAgentId = id;
};

export const setAcpUrl = (url: string | null) => {
  acpUrl = url;
};
const asyncNoop = async () => undefined;

const localStorageSettingKey = (key: SettingKey) => `goose:setting:${key}`;

const readSetting = <K extends SettingKey>(key: K): Settings[K] | null => {
  const raw = localStorage.getItem(localStorageSettingKey(key));
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as Settings[K];
  } catch {
    return null;
  }
};

// Desktop channels with no web trigger (menu, tray, deep links) are dropped here;
// channels with a browser equivalent are mapped below.
const addDocumentListener = (
  event: string,
  handler: EventListener
): (() => void) => {
  document.addEventListener(event, handler);
  return () => document.removeEventListener(event, handler);
};

const eventSources: Record<string, (callback: IpcCallback) => () => void> = {
  'system-resume': (callback) =>
    addDocumentListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') callback(null);
    }),
  'fullscreen-change': (callback) =>
    addDocumentListener('fullscreenchange', () =>
      callback(null, !!document.fullscreenElement)
    ),
  'theme-changed': (callback) => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const handler = () => callback(null, mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  },
  'mouse-back-button-clicked': (callback) => {
    const handler = () => callback(null);
    addEventListener('popstate', handler);
    return () => removeEventListener('popstate', handler);
  },
};

const overrides: Record<string, unknown> = {
  platform: navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'win32',
  arch: 'x64',

  getAcpUrl: async () => acpUrl,
  getSecretKey: async () => null,

  getSetting: async <K extends SettingKey>(key: K): Promise<Settings[K]> =>
    readSetting(key) ?? defaultSettings[key],
  setSetting: async <K extends SettingKey>(key: K, value: Settings[K]): Promise<void> => {
    localStorage.setItem(localStorageSettingKey(key), JSON.stringify(value));
  },

  logInfo: (txt: string) => console.info(txt),
  openExternal: async (url: string) => {
    window.open(url, '_blank', 'noopener');
    return { success: true } as never;
  },
  showMessageBox: async () => ({ response: 0, checkboxChecked: false }) as never,
  showSaveDialog: async () => ({ canceled: true, filePath: null }) as never,
  showNotification: (data: { title: string; body: string }) => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(data.title, { body: data.body });
    }
  },
  createChatWindow: () => {
    window.open(location.pathname, '_blank');
  },
  getVersion: () => `${document.documentElement.dataset.gooseVersion ?? 'web'} · ${webuiAgentId}`,

  isAnyWindowFocused: async () => document.hasFocus(),
  getIsFullScreen: async () => !!document.fullscreenElement,
  setSpellcheck: (enable: boolean) => {
    document.body.spellcheck = enable;
    return enable;
  },
  getSpellcheckState: async () => true,
  setWakelock: async () => false,
  getWakelockState: async () => false,
  setMenuBarIcon: async () => true,
  getMenuBarIconState: async () => true,
  setDockIcon: async () => true,
  getDockIconState: async () => true,
  openNotificationsSettings: async () => {
    if (typeof Notification !== 'undefined') await Notification.requestPermission();
    return true;
  },

  closeWindow: () => {},
  closeApp: asyncNoop,
  reloadApp: () => location.reload(),
  refreshApp: asyncNoop,
  reactReady: () => {},
  launchApp: asyncNoop,

  checkForUpdates: async () => ({ updateInfo: null, error: null }),
  downloadUpdate: async () => ({ success: false, error: 'Web build has no updater' }),
  installUpdate: async () => ({ success: false, error: 'Web build has no updater' }),
  getUpdateState: async () => null,
  getAutoDownloadDisabled: async () => true,
  isUsingGitHubFallback: async () => false,
  onUpdaterEvent: () => {},
  restartApp: () => location.reload(),

  readGoosehints: async () => ({
    path: localStorage.getItem('goose:goosehints-path') ?? '',
    contents: localStorage.getItem('goose:goosehints') ?? '',
  }) as never,
  writeGoosehints: async (content: string) => {
    localStorage.setItem('goose:goosehints', content);
    return true;
  },
  hasAcceptedRecipeBefore: async (_recipe: Recipe) => false,
  recordRecipeHash: async (_recipe: Recipe) => true,

  listRecentDirs: async () => [],
  addRecentDir: async () => true,
  listGitWorktreeDirs: async () => [],
  getGitBranchInfo: async () => null,
  listGitBranches: async () => [],
  switchGitBranch: async () => ({ success: false, error: 'Not supported in web build' }),
  getAllowedExtensions: async () => null,

  listFiles: async () => {
    throw new Error('list-files is not supported in the web build');
  },
  selectFileOrDirectory: async () => null,
  selectRecipeFile: async () => null,
  selectImportSessionFile: async () => null,
  directoryChooser: async () => {
    throw new Error('directory-chooser is not supported in the web build');
  },
  getPathForFile: (file: File) => file.name,
  writeFile: async () => {
    throw new Error('write-file is not supported in the web build');
  },
  ensureDirectory: async () => false,
  getBinaryPath: async () => {
    throw new Error('get-binary-path is not supported in the web build');
  },
  checkForOllama: async () => false,
  openDirectoryInExplorer: async () => false,

  broadcastThemeChange: () => {},
  emit: () => {},
  hideWindow: () => {},
};

export const createElectronShim = (): ElectronAPI => {
  const base: Record<string, unknown> = {
    on: (channel: string, callback: IpcCallback) => {
      eventSources[channel]?.(callback);
    },
    off: () => {},
    onMouseBackButtonClicked: (callback: () => void) => {
      eventSources['mouse-back-button-clicked']?.(() => callback());
    },
    offMouseBackButtonClicked: () => {},
  };

  return new Proxy(base, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop in overrides) return overrides[prop];
      return asyncNoop;
    },
  }) as unknown as ElectronAPI;
};
