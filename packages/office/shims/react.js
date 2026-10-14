// SPDX-License-Identifier: Apache-2.0
// `react`, resolved at runtime to the host's React (api.react.React), which mount() puts
// on globalThis.__sessionpipeThemeReact before the first render. Every export is a thin
// wrapper that looks the real function up when called, so the bundle never carries a copy
// of React and nothing here runs at import time. Only what the theme uses is exported;
// an import of anything else fails at build time, which is the point.
const R = () => globalThis.__sessionpipeThemeReact.React;

export const useState = (...a) => R().useState(...a);
export const useEffect = (...a) => R().useEffect(...a);
export const useMemo = (...a) => R().useMemo(...a);
export const useRef = (...a) => R().useRef(...a);
export const useCallback = (...a) => R().useCallback(...a);
export const useId = (...a) => R().useId(...a);
export const useContext = (...a) => R().useContext(...a);
export const useSyncExternalStore = (...a) => R().useSyncExternalStore(...a);
export const createContext = (...a) => R().createContext(...a);
export const createElement = (...a) => R().createElement(...a);
/** The well-known registered symbol React 17+ uses for <>…</>; the same value as
 *  React.Fragment, available before the host's React is. */
export const Fragment = Symbol.for("react.fragment");
