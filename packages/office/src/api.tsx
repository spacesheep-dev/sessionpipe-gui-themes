// SPDX-License-Identifier: Apache-2.0
// The ThemeApi, reachable from any component. The context is created on first use, not
// at import time: the host's React (shims/react.js) is only there once mount() has run.
import type { ThemeApi } from "@sessionpipe-gui/theme-types";
import { type Context, createContext, type ReactNode, useContext } from "react";

let ctx: Context<ThemeApi | null> | null = null;
const context = () => (ctx ??= createContext<ThemeApi | null>(null));

export function ApiProvider({ api, children }: { api: ThemeApi; children: ReactNode }) {
  const C = context();
  return <C.Provider value={api}>{children}</C.Provider>;
}

export function useApi(): ThemeApi {
  const api = useContext(context());
  if (!api) throw new Error("ThemeApi missing: render inside <ApiProvider>");
  return api;
}

/** The host's /s/<harness>/<id>, for an anchor's href; navigation itself goes through api.openSession. */
export const sessionHref = (harness: string, id: string) =>
  `/s/${encodeURIComponent(harness)}/${encodeURIComponent(id)}`;
