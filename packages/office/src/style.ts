// SPDX-License-Identifier: Apache-2.0
// The office's drawing style: figures (people at desks) or plan (a floor plan), kept per
// device in api.local under "style". Both styles read the same Posture.
import type { ThemeApi } from "@sessionpipe-gui/theme-types";
import { useCallback, useState } from "react";

export type OfficeStyle = "figures" | "plan";
const KEY = "style";

export function useOfficeStyle(api: ThemeApi): [OfficeStyle, (s: OfficeStyle) => void] {
  const [style, setStyle] = useState<OfficeStyle>(() =>
    api.local.get<string>(KEY) === "figures" ? "figures" : "plan",
  );
  const set = useCallback(
    (s: OfficeStyle) => {
      setStyle(s);
      api.local.set(KEY, s);
    },
    [api],
  );
  return [style, set];
}
