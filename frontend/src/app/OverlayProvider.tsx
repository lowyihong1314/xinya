import { Fragment, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type OverlayRenderer = (close: () => void) => ReactNode;

type OverlayEntry = {
  id: number;
  key?: string;
  render: OverlayRenderer;
};

type OverlayBridge = {
  open: (render: OverlayRenderer, options?: { key?: string }) => () => void;
};

const overlayBridgeStack: OverlayBridge[] = [];

let nextOverlayId = 1;

function getActiveOverlayBridge() {
  return overlayBridgeStack[overlayBridgeStack.length - 1] || null;
}

function registerOverlayBridge(bridge: OverlayBridge) {
  overlayBridgeStack.push(bridge);

  return () => {
    const index = overlayBridgeStack.lastIndexOf(bridge);
    if (index !== -1) {
      overlayBridgeStack.splice(index, 1);
    }
  };
}

export function openOverlay(render: OverlayRenderer, options?: { key?: string }) {
  const bridge = getActiveOverlayBridge();
  if (!bridge) {
    console.warn("OverlayProvider is not mounted; overlay request was ignored.");
    return () => {};
  }

  return bridge.open(render, options);
}

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<OverlayEntry[]>([]);

  useEffect(() => {
    const unregister = registerOverlayBridge({
      open(render, options) {
        const id = nextOverlayId++;

        setEntries((current) => {
          const nextEntries = options?.key ? current.filter((entry) => entry.key !== options.key) : current;
          return [
            ...nextEntries,
            {
              id,
              key: options?.key,
              render,
            },
          ];
        });

        return () => {
          setEntries((current) => current.filter((entry) => entry.id !== id));
        };
      },
    });

    return unregister;
  }, []);

  return (
    <>
      {children}
      {typeof document !== "undefined" && entries.length
        ? createPortal(
            entries.map((entry) => (
              <Fragment key={entry.id}>
                {entry.render(() => {
                  setEntries((current) => current.filter((currentEntry) => currentEntry.id !== entry.id));
                })}
              </Fragment>
            )),
            document.body,
          )
        : null}
    </>
  );
}
