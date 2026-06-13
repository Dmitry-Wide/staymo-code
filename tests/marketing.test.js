import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupLazyLoad } from "../src/marketing.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("setupLazyLoad", () => {
  it("fires the callback on the first interaction event", () => {
    const target = new EventTarget();
    const cb = vi.fn();
    setupLazyLoad(cb, { target, events: ["scroll", "keydown"], timeoutMs: 6000 });
    expect(cb).not.toHaveBeenCalled();
    target.dispatchEvent(new Event("scroll"));
    expect(cb).toHaveBeenCalledOnce();
  });

  it("fires only once across multiple events and the timeout", () => {
    const target = new EventTarget();
    const cb = vi.fn();
    setupLazyLoad(cb, { target, events: ["scroll", "keydown"], timeoutMs: 6000 });
    target.dispatchEvent(new Event("scroll"));
    target.dispatchEvent(new Event("keydown"));
    vi.runAllTimers();
    expect(cb).toHaveBeenCalledOnce();
  });

  it("falls back to the timeout when there is no interaction", () => {
    const target = new EventTarget();
    const cb = vi.fn();
    setupLazyLoad(cb, { target, events: ["scroll"], timeoutMs: 6000 });
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5999);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("removes its listeners after firing", () => {
    const target = new EventTarget();
    const removeSpy = vi.spyOn(target, "removeEventListener");
    setupLazyLoad(vi.fn(), { target, events: ["scroll", "keydown"], timeoutMs: 6000 });
    target.dispatchEvent(new Event("scroll"));
    expect(removeSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
  });
});
