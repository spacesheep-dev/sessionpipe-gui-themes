// SPDX-License-Identifier: Apache-2.0
// The office's drawing style: iso (an isometric floor) or figures (people seen from
// behind), kept per device in api.local under "style". Both styles read the same Posture.
import type { ThemeApi } from "@sessionpipe-gui/theme-types";
import { useCallback, useState } from "react";

export type OfficeStyle = "iso" | "figures";
const KEY = "style";

export function useOfficeStyle(api: ThemeApi): [OfficeStyle, (s: OfficeStyle) => void] {
  const [style, setStyle] = useState<OfficeStyle>(() => (api.local.get<string>(KEY) === "figures" ? "figures" : "iso"));
  const set = useCallback(
    (s: OfficeStyle) => {
      setStyle(s);
      api.local.set(KEY, s);
    },
    [api],
  );
  return [style, set];
}
