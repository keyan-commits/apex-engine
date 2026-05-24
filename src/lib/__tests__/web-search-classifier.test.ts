import { describe, expect, it } from "vitest";
import { classifyWebGrounding } from "../web-search-classifier";

describe("classifyWebGrounding", () => {
  it("grounds on commerce keyword alone", () => {
    const r = classifyWebGrounding("What is the current price of an iPhone 17 Pro Max?");
    expect(r.shouldGround).toBe(true);
    expect(r.triggers).toContain("commerce-keyword");
  });

  it("grounds on news keyword alone", () => {
    const r = classifyWebGrounding("Any recent news on the Voyager-2 spacecraft?");
    expect(r.shouldGround).toBe(true);
    expect(r.triggers).toContain("news-keyword");
  });

  it("grounds on temporal + product-noun-pair together", () => {
    const r = classifyWebGrounding("Latest Apexel microscope lens specs?");
    expect(r.shouldGround).toBe(true);
    expect(r.triggers).toContain("temporal-keyword");
    expect(r.triggers).toContain("product-noun-pair");
  });

  it("grounds on recent-year + temporal together", () => {
    const r = classifyWebGrounding("What are the latest events in 2025?");
    expect(r.shouldGround).toBe(true);
  });

  it("does NOT ground on a temporal keyword alone", () => {
    // "current state of the art in algorithms" is evergreen-ish — temporal
    // alone shouldn't burn quota.
    const r = classifyWebGrounding("What is the current state of the art in sorting algorithms?");
    expect(r.shouldGround).toBe(false);
    expect(r.triggers).toContain("temporal-keyword");
  });

  it("does NOT ground on a recent-year mention alone", () => {
    const r = classifyWebGrounding("Explain why 2024 was a leap year.");
    expect(r.shouldGround).toBe(false);
  });

  it("does NOT ground on an evergreen factual query", () => {
    const r = classifyWebGrounding("How does TCP slow start work?");
    expect(r.shouldGround).toBe(false);
    expect(r.triggers).toEqual([]);
  });

  it("does NOT ground on a code-help query", () => {
    const r = classifyWebGrounding("Write me a Python function that returns Fibonacci numbers.");
    expect(r.shouldGround).toBe(false);
  });

  it("grounds on product-noun-pair + recent-year", () => {
    const r = classifyWebGrounding("Apexel microscope lenses sold in 2025?");
    expect(r.shouldGround).toBe(true);
  });

  it("returns a reason string in all cases", () => {
    const grounded = classifyWebGrounding("Current pricing on a Tesla Model 3?");
    const skipped = classifyWebGrounding("Define recursion.");
    expect(grounded.reason.length).toBeGreaterThan(0);
    expect(skipped.reason.length).toBeGreaterThan(0);
  });
});
