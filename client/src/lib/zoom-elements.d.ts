/**
 * The Video SDK's custom element, typed for JSX.
 *
 * `<video-player-container>` is where every video in a call is rendered. React
 * 19 renders custom elements natively; TypeScript only needs telling that this
 * tag exists and what its ref points at.
 *
 * Only the container is declared. The `<video-player>` elements inside it are
 * created by the SDK's `attachVideo` and appended by the call component — they
 * never appear in JSX, so a type for them here would be a declaration nothing
 * uses.
 *
 * `import type` keeps this file free of runtime code: the SDK touches `window`
 * and WebAssembly on load, and must only ever be evaluated in the browser.
 */

import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "video-player-container": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
