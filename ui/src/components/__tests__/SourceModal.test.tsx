/**
 * The provenance modal centers the cited span in its scroll window — jsdom
 * has no layout, so the geometry the centering math reads is stubbed onto
 * the prototypes before render.
 */
import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCase } from "../../test/fixtures";
import { SourceModal } from "../catchup/SourceModal";

const BOX_HEIGHT = 300;
const ITEM_HEIGHT = 40;
const CITED_OFFSET = 500;

const originalOffsetTop = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetTop",
);
const originalClientHeight = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "clientHeight",
);

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      return "anchor" in this.dataset ? CITED_OFFSET : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.dataset.testid === "source-scroll") return BOX_HEIGHT;
      return "anchor" in this.dataset ? ITEM_HEIGHT : 0;
    },
  });
});

afterAll(() => {
  if (originalOffsetTop) {
    Object.defineProperty(HTMLElement.prototype, "offsetTop", originalOffsetTop);
  }
  // clientHeight lives on Element.prototype; drop our HTMLElement shadow
  delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
  if (originalClientHeight) {
    Object.defineProperty(Element.prototype, "clientHeight", originalClientHeight);
  }
});

describe("SourceModal scroll centering", () => {
  it("scrolls the transcript so the cited segment sits mid-window", () => {
    render(
      <SourceModal
        kase={makeCase()}
        request={{ title: "Aspirin", refs: ["audio:preop-interview#s017"] }}
        onClose={() => {}}
      />,
    );
    const box = screen.getByTestId("source-scroll");
    expect(box.scrollTop).toBe(CITED_OFFSET - (BOX_HEIGHT - ITEM_HEIGHT) / 2);
  });

  it("scrolls a document so the cited chunk sits mid-window", () => {
    render(
      <SourceModal
        kase={makeCase()}
        request={{ title: "Diabetes", refs: ["doc:gp-summary#c002"] }}
        onClose={() => {}}
      />,
    );
    const box = screen.getByTestId("source-scroll");
    expect(box.scrollTop).toBe(CITED_OFFSET - (BOX_HEIGHT - ITEM_HEIGHT) / 2);
  });
});
