// SPDX-License-Identifier: Apache-2.0
// The theme module. mount() hands the host's React to the shims (see ../shims and
// scripts/build.mjs), renders <Office> into the container and returns the unmount.
import type { Theme, ThemeApi } from "@sessionpipe-gui/theme-types";
import { createRoot } from "react-dom/client";
import { ApiProvider } from "./api";
import { Office } from "./Office";
import "./office.css";

declare global {
  var __sessionpipeThemeReact: ThemeApi["react"];
}

const theme: Theme = {
  mount(container, api) {
    if (!api.react?.createRoot)
      throw new Error("this theme draws with the host's React, which the ThemeApi did not provide");
    globalThis.__sessionpipeThemeReact = api.react;
    const root = createRoot(container);
    root.render(
      <ApiProvider api={api}>
        <Office api={api} />
      </ApiProvider>,
    );
    return () => root.unmount();
  },
};

export default theme;
