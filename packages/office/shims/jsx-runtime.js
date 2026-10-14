// SPDX-License-Identifier: Apache-2.0
// `react/jsx-runtime` for esbuild's automatic JSX, on top of the host's createElement.
// The automatic runtime passes children inside props and the key as a third argument;
// createElement takes both in its config object.
import { createElement, Fragment } from "./react.js";

export { Fragment };
export const jsx = (type, props, key) => createElement(type, key === undefined ? props : { ...props, key });
export const jsxs = jsx;
