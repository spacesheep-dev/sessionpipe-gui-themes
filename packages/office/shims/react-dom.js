// SPDX-License-Identifier: Apache-2.0
// `react-dom`: the host's createPortal (api.react.ReactDOM), looked up when called.
export const createPortal = (...a) => globalThis.__sessionpipeThemeReact.ReactDOM.createPortal(...a);
